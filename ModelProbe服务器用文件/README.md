# ModelProbe 服务器部署包

本目录用于在服务器上部署独立的 **ModelProbe** 服务（Web UI + API + SQLite）。

## 目录结构

```text
ModelProbe服务器用文件/
├── docker-compose.yml
├── .env.example
├── data/                   # SQLite 持久化
├── build-amd64.sh          # 【本机】构建 amd64 镜像 + 导出 tar
├── pack.sh                 # 【本机】打包配置 → modelprobe-deploy-*.tar.gz
├── load-image.sh / save-image.sh
├── start.sh / stop.sh
└── README.md
```

## 本机发版

```bash
chmod +x ModelProbe服务器用文件/build-amd64.sh
./ModelProbe服务器用文件/build-amd64.sh --pack
```

输出：
- `ModelProbe服务器用文件/modelprobe-server-amd64.tar`
- `modelprobe-deploy-YYYYMMDD-HHMMSS.tar.gz`

## 服务器部署

```bash
tar xzf modelprobe-deploy-*.tar.gz
cd modelprobe-deploy
cp .env.example .env   # 修改 MODEL_PROBE_SECRET
./start.sh
```

浏览器打开 `http://<host>:4200/`。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `MODEL_PROBE_IMAGE` | `modelprobe:result` | 镜像标签 |
| `MODEL_PROBE_SECRET` | — | 生产必改；前端 localStorage 可存同名密钥 |
| `PORT` | `4200` | 对外端口 |

## 使用流程

1. **端点** — 配置 baseURL、API Key、类型（openai/azure/google…）
2. **探测** — 选模型，Direct + Assembled 双层跑 TTFT/RPM/上下文
3. **报告** — 查看三层身份对照与指标，导出 JSON

## 本地开发

见 [`ModelProbe/README.md`](../ModelProbe/README.md)：`cd ModelProbe && npm i && npm run dev`。
