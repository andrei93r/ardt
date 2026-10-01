#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A116 The escape rule (§16/§10 step 3): a managed window that does not fit its
# slot gets its own workspace to the right, sized to itself and clamped to
# [1/6, full screen], flush at slot 0 and full height; the window it left behind
# fills its screen.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# This scenario describes 1 screen; on another
# count the same rules are exercised by the matrix runs, so skip with a reason.
screens="$(screen_count)"
if [ "$screens" -ne 1 ]; then
  skip "A116-escape-clamped-own-workspace: needs exactly 1 screen (this harness has $screens)"
  exit 0
fi

ensure_clean
spawn_window >/dev/null
wait_count 1 15 || true
sleep 1
A="$(list_ids)"
pair_ws="$(window_field "$A" workspace)"

# min width 900 > half of the 1280 screen: it cannot share, so it escapes.
spawn_window "python3 $ROOT_DIR/tests/support/refusing-client.py 900 400 stubborn" >/dev/null
wait_count 2 20 || true
B="$(list_ids | tr ' ' '\n' | grep -v "^$A$" | tr -d '\n' | xargs)"
wait_settled 15

poll "the window that does not fit took its own workspace at its clamped width" '
import json, sys
d = json.load(sys.stdin)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not a or not b:
    print("window gone"); sys.exit(1)
pair_ws = int("'"$pair_ws"'")
if b[0]["workspace"] != pair_ws + 1:
    print("escapee on ws", b[0]["workspace"], "expected", pair_ws + 1); sys.exit(1)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
r = b[0]["rect"]
# Sized to itself: ~900 wide, not the whole 1280.
if r["width"] < 620 or r["width"] > 1000:
    print("width not clamped to its own size:", r["width"]); sys.exit(1)
if abs(r["x"] - area["x"]) > 2:
    print("not flush at slot 0:", r["x"], "vs", area["x"]); sys.exit(1)
if r["height"] < area["height"] - 3:
    print("not full work-area height:", r["height"], "vs", area["height"]); sys.exit(1)
# The window left behind is alone and fills the screen.
if not a[0]["maximized"]:
    print("the window left behind is not maximized"); sys.exit(1)
print("escapee", r, "on ws", b[0]["workspace"], "left behind maximized")
' 25

ensure_clean
summary
