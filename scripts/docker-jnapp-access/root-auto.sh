#!/usr/bin/env bash
# root 智能总控：全面诊断 → 按结论只跑需要的修复 → 复检
# 覆盖常见情况：daemon 挂掉 / socket 属组不对 / 未进组 / 缺 compose / PATH
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

DIAGNOSE_ONLY=0
ASSUME_YES=0
SOURCE_BIN=""
NO_RESTART_SOCKET=0

# 诊断标志（1=需要处理）
NEED_RECOVER=0
NEED_GROUP=0
NEED_SOCKET=0
NEED_COMPOSE=0
NEED_PATH=0
NEED_COMPOSE_FROM=0
NEED_BIN_PERMS=0

ROOT_DOCKER_OK=0
USER_DOCKER_OK=0
USER_COMPOSE_BIN_OK=0
USER_COMPOSE_PLUGIN_OK=0
HAS_COMPAT=0
HAS_PLUGIN=0
USER_IN_DOCKER_GROUP=0
SOCK_OK=0
USER_CAN_EXEC_DOCKER=0

usage() {
  cat <<EOF
用法: sudo bash $0 [选项]

智能流程：
  1) 全面诊断（daemon / socket / 组 / compose / PATH / jnapp 实测）
  2) 打印「将执行哪些修复」
  3) 仅执行需要的步骤（不会无脑跑完全部）
  4) 复检

选项:
  --diagnose-only     只诊断并打印修复计划，不改系统
  --yes               不询问确认，直接按计划修复
  --from PATH         compose 两边都缺失时，用该离线二进制安装
  --no-restart        修 socket 时不 restart docker（传给 03）
  --user NAME         目标用户（默认: jnapp）
  -h, --help

示例:
  sudo bash $0 --diagnose-only
  sudo bash $0 --yes
  sudo bash $0 --yes --from /opt/offline/docker-compose-linux-x86_64
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --diagnose-only) DIAGNOSE_ONLY=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --from) SOURCE_BIN="${2:-}"; shift 2 ;;
    --no-restart) NO_RESTART_SOCKET=1; shift ;;
    --user) TARGET_USER="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) error "未知参数: $1"; usage; exit 1 ;;
  esac
done

require_root
export TARGET_USER

run_step() {
  local script="$1"
  shift
  info "执行: ${script} $*"
  bash "${SCRIPT_DIR}/${script}" "$@"
}

