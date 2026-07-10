#!/usr/bin/env bash
# 完整构建 Because 本地产物，构建 linux/amd64 镜像，并导出 tar 包到桌面。
#
# 用法:
#   ./scripts/build-because-result-image.sh
#
# 可选环境变量:
#   IMAGE_TAG=because:result
#   BUILDER=builder-with-mirror
#   PLATFORM=linux/amd64
#   DOCKERFILE=Dockerfile.multi
#   OUTPUT_FILE="$HOME/Desktop/because-result-amd64.tar"
#   BUILD_AGENTS=true

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE_TAG="${IMAGE_TAG:-because:result}"
BUILDER="${BUILDER:-builder-with-mirror}"
PLATFORM="${PLATFORM:-linux/amd64}"
DOCKERFILE="${DOCKERFILE:-Dockerfile.multi}"
OUTPUT_FILE="${OUTPUT_FILE:-$HOME/Desktop/because-result-amd64.tar}"
BUILD_AGENTS="${BUILD_AGENTS:-true}"

echo "=== Because 完整构建 + 镜像打包 ==="
echo "项目目录: $ROOT"
echo "镜像标签: $IMAGE_TAG"
echo "构建平台: $PLATFORM"
echo "Dockerfile: $DOCKERFILE"
echo "输出文件: $OUTPUT_FILE"
echo ""

mkdir -p "$(dirname "$OUTPUT_FILE")"

if [ "$BUILD_AGENTS" = "true" ]; then
  echo "[1/8] 构建 agents-because..."
  (cd agents-because && npm run build)
else
  echo "[1/8] 跳过 agents-because 构建（BUILD_AGENTS=false）"
fi

echo "[2/8] 构建 packages/data-provider..."
npm run build:data-provider

echo "[3/8] 构建 packages/data-schemas..."
npm run build:data-schemas

echo "[4/8] 构建 packages/api..."
npm run build:api

echo "[5/8] 构建 packages/client..."
npm run build:client-package

echo "[6/8] 构建 client/dist..."
(cd client && npm run build)

echo "[7/8] 构建 Docker 镜像..."
docker buildx build \
  --builder "$BUILDER" \
  --platform "$PLATFORM" \
  --load \
  -t "$IMAGE_TAG" \
  -f "$DOCKERFILE" \
  .

echo "[8/8] 导出镜像 tar 包到桌面..."
docker save -o "$OUTPUT_FILE" "$IMAGE_TAG"

echo ""
echo "=== 构建完成 ==="
echo "镜像: $IMAGE_TAG"
echo "镜像包: $OUTPUT_FILE"
ls -lh "$OUTPUT_FILE"
