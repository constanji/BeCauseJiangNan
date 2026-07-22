#!/usr/bin/env bash
# root 总控：诊断 + 按序调用独立修复脚本（保留一键能力）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

DIAGNOSE_ONLY=0
FIX_PATH=0
NO_RESTART=0

usage() {
  cat <<EOF
用法: sudo bash $0 [选项]

一键：诊断 → 修组 → 修 socket → 修 compose → 复检。
也可拆开单独跑同目录下的:
  01-root-diagnose.sh
  02-root-fix-group.sh
  03-root-fix-socket.sh
  04-root-fix-compose.sh

选项:
  --diagnose-only   只诊断（等价于 01-root-diagnose.sh）
  --fix-path         传递给 04-root-fix-compose.sh，补 PATH
  --no-restart      传递给 03-root-fix-socket.sh，不 restart docker
  --user NAME       目标用户（默认: jnapp）
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --diagnose-only) DIAGNOSE_ONLY=1; shift ;;
    --fix-path) FIX_PATH=1; shift ;;
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

compose_args=(--user "${TARGET_USER}")
[[ "${FIX_PATH}" -eq 1 ]] && compose_args+=(--fix-path)
run_step 04-root-fix-compose.sh "${compose_args[@]}"

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
  note "若仅 docker compose（插件）失败而 docker-compose 成功，部署可继续用 docker-compose"
fi
note "请让 ${TARGET_USER} 重新登录后跑: bash ${SCRIPT_DIR}/jnapp-verify.sh"
exit "${after_rc}"
