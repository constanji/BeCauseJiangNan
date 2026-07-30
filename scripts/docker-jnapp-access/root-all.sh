#!/usr/bin/env bash
# root 总控：诊断 + 按序调用独立修复脚本（固定全跑，不智能跳过）
# 智能按需请用 root-auto.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

DIAGNOSE_ONLY=0
NO_RESTART=0

usage() {
  cat <<EOF
用法: sudo bash $0 [选项]

一键（固定顺序）：诊断 → 02 组 → 03 socket → 05 二进制/目录 → 04 compose → 06 PATH → 复检
智能按需请用: root-auto.sh

也可拆开:
  01-root-diagnose.sh
  02-root-fix-group.sh
  03-root-fix-socket.sh
  04-root-fix-compose.sh
  05-root-fix-bin-perms.sh
  06-root-fix-path.sh

选项:
  --diagnose-only   只诊断（等价于 01）
  --no-restart      传递给 03，不 restart docker
  --user NAME       目标用户（默认: jnapp）
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --diagnose-only) DIAGNOSE_ONLY=1; shift ;;
    --fix-path)
      error "--fix-path 已拆到 06-root-fix-path.sh；本总控会自动跑 06"
      exit 1
      ;;
    --no-restart) NO_RESTART=1; shift ;;
    --user) TARGET_USER="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) error "未知参数: $1"; usage; exit 1 ;;
  esac
done

require_root

run_step() {
  local script="$1"
  shift
  info "执行: ${script} $*"
  bash "${SCRIPT_DIR}/${script}" "$@"
}

info "目标用户: ${TARGET_USER}"
export TARGET_USER

if [[ "${DIAGNOSE_ONLY}" -eq 1 ]]; then
  run_step 01-root-diagnose.sh --user "${TARGET_USER}"
  exit $?
fi

section "阶段 A: 诊断（修复前）"
set +e
bash "${SCRIPT_DIR}/01-root-diagnose.sh" --user "${TARGET_USER}"
set -e

section "阶段 B: 修复（独立脚本按序调用）"
run_step 02-root-fix-group.sh --user "${TARGET_USER}"

socket_args=()
[[ "${NO_RESTART}" -eq 1 ]] && socket_args+=(--no-restart)
run_step 03-root-fix-socket.sh "${socket_args[@]+"${socket_args[@]}"}"

run_step 05-root-fix-bin-perms.sh
run_step 04-root-fix-compose.sh
run_step 06-root-fix-path.sh --user "${TARGET_USER}"

section "阶段 C: 复检"
set +e
bash "${SCRIPT_DIR}/01-root-diagnose.sh" --user "${TARGET_USER}"
after_rc=$?
set -e

section "总结"
if [[ "${after_rc}" -eq 0 ]]; then
  info "复检通过"
else
  warn "复检仍有问题（退出码 ${after_rc}）"
fi
note "请让 ${TARGET_USER} 重新登录后跑: bash ${SCRIPT_DIR}/jnapp-verify.sh"
exit "${after_rc}"
