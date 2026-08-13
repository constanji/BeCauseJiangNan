# AgentScope VS Because 技术选型对比报告

> 分析日期：2026-08-11
> Because 基线：当前工作区，版本 `v0.8.1-rc2`
> AgentScope 基线：官方 2.0 主线，官方文档当前标识 `2.0.7dev`

## 1. 结论摘要

AgentScope 与 Because 不是同类产品：

- **AgentScope** 是 Python 生态的 Agent SDK 与服务化框架，重点是 Agent 运行时、工具与工作空间、动态 Agent Team、长期记忆、RAG，以及把 Agent 暴露成多租户、多会话 HTTP 服务。
- **Because** 是 Node.js/TypeScript 技术栈上的完整 Agent 应用平台，已经包含用户体系、Web UI、模型接入、Agent 配置、版本管理、共享与市场、MCP、知识库、评测、成本额度和行业数据分析能力。

因此，技术选型上不建议用 AgentScope 整体替换 Because。更合理的方向是：

1. 保留 Because 作为产品平台、权限中心、配置中心和用户入口。
2. 借鉴 AgentScope 2.0 的 Workspace、Middleware、Agent Service、后台任务和动态 Agent Team 设计。
3. 只有在 Python 工具链、数据科学、模型训练或 Python 原生 Agent 能力成为核心诉求时，才把 AgentScope 作为独立执行服务接入 Because，而不是重写现有平台。

## 2. 产品定位差异

| 维度 | Because | AgentScope 2.0 |
|---|---|---|
| 核心定位 | 面向最终用户和企业管理员的完整 Agent 平台 | 面向开发者的 Agent SDK 与服务化框架 |
| 主要交付物 | Web 产品、API 服务、Agent Runtime、管理能力、行业工具 | Python 包、FastAPI Agent Service、示例 Web UI |
| 目标用户 | 业务用户、Agent 配置人员、管理员、开发者 | Python Agent 开发者、平台研发团队 |
| 默认使用方式 | 通过 UI 配置和使用模型、Agent、工具、知识库 | 通过 Python 代码组合 Agent、工具、工作空间和服务 |
| 企业产品完整度 | 较高，认证、ACL、共享、版本、市场、额度均已进入主平台 | 框架能力强，但认证等产品能力需要宿主系统补齐 |
| 行业能力 | 已包含指标理解、Text-to-SQL、归因分析、语义模型、数据源治理 | 通用框架，不包含 Because 的行业业务语义 |

一句话判断：**Because 更接近“可直接部署使用的 Agent 产品平台”，AgentScope 更接近“用于构建 Agent 平台的 Python 基础框架”。**

## 3. 技术栈对比

| 技术层 | Because | AgentScope 2.0 | 选型影响 |
|---|---|---|---|
| 主语言 | TypeScript / JavaScript，少量 Python 评测与 Java 驱动桥 | Python 3.11+ | Because 前后端类型复用更顺畅；AgentScope 更适合 Python AI 生态 |
| Agent Runtime | 自研 `@because/agents`，基于 LangChain/LangGraph | 自研 Agent 抽象与 reasoning-acting loop | Because 偏图编排；AgentScope 偏轻量 Agent 循环与中间件组合 |
| 服务端 | Express / Node.js | FastAPI / Python | Because 适合高并发 I/O 和全栈统一；AgentScope 更容易直接调用 Python AI 库 |
| 前端 | React 完整产品 UI | 提供示例 React UI；历史上有 AgentScope Studio | Because 的产品化程度更高 |
| 数据库 | MongoDB、PostgreSQL/pgvector、Meilisearch，Redis 可选 | 存储后端可替换，服务化方案以 Redis 共享状态为重要方向 | Because 当前数据模型更完整；AgentScope 的服务边界更模块化 |
| RAG | 本地 ONNX Embedding/Reranker、文档解析、pgvector、业务语义知识 | Reader、Knowledge、RAG Service，可组合多种 Embedding/存储 | Because 更贴近现有业务；AgentScope 抽象更通用 |
| 可观测性 | OpenTelemetry + Langfuse 可选接入 | 1.x 有 Studio/Tracing；2.0 更强调事件流和服务运行状态 | Because 已有链路基础，但缺统一运营观测面板 |
| 部署 | Docker / Docker Compose 为主 | Python 包、FastAPI 服务、Workspace Manager，多种 Sandbox 后端 | Because 易整体部署；AgentScope 的执行环境隔离更成熟 |
| 协议 | MCP、OpenAI 兼容接口、各模型厂商接口 | MCP、A2A、AG-UI 等协议适配方向 | AgentScope 在 Agent 互操作协议上更领先 |

