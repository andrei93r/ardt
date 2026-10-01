#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A92 On a single-workspace screen (§7): the first window maximizes, a second
# splits it, and a third floats — no workspace is created.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
set_static_workspaces 1

spawn_window >/dev/null
wait_count 1 15 || true
sleep 1
spawn_window >/dev/null
wait_count 2 15 || true
wait_pair_tiled 20 || true
wait_settled 12

before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 3 15 || true
third="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
wait_settled 12

poll "the third window floats and the pair stays tiled" '
import json, sys
d = json.load(sys.stdin)
third = int("'"$third"'")
w = [x for x in d["windows"] if x["id"] == third]
if not w:
    print("window gone"); sys.exit(1)
if w[0]["layer"] != 2:
    print("not floating (layer", w[0]["layer"], ")"); sys.exit(1)
tiles = [x for x in d["windows"] if x["tileable"] and not x["minimized"] and x["layer"] != 2]
if len(tiles) != 2 or len({x["workspace"] for x in tiles}) != 1:
    print("the pair is not intact", [(x["id"], x["workspace"]) for x in tiles]); sys.exit(1)
if d["workspaces"] != 1:
    print("a workspace was created", d["workspaces"]); sys.exit(1)
print("third floats; pair on ws", tiles[0]["workspace"])
' 20

ensure_clean
summary
