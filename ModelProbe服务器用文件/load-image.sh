#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
TAR="${1:-modelprobe-server-amd64.tar}"
if [[ ! -f "$TAR" ]]; then
  echo "错误: 未找到 $TAR"
  exit 1
fi
docker load -i "$TAR"
echo "已加载镜像"
