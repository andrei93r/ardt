#!/usr/bin/env bash
# Generated with AI for personal use.
# S26 Application compatibility (live): the apps the nested headless session
# cannot host — snap, flatpak, AppImage and real Electron — through the SAME
# shared checklist as A158-A160. Runs against the real GNOME session, only ever
# touching windows it spawns and restoring the workspace it started on. Every
# row is availability-gated: a missing app is a named skip.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

row() {
  local label="$1"; shift
  appcheck_row "$label" "$@"
  local rc=$?
  case "$rc" in
    0) echo "ROW PASS  $label" ;;
    2) echo "ROW SKIP  $label" ;;
    *) echo "ROW FAIL  $label" ;;
  esac
  return 0
}

electron_env=(--env ELECTRON_OZONE_PLATFORM_HINT=auto)

# --- Electron (real, on the live session) -----------------------------------
if appcheck_have_bin code; then
  row "Electron · VS Code" "${electron_env[@]}" -- code --new-window
else
  appcheck_skip "S26: code not installed"
fi

if appcheck_have_bin obsidian; then
  row "Electron · Obsidian" "${electron_env[@]}" -- obsidian
else
  appcheck_skip "S26: obsidian not installed"
fi

if appcheck_have_bin ai.opencode.desktop || [ -x /opt/OpenCode/ai.opencode.desktop ]; then
  opencode_bin="$(command -v ai.opencode.desktop || echo /opt/OpenCode/ai.opencode.desktop)"
  row "Electron · OpenCode" "${electron_env[@]}" -- "$opencode_bin"
else
  appcheck_skip "S26: OpenCode not installed"
fi

if appcheck_have_snap ferdium; then
  row "Electron · Ferdium (snap)" "${electron_env[@]}" -- snap run ferdium
else
  appcheck_skip "S26: ferdium snap not installed"
fi

# --- Qt (snap) --------------------------------------------------------------
if appcheck_have_snap onlyoffice-desktopeditors; then
  row "Qt5 · ONLYOFFICE (snap)" -- snap run onlyoffice-desktopeditors
else
  appcheck_skip "S26: onlyoffice-desktopeditors snap not installed"
fi

# --- Flatpak ----------------------------------------------------------------
if appcheck_have_flatpak com.stremio.Stremio; then
  row "GTK4 · Stremio (flatpak)" -- flatpak run com.stremio.Stremio
else
  appcheck_skip "S26: com.stremio.Stremio flatpak not installed"
fi

# --- AppImages in ~/Applications and ~/Downloads ----------------------------
appimages="$(find "$HOME/Applications" "$HOME/Downloads" -maxdepth 1 \( -iname '*.appimage' \) \
  -printf '%p\n' 2>/dev/null | sort -u | head -2)"
if [ -z "$appimages" ]; then
  appcheck_skip "S26: no AppImages in ~/Applications or ~/Downloads"
fi
while IFS= read -r appimage; do
  [ -n "$appimage" ] || continue
  [ -x "$appimage" ] || { appcheck_skip "S26: $appimage is not executable"; continue; }
  row "AppImage · $(basename "$appimage")" -- "$appimage"
done <<<"$appimages"

summary
