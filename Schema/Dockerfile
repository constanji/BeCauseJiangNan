# 与 Dockerfile.multi 同源，buildx 需显式镜像前缀
FROM docker.m.daocloud.io/library/node:20-bookworm-slim

# 不用 shell 循环变量（BuildKit 会错误展开 $$f），直接 sed 已知源文件
RUN set -eux; \
  export DEBIAN_FRONTEND=noninteractive; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i \
      -e 's|http://deb.debian.org|http://mirrors.aliyun.com|g' \
      -e 's|https://deb.debian.org|http://mirrors.aliyun.com|g' \
      -e 's|http://security.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
      -e 's|https://security.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
      -e 's|http://security.debian.org|http://mirrors.aliyun.com/debian-security|g' \
      -e 's|https://security.debian.org|http://mirrors.aliyun.com/debian-security|g' \
      /etc/apt/sources.list.d/debian.sources; \
  fi; \
  if [ -f /etc/apt/sources.list ]; then \
    sed -i \
      -e 's|http://deb.debian.org|http://mirrors.aliyun.com|g' \
      -e 's|https://deb.debian.org|http://mirrors.aliyun.com|g' \
      -e 's|http://security.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
      -e 's|https://security.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
      -e 's|http://security.debian.org|http://mirrors.aliyun.com/debian-security|g' \
      -e 's|https://security.debian.org|http://mirrors.aliyun.com/debian-security|g' \
      /etc/apt/sources.list; \
  fi; \
  apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=120 update \
  && apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=120 install -y --no-install-recommends default-jdk-headless \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/Schema

COPY Schema/package.json Schema/package-lock.json* ./
RUN npm config set registry https://registry.npmmirror.com \
  && npm install --ignore-scripts

COPY Schema/ ./

RUN javac -encoding UTF-8 -cp server/drivers/lib/gsjdbc4-1.0.jar \
      -d server/drivers/gaussdb-jdbc \
      server/drivers/gaussdb-jdbc/GaussJdbcQuery.java \
  && npm run build:web \
  && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=4100
ENV HOST=0.0.0.0
ENV SCHEMA_DATA_DIR=/app/data

EXPOSE 4100
CMD ["npm", "run", "start"]
