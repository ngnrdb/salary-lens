#!/bin/sh
# Builds a zip of the extension folder, ready to share or attach to a GitHub release.
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./extension/manifest.json').version")
mkdir -p dist
OUT="$(pwd)/dist/salary-lens-v$VERSION.zip"
rm -f "$OUT"
(cd extension && zip -r -q -X "$OUT" . -x '.*' -x '*/.*')
echo "Built dist/salary-lens-v$VERSION.zip"
