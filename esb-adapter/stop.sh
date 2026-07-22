#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if command -v docker-compose >/dev/null 2>&1; then
  docker-compose down
elif docker compose version >/dev/null 2>&1; then
  docker compose down
else
  echo "错误: 未找到 docker-compose 或 docker compose"
  exit 1
fi

echo "esb-adapter 已停止"
