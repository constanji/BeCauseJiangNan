#!/usr/bin/env bash
# root: 只修 docker-compose / docker compose 入口文件（软链/插件），不改 PATH
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

SOURCE_BIN=""

usage() {
  cat <<EOF
用法: sudo bash $0 [选项]

职责（仅 Compose 入口文件）：
  - 若已有 ${COMPAT_LINK}、缺插件 → 链到 ${PLUGIN_PATH}
  - 若已有插件、缺兼容命令 → 创建软链到 ${COMPAT_LINK}
  - 绝不覆盖已存在的独立 ${COMPAT_LINK} 大文件

PATH 问题请用: 06-root-fix-path.sh
二进制/父目录权限请用: 05-root-fix-bin-perms.sh

选项:
  --from PATH   从离线包指定二进制拷贝（仅当两边都不存在时使用）
  --user NAME   保留兼容参数（本脚本不依赖用户 PATH）
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fix-path)
      error "--fix-path 已拆到独立脚本，请改用: sudo bash ${SCRIPT_DIR}/06-root-fix-path.sh"
      exit 1
      ;;
    --from) SOURCE_BIN="${2:-}"; shift 2 ;;
    --user) TARGET_USER="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) error "未知参数: $1"; usage; exit 1 ;;
  esac
done

require_root

section "修复 Compose 入口（软链/插件，不含 PATH）"
mkdir -p /usr/libexec/docker/cli-plugins /usr/local/bin

# 两边都没有，尝试从 --from 安装
if [[ ! -e "${COMPAT_LINK}" && ! -e "${PLUGIN_PATH}" ]]; then
  if [[ -n "${SOURCE_BIN}" && -f "${SOURCE_BIN}" ]]; then
    cp -f "${SOURCE_BIN}" "${COMPAT_LINK}"
    chmod +x "${COMPAT_LINK}"
    ok "已从 ${SOURCE_BIN} 安装到 ${COMPAT_LINK}"
  else
    error "机器上既没有 ${COMPAT_LINK} 也没有 ${PLUGIN_PATH}"
    error "请提供离线二进制: sudo bash $0 --from /path/to/docker-compose-linux-x86_64"
    exit 1
  fi
fi

# 有独立二进制，缺插件 → 链过去，不覆盖独立文件
if [[ -x "${COMPAT_LINK}" && ! -e "${PLUGIN_PATH}" ]]; then
  ln -sfn "${COMPAT_LINK}" "${PLUGIN_PATH}"
  ok "已启用插件入口: ${PLUGIN_PATH} -> ${COMPAT_LINK}"
elif [[ -x "${PLUGIN_PATH}" && ! -e "${COMPAT_LINK}" ]]; then
  ln -sfn "${PLUGIN_PATH}" "${COMPAT_LINK}"
  ok "已创建兼容软链: ${COMPAT_LINK} -> ${PLUGIN_PATH}"
else
  [[ -x "${COMPAT_LINK}" ]] && ok "保留现有 ${COMPAT_LINK}（不覆盖）"
  [[ -x "${PLUGIN_PATH}" ]] && ok "插件已存在: ${PLUGIN_PATH}"
fi

echo ""
note "若仍 command not found（但 ${COMPAT_LINK} 绝对路径能跑）:"
echo "  sudo bash ${SCRIPT_DIR}/06-root-fix-path.sh"
note "验证:"
echo "  su - ${TARGET_USER} -c 'docker-compose version'"
echo "  su - ${TARGET_USER} -c 'docker compose version'"
info "完成"
