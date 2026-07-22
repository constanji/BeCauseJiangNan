#!/usr/bin/env bash
# root: 修复 docker-compose / docker compose 入口（不覆盖已有独立二进制）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

FIX_PATH=0
SOURCE_BIN=""

usage() {
  cat <<EOF
用法: sudo bash $0 [选项]

修复 Compose 入口：
  - 若已有 ${COMPAT_LINK} 独立二进制、缺插件 → 链到 ${PLUGIN_PATH}
  - 若已有插件、缺兼容命令 → 创建软链到 ${COMPAT_LINK}
  - 绝不覆盖已存在的独立 ${COMPAT_LINK} 大文件

选项:
  --fix-path           若 jnapp PATH 缺 /usr/local/bin，写入 ${PATH_PROFILE}
  --from PATH          从离线包指定二进制拷贝（仅当两边都不存在时使用）
  --user NAME          目标用户（默认 jnapp，仅 --fix-path 时用到）
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fix-path) FIX_PATH=1; shift ;;
    --from) SOURCE_BIN="${2:-}"; shift 2 ;;
    --user) TARGET_USER="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) error "未知参数: $1"; usage; exit 1 ;;
  esac
done

require_root

section "修复 Compose 入口"
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

if [[ "${FIX_PATH}" -eq 1 ]]; then
  target_path="$(run_as_target 'echo "$PATH"' 2>/dev/null || true)"
  if [[ -n "${target_path}" ]] && ! echo "${target_path}" | tr ':' '\n' | grep -qx '/usr/local/bin'; then
    cat > "${PATH_PROFILE}" <<'EOF'
# Added by docker-jnapp-access scripts
case ":${PATH}:" in
  *:/usr/local/bin:*) ;;
  *) PATH="/usr/local/bin:${PATH}" ;;
esac
export PATH
EOF
    chmod 0644 "${PATH_PROFILE}"
    ok "已写入 PATH 补丁: ${PATH_PROFILE}"
  else
    ok "无需 PATH 补丁（已含 /usr/local/bin 或无法读取）"
  fi
fi

echo ""
note "验证建议:"
echo "  docker-compose version"
echo "  docker compose version"
info "完成"
