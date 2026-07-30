const { logger } = require("@because/data-schemas");
const { getDatDatasourceModel } = require("~/models/DatDatasource");
const { getConvo } = require("~/models/Conversation");
const { Conversation } = require("~/db/models");
const { getDataSourceByAgentId } = require("~/server/services/DataSource");
const { resolveAccessibleOrgCodes } = require("~/server/utils/orgDataScope");
const {
  getSettingsCache,
  setSettingsCache,
  getOrgUnitsCache,
  setOrgUnitsCache,
} = require("~/server/services/OrgPermissionCache");

/** @type {Record<string, import('./McpContextResolver').ContextInjectionConfig | Record<string, import('./McpContextResolver').ContextInjectionConfig>>} */
const DEFAULT_CONTEXT_INJECTION = {
  "becauseai-server": {
    ask_data: {
      resolve: [
        { from: "requestBody", field: "datasourceId" },
        { from: "conversation" },
        { from: "agentBinding" },
      ],
      // 与 Because.yaml 中的协议保持一致：arg4=机构编码，arg5=用户问题
      inject: {
        projectId: "projectId",
        arg1: "projectId",
        arg2: "datasourceId",
        arg4: "orgCode",
        arg5: "question",
      },
      hideFromSchema: ["projectId", "arg1", "arg2", "arg4"],
    },
    agents: {
      resolve: [
        { from: "requestBody", field: "datasourceId" },
        { from: "conversation" },
        { from: "agentBinding" },
      ],
      inject: {
        projectId: "projectId",
        arg1: "projectId",
        datasourceId: "datasourceId",
      },
      hideFromSchema: ["projectId", "arg1", "datasourceId"],
    },
  },
  "analysis-server": {
    resolve: [
      { from: "requestBody", field: "datasourceId" },
      { from: "conversation" },
      { from: "agentBinding" },
    ],
    inject: {
      projectId: "projectId",
      datasourceId: "datasourceId",
    },
    hideFromSchema: ["projectId", "datasourceId"],
  },
};

/** @type {Map<string, { projectId: string, datasourceId: string, expiresAt: number }>} */
const datasourceCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * @typedef {{ from: 'conversation' | 'requestBody' | 'agentBinding', field?: string }} ResolveSource
 * @typedef {{ resolve: ResolveSource[], inject: Record<string, string>, hideFromSchema?: string[] }} ContextInjectionConfig
 * @typedef {{ projectId: string, datasourceId: string, source?: string, orgCode?: string }} McpExecutionContext
 */

/**
 * @param {string} serverName
 * @param {Record<string, unknown> | undefined} mcpConfig
 * @param {string} [toolName]
 * @returns {ContextInjectionConfig | null}
 */
function getContextInjectionConfig(serverName, mcpConfig, toolName) {
  const fromConfig = mcpConfig?.[serverName]?.contextInjection;
  if (toolName && fromConfig?.[toolName]?.inject && fromConfig?.[toolName]?.resolve) {
    return fromConfig[toolName];
  }
  if (fromConfig?.inject && fromConfig?.resolve) {
    return fromConfig;
  }

  const defaults = DEFAULT_CONTEXT_INJECTION[serverName];
  if (defaults) {
    if (toolName && defaults[toolName]?.inject && defaults[toolName]?.resolve) {
      return defaults[toolName];
    }
    if (defaults.inject && defaults.resolve) {
      return defaults;
    }
  }

  // 兜底：Because.yaml 里 MCP server 的 key 是管理员自定义的显示名字（比如把
  // becauseai-server 改叫 dat），跟这里硬编码的 key 对不上时，DEFAULT_CONTEXT_INJECTION[serverName]
  // 会直接查空，导致 projectId/datasourceId 注入被整体静默跳过（现网真实出现过：改名后
  // ask_data 一直只带 arg5，DAT 引擎报 "requires projectId"）。
  // ask_data/agents 是具体、不易与其它 MCP 工具重名的命令，按 toolName 在所有预置配置里
  // 兜底查找一次，不强依赖 server 名字必须完全一致，避免改名字就整体失效。
  if (toolName) {
    for (const serverDefaults of Object.values(DEFAULT_CONTEXT_INJECTION)) {
      if (serverDefaults?.[toolName]?.inject && serverDefaults?.[toolName]?.resolve) {
        return serverDefaults[toolName];
      }
    }
  }

  return null;
}

