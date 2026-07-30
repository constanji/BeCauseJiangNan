#!/usr/bin/env bash
# root: 修复 docker / compose 相关二进制与目录的可执行权限
# 针对:
#   bash: /usr/bin/docker: Permission denied
#   docker: unknown command: docker compose   （插件文件 755 但父目录 750）
#   docker-compose: command not found         （缺 /usr/local/bin 软链）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

usage() {
  cat <<EOF
用法: sudo bash $0

1) 修二进制为 755
2) 修插件父目录为 755（否则 jnapp 进不去，docker 发现不了插件）
3) 若有插件、无 ${COMPAT_LINK}，自动建软链

典型报错:
  bash: /usr/bin/docker: Permission denied
  docker: unknown command: docker compose
  docker-compose: command not found
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) error "未知参数: $1"; usage; exit 1 ;;
  esac
done

require_root

fix_file() {
  local path="$1"
  if [[ ! -e "${path}" ]]; then
    note "跳过（不存在）: ${path}"
    return 0
  fi
  local target="${path}"
  if [[ -L "${path}" ]]; then
    target="$(readlink -f "${path}" 2>/dev/null || true)"
    note "软链 ${path} -> ${target:-?}"
    [[ -n "${target}" && -e "${target}" ]] || target="${path}"
  fi
  note "文件修复前: $(ls -l "${path}" 2>/dev/null || true)"
  chown root:root "${target}" 2>/dev/null || true
  chmod 755 "${target}" 2>/dev/null || chmod a+rx "${target}"
  ok "文件修复后: $(ls -l "${path}" 2>/dev/null || true)"
}

fix_dir() {
  local path="$1"
  if [[ ! -d "${path}" ]]; then
    note "跳过目录（不存在）: ${path}"
    return 0
  fi
  note "目录修复前: $(ls -ld "${path}" 2>/dev/null || true)"
  chmod 755 "${path}" 2>/dev/null || chmod a+rx "${path}"
  ok "目录修复后: $(ls -ld "${path}" 2>/dev/null || true)"
}

section "1) 修复二进制权限"
BINS=(
  /usr/bin/docker
  /usr/bin/dockerd
  /usr/bin/containerd
  /usr/bin/containerd-shim
  /usr/bin/containerd-shim-runc-v1
  /usr/bin/containerd-shim-runc-v2
  /usr/bin/docker-init
  /usr/bin/docker-proxy
  /usr/bin/runc
  /usr/bin/ctr
  "${COMPAT_LINK}"
  "${PLUGIN_PATH}"
)
for b in "${BINS[@]}"; do
  fix_file "${b}"
done

section "2) 修复插件父目录权限（关键：否则 unknown command: docker compose）"
# 父目录若是 750，jnapp 无法 traverse，即使插件文件已是 755
fix_dir /usr
fix_dir /usr/bin
fix_dir /usr/libexec
fix_dir /usr/libexec/docker
fix_dir /usr/libexec/docker/cli-plugins
fix_dir /usr/local
fix_dir /usr/local/bin

section "2b) SELinux 上下文（若启用，best-effort）"
if command -v getenforce >/dev/null 2>&1; then
  se_status="$(getenforce 2>/dev/null || true)"
  note "SELinux 状态: ${se_status:-未知}"
  if [[ "${se_status}" != "Disabled" ]]; then
    if command -v restorecon >/dev/null 2>&1; then
      for p in "${BINS[@]}" /usr/libexec/docker /usr/libexec/docker/cli-plugins; do
        [[ -e "${p}" ]] || continue
        restorecon -v "${p}" 2>/dev/null || true
      done
      ok "已尝试 restorecon 恢复默认 SELinux 上下文"
    elif command -v chcon >/dev/null 2>&1; then
      for p in "${BINS[@]}"; do
        [[ -e "${p}" ]] || continue
        chcon -t bin_t "${p}" 2>/dev/null || true
      done
      ok "已尝试 chcon -t bin_t（无 restorecon 时的兜底）"
    else
      warn "SELinux 未 Disabled，但无 restorecon/chcon 可用，请手动处理"
    fi
  fi
else
  note "无 getenforce，跳过 SELinux 处理"
fi

section "3) 确保 docker-compose 命令存在（软链）"
mkdir -p /usr/local/bin /usr/libexec/docker/cli-plugins
if [[ -e "${PLUGIN_PATH}" && ! -e "${COMPAT_LINK}" ]]; then
  ln -sfn "${PLUGIN_PATH}" "${COMPAT_LINK}"
  ok "已创建: ${COMPAT_LINK} -> ${PLUGIN_PATH}"
elif [[ -e "${COMPAT_LINK}" && ! -e "${PLUGIN_PATH}" ]]; then
  ln -sfn "${COMPAT_LINK}" "${PLUGIN_PATH}"
  ok "已创建: ${PLUGIN_PATH} -> ${COMPAT_LINK}"
else
  [[ -e "${COMPAT_LINK}" ]] && ok "已有 ${COMPAT_LINK}"
  [[ -e "${PLUGIN_PATH}" ]] && ok "已有 ${PLUGIN_PATH}"
fi
# 软链本身也要能被解析
[[ -e "${COMPAT_LINK}" ]] && chmod 755 "${COMPAT_LINK}" 2>/dev/null || true

section "4) 以 ${TARGET_USER} 验证"
if run_as_target 'test -x /usr/bin/docker'; then
  ok "${TARGET_USER} 可执行 /usr/bin/docker"
else
  fail "${TARGET_USER} 仍无法执行 /usr/bin/docker"
fi

if run_as_target "test -r ${PLUGIN_PATH} && test -x ${PLUGIN_PATH}"; then
  ok "${TARGET_USER} 可读可执行插件 ${PLUGIN_PATH}"
else
  fail "${TARGET_USER} 仍无法访问插件（检查父目录权限）"
  note "ls -ld /usr/libexec/docker /usr/libexec/docker/cli-plugins"
fi

if run_as_target 'command -v docker-compose >/dev/null'; then
  ok "${TARGET_USER} 能找到 docker-compose: $(run_as_target 'command -v docker-compose')"
else
  fail "${TARGET_USER} 找不到 docker-compose（PATH 或软链）"
fi

# 实测子命令（允许 daemon 问题以外的 compose 插件发现）
if out="$(run_as_target 'docker compose version' 2>&1)"; then
  ok "docker compose: ${out}"
else
  warn "docker compose 仍失败: ${out}"
fi
if out="$(run_as_target 'docker-compose version' 2>&1)"; then
  ok "docker-compose: ${out}"
else
  warn "docker-compose 仍失败: ${out}"
fi

info "完成。验证: su - ${TARGET_USER} -c 'docker-compose version'"
note "务必用: su - ${TARGET_USER}（带横杠）"
