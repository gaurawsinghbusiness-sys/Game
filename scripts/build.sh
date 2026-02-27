#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/src"

cp "$ROOT_DIR/index.html" "$DIST_DIR/index.html"
cp "$ROOT_DIR/src/main.js" "$DIST_DIR/src/main.js"
cp "$ROOT_DIR/src/styles.css" "$DIST_DIR/src/styles.css"
cp -R "$ROOT_DIR/public/." "$DIST_DIR/"
