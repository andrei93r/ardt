#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A134 Popup-family windows are never tracked. On Wayland an `xdg_popup` reports
# `override_redirect == false`, so the old filter let menus/tooltips/popovers
# into the session; closing one calls a NULL `close` vfunc in Mutter and
# segfaults the Shell (docs/shell-crash-audit.md). The scenario samples while a
# popup is cycling, then closes every tracked window and requires the Shell to
# still answer.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
spawn_window "python3 $ROOT_DIR/tests/agent/popup-client.py" >/dev/null
wait_count 1 25 || true

# The host window is a normal tileable window and must be tracked, so a "no
# popups" result cannot be the session having tracked nothing at all.
if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if any(w.get("windowType") == 0 for w in d["windows"]) else 1)'; then
  pass "the normal host window is tracked"
else
  fail "the host window was never tracked"
fi

# Sample across many popup cycles: a popup type must never appear.
popup_types="6 9 10 11 12 13 14"
saw=""
for _ in $(seq 1 40); do
  seen="$(dump | python3 -c "
import json, sys
popup = {int(x) for x in '$popup_types'.split()}
d = json.load(sys.stdin)
print(','.join(str(w.get('windowType')) for w in d['windows'] if w.get('windowType') in popup))
")"
  if [ -n "$seen" ]; then saw="$seen"; break; fi
  sleep 0.15
done
if [ -n "$saw" ]; then
  fail "a popup-family window was tracked (windowTypes: $saw)"
else
  pass "no popup-family window is ever tracked"
fi

# Closing every tracked window must not take the Shell down. Before the fix this
# is exactly where a tracked popup was deleted and the compositor crashed.
ids="$(list_ids)"
for id in $ids; do adrt CloseWindow "$id" >/dev/null 2>&1 || true; done
sleep 1
if dump >/dev/null 2>&1; then
  pass "the Shell survives closing every tracked window"
else
  fail "the Shell stopped answering after closing tracked windows"
fi
wait_count 0 10 || true

ensure_clean
summary
