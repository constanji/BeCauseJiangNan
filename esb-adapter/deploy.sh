#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "错误: 缺少 .env，请先执行: cp .env.example .env 并填写配置"
  exit 1
fi

compose() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  elif docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    echo "错误: 未找到 docker-compose 或 docker compose"
    exit 1
  fi
}

if [[ -f esb-adapter.tar ]]; then
  echo "==> 加载镜像 esb-adapter.tar"
  docker load -i esb-adapter.tar
  echo "==> 启动 esb-adapter"
  compose up -d
else
  echo "==> 未找到 esb-adapter.tar，本机构建并启动"
  echo "    服务器部署请先在本地执行 ./build-amd64.sh 并上传 esb-adapter.tar"
  compose up -d --build
fi

sleep 2

PORT="${PORT:-8088}"
if grep -q '^PORT=' .env 2>/dev/null; then
  PORT="$(grep '^PORT=' .env | cut -d= -f2 | tr -d ' \"')"
fi

if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
  echo "==> 健康检查通过: http://127.0.0.1:${PORT}/health"
  curl -s "http://127.0.0.1:${PORT}/health"
  echo ""
else
  echo "警告: 健康检查未通过，请查看日志"
  exit 1
fi

echo "==> ESB 入口: http://<服务器IP>:${PORT}/esb/transaction"
