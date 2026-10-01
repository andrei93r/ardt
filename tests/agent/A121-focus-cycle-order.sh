#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A121 The focus cycle walks the current screen and workspace in order (§6/§17):
# the managed windows in slot order, then the floats left to right, wrapping;
# minimized windows are skipped.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

focused_is() {
  wait_python "${2:-10}" "
import json, sys
sys.exit(0 if json.load(sys.stdin).get('focused') == int('$1') else 1)"
}

ensure_clean
# A single-workspace screen: one maximizes, the second splits, the third floats.
set_static_workspaces 1
spawn_window >/dev/null
wait_count 1 15 || true
sleep 1
spawn_window >/dev/null
wait_count 2 15 || true
wait_settled 12
spawn_window >/dev/null
wait_count 3 15 || true
wait_settled 15

read -r LEFT RIGHT FLOAT <<<"$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
tiles = sorted((w for w in d["windows"] if w["tileable"] and not w["minimized"]), key=lambda w: w["rect"]["x"])
floats = [w for w in d["windows"] if w["layer"] == 2]
if len(tiles) != 2 or len(floats) != 1:
    print("SKIP")
else:
    print(tiles[0]["id"], tiles[1]["id"], floats[0]["id"])')"

if [ -z "${FLOAT:-}" ] || [ "$FLOAT" = "SKIP" ]; then
  skip "A121 needs a single-workspace pair plus an overflow float"
  ensure_clean
  summary
  exit 0
fi
echo "left=$LEFT right=$RIGHT float=$FLOAT"

adrt ActivateWindow "$LEFT" >/dev/null
focused_is "$LEFT" || fail "could not focus the left tile"
adrt FocusCycle >/dev/null
focused_is "$RIGHT" || fail "the cycle did not step to slot 1"

adrt FocusCycle >/dev/null
focused_is "$FLOAT" || fail "the cycle did not step to the float after the managed windows"

adrt FocusCycle >/dev/null
focused_is "$LEFT" || fail "the cycle did not wrap back to the first managed window"
pass "the cycle walks managed (slot order) then floats, wrapping"

# Minimized windows are skipped entirely.
adrt MinimizeWindow "$FLOAT" >/dev/null
wait_python 12 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(w['id']==$FLOAT and w['minimized'] for w in d['windows']) else 1)" || true
adrt ActivateWindow "$LEFT" >/dev/null
focused_is "$LEFT" || true
adrt FocusCycle >/dev/null
focused_is "$RIGHT" || fail "a minimized float must be skipped"
adrt FocusCycle >/dev/null
focused_is "$LEFT" || fail "the cycle must wrap over managed windows only"
pass "minimized windows are skipped by the cycle"

ensure_clean
summary
