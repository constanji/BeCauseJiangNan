#!/usr/bin/env bash
# 将本地 Schema 镜像导出为离线 tar（发版后在本机执行）
set -euo pipefail

cd "$(dirname "$0")"

get_env() {
  local key="$1"
  local default="${2:-}"
  if [[ -f .env ]] && grep -q "^${key}=" .env 2>/dev/null; then
    grep "^${key}=" .env | head -1 | cut -d= -f2- | tr -d ' "' | sed 's/#.*$//' | xargs
  else
    echo "$default"
  fi
}

IMAGE="$(get_env SCHEMA_IMAGE schema:result)"
OUT="$(get_env SCHEMA_IMAGE_TAR schema-server-amd64.tar)"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "错误: 本地没有镜像 ${IMAGE}"
  echo "请先在项目根目录构建，例如："
  echo "  docker buildx build --builder builder-with-mirror --platform linux/amd64 --load \\"
  echo "    -t ${IMAGE} -f Schema/Dockerfile ."
  exit 1
fi

echo "==> 导出镜像 ${IMAGE} → ${OUT}"
docker save -o "$OUT" "$IMAGE"
ls -lh "$OUT"
echo "完成。请将 ${OUT} 与 schema-deploy-*.tar.gz 一并上传到服务器。"
