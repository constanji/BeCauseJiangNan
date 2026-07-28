const express = require("express");
const {
  requireJwtAuth,
  buildEndpointOption,
  configMiddleware,
} = require("~/server/middleware");
const { getAgent } = require("~/models/Agent");
const { getProviderConfig } = require("~/server/services/Endpoints/index");
const { getAppConfig } = require("~/server/services/Config");
const { isAgentsEndpoint, EModelEndpoint } = require("@because/data-provider");
const { logger } = require("@because/data-schemas");

const router = express.Router();
router.use(requireJwtAuth);
router.use(configMiddleware);

router.use(async (req, res, next) => {
  try {
    const { endpoint, agent_id, model } = req.body;

    // 1. Resolve agent if agent_id is provided
    if (isAgentsEndpoint(endpoint) && agent_id) {
      const agent = await getAgent({ id: agent_id });
      if (agent) {
        const provider = agent.provider || EModelEndpoint.openAI;
        const resolvedModel = model || agent.model_parameters?.model || agent.model;

        req.body.endpoint = provider;
        req.body.model = resolvedModel;

        // Merge agent parameters
        req.body = {
          ...agent.model_parameters,
          ...req.body,
          endpoint: req.body.endpoint,
          model: req.body.model,
        };

        logger.debug(
          `[api/optimize] Resolved agent ${agent_id} to provider: ${req.body.endpoint}, model: ${req.body.model}`,
        );
      }
    }

    // 2. Ensure endpointType is set correctly for native vs custom endpoints
    const currentEndpoint = req.body.endpoint;
    if (currentEndpoint) {
      const isNative = Object.values(EModelEndpoint).includes(currentEndpoint);
      if (!isNative) {
        req.body.endpointType = EModelEndpoint.custom;
      } else {
        req.body.endpointType = currentEndpoint;
      }
    }

    next();
  } catch (err) {
    logger.error("[api/optimize] Error resolving agent endpoint", err);
    next();
  }
});

router.use(buildEndpointOption);

router.post("/", async (req, res) => {
  try {
    const { text, agent_id, endpoint } = req.body;
    let instructions = "";

    if (agent_id) {
      const agent = await getAgent({ id: agent_id });
      if (agent && agent.instructions) {
        instructions = agent.instructions;
      }
    }

    const appConfig = await getAppConfig();

    const { getOptions, customEndpointConfig, overrideProvider } =
      getProviderConfig({
        provider: endpoint || "openAI",
        appConfig,
      });

    const initFn = getOptions;

    // 我们将为请求的端点初始化标准客户端
    const { client } = await initFn({
      req,
      res,
      endpointOption: {
        ...req.body.endpointOption,
        useChatCompletion: true,
      },
      customEndpointConfig,
      overrideEndpoint: overrideProvider,
      optionsOnly: false,
    });

    if (!client) {
      throw new Error(`Failed to initialize client for endpoint: ${endpoint}`);
    }

    const systemPrompt = `以下是针对你的**数据分析智能体**深度优化后的提示词优化 Prompt：

---

**【数据分析提问优化专家】**

你是一名专业的提问优化助手，服务于一个**数据分析智能体**。该智能体具备两种核心能力：**简单问数**（查询指标数值）和**归因分析**（多维下钻、贡献度计算、趋势解读）。

你的唯一任务是：将用户输入的口语化、模糊提问，改写为一段**更专业、描述精准、能让数据分析智能体准确识别任务类型并高效执行**的指令文本。

---

**优化规则如下：**

**1. 任务类型识别与强化**
判断用户提问属于"简单问数"还是"归因分析"，并在优化后的指令中使用准确信号词引导智能体进入正确的执行模式：
- 简单问数：使用"查询 / 统计 / 列出 / 对比 / 排名"等关键词
- 归因分析：使用"分析原因 / 归因 / 解释下降 / 排查异常 / 拆解波动"等关键词

**2. 指标明确化**
口语化描述中缺失的核心指标必须还原或补全，例如：
- "卖得怎么样" → 补全为"销售额（万元）/ 订单量 / 客单价"
- "效果不好" → 补全为"转化率 / GMV / 新增用户数"

**3. 时间范围精确化**
- 模糊时间（"最近""上个月""这段时间"）→ 还原为具体统计区间，如"2025年3月1日至3月31日"
- 若需对比，明确说明对比基准期（同比：上一年同期 / 环比：上一周期）

**4. 分析维度补全**
归因类提问需补全需要下钻的维度，例如：
- 地区维度（华东/华南/一二线城市）
- 渠道维度（线上/线下/第三方平台）
- 用户类型（新用户/老用户）
- 产品线/品类/SKU 级别

**5. 输出要求显式化**
若用户期望有报告或图表，在优化后的指令末尾明确说明，例如：
- "请生成包含趋势图和维度对比图的归因分析报告"
- "仅返回查询结果数值，无需分析"

**6. 消除歧义，直击结论**
优化后的指令中不得保留任何模糊措辞，每个条件均应具有可执行性。

---

**输出要求：**
- 直接输出优化后的指令正文，不附加任何解释、标注或前言
- 禁止输出 JSON、SQL 或代码块
- 禁止重复用户原始提问
- 语言风格：专业、简洁、指令式中文`;


    // 我们直接使用 sendCompletion 来完全绕过数据库，避免空字符串返回问题。
    // 手动构建负载：由于我们强制使用了 useChatCompletion： true，它必须是一个消息对象数组。
    const payload = [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ];

    const result = await client.sendCompletion(payload, {
      abortController: new AbortController(),
    });

    let optimizedText = "";
    if (typeof result === "string") {
      optimizedText = result;
    } else if (result && typeof result.completion === "string") {
      optimizedText = result.completion;
    } else if (
      result &&
      Array.isArray(result) &&
      result[0] &&
      typeof result[0].text === "string"
    ) {
      optimizedText = result.map((part) => part.text).join("");
    } else if (result && Array.isArray(result.completion)) {
      optimizedText = result.completion.map((part) => part.text || "").join("");
    }

    // 后处理：确保输出纯净，剔除模型可能误报的分析部分或 Markdown 包装
    if (optimizedText) {
      // 1. 强力抓取逻辑：如果模型不听话输出了“优化后的提示词：xxx”，我们只取 xxx
      const markers = [
        "优化后的提示词：",
        "优化后的提示词:",
        "优化后的提问：",
        "优化后的提问:",
        "优化结果：",
        "优化结果:",
        "Optimized Prompt:",
        "Optimized Prompt：",
        "【优化后的提示词】",
      ];

      for (const marker of markers) {
        const index = optimizedText.lastIndexOf(marker);
        if (index !== -1) {
          optimizedText = optimizedText.substring(index + marker.length).trim();
          break;
        }
      }

      // 2. 去除 Markdown 代码块包裹
      optimizedText = optimizedText.replace(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/g, "$1");

      // 3. 剔除可能残余的前缀（针对 marker 之后仍有前缀的情况）
      const prefixesToRemove = [
        /^优化后的提示词[:：]\s*/i,
        /^Prompt[:：]\s*/i,
        /^Optimized Prompt[:：]\s*/i,
        /^\s*【优化后的提示词】\s*/i,
      ];

      for (const prefix of prefixesToRemove) {
        optimizedText = optimizedText.replace(prefix, "");
      }

      // 4. 剔除首尾空白
      optimizedText = optimizedText.trim();
    }


    if (!res.headersSent) {
      res.json({ optimizedText: optimizedText || "" });
    }
  } catch (error) {
    logger.error("[api/optimize] Error optimizing prompt", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "优化提示词时发生错误" });
    }
  }
});

module.exports = router;
