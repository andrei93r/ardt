#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Regenerate the gettext template (po/adrt.pot) from the sources listed in
# po/POTFILES.in and merge it into every existing po/*.po catalogue.
#
# Uses `xgettext`/`msgmerge` when gettext is installed; otherwise falls back to
# scripts/pot-from-source.py, a small extractor that understands the literal
# `_()` / `ngettext()` / `pgettext()` calls this project uses. Either way the
# command succeeds, so `npm run i18n:update` works on a stock machine.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DOMAIN="adrt"
POT="po/$DOMAIN.pot"
POTFILES="po/POTFILES.in"

if [ ! -f "$POTFILES" ]; then
  echo "update-po: $POTFILES is missing" >&2
  exit 1
fi

sources=()
while IFS= read -r line; do
  case "$line" in
    '' | '#'*) continue ;;
  esac
  sources+=("$line")
done < "$POTFILES"

if [ "${#sources[@]}" -eq 0 ]; then
  echo "update-po: $POTFILES lists no sources" >&2
  exit 1
fi

mkdir -p po
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

XGETTEXT=(xgettext --from-code=UTF-8 --keyword=_ --keyword=ngettext:1,2 --keyword=pgettext:1c,2 -o -)

if command -v xgettext >/dev/null 2>&1; then
  echo "update-po: extracting with xgettext"
  # gettext 0.22 understands TypeScript; older releases only ship JavaScript.
  if "${XGETTEXT[@]}" --language=TypeScript "${sources[@]}" > "$tmp" 2>/dev/null; then
    :
  elif "${XGETTEXT[@]}" --language=JavaScript "${sources[@]}" > "$tmp" 2>/dev/null; then
    :
  else
    echo "update-po: xgettext could not parse the sources; using the built-in extractor" >&2
    python3 scripts/pot-from-source.py "${sources[@]}" > "$tmp"
  fi
else
  echo "update-po: xgettext is not installed; using the built-in extractor"
  python3 scripts/pot-from-source.py "${sources[@]}" > "$tmp"
fi

mv "$tmp" "$POT"
trap - EXIT
echo "update-po: wrote $POT"

if command -v msgmerge >/dev/null 2>&1; then
  shopt -s nullglob
  for po in po/*.po; do
    msgmerge --update --backup=none "$po" "$POT"
    echo "update-po: merged $(basename "$po")"
  done
else
  echo "update-po: msgmerge is not installed; existing po/*.po catalogues were left untouched"
fi
