#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A87 Nothing is evicted (§2): a third window gets its own workspace; the pair
# it left behind stays exactly where it was, on its own workspace.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
pair_ws="$(window_field "$A" workspace)"

spawn_window >/dev/null
wait_count 3 15 || true
wait_settled 12

poll "both original windows stayed on the pair workspace, unmoved" '
import json, sys
d = json.load(sys.stdin)
pair_ws = int("'"$pair_ws"'")
a, b = int("'"$A"'"), int("'"$B"'")
here = {w["id"]: w for w in d["windows"]}
for wid in (a, b):
    if wid not in here:
        print("window gone", wid); sys.exit(1)
    if here[wid]["workspace"] != pair_ws:
        print("window", wid, "moved to ws", here[wid]["workspace"]); sys.exit(1)
third = [w for w in d["windows"] if w["id"] not in (a, b)]
if len(third) != 1 or third[0]["workspace"] == pair_ws:
    print("third not on its own workspace", third); sys.exit(1)
print("pair kept on ws", pair_ws, "third on ws", third[0]["workspace"])
' 20

poll "the pair geometry is unchanged" '
import json, sys
d = json.load(sys.stdin)
pair_ws = int("'"$pair_ws"'")
a, b = int("'"$A"'"), int("'"$B"'")
rects = {w["id"]: w["rect"] for w in d["windows"] if w["id"] in (a, b)}
if len(rects) != 2:
    print("pair gone"); sys.exit(1)
left = rects[a] if rects[a]["x"] <= rects[b]["x"] else rects[b]
if left["width"] >= d["monitors"][0]["geometry"]["width"] - 2:
    print("a pair member now spans the screen", left); sys.exit(1)
print("pair rects", rects)
' 20

ensure_clean
summary
