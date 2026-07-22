#!/usr/bin/env bash
# root: 只诊断，不修改系统
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

DIAG_ISSUES=0

usage() {
  cat <<EOF
用法: sudo bash $0 [--user NAME]

只诊断 Docker / socket / 组 / Compose，不改动系统。
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

section "2. Docker socket（组权限）—— 关键阻断点"
if [[ -S "${SOCK}" ]]; then
  meta="$(sock_meta)"
  IFS='|' read -r perms owner group <<<"${meta}"
  note "${SOCK} 权限=${perms} 属主=${owner}:${group}"
  if [[ "${group}" == "docker" && ( "${perms}" == "660" || "${perms}" == "0660" ) ]]; then
    ok "socket 权限符合预期 (root:docker 0660)"
  else
    fail "socket 属组/权限不对：当前 ${owner}:${group} ${perms}，期望 root:docker 0660"
    note "jnapp 在 docker 组也无法访问 root:root 的 660 socket"
    note "下一步: sudo bash ${SCRIPT_DIR}/03-root-fix-socket.sh"
    inc
  fi
else
  fail "未找到 ${SOCK}"; inc
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

section "4. Compose 插件 / 独立二进制 / PATH"
has_plugin=0
has_standalone=0

if [[ -e "${PLUGIN_PATH}" ]]; then
  if [[ -x "${PLUGIN_PATH}" ]]; then
    ok "插件存在且可执行: ${PLUGIN_PATH}"
    has_plugin=1
    note "文件类型: $(file -b "${PLUGIN_PATH}" 2>/dev/null || echo unknown)"
  else
    fail "插件存在但不可执行: ${PLUGIN_PATH}"; inc
  fi
else
  warn "缺少 Compose 插件路径: ${PLUGIN_PATH}（仅影响 docker compose 带空格命令）"
fi

if [[ -L "${COMPAT_LINK}" ]]; then
  target="$(readlink -f "${COMPAT_LINK}" 2>/dev/null || readlink "${COMPAT_LINK}")"
  note "兼容入口是软链: ${COMPAT_LINK} -> ${target}"
  if [[ -x "${COMPAT_LINK}" ]]; then
    ok "docker-compose 软链可执行"; has_standalone=1
  else
    fail "docker-compose 软链不可执行/断链"; inc
  fi
elif [[ -e "${COMPAT_LINK}" ]]; then
  note "${COMPAT_LINK} 是独立文件（非软链）: $(ls -l "${COMPAT_LINK}")"
  if [[ -x "${COMPAT_LINK}" ]]; then
    ok "独立 docker-compose 可执行 —— 部署脚本用 docker-compose 即可"
    has_standalone=1
  else
    fail "${COMPAT_LINK} 不可执行"; inc
  fi
else
  fail "缺少 ${COMPAT_LINK}"
  note "下一步: sudo bash ${SCRIPT_DIR}/04-root-fix-compose.sh"
  inc
fi

if [[ "${has_plugin}" -eq 0 && "${has_standalone}" -eq 1 ]]; then
  note "结论: 有独立 docker-compose，无插件 → 用 docker-compose 即可；可选跑 04-root-fix-compose.sh 启用 docker compose"
elif [[ "${has_plugin}" -eq 0 && "${has_standalone}" -eq 0 ]]; then
  fail "既无插件也无独立 docker-compose，需要从离线包补装"; inc
fi

target_path="$(run_as_target 'echo "$PATH"' 2>/dev/null || true)"
if [[ -n "${target_path}" ]]; then
  note "${TARGET_USER} 登录 PATH=${target_path}"
  if echo "${target_path}" | tr ':' '\n' | grep -qx '/usr/local/bin'; then
    ok "${TARGET_USER} PATH 包含 /usr/local/bin"
  else
    fail "${TARGET_USER} PATH 不包含 /usr/local/bin"
    note "下一步: sudo bash ${SCRIPT_DIR}/04-root-fix-compose.sh --fix-path"
    inc
  fi
else
  warn "无法读取 ${TARGET_USER} 登录 PATH"
fi

section "5. 以 ${TARGET_USER} 登录环境实测三种命令"
if out="$(run_as_target 'docker version --format "Client={{.Client.Version}} Server={{.Server.Version}}"' 2>&1)"; then
  ok "docker: ${out}"
else
  fail "docker: ${out}"; inc
fi
if out="$(run_as_target 'docker compose version' 2>&1)"; then
  ok "docker compose: ${out}"
else
  warn "docker compose: ${out}"
  note "若 docker-compose（无空格）可用，部署可继续用 docker-compose"
fi
if out="$(run_as_target 'command -v docker-compose; docker-compose version' 2>&1)"; then
  ok "docker-compose: ${out}"
else
  fail "docker-compose: ${out}"; inc
fi

section "6. 症状判断与建议步骤"
docker_ok=0 compose_plugin_ok=0 compose_bin_ok=0
run_as_target 'docker info >/dev/null 2>&1' && docker_ok=1 || true
run_as_target 'docker compose version >/dev/null 2>&1' && compose_plugin_ok=1 || true
run_as_target 'docker-compose version >/dev/null 2>&1' && compose_bin_ok=1 || true

meta="$(sock_meta || true)"
IFS='|' read -r perms owner group <<<"${meta}"

if [[ "${owner:-}" == "root" && "${group:-}" == "root" ]]; then
  warn "根因高概率: socket=root:root → 请先跑: sudo bash ${SCRIPT_DIR}/03-root-fix-socket.sh"
fi
if [[ "${compose_bin_ok}" -eq 1 && "${compose_plugin_ok}" -eq 0 ]]; then
  warn "docker-compose 已可用；docker compose 可选: sudo bash ${SCRIPT_DIR}/04-root-fix-compose.sh"
fi
if [[ "${docker_ok}" -eq 0 ]]; then
  warn "jnapp 的 docker 不可用：优先修 socket，再确认组"
elif [[ "${docker_ok}" -eq 1 && "${compose_bin_ok}" -eq 1 ]]; then
  ok "目标已达成: jnapp 可用 docker + docker-compose"
fi

section "总结"
if [[ "${DIAG_ISSUES}" -eq 0 ]]; then
  info "诊断完成：未发现阻断性问题"
  exit 0
fi
warn "诊断完成：发现 ${DIAG_ISSUES} 项问题"
note "一键全修: sudo bash ${SCRIPT_DIR}/root-all.sh"
note "或按项执行: 02-root-fix-group.sh / 03-root-fix-socket.sh / 04-root-fix-compose.sh"
exit "${DIAG_ISSUES}"
