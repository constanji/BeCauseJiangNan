#!/usr/bin/env bash
# 验证管理端热更新：不重启进程即可改配置，且 ESB 转发口仍可用
#
# 用法：
#   npm run verify:admin
#   BASE_URL=http://127.0.0.1:13001 ESB_ADMIN_SECRET=xxx ./scripts/verify-admin-hot-reload.sh
#
# 未指定 BASE_URL 时，脚本会临时启动本地 adapter。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BASE_URL="${BASE_URL:-}"
SECRET="${ESB_ADMIN_SECRET:-}"
TMP_DIR=""
PID=""

cleanup() {
  if [[ -n "${PID}" ]] && kill -0 "${PID}" 2>/dev/null; then
    kill "${PID}" 2>/dev/null || true
    wait "${PID}" 2>/dev/null || true
  fi
  if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
    rm -rf "${TMP_DIR}"
  fi
}
trap cleanup EXIT

hdr_auth=()
curl_auth() {
  if [[ -n "${SECRET}" ]]; then
    curl "$@" -H "X-Esb-Admin-Secret: ${SECRET}"
  else
    curl "$@"
  fi
}

json_get() {
  node -e 'const o=JSON.parse(process.argv[1]); const k=process.argv[2].split("."); let v=o; for (const p of k) v=v?.[p]; if (v===undefined) process.exit(2); process.stdout.write(String(v));' "$1" "$2"
}

if [[ -z "${BASE_URL}" ]]; then
  TMP_DIR="$(mktemp -d)"
  export ESB_RUNTIME_CONFIG_PATH="${TMP_DIR}/runtime-config.json"
  export PORT_FILE="${TMP_DIR}/port"
  export BECAUSE_BASE_URL="${BECAUSE_BASE_URL:-http://127.0.0.1:1}"
  export BECAUSE_EMAIL="${BECAUSE_EMAIL:-verify@test.com}"
  export BECAUSE_PASSWORD="${BECAUSE_PASSWORD:-verify-pass}"
  export AGENT_ID_RESULT="${AGENT_ID_RESULT:-agent_result_verify}"
  export AGENT_ID_ZB="${AGENT_ID_ZB:-agent_zb_verify}"
  export ESB_ADMIN_SECRET="${SECRET}"

  node "${SCRIPT_DIR}/verify-serve.js" &
  PID=$!

  for _ in $(seq 1 50); do
    [[ -f "${TMP_DIR}/port" ]] && break
    sleep 0.1
  done
  [[ -f "${TMP_DIR}/port" ]] || { echo "启动失败：未拿到端口"; exit 1; }
  BASE_URL="http://127.0.0.1:$(cat "${TMP_DIR}/port")"
  echo "==> 临时服务 ${BASE_URL}"
fi

echo "==> 1) 健康检查"
HEALTH="$(curl -fsS "${BASE_URL}/health")"
echo "${HEALTH}" | grep -q '"status":"ok"'
echo "${HEALTH}" | grep -q '/admin/'

echo "==> 2) 管理页可访问"
curl -fsS "${BASE_URL}/admin/" | grep -q 'ESB Adapter'

echo "==> 3) 读取配置"
BEFORE="$(curl_auth -fsS "${BASE_URL}/api/admin/config")"
echo "${BEFORE}" | grep -q '"ok":true'
OLD_TIMEOUT="$(json_get "${BEFORE}" "values.chatTimeoutMs")"
NEW_TIMEOUT=$((OLD_TIMEOUT == 123456 ? 123457 : 123456))

echo "==> 4) 热更新 chatTimeoutMs -> ${NEW_TIMEOUT}"
AFTER="$(curl_auth -fsS -X PUT "${BASE_URL}/api/admin/config" \
  -H 'Content-Type: application/json' \
  -d "{\"chatTimeoutMs\":${NEW_TIMEOUT}}")"
echo "${AFTER}" | grep -q '"ok":true'
GOT="$(json_get "${AFTER}" "values.chatTimeoutMs")"
[[ "${GOT}" == "${NEW_TIMEOUT}" ]] || { echo "热更新未生效: got=${GOT}"; exit 1; }

echo "==> 5) 再次 GET 确认仍为新值（无重启）"
AGAIN="$(curl_auth -fsS "${BASE_URL}/api/admin/config")"
GOT2="$(json_get "${AGAIN}" "values.chatTimeoutMs")"
[[ "${GOT2}" == "${NEW_TIMEOUT}" ]] || { echo "二次读取不一致"; exit 1; }

echo "==> 6) ESB 转发口仍响应"
ESB_CODE="$(curl -sS -o /tmp/esb-verify.json -w '%{http_code}' -X POST "${BASE_URL}/esb/transaction" \
  -H 'Content-Type: application/json' -d '{}')"
[[ "${ESB_CODE}" == "200" ]] || { echo "ESB 入口 HTTP ${ESB_CODE}"; exit 1; }
grep -q 'Transaction' /tmp/esb-verify.json

echo ""
echo "验证通过 ✓"
echo "  BASE_URL=${BASE_URL}"
echo "  chatTimeoutMs: ${OLD_TIMEOUT} -> ${NEW_TIMEOUT}"
echo "  admin: ${BASE_URL}/admin/"