collect_diagnosis() {
  NEED_RECOVER=0 NEED_GROUP=0 NEED_SOCKET=0 NEED_COMPOSE=0 NEED_PATH=0 NEED_COMPOSE_FROM=0 NEED_BIN_PERMS=0
  ROOT_DOCKER_OK=0 USER_DOCKER_OK=0 USER_COMPOSE_BIN_OK=0 USER_COMPOSE_PLUGIN_OK=0
  HAS_COMPAT=0 HAS_PLUGIN=0 USER_IN_DOCKER_GROUP=0 SOCK_OK=0 USER_CAN_EXEC_DOCKER=0

  section "智能诊断：引擎与 socket"

  if docker ps >/dev/null 2>&1; then
    ok "root: docker ps 正常"
    ROOT_DOCKER_OK=1
  else
    fail "root: docker 不可用（daemon/sock 可能挂了）"
    NEED_RECOVER=1
  fi

  if [[ -S "${SOCK}" ]]; then
    local meta perms owner group
    meta="$(sock_meta)"
    IFS='|' read -r perms owner group <<<"${meta}"
    note "${SOCK} = ${owner}:${group} ${perms}"
    if command -v getfacl >/dev/null 2>&1; then
      local acl_mask
      acl_mask="$(getfacl -cp "${SOCK}" 2>/dev/null | awk -F: '/^mask::/ {print $3; exit}' || true)"
      [[ -n "${acl_mask}" ]] && note "${SOCK} ACL mask=${acl_mask}"
      if [[ -n "${acl_mask}" && "${acl_mask}" != "rw-" ]]; then
        fail "socket ACL mask 不是 rw-，可能限制 docker 组访问"
        NEED_SOCKET=1
      fi
    fi
    if [[ "${group}" == "docker" && ( "${perms}" == "660" || "${perms}" == "0660" ) ]]; then
      ok "socket 属组/权限正常"
      SOCK_OK=1
    else
      fail "socket 属组/权限异常（期望 root:docker 0660）"
      NEED_SOCKET=1
    fi
  else
    fail "${SOCK} 不存在"
    NEED_RECOVER=1
    NEED_SOCKET=1
  fi

  # 危险旧 drop-in
  if [[ -f "${DOCKER_SERVICE_DROPIN_DIR}/group.conf" ]]; then
    warn "发现旧版危险 drop-in group.conf（可能含 ExecStart= 覆盖）"
    NEED_RECOVER=1
  fi

  section "智能诊断：二进制可执行权限（BDVIEW 类问题）"
  if [[ -e /usr/bin/docker ]]; then
    note "/usr/bin/docker: $(ls -l /usr/bin/docker 2>/dev/null || true)"
    if run_as_target 'test -x /usr/bin/docker'; then
      ok "${TARGET_USER} 可执行 /usr/bin/docker"
      USER_CAN_EXEC_DOCKER=1
    else
      fail "${TARGET_USER} 无法执行 /usr/bin/docker → 会报: Permission denied"
      note "这与 docker.sock / 03 无关，是文件模式过严（常见 750/700）"
      NEED_BIN_PERMS=1
    fi
  else
    fail "不存在 /usr/bin/docker"
    NEED_RECOVER=1
  fi
  if [[ -e "${COMPAT_LINK}" ]] && ! run_as_target "test -x ${COMPAT_LINK}"; then
    fail "${TARGET_USER} 无法执行 ${COMPAT_LINK}"
    NEED_BIN_PERMS=1
  fi

  section "智能诊断：插件父目录可进入性"
  for d in /usr /usr/bin /usr/libexec /usr/libexec/docker /usr/libexec/docker/cli-plugins /usr/local /usr/local/bin; do
    if [[ -d "${d}" ]]; then
      note "$(ls -ld "${d}" 2>/dev/null || true)"
      if run_as_target "test -x ${d}"; then
        ok "${TARGET_USER} 可进入: ${d}"
      else
        fail "${TARGET_USER} 无法进入: ${d}（父目录 750 → unknown command / command not found）"
        NEED_BIN_PERMS=1
      fi
    fi
  done

  section "智能诊断：用户与组"
  if ! id "${TARGET_USER}" >/dev/null 2>&1; then
    fail "用户不存在: ${TARGET_USER}"
    error "无法继续自动修复用户侧问题"
    return 1
  fi
  ok "用户存在: ${TARGET_USER}"

  if id -nG "${TARGET_USER}" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    ok "${TARGET_USER} 已在 docker 组"
    USER_IN_DOCKER_GROUP=1
  else
    fail "${TARGET_USER} 不在 docker 组"
    NEED_GROUP=1
  fi

  section "智能诊断：Compose 文件 / 软链 / PATH"
  if [[ -e "${COMPAT_LINK}" || -L "${COMPAT_LINK}" ]]; then
    ok "存在兼容入口: ${COMPAT_LINK} ($(ls -l "${COMPAT_LINK}" 2>/dev/null | awk '{print $1,$3,$4}'))"
    HAS_COMPAT=1
  else
    fail "缺少 ${COMPAT_LINK}（docker-compose: command not found）"
    NEED_COMPOSE=1
    NEED_BIN_PERMS=1
  fi
  if [[ -e "${PLUGIN_PATH}" || -L "${PLUGIN_PATH}" ]]; then
    ok "存在插件入口: ${PLUGIN_PATH}"
    HAS_PLUGIN=1
    if ! run_as_target "test -r ${PLUGIN_PATH} && test -x ${PLUGIN_PATH}"; then
      fail "${TARGET_USER} 无法访问插件文件"
      NEED_BIN_PERMS=1
      NEED_COMPOSE=1
    fi
  else
    warn "缺少插件: ${PLUGIN_PATH}（影响 docker compose 带空格）"
  fi

  if [[ "${HAS_COMPAT}" -eq 0 && "${HAS_PLUGIN}" -eq 0 ]]; then
    NEED_COMPOSE=1
    NEED_COMPOSE_FROM=1
  elif [[ "${HAS_COMPAT}" -eq 0 || "${HAS_PLUGIN}" -eq 0 ]]; then
    NEED_COMPOSE=1
  fi

  local target_path
  target_path="$(run_as_target 'echo "$PATH"' 2>/dev/null || true)"
  if [[ -n "${target_path}" ]]; then
    note "${TARGET_USER} PATH=${target_path}"
    if ! echo "${target_path}" | tr ':' '\n' | grep -qx '/usr/local/bin'; then
      fail "PATH 不含 /usr/local/bin → 软链在也会 command not found"
      NEED_PATH=1
    else
      ok "PATH 含 /usr/local/bin"
    fi
  fi

  # 绝对路径能跑但 PATH 找不到 → 纯 PATH
  if [[ -e "${COMPAT_LINK}" ]] && run_as_target "${COMPAT_LINK} version >/dev/null 2>&1"; then
    ok "绝对路径可运行: ${COMPAT_LINK}"
    if ! run_as_target 'command -v docker-compose >/dev/null 2>&1'; then
      fail "绝对路径能跑，command -v 找不到 → 纯 PATH，跑 06"
      NEED_PATH=1
      # PATH 问题不强制 NEED_COMPOSE（避免误判还要装包）
    fi
  fi

  # PATH 中若存在多个 docker-compose，实际生效的可能不是预期那个（如旧版 pip 装的 v1）
  local dup_compose dup_count
  dup_compose="$(run_as_target 'command -v -a docker-compose 2>/dev/null' 2>/dev/null || true)"
  dup_count="$(echo "${dup_compose}" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "${dup_count}" -gt 1 ]]; then
    warn "${TARGET_USER} PATH 中发现多个 docker-compose，可能命中错误版本:"
    echo "${dup_compose}" | sed 's/^/  /'
  fi

  section "智能诊断：SELinux（若启用）"
  if command -v getenforce >/dev/null 2>&1; then
    local se_status
    se_status="$(getenforce 2>/dev/null || true)"
    note "SELinux 状态: ${se_status:-未知}"
    if [[ "${se_status}" == "Enforcing" ]]; then
      warn "SELinux Enforcing：root 常 unconfined 不受限，${TARGET_USER} 可能被拦截（即使 DAC 权限位正确）"
      local p ctx
      for p in /usr/bin/docker /usr/libexec/docker/cli-plugins/docker-compose "${COMPAT_LINK}"; do
        [[ -e "${p}" ]] || continue
        ctx="$(ls -Z "${p}" 2>/dev/null | awk '{print $1}')"
        if [[ -n "${ctx}" && "${ctx}" != *"bin_t"* ]]; then
          fail "${p} SELinux 上下文异常: ${ctx}"
          NEED_BIN_PERMS=1
        fi
      done
    else
      ok "SELinux 非 Enforcing，暂不是阻断因素"
    fi
  fi

  section "智能诊断：以 ${TARGET_USER} 实测"
  local docker_env
  docker_env="$(run_as_target 'env | grep -E "^(DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG)=" || true' 2>/dev/null || true)"
  if [[ -n "${docker_env}" ]]; then
    warn "${TARGET_USER} 登录环境存在 Docker 相关变量，可能覆盖默认 ${SOCK}"
    echo "${docker_env}" | sed 's/^/  /'
  fi
  if [[ "${USER_CAN_EXEC_DOCKER}" -eq 0 ]]; then
    fail "jnapp: 跳过 docker API 实测（二进制都执行不了，先修 05）"
  elif [[ "${ROOT_DOCKER_OK}" -eq 1 ]]; then
    if run_as_target 'docker info >/dev/null 2>&1'; then
      ok "jnapp: docker 可用"
      USER_DOCKER_OK=1
    else
      fail "jnapp: docker 不可用（API/socket/组）"
      [[ "${USER_IN_DOCKER_GROUP}" -eq 0 ]] && NEED_GROUP=1
      [[ "${SOCK_OK}" -eq 0 ]] && NEED_SOCKET=1
      if [[ "${USER_IN_DOCKER_GROUP}" -eq 1 && "${SOCK_OK}" -eq 1 ]]; then
        warn "组与 socket 看起来正常但仍失败 → 可能需重新登录刷新组"
      fi
    fi
  else
    note "跳过 jnapp docker 实测（root docker 尚未可用）"
  fi

  if [[ "${USER_CAN_EXEC_DOCKER}" -eq 1 ]]; then
    if run_as_target 'docker-compose version >/dev/null 2>&1'; then
      ok "jnapp: docker-compose 可用"
      USER_COMPOSE_BIN_OK=1
    else
      fail "jnapp: docker-compose 不可用"
      NEED_COMPOSE=1
      # 有插件无软链时 05 也会建软链
      [[ "${HAS_COMPAT}" -eq 0 && "${HAS_PLUGIN}" -eq 1 ]] && NEED_BIN_PERMS=1
    fi

    if run_as_target 'docker compose version >/dev/null 2>&1'; then
      ok "jnapp: docker compose 可用"
      USER_COMPOSE_PLUGIN_OK=1
    else
      warn "jnapp: docker compose 不可用"
      NEED_COMPOSE=1
      NEED_BIN_PERMS=1
    fi

    if [[ "${USER_COMPOSE_BIN_OK}" -eq 1 && "${USER_COMPOSE_PLUGIN_OK}" -eq 0 ]]; then
      NEED_COMPOSE=1
      NEED_BIN_PERMS=1
    fi
  else
    NEED_COMPOSE=1
  fi
}

