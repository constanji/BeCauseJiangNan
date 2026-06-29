# Schema

独立的 GaussDB LightSchema 分析服务（连接配置 → Schema/表浏览 → 生成 LightSchema → 预览 → Excel 导出）。

## 前置条件

- Node.js 18+
- Java JRE/JDK（用于 JDBC 桥）
- `server/drivers/lib/gsjdbc4-1.0.jar`（GaussDB 驱动，需自行放置，不入 Git）

## 开发

```bash
cd Schema
cp .env.example .env
npm install          # 会自动尝试 javac 编译 GaussJdbcQuery
npm run dev
```

- API: `http://localhost:4100`
- Web: `http://localhost:5178`（Vite 代理 `/api` 到后端）

若 Java 未安装，`npm run compile-jdbc` 会提示手动编译：

```bash
javac -encoding UTF-8 -cp server/drivers/lib/gsjdbc4-1.0.jar \
  -d server/drivers/gaussdb-jdbc \
  server/drivers/gaussdb-jdbc/GaussJdbcQuery.java
```

## 生产

```bash
npm run build:web
npm run start
```

构建后的静态文件由 Express 托管（`web/dist`）。

## Docker

在仓库根目录（服务器需 `linux/amd64`）：

```bash
docker buildx build \
  --builder builder-with-mirror \
  --platform linux/amd64 \
  --load \
  -t schema:result \
  -f Schema/Dockerfile \
  .

docker run -p 4100:4100 -e SCHEMA_SERVER_SECRET=your-secret -v schema-data:/app/data schema:result
```

生产环境推荐用 `Schema服务器用文件/` 下的 compose 与脚本部署，详见该目录 `README.md`。

不挂载 `/app/data` 时，容器重建会丢失 SQLite 中的数据源和 LightSchema。

## 环境变量

| 变量 | 说明 |
|------|------|
| `SCHEMA_SERVER_SECRET` | SQLite 中密码加密密钥 |
| `PORT` | 后端端口，默认 4100 |
| `WEB_PORT` | 开发时 Vite 端口 |
| `JAVA_BIN` | Java 可执行文件路径 |
| `GAUSSDB_JDBC_PROTOCOL` | 默认 `postgresql` |
| `GAUSSDB_JDBC_JAR` | JDBC jar 路径 |
| `SCHEMA_DATA_DIR` | SQLite 数据目录 |

## 联调检查清单

1. 新建数据源 → 测连成功
2. 进入 Workbench → Schema 下拉有数据 → 切换后表列表懒加载
3. 选表生成 LightSchema → 预览区出现列备注与采样值
4. 导出 Excel → 含「目录」Sheet 与各表 Sheet
