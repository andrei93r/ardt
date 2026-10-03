#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A160 Application compatibility: the Qt / flatpak / AppImage rows, through the
# same shared checklist (tests/lib/appcheck.sh). These are the launchers the
# nested session is least likely to host, so every row is gated hard: an absent
# runtime, an uninstalled app, or a launch that fails headlessly is a named skip,
# and the live suite (S26) covers the ones the nested Shell cannot.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

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

# --- Qt5 (snap): ONLYOFFICE ------------------------------------------------
if appcheck_have_snap onlyoffice-desktopeditors; then
  row "Qt5 · ONLYOFFICE (snap)" \
    --env QT_QPA_PLATFORM=wayland \
    -- snap run onlyoffice-desktopeditors
else
  appcheck_skip "A160: onlyoffice-desktopeditors snap not installed"
fi

# --- Flatpak: Stremio -------------------------------------------------------
if appcheck_have_flatpak com.stremio.Stremio; then
  row "GTK4 · Stremio (flatpak)" -- flatpak run com.stremio.Stremio
else
  appcheck_skip "A160: com.stremio.Stremio flatpak not installed"
fi

# --- AppImages in ~/Applications and ~/Downloads (best effort) --------------
# LM Studio is covered by A159; the rest are opened as-is with the extract-and-run
# fallback so a missing FUSE does not turn into a launch failure.
appimages="$(find "$HOME/Applications" "$HOME/Downloads" -maxdepth 1 \( -iname '*.appimage' \) \
  ! -iname 'LM-Studio-*' -printf '%p\n' 2>/dev/null | sort -u | head -2)"
if [ -z "$appimages" ]; then
  appcheck_skip "A160: no AppImages in ~/Applications or ~/Downloads"
fi
while IFS= read -r appimage; do
  [ -n "$appimage" ] || continue
  [ -x "$appimage" ] || { appcheck_skip "A160: $appimage is not executable"; continue; }
  row "AppImage · $(basename "$appimage")" \
    --env APPIMAGE_EXTRACT_AND_RUN=1 \
    -- "$appimage"
done <<<"$appimages"

summary