## 4. Agent Runtime 与编排

### 4.1 Because

Because 的 Agent Runtime 位于 `agents-because`，核心特征如下：

- 基于 LangGraph `StateGraph` 构建执行图。
- 支持单 Agent 和 Multi-Agent。
- 支持 Handoff、条件路由、并行 Fan-out/Fan-in、Supervisor、Map-Reduce、混合流程。
- 支持流式事件、工具调用、上下文剪枝、自动摘要、模型推理内容处理。
- 前端已能配置 Agent Chain、Handoff 和最大执行步数。

这套技术选择适合：流程结构相对明确、需要可视化表达执行图、需要在 UI 中配置 Agent 关系的场景。

主要限制：

- 运行时与 LangGraph 状态模型绑定较深，升级和排障成本受上游影响。
- 图结构更适合预定义流程；运行时动态生成任意规模 Agent 团队的能力不如 AgentScope 2.0 的 Team 模型直接。
- Agent、Session、Workspace、后台任务目前没有形成完全独立的服务资源模型。

### 4.2 AgentScope 2.0

AgentScope 2.0 的核心 Agent 被定义为无状态 reasoning-acting loop，引入：

- Message / Event 统一消息模型。
- Model、Context、Tool、Plan、Permission、Middleware 等组合式构件。
- Human-in-the-Loop、中断恢复、结构化输出。
- Agent Team：Leader Agent 运行时创建 Worker Agent，并通过内置团队工具协调。
- Agent Service：将 Agent 作为多租户、多会话 FastAPI 服务运行。

这套设计更适合：Agent 数量和职责在运行时动态决定、需要后台任务、定时调度、多会话恢复和独立执行环境的场景。

### 4.3 判断

| 场景 | 更优选择 |
|---|---|
| UI 中配置固定工作流 | Because |
| 可解释的图式编排 | Because |
| 运行时动态创建 Agent 团队 | AgentScope |
| Python 算法与 AI 库深度集成 | AgentScope |
| 与现有 Web 产品、权限和数据模型统一 | Because |
| 独立 Agent 服务和会话资源管理 | AgentScope 的设计更清晰 |

建议不是替换运行时，而是在 Because 中增加“动态团队执行模式”，借鉴 AgentScope 的 TeamCreate、AgentCreate、消息交换和独立 Session 设计。

## 5. 模型接入与模型服务

### Because 现状

Because 已支持 OpenAI、Azure OpenAI、Anthropic、Bedrock、Google、Vertex AI、自定义 OpenAI 兼容端点，以及 Ollama、DeepSeek、Qwen 等多类模型来源。管理员可以通过配置文件控制模型，用户可在 UI 中选择端点和模型。

优势：

- 模型供应商覆盖广。
- 与用户、额度、界面参数和 Agent 配置直接关联。
- 适合作为企业统一模型入口。

不足：

- 当前更多是“模型适配器集合”，不是独立的模型路由网关。
- 缺少按成本、延迟、可用率和任务类型自动路由。
- 缺少统一的模型降级、熔断、A/B 和供应商级 SLA 面板。

### AgentScope 现状

AgentScope 的 Model 与 Formatter 更偏 SDK 抽象，开发者在 Python 代码中选择模型和格式化方式。它更灵活，但不会自动提供 Because 已有的完整模型管理 UI、用户额度和企业配置中心。

### 判断

Because 的模型接入更适合平台产品；AgentScope 的模型抽象更适合 Python 开发。模型层没有迁移收益，Because 应继续演进自身模型网关能力。

## 6. Tool、MCP 与执行沙箱

### Because

Because 已具备：

- MCP Server 配置、工具发现和 Agent 绑定。
- OpenAPI Actions、网页搜索、文件搜索、代码执行等能力。
- 用户级插件密钥加密存储。
- Agent 工具配置 UI 和工具调用展示。
- 多个江南业务工具：指标理解、SQL 执行、知识发现、结果分析、波动归因等。

当前短板是“工具执行环境”还没有统一成明确的 Workspace 资源。代码执行、文件、MCP、技能和上下文存储分别由不同模块管理，隔离粒度和生命周期不完全统一。

### AgentScope

AgentScope 2.0 把 Workspace 定义为 Agent 的执行环境，并统一管理：

