#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Validate the translation catalogues with `msgfmt`. When gettext is not
# installed there is nothing to validate with, so the check prints a message and
# succeeds rather than failing the build on a missing optional tool.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v msgfmt >/dev/null 2>&1; then
  echo "i18n:check: msgfmt (gettext) is not installed; no catalogues were validated."
  exit 0
fi

shopt -s nullglob
catalogues=(po/*.po)

status=0
if [ "${#catalogues[@]}" -eq 0 ]; then
  echo "i18n:check: no po/*.po catalogues yet (po/adrt.pot is scaffolded); nothing to validate."
else
  for po in "${catalogues[@]}"; do
    if msgfmt --check --check-format --output-file=/dev/null "$po"; then
      echo "i18n:check: $po OK"
    else
      status=1
    fi
  done
fi
exit "$status"
