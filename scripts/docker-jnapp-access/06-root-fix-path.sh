#!/usr/bin/env bash
# root: 只修 jnapp 登录 PATH，确保能找到 /usr/local/bin/docker-compose
# 典型: 绝对路径 /usr/local/bin/docker-compose version 能跑，但 command not found
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

FORCE=0

usage() {
  cat <<EOF
用法: sudo bash $0 [--user NAME] [--force]

职责（仅 PATH）：
  检查 ${TARGET_USER} 登录环境 PATH 是否包含 /usr/local/bin
  若无，写入 ${PATH_PROFILE}

典型症状:
  -bash: docker-compose: command not found
  但 /usr/local/bin/docker-compose version 能成功

选项:
  --user NAME   目标用户（默认 jnapp）
  --force       即使已检测到 PATH 含 /usr/local/bin 也重写 profile 补丁
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) TARGET_USER="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) error "未知参数: $1"; usage; exit 1 ;;
  esac
done

require_root

if ! id "${TARGET_USER}" >/dev/null 2>&1; then
  error "用户不存在: ${TARGET_USER}"
  exit 1
fi

section "修复 PATH（确保 /usr/local/bin 可见）"

target_path="$(run_as_target 'echo "$PATH"' 2>/dev/null || true)"
note "${TARGET_USER} 当前登录 PATH=${target_path:-<无法读取>}"

need_write=0
if [[ "${FORCE}" -eq 1 ]]; then
  need_write=1
  note "--force：将重写 ${PATH_PROFILE}"
elif [[ -z "${target_path}" ]]; then
  need_write=1
  warn "无法读取登录 PATH，仍写入 profile 补丁兜底"
elif ! echo "${target_path}" | tr ':' '\n' | grep -qx '/usr/local/bin'; then
  need_write=1
  fail "PATH 不含 /usr/local/bin"
else
  ok "PATH 已含 /usr/local/bin"
fi

if [[ "${need_write}" -eq 1 ]]; then
  cat > "${PATH_PROFILE}" <<'EOF'
# Added by docker-jnapp-access 06-root-fix-path.sh
# Ensure /usr/local/bin (docker-compose symlink) is on PATH for login shells
case ":${PATH}:" in
  *:/usr/local/bin:*) ;;
  *) PATH="/usr/local/bin:${PATH}" ;;
esac
export PATH
EOF
  chmod 0644 "${PATH_PROFILE}"
  ok "已写入: ${PATH_PROFILE}"
else
  ok "无需修改（已含 /usr/local/bin）"
  if [[ -f "${PATH_PROFILE}" ]]; then
    note "已存在补丁文件: ${PATH_PROFILE}"
  fi
fi

section "验证（需登录壳加载 profile）"
# 新开登录壳应能读到 PATH；部分发行版 su - 会 source profile.d
new_path="$(run_as_target 'echo "$PATH"' 2>/dev/null || true)"
note "修复后登录 PATH=${new_path:-<无法读取>}"

if echo "${new_path}" | tr ':' '\n' | grep -qx '/usr/local/bin'; then
  ok "登录 PATH 含 /usr/local/bin"
else
  warn "当前探测仍可能未加载 ${PATH_PROFILE}"
  note "请 ${TARGET_USER} 完全退出 SSH 再登录，或: su - ${TARGET_USER}"
fi

if [[ -e "${COMPAT_LINK}" ]]; then
  if run_as_target 'command -v docker-compose >/dev/null 2>&1'; then
    ok "command -v docker-compose => $(run_as_target 'command -v docker-compose')"
  else
    warn "仍 command not found：确认软链存在且已重新登录"
    note "软链: $(ls -l "${COMPAT_LINK}" 2>/dev/null || echo 缺失)"
    note "临时可用: ${COMPAT_LINK} version"
  fi
else
  warn "尚无 ${COMPAT_LINK}：请先跑 04-root-fix-compose.sh 或 05-root-fix-bin-perms.sh 建软链"
fi

info "完成。验证: su - ${TARGET_USER} -c 'docker-compose version'"
