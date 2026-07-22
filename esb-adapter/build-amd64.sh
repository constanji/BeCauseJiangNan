#!/usr/bin/env bash
# 本机开发用：在 esb-adapter 源码目录直接打镜像。
# 生产发版请用仓库根目录：./esb-adapter服务器用文件/build-amd64.sh [--pack]
#
# 用法: ./build-amd64.sh
# 可选: TAG=v1.0.0 OUTPUT=./esb-adapter.tar ./build-amd64.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAG="${TAG:-latest}"
IMAGE="esb-adapter:${TAG}"
OUTPUT="${OUTPUT:-$SCRIPT_DIR/esb-adapter.tar}"

cd "$SCRIPT_DIR"

if [[ ! -f Dockerfile ]]; then
  echo "错误: 未找到 $SCRIPT_DIR/Dockerfile"
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "错误: 需要 Docker Buildx"
  exit 1
fi

# 确保有可用 builder（与 resultMCP 共用 peause-builder）
if ! docker buildx inspect peause-builder >/dev/null 2>&1; then
  docker buildx create --name peause-builder --use >/dev/null 2>&1 || docker buildx use default
else
  docker buildx use peause-builder
fi

echo "==> 构建 linux/amd64 镜像 ${IMAGE}"
docker buildx build \
  --platform linux/amd64 \
  --tag "${IMAGE}" \
  --load \
  -f Dockerfile \
  .

echo "==> 导出到 ${OUTPUT}"
docker save "${IMAGE}" -o "${OUTPUT}"

echo "==> 校验架构"
docker image inspect "${IMAGE}" --format 'Architecture={{.Architecture}} OS={{.Os}}'
ls -lh "${OUTPUT}"
echo "完成。镜像 ${IMAGE} → ${OUTPUT}"
echo "上传到服务器后可用 esb-adapter/deploy.sh，或 esb-adapter服务器用文件/start.sh 启动"
