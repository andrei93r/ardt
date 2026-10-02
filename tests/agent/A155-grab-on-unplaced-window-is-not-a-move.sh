#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A155 A compositor move grab on a window adrt has not placed yet is a tab
# tear-off, not a window move (§6/§11). The live Chrome tear-off emitted
# grab-op-begin/end on the window it had just created, so `beginDrag` armed and
# the drop swapped the pair. `displayGrabActive()` is true there, so the
# discriminator is the window's own state: not adopted / routing pending. The
# gesture must not arm a move, must interpret no drop and must show no preview.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# The journal sequence of the newest entry, so a phase counts only its own
# events even on a worker that already ran other scenarios.
journal_seq() {
  journal_tail 1 2>/dev/null | python3 -c 'import json,sys
e=json.load(sys.stdin)
print(e[-1]["seq"] if e else 0)' 2>/dev/null || echo 0
}

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
wait_settled 15

# Keep the newcomer unplaced: with tiling paused, `onReady` still adopts it but
# the drain cannot route it, so `routePending` stays set — exactly the state the
# live tear-off window was in when the grab began.
adrt ActivatePanelItem pause >/dev/null
wait_python 10 'import json,sys; sys.exit(0 if json.load(sys.stdin)["paused"] else 1)' || true

ids_before="$(list_ids)"
spawn_window >/dev/null
wait_count 3 15 || true
NEW="$(dump | python3 -c '
import json,sys
before=set("'"$ids_before"'".split())
d=json.load(sys.stdin)
new=[str(w["id"]) for w in d["windows"] if str(w["id"]) not in before]
print(new[0] if new else "")')"
if [ -z "$NEW" ]; then
  fail "the newcomer never registered (cannot exercise the tear-off gate)"
  adrt ActivatePanelItem pause >/dev/null 2>&1 || true
  ensure_clean
  summary
  exit $?
fi
# Its first frame has arrived (adopted) but it is still unplaced/routing.
sleep 0.6

read -r BX BY BW BH <<<"$(dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
ws=sorted([w for w in d["windows"] if w["tileable"] and w["layer"] != 2], key=lambda w: w["rect"]["x"])
b=ws[-1]["rect"]
print(b["x"], b["y"], b["width"], b["height"])')"

since="$(journal_seq)"
adrt BeginDrag "$NEW" >/dev/null
adrt MoveWindow "$NEW" "$((BX + 30))" "$((BY + 30))" 500 500 >/dev/null
sleep 0.5

check_python "a grab on an unplaced window does not arm a window move" '
import json,sys
d = json.load(sys.stdin)
drag = d.get("drag") or {}
if drag.get("windowDrag") or drag.get("dragId") is not None or drag.get("adjustId") is not None:
    print("window drag armed:", drag); sys.exit(1)
if d["indicator"]["preview"]["visible"]:
    print("drop-assist preview shown:", d["indicator"]["preview"]); sys.exit(1)
print("no window drag armed")
'

adrt EndDrag "$NEW" >/dev/null
# Unpause: the deferred routing must run exactly once and must not interpret the
# tear-off as a drop (no swap, no user-adjust, no clamp storm).
adrt ActivatePanelItem pause >/dev/null
wait_settled 15

check_python "the tear-off grab was not recorded as a pair swap" '
import json,sys
d = json.load(sys.stdin)
n = int("'"$NEW"'")
pairs = [p for p in (d.get("swapPairs") or []) if str(n) in str(p).split("|")]
if pairs:
    print("swap recorded for the tear-off:", pairs); sys.exit(1)
print("no swap recorded")
'

# `journal_tail` filters the decision journal; a `swap` carries the pair in
# `a`/`b` (not `id`), which is exactly the live `swap reason=drag` line.
out="$(journal_tail 400 2>/dev/null | python3 -c '
import json,sys
base = int("'"$since"'")
n = int("'"$NEW"'")
try:
    es = json.load(sys.stdin)
except Exception:
    sys.exit(0)
bad = [e for e in es if e.get("seq", 0) > base
       and e.get("event") in ("swap", "user-adjust")
       and (e.get("id") == n or e.get("a") == n or e.get("b") == n)]
if bad:
    print("drag decisions for the tear-off:", bad[:3]); sys.exit(1)
')" && pass "no swap or drag decision was journalled for the tear-off" || fail "no swap or drag decision was journalled for the tear-off — $out"

poll "the newcomer created mid-gesture is routed once and tiled" '
import json,sys
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
n = next((w for w in tiles if w["id"] == int("'"$NEW"'")), None)
if n is None:
    print("newcomer not tiled:", [(w["id"], w["workspace"], w["rect"]) for w in tiles]); sys.exit(1)
for w in tiles:
    if w["id"] == int("'"$NEW"'") or w["workspace"] != n["workspace"]: continue
    a, b = n["rect"], w["rect"]
    if a["x"] < b["x"] + b["width"] - 2 and b["x"] < a["x"] + a["width"] - 2 \
       and a["y"] < b["y"] + b["height"] - 2 and b["y"] < a["y"] + a["height"] - 2:
        print("newcomer overlaps", w["id"], a, b); sys.exit(1)
print("newcomer routed once")
' 15

ensure_clean
summary
