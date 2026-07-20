#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if command -v docker-compose >/dev/null 2>&1; then
  docker-compose down
else
  docker compose down
fi
echo "已停止（data/ 保留）"
