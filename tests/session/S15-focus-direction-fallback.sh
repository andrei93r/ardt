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

adrt ActivateWindow "$left" >/dev/null
sleep 2
adrt FocusDirection left >/dev/null
sleep 2
if [ "$(border_x)" = "$(window_x "$right")" ]; then pass "no left window: focused the right one"; else fail "did not fall back to the right window"; fi

adrt ActivateWindow "$right" >/dev/null
sleep 2
adrt FocusDirection right >/dev/null
sleep 2
if [ "$(border_x)" = "$(window_x "$left")" ]; then pass "no right window: focused the left one"; else fail "did not fall back to the left window"; fi

summary
