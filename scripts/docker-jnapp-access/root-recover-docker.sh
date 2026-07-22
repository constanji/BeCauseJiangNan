#!/usr/bin/env bash
# root 紧急恢复：docker.sock 不存在 / root 也 docker ps 失败时用
# 常见原因：修 socket 时写入的 systemd drop-in + restart，在 containerd 未就绪时把 dockerd 拉挂
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

DROPIN="${DOCKER_SERVICE_DROPIN_DIR}/group.conf"

usage() {
  cat <<EOF
用法: sudo bash $0

当出现以下错误时运行本脚本：
  failed to connect ... unix:///var/run/docker.sock ... no such file or directory

会：
  1) 移除有风险的 docker.service.d/group.conf（若存在）
  2) 先启动 containerd，再启动 docker.socket / docker
  3) 确认 docker ps 可用
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) error "未知参数: $1"; usage; exit 1 ;;
  esac
done

require_root

section "紧急恢复 Docker 守护进程"

note "当前状态快照："
systemctl is-active containerd 2>/dev/null || true
systemctl is-active docker.socket 2>/dev/null || true
systemctl is-active docker 2>/dev/null || true
ls -l "${SOCK}" 2>/dev/null || note "${SOCK} 不存在"

if [[ -f "${DROPIN}" ]]; then
  warn "发现可能有问题的 drop-in: ${DROPIN}"
  note "内容预览:"
  sed 's/^/    /' "${DROPIN}" || true
  rm -f "${DROPIN}"
  ok "已删除 ${DROPIN}"
  # 若目录空了可保留目录
else
  ok "未发现 ${DROPIN}"
fi

systemctl daemon-reload
ok "systemctl daemon-reload 完成"

# 先停掉失败中的 docker，避免半死不活
systemctl stop docker 2>/dev/null || true

section "启动 containerd → docker.socket → docker"
if [[ -f /etc/systemd/system/containerd.service ]] || systemctl list-unit-files containerd.service 2>/dev/null | grep -q containerd; then
  systemctl enable containerd >/dev/null 2>&1 || true
  if systemctl start containerd; then
    ok "containerd 已启动"
  else
    warn "containerd start 失败，继续尝试直接启 docker"
    systemctl status containerd --no-pager -l || true
  fi
else
  warn "未找到 containerd.service，跳过"
fi

# 等 containerd sock
for i in 1 2 3 4 5; do
  if [[ -S /run/containerd/containerd.sock ]]; then
    ok "containerd.sock 已就绪"
    break
  fi
  sleep 1
done

systemctl enable docker.socket >/dev/null 2>&1 || true
systemctl start docker.socket 2>/dev/null || true
ok "已尝试 start docker.socket"

systemctl enable docker >/dev/null 2>&1 || true
if systemctl start docker; then
  ok "docker 已 start"
else
  error "docker start 失败"
  echo ""
  note "最近日志："
  journalctl -u docker -n 40 --no-pager || true
  journalctl -u containerd -n 20 --no-pager || true
  exit 1
fi

sleep 1
if [[ -S "${SOCK}" ]]; then
  ok "socket 已出现: $(ls -l "${SOCK}")"
else
  # socket 激活场景下，访问一次会创建
  docker version >/dev/null 2>&1 || true
  sleep 1
fi

if [[ -S "${SOCK}" ]]; then
  # 恢复后先保证 root 能用；属组可随后再跑 03
  chmod 0660 "${SOCK}" 2>/dev/null || true
  ok "socket: $(ls -l "${SOCK}")"
else
  error "docker 已启动但仍无 ${SOCK}"
  systemctl status docker --no-pager -l || true
  exit 1
fi

section "验证"
if out="$(docker ps 2>&1)"; then
  info "恢复成功：root 下 docker ps 正常"
  echo "${out}" | sed 's/^/  /' | head -n 15
  note "若还需 jnapp 可用，再跑: sudo bash ${SCRIPT_DIR}/03-root-fix-socket.sh --no-restart"
  note "新版 03 会用 daemon.json group，不再写危险的 ExecStart 覆盖"
  exit 0
fi

error "docker ps 仍失败: ${out}"
journalctl -u docker -n 40 --no-pager || true
exit 1
