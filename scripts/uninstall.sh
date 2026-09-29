#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Uninstall (§39.2). Leaves $XDG_DATA_HOME/adrt/ in place unless --purge.
set -euo pipefail

UUID="adrt@adrt.dev"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
INSTALL_DIR="$DATA_HOME/gnome-shell/extensions/$UUID"
PURGE=0

for arg in "$@"; do
  [ "$arg" = "--purge" ] && PURGE=1
done

if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions disable "$UUID" 2>/dev/null || true
  echo "uninstall: extension disabled"
fi

rm -rf "$INSTALL_DIR"
echo "uninstall: removed $INSTALL_DIR"

if [ "$PURGE" -eq 1 ]; then
  rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/adrt"
  echo "uninstall: purged user data"
else
  echo "uninstall: kept user data (pass --purge to remove it)"
fi

echo "uninstall: done"
