#!/usr/bin/env bash
# Schema 服务：本机构建 linux/amd64 镜像并导出离线 tar
#
# 用法（在仓库根目录或本目录执行均可）:
#   ./Schema服务器用文件/build-amd64.sh
#   ./Schema服务器用文件/build-amd64.sh --pack          # 构建后顺带打配置包
#   TAG=schema:result OUTPUT=./schema-server-amd64.tar ./Schema服务器用文件/build-amd64.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE="${TAG:-schema:result}"
OUTPUT="${OUTPUT:-$SCRIPT_DIR/schema-server-amd64.tar}"
BUILDER="${BUILDX_BUILDER:-builder-with-mirror}"
PLATFORM="${PLATFORM:-linux/amd64}"
JDBC_SRC="${JDBC_SRC:-$REPO_ROOT/Because-2.0/drivers/lib/gsjdbc4-1.0.jar}"
JDBC_DST="$REPO_ROOT/Schema/server/drivers/lib/gsjdbc4-1.0.jar"
DOCKERFILE="$REPO_ROOT/Schema/Dockerfile"
RUN_PACK=0

usage() {
  cat <<EOF
用法: $(basename "$0") [选项]

  准备 JDBC 驱动 → docker buildx 构建 amd64 镜像 → docker save 导出 tar

选项:
  --pack          构建完成后执行 pack.sh，生成 schema-deploy-*.tar.gz
  --no-save       仅构建镜像，不导出 tar
  -h, --help      显示帮助

环境变量:
  TAG             镜像标签（默认 schema:result）
  OUTPUT          tar 输出路径（默认本目录 schema-server-amd64.tar）
  BUILDX_BUILDER  buildx builder 名称（默认 builder-with-mirror）
  JDBC_SRC        gsjdbc4 jar 源路径
EOF
}

for arg in "$@"; do
  case "$arg" in
    --pack) RUN_PACK=1 ;;
    --no-save) OUTPUT="" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $arg"; usage; exit 1 ;;
  esac
done

if [[ ! -f "$DOCKERFILE" ]]; then
  echo "错误: 未找到 Dockerfile: $DOCKERFILE"
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "错误: 需要 Docker Buildx"
  exit 1
fi

echo "==> [1/4] 准备 GaussDB JDBC 驱动"
mkdir -p "$(dirname "$JDBC_DST")"
if [[ -f "$JDBC_DST" ]]; then
  echo "    已存在: $JDBC_DST"
elif [[ -f "$JDBC_SRC" ]]; then
  cp "$JDBC_SRC" "$JDBC_DST"
  echo "    已复制: $JDBC_SRC → $JDBC_DST"
else
  echo "错误: 缺少 gsjdbc4-1.0.jar"
  echo "  请放置到: $JDBC_DST"
  echo "  或设置 JDBC_SRC 指向现有 jar"
  exit 1
fi

echo "==> [2/4] 选择 buildx builder: ${BUILDER}"
if docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  docker buildx use "$BUILDER"
else
  echo "    警告: builder「${BUILDER}」不存在，使用 default"
  docker buildx use default 2>/dev/null || true
fi

echo "==> [3/4] 构建镜像 ${IMAGE} (${PLATFORM})"
echo "    上下文: $REPO_ROOT"
docker buildx build \
  --platform "$PLATFORM" \
  --load \
  -t "$IMAGE" \
  -f "$DOCKERFILE" \
  "$REPO_ROOT"

echo "    架构校验:"
docker image inspect "$IMAGE" --format '    Architecture={{.Architecture}} OS={{.Os}}'

if [[ -n "$OUTPUT" ]]; then
  echo "==> [4/4] 导出镜像 → ${OUTPUT}"
  docker save -o "$OUTPUT" "$IMAGE"
  ls -lh "$OUTPUT"
else
  echo "==> [4/4] 跳过导出 tar（--no-save）"
fi

if [[ "$RUN_PACK" -eq 1 ]]; then
  echo "==> 打包部署配置"
  "$SCRIPT_DIR/pack.sh"
fi

echo ""
echo "完成。"
echo "  镜像: ${IMAGE}"
[[ -n "$OUTPUT" ]] && echo "  tar:  ${OUTPUT}"
echo "  上传 tar + schema-deploy-*.tar.gz 到服务器，执行 load-image.sh / start.sh"
