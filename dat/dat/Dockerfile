# ============================================================
# DAT Multi-stage Dockerfile — OpenAPI + MCP（无前端、无 nginx）
# ============================================================
# Stage 1: Maven 构建 Linux amd64 分发包
# Stage 2: glibc JRE 运行时 + supervisord（内置 ONNX 需要 glibc）
#
# CI：宿主机 /var/cache/dat-maven 挂载为 Maven 本地仓库，跨构建复用
# 首次运行前在宿主机执行：mkdir -p /var/cache/dat-maven
# 本地：DOCKER_BUILDKIT=1 docker build ...
# ============================================================

# -----------------------------------------------------------
# Stage 1: Build backend (Maven)
# -----------------------------------------------------------
FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/maven:3.9-amazoncorretto-17-alpine AS backend-builder

WORKDIR /app

RUN mkdir -p /root/.m2
COPY docker/maven-settings-aliyun.xml /root/.m2/settings.xml

COPY pom.xml .
COPY dat-core/pom.xml dat-core/
COPY dat-embedders/pom.xml dat-embedders/
COPY dat-rerankers/pom.xml dat-rerankers/
COPY dat-storers/pom.xml dat-storers/
COPY dat-llms/pom.xml dat-llms/
COPY dat-adapters/pom.xml dat-adapters/
COPY dat-agents/pom.xml dat-agents/
COPY dat-sdk/pom.xml dat-sdk/
COPY dat-servers/pom.xml dat-servers/
COPY dat-servers/dat-server-mcp/pom.xml dat-servers/dat-server-mcp/
COPY dat-servers/dat-server-openapi/pom.xml dat-servers/dat-server-openapi/
COPY dat-cli/pom.xml dat-cli/
COPY dat-project/pom.xml dat-project/
COPY dat-project/dat-datastore/pom.xml dat-project/dat-datastore/
COPY dat-project/dat-datasource/pom.xml dat-project/dat-datasource/
COPY dat-project/dat-migration/pom.xml dat-project/dat-migration/

COPY dat-core/ dat-core/
COPY dat-embedders/ dat-embedders/
COPY dat-rerankers/ dat-rerankers/
COPY dat-storers/ dat-storers/
COPY dat-llms/ dat-llms/
COPY dat-adapters/ dat-adapters/
COPY dat-agents/ dat-agents/
COPY dat-sdk/ dat-sdk/
COPY dat-servers/ dat-servers/
COPY dat-cli/ dat-cli/
COPY dat-project/ dat-project/

# BuildKit cache 持久化 Maven 本地仓库（跨构建复用，勿执行 docker builder prune -a）
RUN --mount=type=cache,id=dat-maven-repository,target=/root/.m2/repository \
    mvn -B clean package -DskipTests -Ppkg:unbundled,os:linux-amd64,jar:built-in-small

# -----------------------------------------------------------
# Stage 2: Runtime — Eclipse Temurin JRE (glibc)
# -----------------------------------------------------------
FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/eclipse-temurin:17-jre AS runtime

LABEL maintainer="hexinfo <rd@hexinfo.cn>"
LABEL description="DAT — OpenAPI + MCP servers"
LABEL version="0.7.2"

# 国内服务器访问 archive.ubuntu.com 超时，切换为阿里云镜像源
RUN sed -i 's@//.*archive.ubuntu.com@//mirrors.aliyun.com@g; s@//security.ubuntu.com@//mirrors.aliyun.com@g; s@//ports.ubuntu.com@//mirrors.aliyun.com@g' \
        /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        curl \
        supervisor \
        tzdata \
    && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system dat && useradd --system -g dat dat

WORKDIR /app

COPY --from=backend-builder /app/dat-cli/target/dat-cli-*-linux-amd64.tar.gz /tmp/

RUN tar -xzf /tmp/dat-cli-*-linux-amd64.tar.gz -C /app --strip-components=1 \
    && rm /tmp/dat-cli-*-linux-amd64.tar.gz

RUN mkdir -p /app/data /app/logs /app/projects /var/log/supervisor \
    && chown -R dat:dat /app /var/log/supervisor

COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV TZ=Asia/Shanghai
ENV DAT_HOME=/app
ENV DAT_LOGS_PATH=/app/logs
ENV JAVA_OPTS="-Xms256m -Xmx2g -Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8"

ENV OPENAPI_PORT=8080
ENV MCP_PORT=8081

EXPOSE 8080
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/api/v1/health || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