- Bash、Read、Write 等内置工具。
- MCP Server 进程与 MCP Gateway。
- 动态安装的 Skills。
- 上下文卸载文件和持久化资源。
- Agent、Session 或 User 级隔离。
- Local、Bubblewrap、Docker、Kubernetes、OpenSandbox、Daytona 等不同后端。

### 判断

这是 AgentScope 最值得 Because 借鉴的部分。建议 Because 建立统一 `Workspace` 接口，将文件系统、代码执行、MCP、临时凭据、技能和产物生命周期收敛到同一资源模型，并至少提供：

1. Local Workspace：开发环境。
2. Docker Workspace：默认生产隔离。
3. Kubernetes/OpenSandbox Workspace：高安全和弹性场景。

## 7. Memory、Context 与 Session

### Because

Because 已有：

- 对话历史与分支。
- 用户长期记忆，支持自动提取、更新和删除。
- Agent 级上下文剪枝和摘要。
- 文件、知识库和对话上下文融合。
- Token 限制与上下文窗口控制。

优势是已经进入完整用户产品流程。主要不足是长期记忆后端和策略较固定，记忆注入、提取、冲突解决、过期和质量评估还缺少标准化扩展点。

### AgentScope

AgentScope 2.0 通过 Middleware 接入长期记忆，官方当前列出 Agentic Memory、ReMe、Mem0 等实现。其优点是记忆系统不侵入 Agent 主循环，便于替换和实验。

### 判断

Because 应保留现有记忆产品和数据模型，但将记忆提取、召回、合并和写回改造成中间件式接口。这样可以在不改变前端和权限体系的情况下接入 ReMe、Mem0 或自研行业记忆。

## 8. RAG 与知识库

### Because

Because 的 RAG 已经结合实际业务：

- PDF、Word、Excel 等文档解析。
- 本地 ONNX 中文 Embedding 和 Reranker。
- PostgreSQL/pgvector 向量存储。
- 知识库管理、文件引用和检索。
- 数据库 Schema、指标口径、组织信息、语义模型的向量化。
- RAG 与 Text-to-SQL、指标分析工具联动。

### AgentScope

AgentScope 提供通用 Reader、Knowledge、Embedding 和 RAG Service，2.0 强调多租户、多会话服务化。框架允许替换自己的 RAG 实现，通用性和服务边界更好。

### 判断

Because 的 RAG 业务价值明显更高，不应替换。可借鉴的是服务化边界：把文档摄取、解析、Embedding、索引、召回和重排拆分成有清晰状态与任务队列的能力，支持异步处理和独立扩缩容。

## 9. 可观测性、评测与成本治理

| 能力 | Because | AgentScope | 判断 |
|---|---|---|---|
| Trace | 已接入 OpenTelemetry 和 Langfuse，但依赖外部服务配置 | 1.x 有 Studio/Tracing；2.0 以 Event/Session Stream 为核心 | Because 有基础，缺统一平台大盘 |
| Agent 运行事件 | 已支持流式工具和 Agent 步骤事件 | 原生 Event 模型、会话回放、多订阅者 | AgentScope 的事件资源模型更完整 |
| 评测 | 内置 BIRD/Text-to-SQL 评测，支持 EX、R-VES、Soft F1 和自定义数据源 | 历史版本提供 Evaluation/OpenJudge/Tuner | Because 在当前行业任务上更实用 |
| Token/额度 | 用户余额、Token credits、自动补充、请求限流 | 可统计 Token，但不提供 Because 同等产品化额度体系 | Because 更强 |
| 成本路由 | 暂无成熟自动路由 | 不是核心产品能力 | 两者都需外部建设 |

Because 下一阶段应优先补齐：

- Trace、模型调用、工具调用、RAG 检索、SQL 执行的统一 Run ID。
- 按用户、组织、Agent、模型、工具统计的成本和成功率大盘。
- Prompt/Agent 版本与评测结果绑定。
- 上线前评测门禁和线上样本回流。

## 10. 安全、权限与多租户

### Because

Because 已具备完整产品侧能力：

- OAuth2、OIDC、LDAP、SAML、邮箱登录和双因素认证相关模块。
- 用户、群组、角色和资源 ACL。
- Agent、Prompt、Memory、Marketplace 等功能权限。
- 用户级插件密钥加密存储。
- 资源共享、公开访问和有效权限计算。
- API 限流与 Token 额度。

### AgentScope

AgentScope 2.0 Agent Service 按 `user_id` 组织凭据、Agent、Session、Schedule 和消息，具备多租户资源模型，但官方明确说明不内置用户认证，默认 `X-User-ID` 只是占位，需要宿主系统替换成 JWT、OAuth 或其他认证中间件。

