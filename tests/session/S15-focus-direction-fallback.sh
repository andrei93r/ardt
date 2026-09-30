#!/usr/bin/env bash
# Generated with AI for personal use.
# S15 Focus direction fallback on the live session: no window on the requested
# side focuses the other side; no neighbour at all does nothing.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
spawn
wait_tests 2 15 || true
sleep 2
read -r left right <<<"$(test_pair_by_x)"
echo "left=$left right=$right"

border_x() { dump | python3 -c 'import json,sys; b=json.load(sys.stdin)["border"]["rect"]; print(b["x"] if b else "")'; }
window_x() { dump | python3 -c '
import json, sys
w = [x for x in json.load(sys.stdin)["windows"] if x["id"] == int(sys.argv[1])]
print(w[0]["rect"]["x"] if w else "")' "$1"; }

focus_matches() {
  wait_python 12 '
import json, sys
d = json.load(sys.stdin)
b = d["border"]["rect"]
w = [x for x in d["windows"] if x["id"] == int("'"$1"'")]
if not b or not w:
    sys.exit(1)
sys.exit(0 if abs(b["x"] - w[0]["rect"]["x"]) <= 2 else 1)'
}

adrt ActivateWindow "$left" >/dev/null
sleep 1
adrt FocusDirection left >/dev/null
if focus_matches "$right"; then
  pass "no left window: focused the right one"
else
  fail "did not fall back to the right window (border $(border_x), right $(window_x "$right"))"
fi

adrt ActivateWindow "$right" >/dev/null
sleep 1
adrt FocusDirection right >/dev/null
if focus_matches "$left"; then
  pass "no right window: focused the left one"
else
  fail "did not fall back to the left window (border $(border_x), left $(window_x "$left"))"
fi

summary
