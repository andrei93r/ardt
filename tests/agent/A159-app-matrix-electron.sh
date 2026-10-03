#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A159 Application compatibility: the Electron rows, always through the same
# shared checklist (tests/lib/appcheck.sh). Electron is the family that most
# often runs on XWayland and silently ignores the Wayland session, so each row
# asks for the Wayland ozone backend explicitly. Every row is availability-gated:
# a missing app, or one that cannot launch headlessly, is a named skip.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# Report each row with its gate, so a skip is never silent, and keep going.
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

# The Wayland hint every Electron build understands; the command-line flag is
# belt-and-braces for the ones that read only the flag.
electron_env=(--env ELECTRON_OZONE_PLATFORM_HINT=auto)
ua() { # app-name
  mkdir -p "$ADRT_STATE_DIR/appmatrix-$1"
  printf '%s' "$ADRT_STATE_DIR/appmatrix-$1"
}

# --- VS Code ----------------------------------------------------------------
if appcheck_have_bin code; then
  row "Electron · VS Code" "${electron_env[@]}" \
    -- code --new-window --ozone-platform=wayland --no-sandbox \
       --user-data-dir="$(ua code)"
else
  appcheck_skip "A159: code (VS Code) not installed"
fi

# --- Obsidian ---------------------------------------------------------------
if appcheck_have_bin obsidian; then
  row "Electron · Obsidian" "${electron_env[@]}" \
    -- obsidian --ozone-platform=wayland --no-sandbox \
       --user-data-dir="$(ua obsidian)"
else
  appcheck_skip "A159: obsidian not installed"
fi

# --- OpenCode ---------------------------------------------------------------
if appcheck_have_bin ai.opencode.desktop || [ -x /opt/OpenCode/ai.opencode.desktop ]; then
  opencode_bin="$(command -v ai.opencode.desktop || echo /opt/OpenCode/ai.opencode.desktop)"
  row "Electron · OpenCode" "${electron_env[@]}" \
    -- "$opencode_bin" --ozone-platform=wayland --no-sandbox \
       --user-data-dir="$(ua opencode)"
else
  appcheck_skip "A159: OpenCode not installed"
fi

# --- Ferdium (snap) ---------------------------------------------------------
if appcheck_have_snap ferdium; then
  row "Electron · Ferdium (snap)" "${electron_env[@]}" \
    -- snap run ferdium --ozone-platform=wayland
else
  appcheck_skip "A159: ferdium snap not installed"
fi

# --- LM Studio (AppImage, best effort) --------------------------------------
lm_studio="$(find "$HOME/Downloads" -maxdepth 1 -iname 'LM-Studio-*.AppImage' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
if [ -z "$lm_studio" ]; then
  appcheck_skip "A159: LM Studio AppImage not found in ~/Downloads"
elif [ ! -x "$lm_studio" ]; then
  # A downloaded AppImage often lacks the execute bit; it cannot be launched
  # as-is, and chmod-ing the user's file is not ours to do.
  appcheck_skip "A159: LM Studio AppImage is not executable: $(basename "$lm_studio")"
else
  row "Electron · LM Studio (AppImage)" "${electron_env[@]}" \
    --env APPIMAGE_EXTRACT_AND_RUN=1 \
    -- "$lm_studio" --no-sandbox --ozone-platform=wayland \
       --user-data-dir="$(ua lmstudio)"
fi

summary
