FROM docker.m.daocloud.io/library/node:20-bookworm-slim

RUN set -eux; \
  export DEBIAN_FRONTEND=noninteractive; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i \
      -e 's|http://deb.debian.org|http://mirrors.aliyun.com|g' \
      -e 's|https://deb.debian.org|http://mirrors.aliyun.com|g' \
      -e 's|http://security.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
      -e 's|https://security.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' \
      /etc/apt/sources.list.d/debian.sources; \
  fi; \
  apt-get -o Acquire::Retries=5 update \
  && apt-get -o Acquire::Retries=5 install -y --no-install-recommends python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/ModelProbe

COPY ModelProbe/package.json ModelProbe/package-lock.json* ./
RUN npm config set registry https://registry.npmmirror.com \
  && npm install --ignore-scripts \
  && npm rebuild better-sqlite3

COPY ModelProbe/ ./

RUN npm run build:web \
  && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=4200
ENV HOST=0.0.0.0
ENV MODEL_PROBE_DATA_DIR=/app/data

EXPOSE 4200
CMD ["npm", "run", "start"]
