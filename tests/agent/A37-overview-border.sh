#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A37 The overview hides the border but does not pause tiling: a window moved
# while the overview is open is still put back, and the border returns when the
# overview closes.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
a="${ids[0]}"
adrt ActivateWindow "$a" >/dev/null
sleep 1

assert_true "overview opens" "$(adrt SimulateOverview true | python3 "$PARSE")"
sleep 1

check_python "border is suppressed in the overview" '
import json, sys
d = json.load(sys.stdin)
if "overview" not in d["indicator"]["suppressed"]:
    print("suppressions:", d["indicator"]["suppressed"]); sys.exit(1)
print("suppressed:", d["indicator"]["suppressed"])
'

# Move a window out of place; tiling keeps running, so it must be put back.
adrt MoveWindow "$a" 300 300 400 300 >/dev/null
if wait_python 10 '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$a"'")]
if not w:
    print("window gone"); sys.exit(1)
sys.exit(0 if abs(w[0]["rect"]["x"] - 300) > 8 else 1)'; then
  pass "the drifted window was re-tiled while the overview was open"
else
  fail "tiling did not run in the overview (x $(state_expr "next(x['rect']['x'] for x in d['windows'] if x['id'] == $a)"))"
fi

assert_true "overview closes" "$(adrt SimulateOverview false | python3 "$PARSE")"
sleep 1
check_python "border is back after the overview closes" '
import json, sys
d = json.load(sys.stdin)
if "overview" in d["indicator"]["suppressed"]:
    print("still suppressed"); sys.exit(1)
if not d["border"]["visible"]:
    print("border not visible"); sys.exit(1)
print("visible")
'

ensure_clean
summary