print_plan() {
  section "修复计划（按诊断自动生成）"
  local any=0
  if [[ "${NEED_RECOVER}" -eq 1 ]]; then
    note "→ 运行 root-recover-docker.sh   （恢复 dockerd / 删除危险 drop-in）"
    any=1
  fi
  if [[ "${NEED_BIN_PERMS}" -eq 1 ]]; then
    note "→ 运行 05-root-fix-bin-perms.sh  （二进制+父目录+软链）【优先】"
    any=1
  fi
  if [[ "${NEED_GROUP}" -eq 1 ]]; then
    note "→ 运行 02-root-fix-group.sh     （把 ${TARGET_USER} 加入 docker 组）"
    any=1
  fi
  if [[ "${NEED_SOCKET}" -eq 1 ]]; then
    if [[ "${NO_RESTART_SOCKET}" -eq 1 ]]; then
      note "→ 运行 03-root-fix-socket.sh --no-restart  （socket 属组 + daemon.json）"
    else
      note "→ 运行 03-root-fix-socket.sh   （socket 属组 + daemon.json，含安全重启）"
    fi
    any=1
  fi
  if [[ "${NEED_COMPOSE}" -eq 1 ]]; then
    if [[ "${NEED_COMPOSE_FROM}" -eq 1 ]]; then
      if [[ -n "${SOURCE_BIN}" ]]; then
        note "→ 运行 04-root-fix-compose.sh --from ${SOURCE_BIN}"
      else
        note "→ 需要 04-root-fix-compose.sh --from <离线包>  （两边都无 compose 二进制）"
        warn "未提供 --from，自动修复无法安装 compose，请补参数后重跑"
      fi
    else
      note "→ 运行 04-root-fix-compose.sh  （插件/软链）"
    fi
    any=1
  fi
  if [[ "${NEED_PATH}" -eq 1 ]]; then
    note "→ 运行 06-root-fix-path.sh      （补 /usr/local/bin 到登录 PATH）"
    any=1
  fi
  if [[ "${any}" -eq 0 ]]; then
    ok "无需修复：当前诊断未发现可自动处理的问题"
    if [[ "${USER_DOCKER_OK}" -eq 1 && ( "${USER_COMPOSE_BIN_OK}" -eq 1 || "${USER_COMPOSE_PLUGIN_OK}" -eq 1 ) ]]; then
      info "目标基本达成：jnapp 可用 docker，且至少一种 compose 可用"
    fi
  fi
}

