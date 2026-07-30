#!/usr/bin/env bash
# root: 只诊断，不修改系统
# 覆盖: daemon/socket/组/二进制权限/插件父目录/软链/PATH/实测
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

DIAG_ISSUES=0

usage() {
  cat <<EOF
用法: sudo bash $0 [--user NAME]

只诊断 Docker / socket / 组 / 二进制权限 / 插件目录 / Compose / PATH，不改动系统。
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

inc() { DIAG_ISSUES=$((DIAG_ISSUES + 1)); }

section "1. Docker 引擎与服务"
if command -v docker >/dev/null 2>&1; then
  ok "docker 二进制: $(command -v docker)"
else
  fail "未找到 docker 命令"; inc
fi

for bin in dockerd containerd; do
  if [[ -x "/usr/bin/${bin}" ]]; then
    ok "/usr/bin/${bin} 可执行"
  else
    fail "/usr/bin/${bin} 不存在或不可执行"; inc
  fi
done

if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet docker; then
    ok "systemctl: docker = active"
  else
    fail "systemctl: docker 未 active（$(systemctl is-active docker 2>/dev/null || true)）"; inc
  fi
  if systemctl is-active --quiet containerd; then
    ok "systemctl: containerd = active"
  else
    warn "systemctl: containerd 未 active（若 root 下 docker info 正常可忽略）"
  fi
else
  warn "无 systemctl，跳过服务状态检查"
fi

section "2. Docker socket（组权限）"
if [[ -S "${SOCK}" ]]; then
  meta="$(sock_meta)"
  IFS='|' read -r perms owner group <<<"${meta}"
  note "${SOCK} 权限=${perms} 属主=${owner}:${group}"
  if command -v getfacl >/dev/null 2>&1; then
    acl_mask="$(getfacl -cp "${SOCK}" 2>/dev/null | awk -F: '/^mask::/ {print $3; exit}' || true)"
    [[ -n "${acl_mask}" ]] && note "${SOCK} ACL mask=${acl_mask}"
    if [[ -n "${acl_mask}" && "${acl_mask}" != "rw-" ]]; then
      fail "socket ACL mask 不是 rw-，即使 stat 看着 660 也可能限制 docker 组访问"
      note "下一步: sudo bash ${SCRIPT_DIR}/03-root-fix-socket.sh"
      inc
    fi
  fi
  if [[ "${group}" == "docker" && ( "${perms}" == "660" || "${perms}" == "0660" ) ]]; then
    ok "socket 权限符合预期 (root:docker 0660)"
  else
    fail "socket 属组/权限不对：当前 ${owner}:${group} ${perms}，期望 root:docker 0660"
    note "下一步: sudo bash ${SCRIPT_DIR}/03-root-fix-socket.sh"
    inc
  fi
else
  fail "未找到 ${SOCK}"; note "下一步: sudo bash ${SCRIPT_DIR}/root-recover-docker.sh"; inc
fi

section "3. 用户与 docker 组"
if id "${TARGET_USER}" >/dev/null 2>&1; then
  ok "用户存在: ${TARGET_USER}"
else
  fail "用户不存在: ${TARGET_USER}"; inc
  section "总结"; warn "诊断中止：用户不存在"; exit 1
fi

if getent group docker >/dev/null 2>&1; then
  ok "docker 组存在"
else
  fail "docker 组不存在"; note "下一步: sudo bash ${SCRIPT_DIR}/02-root-fix-group.sh"; inc
fi

if id -nG "${TARGET_USER}" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
  ok "${TARGET_USER} 已在 docker 组（/etc/group）"
else
  fail "${TARGET_USER} 不在 docker 组"
  note "下一步: sudo bash ${SCRIPT_DIR}/02-root-fix-group.sh --user ${TARGET_USER}"
  inc
fi

section "4. 二进制可执行权限（BDVIEW: Permission denied）"
if [[ -e /usr/bin/docker ]]; then
  note "/usr/bin/docker: $(ls -l /usr/bin/docker 2>/dev/null || true)"
  if run_as_target 'test -x /usr/bin/docker'; then
    ok "${TARGET_USER} 可执行 /usr/bin/docker"
  else
    fail "${TARGET_USER} 无法执行 /usr/bin/docker → bash: /usr/bin/docker: Permission denied"
    note "下一步: sudo bash ${SCRIPT_DIR}/05-root-fix-bin-perms.sh"
    inc
  fi
else
  fail "不存在 /usr/bin/docker"; inc
fi

section "5. 插件父目录可进入性（BDVIEW: unknown command: docker compose）"
for d in /usr /usr/bin /usr/libexec /usr/libexec/docker /usr/libexec/docker/cli-plugins /usr/local /usr/local/bin; do
  if [[ -d "${d}" ]]; then
    note "$(ls -ld "${d}" 2>/dev/null || true)"
    if run_as_target "test -x ${d}"; then
      ok "${TARGET_USER} 可进入目录: ${d}"
    else
      fail "${TARGET_USER} 无法进入目录: ${d}（常见 750）"
      note "即使插件文件是 755，进不去父目录也会 unknown command / command not found"
      note "下一步: sudo bash ${SCRIPT_DIR}/05-root-fix-bin-perms.sh"
      inc
    fi
  else
    warn "目录不存在: ${d}"
  fi
done

section "6. Compose 插件 / 软链 / PATH（BDVIEW: command not found）"
has_plugin=0
has_standalone=0

if [[ -e "${PLUGIN_PATH}" ]]; then
  note "插件: $(ls -l "${PLUGIN_PATH}" 2>/dev/null || true)"
  if run_as_target "test -r ${PLUGIN_PATH} && test -x ${PLUGIN_PATH}"; then
    ok "${TARGET_USER} 可读可执行插件: ${PLUGIN_PATH}"
    has_plugin=1
  else
    fail "${TARGET_USER} 无法访问插件文件（权限或父目录）"
    note "下一步: sudo bash ${SCRIPT_DIR}/05-root-fix-bin-perms.sh"
    inc
  fi
else
  warn "缺少 Compose 插件: ${PLUGIN_PATH}"
fi

if [[ -L "${COMPAT_LINK}" || -e "${COMPAT_LINK}" ]]; then
  note "兼容入口: $(ls -l "${COMPAT_LINK}" 2>/dev/null || true)"
  has_standalone=1
  if run_as_target "test -x ${COMPAT_LINK}"; then
    ok "${TARGET_USER} 可执行 ${COMPAT_LINK}"
  else
    fail "${TARGET_USER} 无法执行 ${COMPAT_LINK}"
    note "下一步: sudo bash ${SCRIPT_DIR}/05-root-fix-bin-perms.sh"
    inc
  fi
else
  fail "缺少 ${COMPAT_LINK}（会导致 docker-compose: command not found）"
  if [[ "${has_plugin}" -eq 1 ]]; then
    note "插件在，缺软链 → sudo bash ${SCRIPT_DIR}/05-root-fix-bin-perms.sh 或 04-root-fix-compose.sh"
  else
    note "下一步: sudo bash ${SCRIPT_DIR}/04-root-fix-compose.sh --from <离线包>"
  fi
  inc
fi

target_path="$(run_as_target 'echo "$PATH"' 2>/dev/null || true)"
if [[ -n "${target_path}" ]]; then
  note "${TARGET_USER} 登录 PATH=${target_path}"
  if echo "${target_path}" | tr ':' '\n' | grep -qx '/usr/local/bin'; then
    ok "PATH 包含 /usr/local/bin"
  else
    fail "PATH 不包含 /usr/local/bin"
    note "软链在 /usr/local/bin 也会 command not found"
    note "下一步: sudo bash ${SCRIPT_DIR}/06-root-fix-path.sh"
    inc
  fi
else
  warn "无法读取 ${TARGET_USER} 登录 PATH"
fi

# 区分：绝对路径能跑 vs PATH 找不到
if [[ -e "${COMPAT_LINK}" ]]; then
  if run_as_target "${COMPAT_LINK} version >/dev/null 2>&1"; then
    ok "绝对路径可运行: ${COMPAT_LINK} version"
    if ! run_as_target 'command -v docker-compose >/dev/null 2>&1'; then
      fail "绝对路径能跑，但 command -v docker-compose 找不到 → 纯 PATH 问题"
      note "下一步: sudo bash ${SCRIPT_DIR}/06-root-fix-path.sh"
      inc
    fi
  else
    warn "绝对路径 ${COMPAT_LINK} version 失败（权限/坏链/依赖）"
  fi
fi

if [[ "${has_plugin}" -eq 0 && "${has_standalone}" -eq 0 ]]; then
  fail "既无插件也无独立 docker-compose，需要离线包"; inc
fi

# PATH 中若存在多个 docker-compose，实际生效的可能不是 /usr/local/bin 里这个（如旧版 pip 装的 v1）
dup_compose="$(run_as_target 'command -v -a docker-compose 2>/dev/null' 2>/dev/null || true)"
dup_count="$(echo "${dup_compose}" | sed '/^$/d' | wc -l | tr -d ' ')"
if [[ "${dup_count}" -gt 1 ]]; then
  warn "${TARGET_USER} PATH 中发现多个 docker-compose，可能命中了错误版本:"
  echo "${dup_compose}" | sed 's/^/  /'
  note "实际生效: $(run_as_target 'command -v docker-compose' 2>/dev/null || true)（PATH 中排最前的那个）"
fi

section "7. SELinux（若启用，root 与普通用户可能表现不同）"
if command -v getenforce >/dev/null 2>&1; then
  se_status="$(getenforce 2>/dev/null || true)"
  note "SELinux 状态: ${se_status:-未知}"
  if [[ "${se_status}" == "Enforcing" ]]; then
    warn "SELinux 处于 Enforcing：root 常以 unconfined 运行不受限，${TARGET_USER} 可能被拦截"
    note "即使文件权限/属组都正确，仍可能报 permission denied（本质是 SELinux 拒绝，非 DAC 权限位）"
    for p in /usr/bin/docker /usr/libexec/docker/cli-plugins/docker-compose "${COMPAT_LINK}"; do
      [[ -e "${p}" ]] || continue
      ctx="$(ls -Z "${p}" 2>/dev/null | awk '{print $1}')"
      note "$(printf '%-55s' "${p}") 上下文=${ctx:-未知}"
      if [[ -n "${ctx}" && "${ctx}" != *"bin_t"* ]]; then
        fail "${p} 的 SELinux 上下文非 bin_t，可能被拦截执行"
        note "下一步: restorecon -v ${p} 或 chcon -t bin_t ${p}（也可跑 05-root-fix-bin-perms.sh 自动尝试）"
        inc
      fi
    done
    if command -v ausearch >/dev/null 2>&1; then
      note "如需确认是否真被 SELinux 拒绝: ausearch -m avc -ts recent 2>/dev/null | grep -i docker"
    fi
  else
    ok "SELinux 非 Enforcing（${se_status:-disabled}），暂不是阻断因素"
  fi
else
  note "系统无 getenforce，跳过 SELinux 检查（非 RHEL 系发行版通常无需关心）"
fi

section "8. 以 ${TARGET_USER} 登录环境实测"
docker_env="$(run_as_target 'env | grep -E "^(DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG)=" || true' 2>/dev/null || true)"
if [[ -n "${docker_env}" ]]; then
  warn "${TARGET_USER} 登录环境存在 Docker 相关变量，可能覆盖默认 ${SOCK}"
  echo "${docker_env}" | sed 's/^/  /'
fi
if out="$(run_as_target 'docker version --format "Client={{.Client.Version}} Server={{.Server.Version}}"' 2>&1)"; then
  ok "docker: ${out}"
else
  fail "docker: ${out}"; inc
fi
if out="$(run_as_target 'docker compose version' 2>&1)"; then
  ok "docker compose: ${out}"
else
  warn "docker compose: ${out}"
  note "常见: 父目录 750 / 插件不可读 → 05-root-fix-bin-perms.sh"
fi
if out="$(run_as_target 'command -v docker-compose; docker-compose version' 2>&1)"; then
  ok "docker-compose: ${out}"
else
  fail "docker-compose: ${out}"; inc
  note "常见: 缺软链 / PATH 无 /usr/local/bin → 05 + 06"
fi

section "9. 症状判断与建议"
docker_ok=0 compose_plugin_ok=0 compose_bin_ok=0
run_as_target 'docker info >/dev/null 2>&1' && docker_ok=1 || true
run_as_target 'docker compose version >/dev/null 2>&1' && compose_plugin_ok=1 || true
run_as_target 'docker-compose version >/dev/null 2>&1' && compose_bin_ok=1 || true

if ! run_as_target 'test -x /usr/bin/docker' 2>/dev/null; then
  warn "优先修二进制: sudo bash ${SCRIPT_DIR}/05-root-fix-bin-perms.sh"
fi
if [[ -e "${PLUGIN_PATH}" ]] && ! run_as_target "test -x /usr/libexec/docker/cli-plugins" 2>/dev/null; then
  warn "优先修插件父目录: sudo bash ${SCRIPT_DIR}/05-root-fix-bin-perms.sh"
fi
if [[ ! -e "${COMPAT_LINK}" && -e "${PLUGIN_PATH}" ]]; then
  warn "缺软链: ln -sfn ${PLUGIN_PATH} ${COMPAT_LINK} 或跑 05/04"
fi
if [[ -e "${COMPAT_LINK}" ]] && run_as_target "${COMPAT_LINK} version >/dev/null 2>&1" && ! run_as_target 'command -v docker-compose >/dev/null'; then
  warn "纯 PATH 问题: sudo bash ${SCRIPT_DIR}/06-root-fix-path.sh"
fi

meta="$(sock_meta || true)"
IFS='|' read -r perms owner group <<<"${meta}"
if [[ "${owner:-}" == "root" && "${group:-}" == "root" ]]; then
  warn "socket=root:root → sudo bash ${SCRIPT_DIR}/03-root-fix-socket.sh"
fi

if [[ "${docker_ok}" -eq 1 && "${compose_bin_ok}" -eq 1 ]]; then
  ok "目标已达成: jnapp 可用 docker + docker-compose"
elif [[ "${docker_ok}" -eq 1 && "${compose_plugin_ok}" -eq 1 ]]; then
  ok "可用 docker + docker compose；若脚本写 docker-compose 再补 PATH/软链"
fi

section "总结"
if [[ "${DIAG_ISSUES}" -eq 0 ]]; then
  info "诊断完成：未发现阻断性问题"
  exit 0
fi
warn "诊断完成：发现 ${DIAG_ISSUES} 项问题"
note "智能一键: sudo bash ${SCRIPT_DIR}/root-auto.sh --yes"
note "或: 05 / 06-root-fix-path.sh / 04 / 03"
exit "${DIAG_ISSUES}"
