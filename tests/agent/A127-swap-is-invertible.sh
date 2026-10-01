#!/usr/bin/env bash
# Generated with AI for personal use.
# A127 Keyboard swap is invertible (§13): moving the focused tile toward its
# sibling exchanges the sides, and moving it back exchanges them again. The
# swap flag alone is not enough — when the pair's position order already matches
# the reverse of its id order, toggling it changes nothing and clearing it
# restores nothing. The user's swap is recorded as explicit sides.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
wait_settled 12

read -r A B <<<"$(dump | python3 -c '
import json, sys
ws = sorted((w for w in json.load(sys.stdin)["windows"] if w["tileable"]), key=lambda w: w["rect"]["x"])
print(" ".join(str(w["id"]) for w in ws[:2]))')"
echo "pair: $A $B"

adrt ActivateWindow "$A" >/dev/null
if ! wait_python 15 "import json,sys; sys.exit(0 if json.load(sys.stdin)['focused'] == $A else 1)"; then
  fail "the focus did not land on the pair's left window before the move"
  summary
  exit 1
fi

# First move: A goes to the far side (right).
adrt MoveToward right >/dev/null
poll "the first move swapped the pair (A is on the right)" '
import json, sys
d = json.load(sys.stdin)
by = {w["id"]: w["rect"]["x"] for w in d["windows"]}
a, b = int("'"$A"'"), int("'"$B"'")
if a not in by or b not in by:
    print("window gone", sorted(by)); sys.exit(1)
if not (by[a] > by[b]):
    print(by); sys.exit(1)
print(by)
' 20

# Second move, back the other way: A must return to the left. Before the fix
# the flag was merely cleared and the position order left A on the right.
adrt MoveToward left >/dev/null
poll "the second move swapped the pair back (A is on the left)" '
import json, sys
d = json.load(sys.stdin)
by = {w["id"]: w["rect"]["x"] for w in d["windows"]}
a, b = int("'"$A"'"), int("'"$B"'")
if a not in by or b not in by:
    print("window gone", sorted(by)); sys.exit(1)
if not (by[a] < by[b]):
    print(by); sys.exit(1)
print(by)
' 20

check_python "the swap pair flag is clear again" '
import json, sys
pairs = json.load(sys.stdin)["swapPairs"]
if pairs:
    print("swapPairs", pairs); sys.exit(1)
print("clear")
'

ensure_clean
summary
