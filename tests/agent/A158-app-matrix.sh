#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A158 Application compatibility: the GTK4 / GTK3 / Chromium rows, each through
# the SAME shared checklist (tests/lib/appcheck.sh) — opens and is tracked, a
# lone window maximises, a sibling makes a 50/50 pair, maximize/unmaximize
# round-trips, a tab tear-off tiles/maximises with no swap, no clamp/resize_retry
# storm and no stubborn, focus and the border land on the right window/screen,
# and the layout settles without oscillation. Every row is availability-gated: a
# missing app, or one that cannot launch in the nested session, is a named skip.
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

# --- GTK4: the default test client -----------------------------------------
if appcheck_have_bin gnome-text-editor; then
  row "GTK4 · GNOME Text Editor" -- gnome-text-editor --new-window
else
  appcheck_skip "A158: gnome-text-editor not installed"
fi

# --- GTK4: a file manager that opens a fresh window on request -------------
if appcheck_have_bin nautilus; then
  row "GTK4 · Nautilus" -- nautilus --new-window
else
  appcheck_skip "A158: nautilus not installed"
fi

# --- GTK3: Disks (no --new-window flag; it opens a window per process) ------
if appcheck_have_bin gnome-disks; then
  row "GTK3 · GNOME Disks" -- gnome-disks
else
  appcheck_skip "A158: gnome-disks not installed"
fi

# --- Chromium on GTK3: needs the Wayland ozone backend (the nested Shell has
# no X server) and its own profile so it never collides with the user's. ------
chrome_bin="$(command -v google-chrome-stable || command -v google-chrome || true)"
if [ -n "$chrome_bin" ]; then
  row "Chromium · Google Chrome" \
    --env GDK_BACKEND=wayland \
    -- "$chrome_bin" --new-window --ozone-platform=wayland \
       --user-data-dir="$ADRT_STATE_DIR/appmatrix-chrome" \
       --no-first-run --no-default-browser-check --disable-dev-shm-usage
else
  appcheck_skip "A158: google-chrome not installed"
fi

summary
