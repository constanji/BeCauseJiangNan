#!/usr/bin/env bash
# jnapp: 自检 Docker / Compose 是否可用（无需 root）
# 区分: 组 / socket / 二进制权限 / 父目录 / 软链 / PATH
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
docker_env="$(env | grep -E '^(DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG)=' || true)"
if [[ -n "${docker_env}" ]]; then
  warn "当前环境存在 Docker 相关变量，可能覆盖默认 /var/run/docker.sock"
  echo "${docker_env}" | sed 's/^/  /'
fi
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
  note "软链在 /usr/local/bin/docker-compose 也会 command not found"
  note "请 root: sudo bash 06-root-fix-path.sh"
  ISSUES=$((ISSUES + 1))
fi

if [[ -x /usr/bin/docker ]]; then
  ok "可执行 /usr/bin/docker"
else
  fail "无法执行 /usr/bin/docker（Permission denied 类）"
  note "请 root: sudo bash 05-root-fix-bin-perms.sh"
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
  dup_compose="$(command -v -a docker-compose 2>/dev/null | sed '/^$/d')"
  if [[ "$(echo "${dup_compose}" | wc -l | tr -d ' ')" -gt 1 ]]; then
    warn "PATH 中发现多个 docker-compose，实际生效的是第一个:"
    echo "${dup_compose}" | sed 's/^/  /'
  fi
else
  fail "找不到 docker-compose（command not found）"
  if [[ -x "${COMPAT_LINK}" ]]; then
    note "但绝对路径存在且可执行: ${COMPAT_LINK} → 纯 PATH 问题"
    note "试: ${COMPAT_LINK} version"
  elif [[ -e "${COMPAT_LINK}" ]]; then
    note "文件存在但不可执行: $(ls -l "${COMPAT_LINK}" 2>/dev/null || true)"
  else
    note "软链/文件不存在 → 请 root 跑 05 或 04"
  fi
  ISSUES=$((ISSUES + 1))
fi

section "3. 插件目录与文件可见性"
for d in /usr/libexec/docker /usr/libexec/docker/cli-plugins /usr/local/bin; do
  if [[ -d "${d}" ]]; then
    if [[ -x "${d}" ]]; then
      ok "可进入目录: ${d}"
    else
      fail "无法进入目录: ${d}（父目录权限过严）"
      note "请 root: chmod 755 ${d} 或 sudo bash 05-root-fix-bin-perms.sh"
      ISSUES=$((ISSUES + 1))
    fi
  fi
done

if [[ -e "${PLUGIN_PATH}" ]]; then
  if [[ -r "${PLUGIN_PATH}" && -x "${PLUGIN_PATH}" ]]; then
    ok "可读可执行插件: ${PLUGIN_PATH}"
  else
    fail "插件存在但不可读/执行: ${PLUGIN_PATH}"
    ISSUES=$((ISSUES + 1))
  fi
  note "$(ls -l "${PLUGIN_PATH}" 2>/dev/null || true)"
else
  fail "看不到插件: ${PLUGIN_PATH}"
  ISSUES=$((ISSUES + 1))
fi

if [[ -e "${COMPAT_LINK}" || -L "${COMPAT_LINK}" ]]; then
  ok "兼容入口存在: ${COMPAT_LINK}"
  note "$(ls -l "${COMPAT_LINK}" 2>/dev/null || true)"
  if [[ -x "${COMPAT_LINK}" ]] && ! command -v docker-compose >/dev/null 2>&1; then
    if "${COMPAT_LINK}" version >/dev/null 2>&1; then
      warn "绝对路径能跑，PATH 找不到命令 → 请 root 跑 06-root-fix-path.sh"
    fi
  fi
else
  fail "缺少兼容入口: ${COMPAT_LINK}"
  ISSUES=$((ISSUES + 1))
fi

section "3b. SELinux（若启用）"
if command -v getenforce >/dev/null 2>&1; then
  se_status="$(getenforce 2>/dev/null || true)"
  note "SELinux 状态: ${se_status:-未知}"
  if [[ "${se_status}" == "Enforcing" ]]; then
    warn "Enforcing 模式下，即使文件权限正确也可能因上下文被拦截"
    note "请 root 检查: ls -Z /usr/bin/docker /usr/libexec/docker/cli-plugins/docker-compose"
    note "或直接: sudo bash 05-root-fix-bin-perms.sh（已包含 restorecon 兜底）"
  fi
else
  note "无 getenforce，跳过"
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
  note "若提示 unknown command：多半父目录 750 或插件不可读 → 05"
  ISSUES=$((ISSUES + 1))
fi

if out="$(docker-compose version 2>&1)"; then
  ok "docker-compose: ${out}"
  COMPOSE_BIN_OK=1
else
  fail "docker-compose 不可用: ${out}"
  if [[ -x "${COMPAT_LINK}" ]] && "${COMPAT_LINK}" version >/dev/null 2>&1; then
    note "可用临时命令: ${COMPAT_LINK} version / up / down"
    note "根因是 PATH，不是 compose 没装"
  fi
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
  note "当前目录无 compose 文件，跳过 config 校验"
fi

section "6. 结论与下一步"
if [[ "${DOCKER_OK}" -eq 1 && "${COMPOSE_BIN_OK}" -eq 1 ]]; then
  info "成功：docker 与 docker-compose 都可用"
  echo "  docker-compose up -d / docker compose up -d"
  exit 0
fi

if [[ "${DOCKER_OK}" -eq 1 && "${COMPOSE_PLUGIN_OK}" -eq 1 && "${COMPOSE_BIN_OK}" -eq 0 ]]; then
  warn "docker compose 可用，docker-compose 命令不可用"
  echo "  临时: docker compose up -d"
  echo "  请 root: sudo bash 06-root-fix-path.sh"
  echo "        或 sudo bash 05-root-fix-bin-perms.sh"
  exit 2
fi

if [[ "${DOCKER_OK}" -eq 1 && -x "${COMPAT_LINK}" ]] && "${COMPAT_LINK}" version >/dev/null 2>&1; then
  warn "绝对路径 compose 可用，但 PATH 命令找不到"
  echo "  临时: ${COMPAT_LINK} up -d"
  echo "  请 root: sudo bash 06-root-fix-path.sh"
  exit 5
fi

if [[ "${DOCKER_OK}" -eq 1 && "${COMPOSE_PLUGIN_OK}" -eq 0 ]]; then
  warn "docker 可用，Compose 插件不可用"
  echo "  请 root: sudo bash 05-root-fix-bin-perms.sh"
  echo "  再:     sudo bash 01-root-diagnose.sh"
  exit 3
fi

if [[ "${DOCKER_OK}" -eq 0 ]]; then
  warn "docker 本身不可用"
  echo "  若 Permission denied on /usr/bin/docker → 05-root-fix-bin-perms.sh"
  echo "  若 socket/组 → 03 / 02，并用 su - 重新登录"
  echo "  诊断: sudo bash 01-root-diagnose.sh"
  exit 4
fi

warn "存在 ${ISSUES} 项问题，见上方 [FAIL]"
exit 1
