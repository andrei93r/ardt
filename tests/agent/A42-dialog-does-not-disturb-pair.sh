#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A42 A transient dialog does not disturb the pair: it is not tiled and the two
# tiles keep their geometry.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
before="$(window_field "${ids[0]}" rect)"

spawn_window "zenity --info --text=adrt" >/dev/null
wait_count 3 15 || true
wait_settled 12

check_python "the pair is unchanged and the dialog is not tiled" '
import json, sys
d = json.load(sys.stdin)
tileables = [w for w in d["windows"] if w["tileable"]]
if len(tileables) != 2:
    print("tileable count", len(tileables)); sys.exit(1)
non = [w for w in d["windows"] if not w["tileable"]]
if not non:
    print("the dialog was treated as tileable"); sys.exit(1)
if all(w["layer"] == 1 for w in non):
    print("the dialog is in the tiled layer"); sys.exit(1)
print("pair intact,", len(non), "non-tiled")
'

after="$(window_field "${ids[0]}" rect)"
if [ "$before" = "$after" ]; then pass "the first tile kept its geometry"; else fail "the tile moved ($before -> $after)"; fi

ensure_clean
summary
