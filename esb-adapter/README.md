# ESB Adapter

ESB 标准报文与 Because Agents API 之间的协议转换服务。

## 快速启动（本地开发）

```bash
cp .env.example .env
# 编辑 .env：BECAUSE_BASE_URL（及可选 BECAUSE_BASE_URL_RESULT / _ZB）、账号、Agent ID

npm install
npm start
```

- ESB 入口：`POST http://127.0.0.1:13001/esb/transaction`
- 管理端：`http://127.0.0.1:13001/admin/`（热更新配置，无需重启）
- 健康检查：`GET /health`

## 服务器部署

生产/离线部署包与 ModelProbe 同结构，见：

**[`esb-adapter服务器用文件/`](../esb-adapter服务器用文件/README.md)**

```bash
chmod +x esb-adapter服务器用文件/*.sh
./esb-adapter服务器用文件/build-amd64.sh --pack
# 将 esb-adapter-server-amd64.tar + esb-adapter-deploy-*.tar.gz 上传服务器
# 解压后 cp .env.example .env && ./start.sh
```

## 接口

| 路径 | 说明 |
|------|------|
| `POST /esb/transaction` | ESB 标准报文入口（端口不变） |
| `GET /health` | 健康检查 |
| `GET /admin/` | 配置管理前端 |
| `GET/PUT /api/admin/config` | 热更新配置 API |

## 测试

```bash
npm test
npm run verify:admin
BECAUSE_INTEGRATION_LIVE=1 npm run test:live
```

## 架构

```
ESB → esb-adapter → Because /api/agents/chat
         └─ /admin 热更新 config（data/runtime-config.json）
```
