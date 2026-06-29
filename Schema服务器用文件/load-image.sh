#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "错误: 缺少 .env，请先执行: cp .env.example .env 并填写配置"
  exit 1
fi

IMAGE_TAR="${SCHEMA_IMAGE_TAR:-schema-server-amd64.tar}"
if grep -q "^SCHEMA_IMAGE_TAR=" .env 2>/dev/null; then
  IMAGE_TAR="$(grep "^SCHEMA_IMAGE_TAR=" .env | head -1 | cut -d= -f2- | tr -d ' "' | xargs)"
fi

if [[ ! -f "$IMAGE_TAR" ]]; then
  echo "错误: 缺少镜像包 ${IMAGE_TAR}"
  exit 1
fi

echo "==> 加载镜像 ${IMAGE_TAR}"
docker load -i "$IMAGE_TAR"
