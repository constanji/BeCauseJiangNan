#!/usr/bin/env bash
# root: 修复 /var/run/docker.sock 属组为 docker，并尽量持久化（EMEP59 主因）
# 注意：不再用 ExecStart= 覆盖 dockerd（容易把 docker 拉挂）；改用 daemon.json "group"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

NO_RESTART=0
DAEMON_JSON="/etc/docker/daemon.json"
DROPIN="${DOCKER_SERVICE_DROPIN_DIR}/group.conf"

usage() {
  cat <<EOF
用法: sudo bash $0 [--no-restart]

将 ${SOCK} 设为 root:docker 0660，并持久化：
  - 确保 docker.socket 的 SocketGroup=docker
  - 写入/合并 ${DAEMON_JSON} 的 "group": "docker"
  - 删除旧版危险 drop-in ${DROPIN}（若存在）

默认会安全重启 docker（先保证 containerd）；加 --no-restart 则只改配置 + 当前 sock。
若 docker 已挂（sock 不存在），请先跑: sudo bash ${SCRIPT_DIR}/root-recover-docker.sh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-restart) NO_RESTART=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) error "未知参数: $1"; usage; exit 1 ;;
  esac
done

require_root

if [[ ! -S "${SOCK}" ]] && ! systemctl is-active --quiet docker; then
  error "docker 未运行且 ${SOCK} 不存在"
  note "请先恢复: sudo bash ${SCRIPT_DIR}/root-recover-docker.sh"
  exit 1
fi

section "清理旧版危险 drop-in（若有）"
if [[ -f "${DROPIN}" ]]; then
  warn "删除会覆盖 ExecStart 的 ${DROPIN}"
  rm -f "${DROPIN}"
  ok "已删除"
else
  ok "无旧 drop-in"
fi

section "确保 docker 组 / socket unit"
groupadd docker 2>/dev/null || true

if [[ ! -f "${DOCKER_SOCKET_UNIT}" ]]; then
  cat > "${DOCKER_SOCKET_UNIT}" <<'EOF'
[Unit]
Description=Docker Socket for the API

[Socket]
ListenStream=/var/run/docker.sock
SocketMode=0660
SocketUser=root
SocketGroup=docker

[Install]
WantedBy=sockets.target
EOF
  ok "已写入 ${DOCKER_SOCKET_UNIT}"
else
  if grep -q '^SocketGroup=docker' "${DOCKER_SOCKET_UNIT}"; then
    ok "docker.socket 已含 SocketGroup=docker"
  else
    if grep -q '^SocketGroup=' "${DOCKER_SOCKET_UNIT}"; then
      sed -i 's/^SocketGroup=.*/SocketGroup=docker/' "${DOCKER_SOCKET_UNIT}"
    elif grep -q '^\[Socket\]' "${DOCKER_SOCKET_UNIT}"; then
      sed -i '/^\[Socket\]/a SocketGroup=docker' "${DOCKER_SOCKET_UNIT}"
    else
      printf '\n[Socket]\nSocketGroup=docker\n' >> "${DOCKER_SOCKET_UNIT}"
    fi
    ok "已更新 docker.socket 的 SocketGroup=docker"
  fi
fi

section "写入 daemon.json group=docker（安全持久化）"
mkdir -p /etc/docker
if [[ -f "${DAEMON_JSON}" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 - "${DAEMON_JSON}" <<'PY'
import json, sys
path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
except Exception:
    data = {}
if not isinstance(data, dict):
    data = {}
data["group"] = "docker"
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("merged")
PY
    ok "已合并 ${DAEMON_JSON} -> group=docker"
  elif grep -q '"group"' "${DAEMON_JSON}"; then
    ok "${DAEMON_JSON} 已含 group 字段（未用 python 校验）"
  else
    warn "无 python3，无法安全合并已有 daemon.json；请手动加入 \"group\": \"docker\""
  fi
else
  cat > "${DAEMON_JSON}" <<'EOF'
{
  "group": "docker"
}
EOF
  ok "已创建 ${DAEMON_JSON}"
fi

# 可选：用 ExecStartPost 校正属组（不改 ExecStart）
mkdir -p "${DOCKER_SERVICE_DROPIN_DIR}"
cat > "${DOCKER_SERVICE_DROPIN_DIR}/socket-group.conf" <<EOF
[Service]
ExecStartPost=-/bin/chown root:docker ${SOCK}
ExecStartPost=-/bin/chmod 0660 ${SOCK}
EOF
ok "已写入 ${DOCKER_SERVICE_DROPIN_DIR}/socket-group.conf（仅 chown，不改启动参数）"

systemctl daemon-reload
systemctl enable docker.socket >/dev/null 2>&1 || true
systemctl enable docker >/dev/null 2>&1 || true
systemctl enable containerd >/dev/null 2>&1 || true

if [[ -S "${SOCK}" ]]; then
  chown root:docker "${SOCK}" || true
  chmod 0660 "${SOCK}" || true
  ok "已校正当前 socket: $(ls -l "${SOCK}")"
fi

if [[ "${NO_RESTART}" -eq 1 ]]; then
  warn "已跳过 restart（--no-restart）"
else
  section "安全重启（先 containerd）"
  systemctl start containerd 2>/dev/null || true
  sleep 1
  if systemctl restart docker; then
    ok "已 restart docker"
  else
    error "restart docker 失败 —— 请立即跑恢复脚本"
    note "sudo bash ${SCRIPT_DIR}/root-recover-docker.sh"
    journalctl -u docker -n 30 --no-pager || true
    exit 1
  fi
  sleep 1
  if [[ -S "${SOCK}" ]]; then
    chown root:docker "${SOCK}" || true
    chmod 0660 "${SOCK}" || true
    note "重启后 socket: $(ls -l "${SOCK}")"
  else
    error "重启后仍无 ${SOCK}"
    note "sudo bash ${SCRIPT_DIR}/root-recover-docker.sh"
    exit 1
  fi
fi

# 验证 root 仍能用
if ! docker ps >/dev/null 2>&1; then
  error "修复后 root 的 docker ps 失败，开始自动恢复"
  bash "${SCRIPT_DIR}/root-recover-docker.sh"
  exit $?
fi

meta="$(sock_meta || true)"
IFS='|' read -r perms owner group <<<"${meta}"
if [[ "${group:-}" == "docker" && ( "${perms:-}" == "660" || "${perms:-}" == "0660" ) ]]; then
  info "socket 修复成功: ${owner}:${group} ${perms}"
  ok "root docker ps 正常"
  exit 0
fi

warn "socket 属组仍可能不对: ${owner:-?}:${group:-?} ${perms:-?}"
note "但若 root docker ps 正常，可先 chown 救急后再查 journalctl"
exit 1
