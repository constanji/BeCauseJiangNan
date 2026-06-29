#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
elif docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
else
  echo "错误: 未找到 docker-compose 或 docker compose"
  exit 1
fi

"${COMPOSE_CMD[@]}" down
echo "Schema 服务已停止（data 目录会保留）"