### 判断

企业平台安全层 Because 明显更完整。AgentScope 可以作为 Because 管控下的执行服务，但不能替代 Because 的身份、组织和 ACL 中心。

## 11. 发布、版本与渠道

### Because

Because 已有：

- Agent 创建、复制、共享、分类和市场入口。
- Agent 版本历史、版本说明与回滚。
- Prompt 共享和权限。
- Docker 镜像与 Compose 部署。

### AgentScope

AgentScope 2.0 当前提供 Agent Service、MCP/Skill Hub、Workspace Manager，以及飞书和 Discord 渠道；钉钉、企业微信在官方文档中仍标为规划中。它更关注把 Agent 作为服务连接到外部渠道，而不是提供完整的企业 Agent 市场和运营后台。

### 判断

Because 在 Agent 资产管理和产品发布上更成熟；AgentScope 在外部消息渠道、协议适配和后台调度方面更值得借鉴。

## 12. 工程与运维对比

| 维度 | Because | AgentScope 2.0 |
|---|---|---|
| 本地开发 | Node monorepo，前后端统一，但依赖和构建链较重 | Python 包安装简单，核心 SDK 上手快 |
| 测试 | Jest 为主，前后端和 Agent Runtime 已有大量测试 | Pytest/Python 生态，框架层测试与示例丰富 |
| 部署单元 | 主应用容器 + MongoDB + pgvector + Meilisearch 等 | SDK 可嵌入；Agent Service 可独立部署 |
| 横向扩展 | 当前以 Docker Compose 和单体 API 为主 | Agent Service 设计面向多进程/多节点，但官方仍标注分布式能力 WIP |
| 后台任务 | 基准任务等存在进程内任务管理，统一持久队列不足 | Agent Service 原生强调后台工具、Schedule 和恢复 |
| 沙箱 | 有代码解释器能力，但缺统一 Workspace 抽象 | 多种 Workspace/Sandbox 后端 |
| CI/CD | 仓库脚本齐全，但主仓库未见完整 GitHub Actions/K8s 发布链路 | 开源仓库有标准 CI，部署仍需业务方建设 |

Because 当前最大的工程风险不是 Agent 能力不足，而是平台能力持续堆叠在主 Node 服务中，服务边界、后台任务持久化和执行环境隔离逐渐成为扩展瓶颈。

## 13. 关键差距清单

### P0：优先补齐

1. **统一 Workspace/Sandbox 抽象**：统一代码执行、文件、MCP、技能、临时凭据和产物生命周期。
2. **持久化任务与调度系统**：将基准评测、知识摄取、长工具任务从进程内 Map/异步调用迁移到 Redis 队列或消息系统。
3. **统一运行事件模型**：Agent、Tool、Model、RAG、SQL 使用同一 Run/Span/Event 协议，并支持断线回放。
4. **执行服务隔离**：将高风险工具和长时 Agent Run 从主 API 服务拆出。

### P1：增强平台竞争力

1. **动态 Agent Team**：支持 Leader 在运行时创建、销毁和协调 Worker。
2. **Memory Middleware**：长期记忆后端可插拔，支持 ReMe/Mem0/自研策略。
3. **Agent Service API**：形成稳定的 Agent、Session、Run、Event、Workspace 资源模型。
4. **A2A/AG-UI 协议适配**：提升与外部 Agent 和前端协议的互操作性。
5. **成本与质量运营大盘**：把 Langfuse、额度和评测数据统一到平台内。

### P2：中长期建设

1. 多渠道接入：飞书、钉钉、企业微信、Webhook。
2. MCP/Skill Hub 的安装、审计、版本和供应链安全。
3. Kubernetes Workspace 与弹性执行池。
4. 模型路由、熔断、降级和质量/成本自适应选择。

## 14. 三种技术路线

### 路线 A：继续 Because 原生演进

做法：继续使用 TypeScript/LangGraph，自研 Workspace、任务系统、事件模型和动态 Team。

适合：团队以 Node/TypeScript 为主，希望保持单一技术栈，Python 需求有限。

优点：迁移风险最低，现有资产复用最多。
缺点：需要自行实现 AgentScope 已验证的一些底层抽象。

### 路线 B：Because + Python 执行服务

做法：Because 保持平台主控，新增 Python Agent Execution Service。可采用 AgentScope 2.0，也可只参考其接口。Because 通过内部 API 下发 Agent 配置和任务，执行服务返回标准事件。

