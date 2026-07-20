#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "错误: 缺少 .env，请先执行: cp .env.example .env 并填写配置"
  exit 1
fi

get_env() {
  local key="$1"
  local default="${2:-}"
  if grep -q "^${key}=" .env 2>/dev/null; then
    grep "^${key}=" .env | head -1 | cut -d= -f2- | tr -d ' "' | sed 's/#.*$//' | xargs
  else
    echo "$default"
  fi
}

IMAGE_TAR="$(get_env MODEL_PROBE_IMAGE_TAR modelprobe-server-amd64.tar)"
API_PORT="$(get_env PORT 4200)"

if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
elif docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
else
  echo "错误: 未找到 docker-compose 或 docker compose"
  exit 1
fi

if [[ -f "$IMAGE_TAR" ]]; then
  echo "==> 加载镜像 ${IMAGE_TAR}"
  docker load -i "$IMAGE_TAR"
else
  echo "提示: 未找到镜像包 ${IMAGE_TAR}，将直接尝试启动已有镜像"
fi

echo "==> 启动 ModelProbe 服务（${COMPOSE_CMD[*]} up -d）"
"${COMPOSE_CMD[@]}" up -d

echo "==> 健康检查..."
HEALTH_URL="http://127.0.0.1:${API_PORT}/api/health"
READY=0
for i in $(seq 1 30); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

if [[ "$READY" -eq 1 ]]; then
  echo "==> 健康检查通过: ${HEALTH_URL}"
  echo "==> 浏览器打开: http://127.0.0.1:${API_PORT}/"
  "${COMPOSE_CMD[@]}" ps
else
  echo "警告: 健康检查未通过（${HEALTH_URL}）"
  echo "请查看日志: ${COMPOSE_CMD[*]} logs -f api"
  "${COMPOSE_CMD[@]}" ps
  exit 1
fi