/**
 * Remove injected params from tool JSON schema so the model does not fill them.
 * @param {Record<string, unknown> | undefined} parameters
 * @param {string[] | undefined} hideFromSchema
 * @returns {Record<string, unknown> | undefined}
 */
function stripHiddenParamsFromSchema(parameters, hideFromSchema) {
  if (!parameters?.properties || !hideFromSchema?.length) {
    return parameters;
  }

  const hidden = new Set(hideFromSchema);
  const hasHidden = hideFromSchema.some((key) => key in parameters.properties);
  if (!hasHidden) {
    return parameters;
  }

  const modified = { ...parameters, properties: { ...parameters.properties } };
  for (const key of hidden) {
    delete modified.properties[key];
  }
  if (Array.isArray(modified.required)) {
    modified.required = modified.required.filter((r) => !hidden.has(r));
  }
  return modified;
}

/**
 * @param {string} datasourceId
 * @returns {Promise<{ projectId: string, datasourceId: string } | null>}
 */
async function lookupDatasource(datasourceId) {
  const cached = datasourceCache.get(datasourceId);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      projectId: cached.projectId,
      datasourceId: cached.datasourceId,
    };
  }

  const DatDatasource = await getDatDatasourceModel();
  const dataSource = await DatDatasource.findById(datasourceId).lean();
  if (dataSource) {
    logger.info(
      `[McpContext] Datasource ${datasourceId}: provider=${dataSource.provider}, configurationKeys=${JSON.stringify(Object.keys(dataSource.configuration || {}))}`,
    );
  }
  if (!dataSource?.projectId) {
    return null;
  }

  const ctx = {
    projectId: String(dataSource.projectId),
    datasourceId: String(datasourceId),
  };
  datasourceCache.set(datasourceId, { ...ctx, expiresAt: Date.now() + CACHE_TTL_MS });
  return ctx;
}

/**
 * @param {string} datasourceId
 * @returns {Promise<McpExecutionContext | null>}
 */
async function resolveFromDatasourceId(datasourceId, source) {
  const ctx = await lookupDatasource(datasourceId);
  if (!ctx) {
    return null;
  }
  return { ...ctx, source };
}

/**
 * @param {ResolveSource[]} resolveSources
 * @param {object} params
 * @param {import('@langchain/core/runnables').RunnableConfig['configurable']} [params.configurable]
 * @returns {Promise<McpExecutionContext | null>}
 */
