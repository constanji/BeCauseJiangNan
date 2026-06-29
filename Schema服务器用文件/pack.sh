#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT_NAME="schema-deploy-$(date +%Y%m%d-%H%M%S).tar.gz"
TMP="$(mktemp -d)"
PARENT="$(dirname "$ROOT")"

echo "打包目录: $ROOT"

rsync -a \
  --exclude='.env' \
  --exclude='*.tar' \
  --exclude='.DS_Store' \
  --exclude='data/*' \
  "$ROOT/" "$TMP/schema-deploy/"

mkdir -p "$TMP/schema-deploy/data"
touch "$TMP/schema-deploy/data/.gitkeep"

tar czf "$PARENT/$OUT_NAME" -C "$TMP" schema-deploy
rm -rf "$TMP"

echo "已生成: $PARENT/$OUT_NAME"
ls -lh "$PARENT/$OUT_NAME"
