# TokenProbe

独立的 **全链路 Token 重构统计** 服务：连接 BeCause，真跑问句或绑定 `conversationId`，基于落库 `Message.content` 与工具 I/O，拆解系统提示词 / 各工具输入输出 / 最终回复的 token 占比，并导出报告。

## 口径（必读）

本服务统计的是：

```text
基于 BeCause 真实落库消息与工具 I/O 的全链路 token 重构统计
```

**不是**：

```text
真实每轮 LLM payload 精确 token 统计
```

| 能统计 | 不能（第一版） |
|--------|----------------|
| 用户问题、最终回复 | 每轮真实完整 messages 帧 |
| 工具名 / command、入参、出参 | 运行时动态拼接且未落库的系统规则 |
| Agent.instructions（配置） | 实际发给模型的完整 tools schema JSON |
| Agent.tools 配置估算 | 裁剪 / summary 后的真实帧 |
| | 按类目拆分的 provider usage |

`peakContextTokens` 为重构估值。若要硬证明窗口需求，需主站 `TOKEN_TRACE` 记录真实请求帧。

## 开发

```bash
cd TokenProbe
cp .env.example .env
npm install
npm run dev
```

- API: `http://localhost:4210`
- Web: `http://localhost:5180`（Vite 代理 `/api`）

## 生产

```bash
npm run build:web
npm run start
```

## Docker（linux/amd64）

```bash
./TokenProbe服务器用文件/build-amd64.sh --pack
```

见 [`TokenProbe服务器用文件/README.md`](../TokenProbe服务器用文件/README.md)。

## 使用流程

1. **连接** — 配置 BeCause Base URL、**登录邮箱/密码**（与 esb-adapter 相同，服务端自动 login/refresh）、默认 `agent_id`
2. **采集** — 真跑问句，或绑定已有 `conversationId`
3. **报告** — 查看步骤占比，导出 `{ format: "tokenprobe-report", version: 1, report }`

> 仍兼容旧的静态 JWT 字段（仅后端），新 UI 不再要求手填 token。

## 环境变量

| 变量 | 说明 |
|------|------|
| `TOKEN_PROBE_SECRET` | API 鉴权（请求头 `X-Token-Probe-Secret`） |
| `PORT` | 默认 4210 |
| `TOKEN_PROBE_DATA_DIR` | SQLite 目录 |