apply_plan() {
  section "按计划自动修复"
  local ran=0

  if [[ "${NEED_RECOVER}" -eq 1 ]]; then
    run_step root-recover-docker.sh
    ran=1
    # 恢复后再看 socket
    if [[ -S "${SOCK}" ]]; then
      local meta perms owner group
      meta="$(sock_meta)"
      IFS='|' read -r perms owner group <<<"${meta}"
      if [[ "${group}" != "docker" ]]; then
        NEED_SOCKET=1
      fi
    fi
  fi

  if [[ "${NEED_BIN_PERMS}" -eq 1 ]]; then
    run_step 05-root-fix-bin-perms.sh
    ran=1
  fi

  if [[ "${NEED_GROUP}" -eq 1 ]]; then
    run_step 02-root-fix-group.sh --user "${TARGET_USER}"
    ran=1
  fi

  if [[ "${NEED_SOCKET}" -eq 1 ]]; then
    local sargs=()
    [[ "${NO_RESTART_SOCKET}" -eq 1 ]] && sargs+=(--no-restart)
    run_step 03-root-fix-socket.sh "${sargs[@]+"${sargs[@]}"}"
    ran=1
  fi

  if [[ "${NEED_COMPOSE}" -eq 1 ]]; then
    if [[ "${NEED_COMPOSE_FROM}" -eq 1 && -z "${SOURCE_BIN}" ]]; then
      error "跳过 compose 安装：缺少 --from <docker-compose-linux-x86_64>"
    else
      local cargs=()
      [[ -n "${SOURCE_BIN}" ]] && cargs+=(--from "${SOURCE_BIN}")
      run_step 04-root-fix-compose.sh "${cargs[@]+"${cargs[@]}"}"
      ran=1
    fi
  fi

  if [[ "${NEED_PATH}" -eq 1 ]]; then
    run_step 06-root-fix-path.sh --user "${TARGET_USER}"
    ran=1
  fi

  if [[ "${ran}" -eq 0 ]]; then
    ok "未执行任何修复步骤"
  fi
}

