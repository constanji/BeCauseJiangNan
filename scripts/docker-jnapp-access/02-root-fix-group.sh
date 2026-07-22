#!/usr/bin/env bash
# root: 确保 docker 组存在，并把目标用户加入 docker 组
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

usage() {
  cat <<EOF
用法: sudo bash $0 [--user NAME]

确保 docker 组存在，并将用户加入该组（默认用户: jnapp）。
注意: 用户需重新登录后组才在当前会话生效。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) TARGET_USER="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) error "未知参数: $1"; usage; exit 1 ;;
  esac
done

require_root

section "修复 docker 组 / 用户归属"
groupadd docker 2>/dev/null || true
ok "确保 docker 组存在"

if ! id "${TARGET_USER}" >/dev/null 2>&1; then
  error "用户不存在: ${TARGET_USER}"
  exit 1
fi

usermod -aG docker "${TARGET_USER}"
ok "已确保 ${TARGET_USER} 加入 docker 组"
note "当前组成员: $(getent group docker || true)"
note "请让 ${TARGET_USER} 重新登录，或: newgrp docker"
info "完成"
