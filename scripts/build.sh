#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Compile TypeScript into the extension layout (§32.1).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund
fi

npm run build
echo "build: compiled output in dist/"
