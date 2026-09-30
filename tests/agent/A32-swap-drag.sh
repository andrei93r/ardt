#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A32 Drag swap: dropping a tile past its sibling swaps the pair.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
a="${ids[0]}"
b="${ids[1]}"

read -r AX AY AW AH BX BY BW BH <<<"$(dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
area=d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
by={w["id"]:w["rect"] for w in d["windows"]}
b=by[int("'"$b"'")]
print(area["x"],area["y"],area["width"],area["height"],b["x"],b["y"],b["width"],b["height"])
')"
# Drop a onto b's area (its centre lands inside b) without crossing b's centre.
NX=$((BX - 4))

adrt BeginDrag "$a" >/dev/null
adrt MoveWindow "$a" "$NX" "$AY" "$BW" "$BH" >/dev/null
sleep 1
start_ms="$(date +%s%3N)"
adrt EndDrag "$a" >/dev/null
swapped_ms=0
deadline=$((SECONDS + 6))
while [ "$SECONDS" -lt "$deadline" ]; do
  if dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
by={w["id"]:w["rect"]["x"] for w in d["windows"]}
sys.exit(0 if by.get(int("'"$a"'"), -1) > by.get(int("'"$b"'"), 1 << 30) else 1)'; then
    swapped_ms=$(( $(date +%s%3N) - start_ms ))
    break
  fi
done

# The swap must take effect promptly after the drop, not wait out a reconcile
# debounce (the user notices ~100 ms here).
if [ "$swapped_ms" -gt 0 ] && [ "$swapped_ms" -le 1200 ]; then
  pass "the drop was interpreted promptly ($swapped_ms ms)"
else
  fail "the drop took ${swapped_ms:->6000} ms to take effect"
fi
wait_settled 12

check_python "the pair is marked swapped" '
import json,sys
if not json.load(sys.stdin)["swapPairs"]:
    print("no swap pair recorded"); sys.exit(1)
print("swapped")
'

check_python "the dragged window is now on the right" '
import json,sys
d=json.load(sys.stdin)
by={w["id"]:w["rect"]["x"] for w in d["windows"]}
if not (by[int("'"$a"'")] > by[int("'"$b"'")]):
    print(by); sys.exit(1)
print("swapped sides")
'

ensure_clean
summary
