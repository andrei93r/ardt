#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A48 The tiling plan is re-run on a slow cadence (~10 motion ticks, ~500 ms)
# while a tileable window is focused, as a safety net for a layout that drifted
# without a usable signal.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_settled 15
wait_border_visible 20 || true

before="$(state_expr 'd["motionRetiles"]')"
if wait_for 10 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"motionRetiles\"])')\" -gt '$((before + 1))' ]"; then
  pass "the tiling plan re-runs on its own (was $before)"
else
  fail "no periodic tiling pass (still $(state_expr 'd["motionRetiles"]'))"
fi

# A drifted window is put back without the user doing anything else.
target="${ids[0]}"
adrt MoveWindow "$target" 5 40 300 200 >/dev/null
if wait_for 8 bash -c "bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c '
import json,sys
d = json.load(sys.stdin)
for w in d[\"windows\"]:
    if w[\"id\"] == $target:
        sys.exit(0 if w[\"rect\"][\"width\"] > 399 else 1)
sys.exit(1)'"; then
  pass "the drifted window was restored to the plan"
else
  fail "window stayed at $(window_field "$target" rect)"
fi

ensure_clean
summary