async function resolveMcpExecutionContext({ resolveSources, configurable }) {
  const requestBody = configurable?.requestBody;
  const userId = configurable?.user?.id || configurable?.user_id;
  const conversationId = requestBody?.conversationId;
  const agentId = configurable?.last_agent_id;

  for (const source of resolveSources) {
    if (source.from === "conversation" && userId && conversationId) {
      try {
        const convo = await getConvo(userId, conversationId);
        const stored = convo?.agentOptions?.mcpContext;
        if (stored?.datasourceId && stored?.projectId) {
          return {
            projectId: String(stored.projectId),
            datasourceId: String(stored.datasourceId),
            source: "conversation",
          };
        }
        if (stored?.datasourceId) {
          const ctx = await resolveFromDatasourceId(stored.datasourceId, "conversation");
          if (ctx) {
            return ctx;
          }
        }
      } catch (error) {
        logger.warn("[McpContext] Failed to read conversation mcpContext:", error);
      }
    }

    if (source.from === "requestBody") {
      const field = source.field || "datasourceId";
      const rawId = requestBody?.[field];
      if (rawId) {
        const ctx = await resolveFromDatasourceId(String(rawId), "requestBody");
        if (ctx) {
          return ctx;
        }
      }
    }

    if (source.from === "agentBinding" && agentId) {
      try {
        const dataSource = await getDataSourceByAgentId(agentId);
        if (dataSource?._id && dataSource?.projectId) {
          return {
            projectId: String(dataSource.projectId),
            datasourceId: String(dataSource._id),
            source: "agentBinding",
          };
        }
      } catch (error) {
        logger.warn("[McpContext] Agent binding lookup failed:", error);
      }
    }

    // 默认数据源回退：取第一个启用的数据源
    if (source.from === "agentBinding") {
      // agentBinding 作为最后一个 resolve source 且没命中时，回退到默认数据源
      continue;
    }
  }

  // 所有来源均未命中 → fallback 到默认数据源（第一个启用的）
  try {
    const DatDatasource = await getDatDatasourceModel();
    const defaultDs = await DatDatasource.findOne({ enabled: true }).sort({ createdAt: 1 }).lean();
    if (defaultDs?._id && defaultDs?.projectId) {
      logger.info(
        `[McpContext] Fallback to default datasource: ${defaultDs._id}, projectId=${defaultDs.projectId}`,
      );
      return {
        projectId: String(defaultDs.projectId),
        datasourceId: String(defaultDs._id),
        source: "default",
      };
    }
  } catch (error) {
    logger.warn("[McpContext] Default datasource fallback failed:", error);
  }

  return null;
}

/**
 * Persist resolved context on the conversation (fire-and-forget).
 * @param {object} params
 */
function persistConversationMcpContext({ userId, conversationId, context }) {
  if (!userId || !conversationId || !context?.datasourceId) {
    return;
  }

  Conversation.findOneAndUpdate(
    { user: userId, conversationId },
    {
      $set: {
        "agentOptions.mcpContext": {
          datasourceId: context.datasourceId,
          projectId: context.projectId,
        },
      },
    },
  ).catch((error) => {
    logger.warn("[McpContext] Failed to persist conversation mcpContext:", error);
  });
}

/**
 * Merge execution context into tool arguments without overwriting explicit LLM values.
 * @param {Record<string, unknown>} toolArguments
 * @param {McpExecutionContext} context
 * @param {Record<string, string>} injectMap
 * @param {string[]} [hideFromSchema]
 */
function applyContextInjection(toolArguments, context, injectMap, hideFromSchema = []) {
  const hidden = new Set(hideFromSchema);
  const result = { ...toolArguments };

  // question 文本的来源：先按 inject 映射反查哪个工具参数承载 question（如新协议的 arg5），
  // 再回退到通用语义字段。不能再写死 arg4：协议升级后 arg4 已是 orgCode。
  const questionParam = Object.entries(injectMap).find(([, src]) => src === "question")?.[0];
  const question =
    (questionParam ? result[questionParam] : undefined) ??
    result.question ??
    result.query ??
    result.prompt ??
    result.input;

  for (const [toolParam, contextField] of Object.entries(injectMap)) {
    const value = contextField === "question" ? question : context[contextField];
    if (value == null || value === "") {
      continue;
    }
    if (result[toolParam] != null && result[toolParam] !== "") {
      continue;
    }
    result[toolParam] = value;
  }

  for (const key of hidden) {
    if (result[key] == null || result[key] === "") {
      delete result[key];
    }
  }

  return result;
}

/**
 * 平台级机构编码解析。
 * 优先级：existing（已有值）> requestBody.orgCode（接口显式传）> user.orgCode（用户表/JWT）。
 * 不依赖 DAT 数据源/项目上下文，可供 MCP 注入、结构化工具、评测路径统一复用。
 *
 * @param {object} [params]
 * @param {Record<string, unknown>} [params.requestBody]
 * @param {{ orgCode?: string } | null} [params.user]
 * @param {string} [params.existing]
 * @returns {string | undefined}
 */
