#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
TAG="${TAG:-modelprobe:result}"
OUT="${OUTPUT:-modelprobe-server-amd64.tar}"
docker save -o "$OUT" "$TAG"
ls -lh "$OUT"
