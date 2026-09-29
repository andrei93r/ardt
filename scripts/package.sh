#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Package the extension zip (§32.2). EGO requires readable, unbundled output.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UUID="adrt@adrt.dev"
SCHEMA="org.gnome.shell.extensions.adrt"
OUT="$ROOT/$UUID.zip"
STAGE="$(mktemp -d)"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

if [ ! -f "$ROOT/dist/extension.js" ]; then
  ( cd "$ROOT" && npm run build )
fi

cp -r "$ROOT/dist/." "$STAGE/"
cp "$ROOT/packages/gnome/metadata.json" "$STAGE/metadata.json"
cp "$ROOT/packages/gnome/stylesheet.css" "$STAGE/stylesheet.css"
mkdir -p "$STAGE/schemas"
cp "$ROOT/packages/gnome/schemas/$SCHEMA.gschema.xml" "$STAGE/schemas/"
glib-compile-schemas "$STAGE/schemas"

rm -f "$OUT"
( cd "$STAGE" && zip -qr "$OUT" . )

echo "package: wrote $OUT"
unzip -l "$OUT" | tail -n +2 | head -20
