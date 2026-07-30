#!/usr/bin/env bash
# 公共常量与输出函数（被 root-* 脚本 source）
# shellcheck disable=SC2034

: "${TARGET_USER:=jnapp}"
: "${PLUGIN_PATH:=/usr/libexec/docker/cli-plugins/docker-compose}"
: "${COMPAT_LINK:=/usr/local/bin/docker-compose}"
: "${PATH_PROFILE:=/etc/profile.d/docker-compose-path.sh}"
: "${SOCK:=/var/run/docker.sock}"
: "${DOCKER_SOCKET_UNIT:=/etc/systemd/system/docker.socket}"
: "${DOCKER_SERVICE_DROPIN_DIR:=/etc/systemd/system/docker.service.d}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}==>${NC} $*"; }
warn()  { echo -e "${YELLOW}警告:${NC} $*"; }
error() { echo -e "${RED}错误:${NC} $*" >&2; }
ok()    { echo -e "  ${GREEN}[OK]${NC}   $*"; }
fail()  { echo -e "  ${RED}[FAIL]${NC} $*"; }
note()  { echo -e "  ${CYAN}[INFO]${NC} $*"; }
section() {
  echo ""
  echo -e "${CYAN}-------- $* --------${NC}"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    error "请使用 root 运行本脚本（sudo bash $0）"
    exit 1
  fi
}

run_as_target() {
  local cmd="$1"
  if command -v runuser >/dev/null 2>&1; then
    runuser -l "${TARGET_USER}" -c "${cmd}"
  else
    su - "${TARGET_USER}" -c "${cmd}"
  fi
}

sock_meta() {
  if [[ ! -S "${SOCK}" ]]; then
    echo ""
    return 1
  fi
  local perms owner group
  perms="$(stat -c '%a' "${SOCK}" 2>/dev/null || stat -f '%OLp' "${SOCK}")"
  owner="$(stat -c '%U' "${SOCK}" 2>/dev/null || stat -f '%Su' "${SOCK}")"
  group="$(stat -c '%G' "${SOCK}" 2>/dev/null || stat -f '%Sg' "${SOCK}")"
  echo "${perms}|${owner}|${group}"
}

# 目录是否对「其他人」可进入（至少 other 有 x，或对目标用户可 access）
dir_world_traversable() {
  local d="$1"
  [[ -d "${d}" ]] || return 1
  local mode
  mode="$(stat -c '%a' "${d}" 2>/dev/null || stat -f '%OLp' "${d}")"
  # 末位为奇数 => other 有 x
  local last="${mode: -1}"
  [[ "${last}" == "1" || "${last}" == "3" || "${last}" == "5" || "${last}" == "7" ]]
}

user_can_access_path() {
  local path="$1"
  run_as_target "test -e $(printf '%q' "${path}")" 2>/dev/null
}

# 解析 --user / -h；其余参数原样留下由调用方处理
parse_common_args() {
  local -a kept=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --user)
        TARGET_USER="${2:-}"
        shift 2
        ;;
      -h|--help)
        kept+=("$1")
        shift
        ;;
      *)
        kept+=("$1")
        shift
        ;;
    esac
  done
  # 把剩余参数回传：调用方用 eval set -- "$(parse...)" 不优雅
  # 改为写入全局 COMMON_ARGS
  COMMON_ARGS=("${kept[@]}")
}
