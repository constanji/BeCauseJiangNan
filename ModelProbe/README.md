# ModelProbe

独立的 **模型探测与评测** 服务：对同一端点/模型执行 **Direct（原样发送）** 与 **Assembled（LibreChat 组装规则）** 双层探测，输出身份对齐、TTFT、ITL、RPM、TPM、上下文窗口等评测报告。

## 前置条件

- Node.js 18+
- 可访问的 OpenAI 兼容 API（含 custom / Azure 网关）

## 开发

```bash
cd ModelProbe
cp .env.example .env   # 可选
npm install
npm run dev
```

- API: `http://localhost:4200`
- Web: `http://localhost:5179`（Vite 代理 `/api`）

## 生产

```bash
npm run build:web
npm run start
```

## Docker（linux/amd64）

在仓库根目录：

```bash
./ModelProbe服务器用文件/build-amd64.sh --pack
```

详见 [`ModelProbe服务器用文件/README.md`](../ModelProbe服务器用文件/README.md)。

## 环境变量

| 变量 | 说明 |
|------|------|
| `MODEL_PROBE_SECRET` | API 鉴权密钥（请求头 `X-Model-Probe-Secret`）；生产务必修改 |
| `PORT` | 服务端口，默认 4200 |
| `MODEL_PROBE_DATA_DIR` | SQLite 数据目录 |
| `AZURE_USE_MODEL_AS_DEPLOYMENT_NAME` | Azure 组装：与主站一致 |
| `AZURE_OPENAI_DEFAULT_MODEL` | Azure 组装：覆盖 model 字段 |

## 报告指标

- **身份**：L1 UI 选择 → L2 出站 body → L3 provider 回包
- **TTFT / ITL**：流式首 token 与 token 间隔（warmup 后采样）
- **RPM / TPM**：固定并发与时长压测
- **上下文**：阶梯 + 二分探测最大可接受 input tokens

## 联调检查清单

1. 新建端点 → 测连成功
2. 选择模型 → Direct + Assembled 探测完成
3. 报告页身份三层对照、延迟/吞吐/上下文卡片可读
4. 导出 JSON 报告
