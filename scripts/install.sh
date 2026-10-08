#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# One-command install (§39.1). Verifies the environment, builds if needed,
# installs into the user's extension directory, compiles the schema and prints
# the next steps. Exits 0 on success, 1 with a reason on failure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UUID="adrt@adrt.dev"
SCHEMA="org.gnome.shell.extensions.adrt"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
INSTALL_DIR="$DATA_HOME/gnome-shell/extensions/$UUID"

fail() {
  echo "install: $*" >&2
  exit 1
}

# 1. Environment -----------------------------------------------------------
[ "$(uname -s)" = "Linux" ] || fail "only Linux is supported"

if ! command -v gnome-shell >/dev/null 2>&1; then
  fail "gnome-shell was not found"
fi

version="$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -1)"
case "$version" in
  48 | 49 | 50 | 51) ;;
  *) fail "GNOME Shell $version is not supported (need 48, 49, 50 or 51)" ;;
esac
echo "install: GNOME Shell $version detected"

if ! command -v glib-compile-schemas >/dev/null 2>&1; then
  echo "install: glib-compile-schemas is missing; attempting to install"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y libglib2.0-bin || fail "could not install glib-compile-schemas"
  else
    fail "install libglib2.0-bin (glib-compile-schemas) and re-run"
  fi
fi

# 2. Build -----------------------------------------------------------------
# Always rebuild: newer-source detection cannot see a deleted source, which
# would leave a stale module in `dist/` (tsc never cleans its outDir).
if [ ! -d "$ROOT/node_modules" ]; then
  ( cd "$ROOT" && npm install --no-audit --no-fund )
fi
echo "install: building"
( cd "$ROOT" && npm run build )

# 3. Install ---------------------------------------------------------------
# Back up an existing install *outside* the extensions directory. A sibling
# `adrt@adrt.dev.pre-*` directory is discovered by the Shell as a second
# extension UUID, so it tries to load it and logs an error on every login.
BACKUP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/adrt/backups"
if [ -d "$INSTALL_DIR" ]; then
  mkdir -p "$BACKUP_DIR"
  stamp="$(date +%Y%m%d-%H%M%S)"
  while [ -e "$BACKUP_DIR/$UUID.$stamp" ]; do
    stamp="$stamp.$$"
  done
  if mv "$INSTALL_DIR" "$BACKUP_DIR/$UUID.$stamp"; then
    echo "install: backed up the previous install to $BACKUP_DIR/$UUID.$stamp"
  else
    echo "install: could not back up $INSTALL_DIR; removing it"
    rm -rf "$INSTALL_DIR"
  fi
else
  echo "install: no previous install at $INSTALL_DIR"
fi
mkdir -p "$INSTALL_DIR/schemas"

cp -r "$ROOT/dist/." "$INSTALL_DIR/"
cp "$ROOT/packages/gnome/metadata.json" "$INSTALL_DIR/metadata.json"
cp "$ROOT/packages/gnome/stylesheet.css" "$INSTALL_DIR/stylesheet.css"
cp "$ROOT/packages/gnome/schemas/$SCHEMA.gschema.xml" "$INSTALL_DIR/schemas/"
glib-compile-schemas "$INSTALL_DIR/schemas"

echo "install: files copied"

# 4. Session type ----------------------------------------------------------
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
  echo "install: Wayland session detected — GNOME Shell cannot be restarted in place."
  echo "install: log out and back in, or run 'npm run dev' for a nested Shell."
else
  echo "install: press Alt+F2, type 'r' and press Enter to reload the Shell."
fi

# 5. Enable if possible ----------------------------------------------------
if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions enable "$UUID" 2>/dev/null || true
fi

# 6. Verification ----------------------------------------------------------
echo
echo "install: done. Verify with:"
echo "  gnome-extensions info $UUID"
echo "  (State: ENABLED means the install succeeded)"
