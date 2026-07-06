#!/usr/bin/env bash
# 将目录打包为 <目录名>.tar.gz（解压后保留顶层目录名）
#
# 用法：
#   ./pack-dir.sh                          # 打包脚本所在目录
#   ./pack-dir.sh /path/to/esb-adapter-deploy
#   ./pack-dir.sh . ./esb-adapter-deploy.tar.gz   # 指定输出文件
#   OUTPUT=~/Desktop ./pack-dir.sh         # 输出到指定目录
#
# 可选环境变量：
#   OUTPUT    输出目录，或完整 .tar.gz 路径
#   EXCLUDES  额外排除项（空格分隔），如 EXCLUDES=".DS_Store node_modules"
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${1:-${SCRIPT_DIR}}"
TARGET_DIR="$(cd "${TARGET_DIR}" && pwd)"
DIR_NAME="$(basename "${TARGET_DIR}")"
PARENT_DIR="$(dirname "${TARGET_DIR}")"

resolve_output_path() {
  local arg="${1:-}"
  if [[ -n "${arg}" ]]; then
    if [[ "${arg}" == *.tar.gz ]]; then
      echo "$(cd "$(dirname "${arg}")" && pwd)/$(basename "${arg}")"
      return
    fi
    echo "$(cd "${arg}" && pwd)/${DIR_NAME}.tar.gz"
    return
  fi

  if [[ -n "${OUTPUT:-}" ]]; then
    if [[ "${OUTPUT}" == *.tar.gz ]]; then
      echo "$(cd "$(dirname "${OUTPUT}")" && pwd)/$(basename "${OUTPUT}")"
      return
    fi
    echo "$(cd "${OUTPUT}" && pwd)/${DIR_NAME}.tar.gz"
    return
  fi

  echo "${PARENT_DIR}/${DIR_NAME}.tar.gz"
}

ARCHIVE_PATH="$(resolve_output_path "${2:-}")"
OUTPUT_DIR="$(dirname "${ARCHIVE_PATH}")"
mkdir -p "${OUTPUT_DIR}"

DEFAULT_EXCLUDES=(".git")
ALL_EXCLUDES=("${DEFAULT_EXCLUDES[@]}")
if [[ -n "${EXCLUDES:-}" ]]; then
  read -r -a EXTRA_EXCLUDES <<< "${EXCLUDES}"
  ALL_EXCLUDES+=("${EXTRA_EXCLUDES[@]}")
fi

TAR_ARGS=()
for item in "${ALL_EXCLUDES[@]}"; do
  [[ -z "${item}" ]] && continue
  TAR_ARGS+=(--exclude="${DIR_NAME}/${item}")
done

# 输出文件若在待打包目录内，需排除自身
if [[ "${ARCHIVE_PATH}" == "${TARGET_DIR}/"* ]]; then
  REL_ARCHIVE="${ARCHIVE_PATH#${TARGET_DIR}/}"
  TAR_ARGS+=(--exclude="${DIR_NAME}/${REL_ARCHIVE}")
fi

echo "==> 打包目录: ${TARGET_DIR}"
echo "==> 输出文件: ${ARCHIVE_PATH}"

cd "${PARENT_DIR}"
tar czf "${ARCHIVE_PATH}" "${TAR_ARGS[@]}" "${DIR_NAME}/"

echo "==> 完成 ✓  大小: $(du -sh "${ARCHIVE_PATH}" | cut -f1)"
