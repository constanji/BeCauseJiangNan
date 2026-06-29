# Schema 服务器部署包

本目录用于在服务器上部署独立的 **Schema / GaussDB LightSchema** 服务（Web UI + API + SQLite）。

---

## 目录结构

```text
Schema服务器用文件/
├── docker-compose.yml      # 单容器编排
├── .env.example            # 环境变量模板 → 复制为 .env
├── data/                   # SQLite 持久化（运行时写入，新环境可空）
├── save-image.sh           # 【本机】导出 schema-server-amd64.tar
├── pack.sh                 # 【本机】打包配置目录 → schema-deploy-*.tar.gz
├── load-image.sh           # 【服务器】仅加载镜像 tar
├── start.sh                # 【服务器】加载镜像（若有）+ compose up + 健康检查
├── stop.sh                 # 【服务器】compose down（保留 data/）
└── README.md
```

离线镜像包（**不入 Git，需单独上传**）：

| 文件 | 必需 | 说明 |
|------|------|------|
| `schema-server-amd64.tar` | ✅ | 镜像标签 `schema:result`（每次发版更新） |
| `schema-deploy-*.tar.gz` | ✅ | 本目录 `pack.sh` 输出（配置与脚本） |

---

## 一、本机发版（按顺序执行）

> 在项目根目录 `BeCauseJiangNan` 操作，除非注明在 `Schema服务器用文件/` 下。

### 第 0 步：准备 JDBC 驱动（仅首次 / jar 变更时）

构建镜像前，确保驱动存在（不入 Git）：

```bash
cp Because-2.0/drivers/lib/gsjdbc4-1.0.jar Schema/server/drivers/lib/
```

### 第 1 步：构建 Docker 镜像（linux/amd64）

```bash
docker buildx build \
  --builder builder-with-mirror \
  --platform linux/amd64 \
  --load \
  -t schema:result \
  -f Schema/Dockerfile \
  .
```

### 第 2 步：导出镜像 tar

```bash
docker save -o Schema服务器用文件/schema-server-amd64.tar schema:result
```

### 第 3 步：打包部署配置

```bash
cd Schema服务器用文件
chmod +x pack.sh
./pack.sh
# 输出：../schema-deploy-YYYYMMDD-HHMMSS.tar.gz
```

`pack.sh` 会排除 `.env`、`*.tar` 和 `data/` 内实际数据，避免把密钥或 SQLite 打进包。

---

## 二、服务器部署（按顺序执行）

### 场景 A：首次部署

```bash
cd /opt/schema-server

# 1. 解压配置包（去掉外层目录名）
tar xzf schema-deploy-*.tar.gz --strip-components=1

# 2. 配置环境变量
cp .env.example .env
nano .env
# 必填：SCHEMA_SERVER_SECRET=<强随机密钥>
# 可选：PORT（默认 4100）

# 3. 脚本权限
chmod +x *.sh

# 4. 加载镜像
./load-image.sh

# 5. 启动
./start.sh
# 自动 compose up，并请求 http://127.0.0.1:4100/api/health

# 6. 验证
curl http://127.0.0.1:4100/api/health
# 浏览器：http://<服务器IP>:4100
```

### 场景 B：版本更新（保留 data/ 与 .env）

```bash
cd /opt/schema-server

# 1. 解压新配置包（不会覆盖已有 .env）
tar xzf schema-deploy-*.tar.gz --strip-components=1

# 2. 加载新镜像并重启
./load-image.sh
docker compose up -d --force-recreate

# 或直接
./start.sh

# 3. 查看日志
docker compose logs -f api
```

---

## 三、脚本说明

| 脚本 | 执行位置 | 作用 |
|------|----------|------|
| `save-image.sh` | **本机** | 将 `schema:result` 导出为 `schema-server-amd64.tar` |
| `pack.sh` | **本机** | 打包本目录为 `schema-deploy-*.tar.gz`（不含 .env / tar / 数据） |
| `load-image.sh` | **服务器** | 从 `schema-server-amd64.tar` 加载镜像 |
| `start.sh` | **服务器** | 若存在 tar 则 load → `compose up -d` → 健康检查 |
| `stop.sh` | **服务器** | `compose down`，**保留** `./data` 目录 |

### start.sh 行为

1. 检查 `.env` 是否存在  
2. 若当前目录有 `schema-server-amd64.tar`，执行 `docker load`  
3. `docker compose up -d`  
4. 轮询 `http://127.0.0.1:${PORT}/api/health`（最多约 60 秒）

### stop.sh 行为

- 停止并删除容器，**不删除** `./data` 中的 SQLite  
- 下次 `./start.sh` 数据仍在

---

## 四、日常运维

```bash
# 状态
docker compose ps

# 日志
docker compose logs -f api

# 停止
./stop.sh

# 重启
./stop.sh && ./start.sh

# 进入容器
docker compose exec api sh
```

---

## 五、默认端口与环境变量

| 服务 | 主机端口 | 说明 |
|------|----------|------|
| Schema API + Web | **4100** | 浏览器访问 `http://<IP>:4100` |

| 变量 | 必填 | 说明 |
|------|------|------|
| `SCHEMA_SERVER_SECRET` | ✅ | SQLite 密码加密密钥；变更后旧数据源密码无法解密 |
| `SCHEMA_IMAGE` | | 默认 `schema:result`，须与 tar 内标签一致 |
| `SCHEMA_IMAGE_TAR` | | 默认 `schema-server-amd64.tar` |
| `PORT` | | 映射到容器的 4100 |
| `SCHEMA_DATA_DIR` | | 容器内固定 `/app/data`，compose 已挂载 `./data` |

---

## 六、数据迁移

SQLite 文件位于 `./data/`（容器内 `/app/data`）。

```bash
./stop.sh

# 从旧服务器拷贝 data 目录
rsync -av old-server:/opt/schema-server/data/ ./data/

./start.sh
```

> 目标环境的 `SCHEMA_SERVER_SECRET` 须与加密数据时一致，否则已保存的数据源密码无法使用。

---

## 七、网络要求

- 服务器 / 容器需能访问 **GaussDB** 的 `host:port`（防火墙、安全组放行）  
- Schema 服务**不依赖** Because、MongoDB、pgvector

---

## 八、故障排查

```bash
# 启动失败
docker compose logs api | tail -80

# 健康检查
curl -v http://127.0.0.1:4100/api/health

# 镜像标签是否匹配
docker images | grep schema
grep SCHEMA_IMAGE .env

# 测连 GaussDB 失败：检查容器出网与数据库白名单
docker compose exec api sh -c 'java -version'
```

---

## 注意事项

- **不需要上传**：源码、`node_modules`、`gsjdbc4-1.0.jar`（已打入镜像）  
- **`.env` 不入 Git / 不打进 pack**：解压配置包不会覆盖服务器上已有 `.env`  
- **重建容器务必保留 `./data`**，否则丢失数据源与 LightSchema 配置  
- 联调清单见 `Schema/README.md`
