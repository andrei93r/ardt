#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A31 Keyboard swap: moving a tile toward its sibling swaps the pair.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
# Focus the left-hand window.
left="$(dump | python3 -c '
import json,sys
ws=[w for w in json.load(sys.stdin)["windows"] if w["tileable"]]
ws.sort(key=lambda w: w["rect"]["x"])
print(ws[0]["id"])
')"
adrt ActivateWindow "$left" >/dev/null
sleep 1
before="$(window_field "$left" rect)"

adrt MoveToward right >/dev/null
wait_settled 25

check_python "the pair is marked swapped" '
import json,sys
if not json.load(sys.stdin)["swapPairs"]:
    print("no swap pair recorded"); sys.exit(1)
print("swapped")
'
after="$(window_field "$left" rect)"
if [ "$before" != "$after" ]; then pass "the focused tile changed sides"; else fail "the tile did not move"; fi

ensure_clean
summary