function resolveOrgCode({ requestBody, user, existing } = {}) {
  if (existing != null && existing !== "") {
    return String(existing);
  }
  const requestBodyOrgCode = requestBody?.orgCode;
  const userOrgCode = user?.orgCode;
  const candidate =
    requestBodyOrgCode != null && requestBodyOrgCode !== ""
      ? requestBodyOrgCode
      : userOrgCode;
  if (candidate == null || candidate === "") {
    return undefined;
  }
  return String(candidate);
}

/**
 * inject 映射是否需要数据源/项目上下文（projectId / datasourceId）。
 * 仅声明 orgCode（及 question 等非数据源字段）时，即使没有数据源也可注入。
 * @param {Record<string, string> | undefined} injectMap
 * @returns {boolean}
 */
function injectNeedsDatasourceContext(injectMap) {
  if (!injectMap) {
    return false;
  }
  return Object.values(injectMap).some(
    (field) => field === "projectId" || field === "datasourceId",
  );
}

/**
 * 读取机构权限设置文档（带缓存）。`enforcementEnabled`（MCP 门禁）与
 * `sqlEnforcementEnabled`（Because-jn sql-executor 强制校验/改写）共用同一份
 * 缓存文档，避免两个开关各自查一次库。
 * @returns {Promise<{ enforcementEnabled: boolean, sqlEnforcementEnabled: boolean }>}
 */
