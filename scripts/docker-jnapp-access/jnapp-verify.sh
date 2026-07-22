#!/usr/bin/env bash
# jnapp: 自检 Docker / Compose 是否可用（无需 root）
# 重点区分：组权限问题 vs compose 插件/软链/PATH 问题
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PLUGIN_PATH="/usr/libexec/docker/cli-plugins/docker-compose"
COMPAT_LINK="/usr/local/bin/docker-compose"

info()  { echo -e "${GREEN}==>${NC} $*"; }
warn()  { echo -e "${YELLOW}警告:${NC} $*"; }
ok()    { echo -e "  ${GREEN}[OK]${NC}   $*"; }
fail()  { echo -e "  ${RED}[FAIL]${NC} $*"; }
note()  { echo -e "  ${CYAN}[INFO]${NC} $*"; }
section() {
  echo ""
  echo -e "${CYAN}-------- $* --------${NC}"
}

CURRENT_USER="$(id -un)"
ISSUES=0

section "1. 当前身份"
note "用户: ${CURRENT_USER}"
note "uid/gid: $(id)"
if id -nG | tr ' ' '\n' | grep -qx docker; then
  ok "当前会话已包含 docker 组"
else
  fail "当前会话不包含 docker 组"
  note "若 root 已 usermod -aG docker，请重新登录，或临时: newgrp docker"
  ISSUES=$((ISSUES + 1))
fi

section "2. PATH 与命令定位"
note "PATH=${PATH}"
if echo "${PATH}" | tr ':' '\n' | grep -qx '/usr/local/bin'; then
  ok "PATH 包含 /usr/local/bin"
else
  fail "PATH 不包含 /usr/local/bin"
  note "这会导致找不到 /usr/local/bin/docker-compose"
  ISSUES=$((ISSUES + 1))
fi

if command -v docker >/dev/null 2>&1; then
  ok "docker -> $(command -v docker)"
else
  fail "找不到 docker"
  ISSUES=$((ISSUES + 1))
fi

if command -v docker-compose >/dev/null 2>&1; then
  ok "docker-compose -> $(command -v docker-compose)"
  note "type -a: $(type -a docker-compose 2>/dev/null | tr '\n' ' ; ')"
else
  fail "找不到 docker-compose（command not found）"
  ISSUES=$((ISSUES + 1))
fi

section "3. Compose 文件可见性"
if [[ -e "${PLUGIN_PATH}" ]]; then
  if [[ -x "${PLUGIN_PATH}" ]]; then
    ok "可读可执行插件: ${PLUGIN_PATH}"
  else
    fail "插件存在但当前用户不可执行: ${PLUGIN_PATH}"
    ISSUES=$((ISSUES + 1))
  fi
  note "$(ls -l "${PLUGIN_PATH}" 2>/dev/null || true)"
else
  fail "看不到插件: ${PLUGIN_PATH}"
  note "联系 root 用离线包补装 docker-compose-linux-x86_64"
  ISSUES=$((ISSUES + 1))
fi

if [[ -e "${COMPAT_LINK}" || -L "${COMPAT_LINK}" ]]; then
  ok "兼容入口存在: ${COMPAT_LINK}"
  note "$(ls -l "${COMPAT_LINK}" 2>/dev/null || true)"
else
  fail "缺少兼容入口: ${COMPAT_LINK}"
  note "典型原因：离线安装后软链缺失 → docker 能用、docker-compose 不能用"
  ISSUES=$((ISSUES + 1))
fi

section "4. 实测三种命令"
DOCKER_OK=0
COMPOSE_PLUGIN_OK=0
COMPOSE_BIN_OK=0

if out="$(docker info >/dev/null 2>&1 && docker version --format 'Client={{.Client.Version}} Server={{.Server.Version}}' 2>&1)"; then
  ok "docker: ${out}"
  DOCKER_OK=1
else
  fail "docker 不可用: ${out:-permission denied or daemon unreachable}"
  ISSUES=$((ISSUES + 1))
fi

if out="$(docker compose version 2>&1)"; then
  ok "docker compose: ${out}"
  COMPOSE_PLUGIN_OK=1
else
  fail "docker compose 不可用: ${out}"
  ISSUES=$((ISSUES + 1))
fi

if out="$(docker-compose version 2>&1)"; then
  ok "docker-compose: ${out}"
  COMPOSE_BIN_OK=1
else
  fail "docker-compose 不可用: ${out}"
  ISSUES=$((ISSUES + 1))
fi

section "5. 可选：校验当前目录 compose 文件（不启动）"
COMPOSE_FILE=""
for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml deploy-compose.yml; do
  if [[ -f "${f}" ]]; then
    COMPOSE_FILE="${f}"
    break
  fi
done

if [[ -n "${COMPOSE_FILE}" ]]; then
  note "发现 ${COMPOSE_FILE}"
  if [[ "${COMPOSE_PLUGIN_OK}" -eq 1 ]]; then
    if docker compose -f "${COMPOSE_FILE}" config >/dev/null 2>&1; then
      ok "docker compose -f ${COMPOSE_FILE} config 通过"
    else
      fail "docker compose -f ${COMPOSE_FILE} config 失败"
      ISSUES=$((ISSUES + 1))
    fi
  fi
  if [[ "${COMPOSE_BIN_OK}" -eq 1 ]]; then
    if docker-compose -f "${COMPOSE_FILE}" config >/dev/null 2>&1; then
      ok "docker-compose -f ${COMPOSE_FILE} config 通过"
    else
      fail "docker-compose -f ${COMPOSE_FILE} config 失败"
      ISSUES=$((ISSUES + 1))
    fi
  fi
else
  note "当前目录无 compose 文件，跳过 config 校验（可在部署目录再跑本脚本）"
fi

section "6. 结论与下一步"
if [[ "${DOCKER_OK}" -eq 1 && "${COMPOSE_BIN_OK}" -eq 1 ]]; then
  info "成功：docker 与 docker-compose 都可用"
  echo "  可执行: docker-compose up -d"
  echo "  或:     docker compose up -d"
  echo "  停止:   docker-compose down / docker compose down"
  exit 0
fi

if [[ "${DOCKER_OK}" -eq 1 && "${COMPOSE_PLUGIN_OK}" -eq 1 && "${COMPOSE_BIN_OK}" -eq 0 ]]; then
  warn "docker 与 docker compose 可用，但 docker-compose 命令不可用"
  echo "  临时可用: docker compose up -d"
  echo "  请 root 执行修复软链/PATH:"
  echo "    sudo bash scripts/docker-jnapp-access/04-root-fix-compose.sh --fix-path"
  exit 2
fi

if [[ "${DOCKER_OK}" -eq 1 && "${COMPOSE_PLUGIN_OK}" -eq 0 ]]; then
  warn "docker 可用，但 Compose 插件不可用"
  echo "  请 root 检查并补装插件:"
  echo "    sudo bash scripts/docker-jnapp-access/01-root-diagnose.sh"
  echo "  若缺插件，从离线包拷贝 docker-compose-linux-x86_64 到:"
  echo "    ${PLUGIN_PATH}"
  exit 3
fi

if [[ "${DOCKER_OK}" -eq 0 ]]; then
  warn "docker 本身不可用（优先查组/socket/重新登录）"
  echo "  1) 确认 id 含 docker；不含则请 root 加组后重新登录"
  echo "  2) 请 root 跑:"
  echo "     sudo bash scripts/docker-jnapp-access/01-root-diagnose.sh"
  exit 4
fi

warn "存在 ${ISSUES} 项问题，见上方 [FAIL]"
exit 1