confirm_or_exit() {
  if [[ "${ASSUME_YES}" -eq 1 ]]; then
    return 0
  fi
  echo ""
  read -r -p "按上述计划执行修复？[y/N] " ans
  case "${ans}" in
    y|Y|yes|YES) return 0 ;;
    *) info "已取消"; exit 0 ;;
  esac
}

main() {
  info "目标用户: ${TARGET_USER}"
  info "模式: $([[ "${DIAGNOSE_ONLY}" -eq 1 ]] && echo 仅诊断/出计划 || echo 诊断后按需自动修复)"

  collect_diagnosis || true
  print_plan

  if [[ "${DIAGNOSE_ONLY}" -eq 1 ]]; then
    section "总结"
    info "仅诊断完成。要自动修复请去掉 --diagnose-only，或加 --yes："
    echo "  sudo bash $0 --yes"
    [[ "${NEED_COMPOSE_FROM}" -eq 1 ]] && echo "  sudo bash $0 --yes --from /path/to/docker-compose-linux-x86_64"
    exit 0
  fi

  # 若完全没事
  if [[ "${NEED_RECOVER}" -eq 0 && "${NEED_BIN_PERMS}" -eq 0 && "${NEED_GROUP}" -eq 0 && "${NEED_SOCKET}" -eq 0 && "${NEED_COMPOSE}" -eq 0 && "${NEED_PATH}" -eq 0 ]]; then
    section "总结"
    info "无需修复"
    note "jnapp 验证: bash ${SCRIPT_DIR}/jnapp-verify.sh （若刚加过组请先重新登录）"
    exit 0
  fi

  # compose 缺二进制且无 --from：允许继续修其它项，但最终非 0
  confirm_or_exit
  apply_plan

  section "复检"
  collect_diagnosis || true
  print_plan

  section "总结"
  local ok_goal=0
  if [[ "${ROOT_DOCKER_OK}" -eq 1 && "${USER_DOCKER_OK}" -eq 1 && ( "${USER_COMPOSE_BIN_OK}" -eq 1 || "${USER_COMPOSE_PLUGIN_OK}" -eq 1 ) ]]; then
    ok_goal=1
  fi

  if [[ "${ok_goal}" -eq 1 ]]; then
    info "成功：root/jnapp docker 可用，且至少一种 compose 可用"
    if [[ "${USER_COMPOSE_BIN_OK}" -eq 0 ]]; then
      note "建议用: docker compose ..."
    elif [[ "${USER_COMPOSE_PLUGIN_OK}" -eq 0 ]]; then
      note "建议用: docker-compose ..."
    fi
    note "请让 ${TARGET_USER} 重新登录后再跑: bash ${SCRIPT_DIR}/jnapp-verify.sh"
    exit 0
  fi

  warn "自动修复后仍未完全达标"
  if [[ "${NEED_COMPOSE_FROM}" -eq 1 && -z "${SOURCE_BIN}" ]]; then
    error "缺 compose 二进制：请带上 --from 重跑"
    echo "  sudo bash $0 --yes --from /path/to/docker-compose-linux-x86_64"
  fi
  if [[ "${USER_CAN_EXEC_DOCKER}" -eq 0 || "${NEED_BIN_PERMS}" -eq 1 ]]; then
    warn "仍是二进制 Permission denied：请跑 sudo bash ${SCRIPT_DIR}/05-root-fix-bin-perms.sh"
    note "并检查: ls -l /usr/bin/docker"
  elif [[ "${USER_DOCKER_OK}" -eq 0 && "${NEED_GROUP}" -eq 0 && "${SOCK_OK}" -eq 1 ]]; then
    warn "可能只是组未在会话生效：请用 su - ${TARGET_USER}（带横杠）重新登录后再试"
  fi
  note "可再跑详细诊断: sudo bash ${SCRIPT_DIR}/01-root-diagnose.sh"
  exit 1
}

main "$@"
