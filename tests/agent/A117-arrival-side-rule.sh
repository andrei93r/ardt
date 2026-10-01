#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A117 A workspace move keeps the side it came from (§3): a window moving to the
# workspace on its right came from the left, so it takes slot 0.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
pair_ws="$(window_field "$A" workspace)"

before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 3 15 || true
C="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
wait_python 15 "
import json, sys
d = json.load(sys.stdin)
c = [w for w in d['windows'] if w['id'] == $C]
sys.exit(0 if c and c[0]['workspace'] != $pair_ws else 1)" || true

# Move B onto C's workspace, one to the right: B came from the left.
adrt MoveToWorkspace "$B" "$(window_field "$C" workspace)" >/dev/null

poll "the window arriving from the left takes slot 0" '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
c = [w for w in d["windows"] if w["id"] == int("'"$C"'")]
if not b or not c:
    print("window gone"); sys.exit(1)
if b[0]["workspace"] != c[0]["workspace"]:
    print("not paired:", b[0]["workspace"], c[0]["workspace"]); sys.exit(1)
if b[0]["slot"] != 0:
    print("the arrival is in slot", b[0]["slot"], "expected 0"); sys.exit(1)
if c[0]["slot"] != 1:
    print("the resident is in slot", c[0]["slot"], "expected 1"); sys.exit(1)
print("arrival slot", b[0]["slot"], "resident slot", c[0]["slot"])
' 25

ensure_clean
summary