async function getOrgPermissionSettings() {
  const cached = getSettingsCache();
  if (cached.value != null && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const fallback = { enforcementEnabled: false, sqlEnforcementEnabled: false };
  try {
    const { OrgPermissionSettings } = require("~/db/models");
    if (!OrgPermissionSettings) {
      return fallback;
    }
    const settings = await OrgPermissionSettings.findOne({ configId: "default" }).lean();
    const value = settings || fallback;
    setSettingsCache(value);
    return value;
  } catch (error) {
    logger.warn("[OrgPermission] Failed to load settings, treat as disabled:", error);
    return fallback;
  }
}

async function isEnforcementEnabled() {
  const settings = await getOrgPermissionSettings();
  return Boolean(settings.enforcementEnabled);
}

/**
 * 独立于 `isEnforcementEnabled`（MCP 门禁）：控制 Because-jn 的
 * sql-executor 是否按机构权限强制校验/改写 SQL。默认关闭。
 */
async function isSqlEnforcementEnabled() {
  const settings = await getOrgPermissionSettings();
  return Boolean(settings.sqlEnforcementEnabled);
}

async function getOrgUnits() {
  const cached = getOrgUnitsCache();
  if (cached.value != null && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  try {
    const { OrgPermissionUnit } = require("~/db/models");
    if (!OrgPermissionUnit) {
      return [];
    }
    const units = await OrgPermissionUnit.find({}).lean();
    setOrgUnitsCache(units);
    return units;
  } catch (error) {
    logger.warn("[OrgPermission] Failed to load org units:", error);
    return [];
  }
}

/**
 * 开关开启时，对声明了 orgCode 注入的 MCP 工具做门禁校验。
 * 不改写工具参数；仅校验 orgCode 合法且 dataScope 可解析出非空可访问范围。
 */
async function assertOrgCodeAllowed({ serverName, toolName, orgCode, injectMap }) {
  const needsOrgCode = Object.values(injectMap || {}).includes("orgCode");
  if (!needsOrgCode) {
    return;
  }
  if (!(await isEnforcementEnabled())) {
    return;
  }

  if (orgCode == null || orgCode === "") {
    throw new Error(
      `[MCP][${serverName}][${toolName}] 机构权限校验失败：未提供机构编码 orgCode`,
    );
  }

  const orgUnits = await getOrgUnits();
  const { scope, orgCodes } = resolveAccessibleOrgCodes(orgCode, orgUnits);
  if (!scope || orgCodes.length === 0) {
    throw new Error(
      `[MCP][${serverName}][${toolName}] 机构权限校验失败：机构编码 ${orgCode} 不存在、已禁用或未配置权限级别`,
    );
  }

  logger.info(
    `[MCP][${serverName}][${toolName}] orgCode=${orgCode} dataScope=${scope} accessibleCount=${orgCodes.length}`,
  );
}

/**
 * Resolve datasource context and inject into MCP tool arguments.
 * @param {object} params
 * @param {string} params.serverName
 * @param {string} [params.toolName]
 * @param {Record<string, unknown>} params.toolArguments
 * @param {import('@langchain/core/runnables').RunnableConfig['configurable']} [params.configurable]
 * @param {Record<string, unknown>} [params.mcpConfig]
 * @returns {Promise<Record<string, unknown>>}
 */
async function resolveAndInjectMcpContext({
  serverName,
  toolName,
  toolArguments,
  configurable,
  mcpConfig,
}) {
  const rules = getContextInjectionConfig(serverName, mcpConfig, toolName);
  if (!rules) {
    return toolArguments;
  }

  const args =
    typeof toolArguments === "string"
      ? (() => {
          try {
            return JSON.parse(toolArguments);
          } catch {
            return { input: toolArguments };
          }
        })()
      : { ...toolArguments };

  // 机构编码与数据源上下文解耦：始终先解析，哪怕后续没有 project/datasource
  const orgCode = resolveOrgCode({
    requestBody: configurable?.requestBody,
    user: configurable?.user,
  });

  // 门禁校验：开关关闭时直接跳过（现状回归）
  await assertOrgCodeAllowed({
    serverName,
    toolName,
    orgCode,
    injectMap: rules.inject,
  });

  const needsDatasource = injectNeedsDatasourceContext(rules.inject);
  const hasResolveSources = Array.isArray(rules.resolve) && rules.resolve.length > 0;

  let context = null;
  if (needsDatasource || hasResolveSources) {
    context = await resolveMcpExecutionContext({
      resolveSources: rules.resolve || [],
      configurable,
    });
  }

  if (!context) {
    if (needsDatasource) {
      logger.warn(
        `[MCP][${serverName}] No datasource context resolved. Select a datasource or bind one to the agent.`,
      );
      return args;
    }
    // 仅需 orgCode（或其他非数据源字段）时，用最小上下文继续注入
    if (orgCode == null) {
      return args;
    }
    context = { orgCode, source: "orgCodeOnly" };
  } else if (orgCode != null && context.orgCode == null) {
    context.orgCode = orgCode;
  }

  logger.info(
    `[MCP][${serverName}] Context resolved (source=${context.source}): projectId=${context.projectId || "-"}, datasourceId=${context.datasourceId || "-"}, orgCode=${context.orgCode || "-"}`,
  );

  const userId = configurable?.user?.id || configurable?.user_id;
  const conversationId = configurable?.requestBody?.conversationId;
  if (context.source === "requestBody" && userId && conversationId) {
    persistConversationMcpContext({ userId, conversationId, context });
  }

  return applyContextInjection(
    args,
    context,
    rules.inject,
    rules.hideFromSchema,
  );
}

module.exports = {
  DEFAULT_CONTEXT_INJECTION,
  getContextInjectionConfig,
  stripHiddenParamsFromSchema,
  resolveAndInjectMcpContext,
  resolveMcpExecutionContext,
  resolveOrgCode,
  injectNeedsDatasourceContext,
  assertOrgCodeAllowed,
  isEnforcementEnabled,
  isSqlEnforcementEnabled,
  getOrgUnits,
  applyContextInjection,
  lookupDatasource,
};