适合：需要大量 Python 工具、数据科学流程、模型训练或 AgentScope 生态能力。

优点：保留 Because 产品资产，同时获得 Python 生态。
缺点：引入双技术栈、跨服务事件一致性和运维成本。

### 路线 C：整体迁移到 AgentScope

做法：用 AgentScope 重建 Runtime 和服务端，并重做 Because 的产品能力。

不建议。需要重新实现认证、ACL、Agent 市场、版本、Prompt、模型管理、用户额度、完整 UI、数据源和江南行业工具，收益无法覆盖迁移成本。

## 15. 推荐架构

```text
                    Because Web / Admin
                           |
                  API Gateway / Auth / ACL
                           |
        +------------------+------------------+
        |                  |                  |
  Agent Asset Service  Model Gateway   Knowledge Service
  配置/版本/共享/市场   路由/额度/熔断   摄取/RAG/语义模型
        |                  |                  |
        +------------------+------------------+
                           |
                 Agent Execution Service
          Run / Session / Event / Team / Schedule
                           |
                Workspace Manager / Sandbox
           Local / Docker / K8s / OpenSandbox
                           |
                 MCP / Skills / Domain Tools
```

其中：

- Because 继续拥有用户、组织、ACL、Agent 资产、Prompt、市场、模型配置和行业知识。
- Agent Execution Service 可以先继续使用 `@because/agents`，以后按场景增加 AgentScope 执行器。
- 所有执行器遵循统一 Run/Event/Tool/Artifact 协议，前端无需感知底层是 TypeScript 还是 Python。

## 16. 最终选型建议

| 决策项 | 建议 |
|---|---|
| 是否整体引入 AgentScope 替换 Because | 否 |
| 是否继续使用 `@because/agents` | 是，作为默认执行器 |
| 是否引入 Python Agent 执行侧 | 有明确 Python 业务需求时引入 |
| 最优先借鉴 AgentScope 的模块 | Workspace、Middleware、Agent Service、后台任务、动态 Team |
| Because 的长期定位 | 企业 Agent 平台与控制平面 |
| AgentScope 的可选定位 | Python Agent 执行引擎或架构参考实现 |

最终建议：**保持 Because 的产品和控制平面优势，将 AgentScope 视为执行平面参考，而不是替代框架。先统一 Run/Event/Workspace 接口，再决定是否接入 AgentScope，可把未来迁移风险控制在执行器边界内。**

## 17. 证据与参考

### Because 仓库证据

- `package.json`：Monorepo、构建、测试、用户管理、权限迁移、OpenTelemetry 依赖。
- `agents-because/src/graphs/MultiAgentGraph.ts`：Handoff、Direct Edge、并行 Fan-out/Fan-in。
- `agents-because/src/instrumentation.ts`：OpenTelemetry + Langfuse。
- `Because.yaml.example`：模型端点、MCP、Agent 能力、Memory、摘要和上下文剪枝。
- `api/server/services/RAG/`：Embedding、Reranking、VectorDB、文档解析和知识库。
- `api/server/services/EvaluationService.js`：EX、R-VES、Soft F1 评测。
- `api/server/services/PermissionService.js`：用户、群组、角色、公开主体与 ACL。
- `client/src/components/SidePanel/Agents/`：Agent 配置、工具、MCP、文件、版本和高级编排 UI。

### AgentScope 官方资料

- [AgentScope GitHub](https://github.com/agentscope-ai/agentscope)
- [AgentScope 2.0 Agent](https://docs.agentscope.io/latest/en/building-blocks/agent/overview)
- [AgentScope Workspace](https://docs.agentscope.io/latest/en/building-blocks/workspace/overview)
- [AgentScope Long-Term Memory](https://docs.agentscope.io/latest/en/building-blocks/long-term-memory)
- [AgentScope Agent Service](https://docs.agentscope.io/latest/en/deploy/agent-service)
- [AgentScope Agent Team](https://docs.agentscope.io/latest/en/deploy/agent-team)
- [AgentScope MCP & Skill Hub](https://docs.agentscope.io/latest/en/deploy/hub/overview)
- [AgentScope Channel](https://docs.agentscope.io/latest/en/deploy/channel/overview)

> 注意：AgentScope 2.0 官方文档当前标识为 `2.0.7dev`，部分能力（特别是分布式部署和部分 IM 渠道）仍处于开发或 WIP 状态。选型时应通过 PoC 验证，不宜仅依据路线图做生产承诺。
