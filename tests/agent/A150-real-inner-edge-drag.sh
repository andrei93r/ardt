#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A150 A *real* drag (grab-op begin/end) on a pair's shared inner edge is a
# split-ratio change (§10/§12), not a free resize. `endDrag` clears the shared
# drag-start rect before the deferred drain interprets the gesture, so the
# resize used to be read as a plain move and the pair reflowed to the old
# ratio — the window snapped back. A floating window is different: it is not
# managed, so the same drag must resize it freely and the clamp-to-screen pass
# must leave it alone while it stays inside the monitor.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
wait_settled 15

# Left/right tiles, the left one's frame and the pair's horizontal span.
read -r LID LX LY LW LH SPAN <<<"$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ws = sorted(
    [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2],
    key=lambda w: w["rect"]["x"],
)
l, r = ws[0], ws[1]
lr, rr = l["rect"], r["rect"]
print(l["id"], lr["x"], lr["y"], lr["width"], lr["height"], (rr["x"] + rr["width"]) - lr["x"])
')"

# Shrink the left tile so its right (inner) edge lands at ~30% of the span,
# exactly as a user dragging the shared boundary would.
new_w=$(( SPAN * 30 / 100 ))
adrt BeginDrag "$LID" >/dev/null
adrt MoveWindow "$LID" "$LX" "$LY" "$new_w" "$LH" >/dev/null
sleep 1
adrt EndDrag "$LID" >/dev/null

# Let the released gesture's drain run: on the unfixed build the pair reflows
# back to the old 50/50 ratio here (the snap-back), so a settled read is what
# tells the saved split from the transient drag frame.
wait_settled 15

poll "a real inner-edge drag moves the split to roughly 30/70" '
import json, sys
d = json.load(sys.stdin)
ws = sorted(
    [w["rect"] for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2],
    key=lambda r: r["x"],
)
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
total = ws[0]["width"] + ws[1]["width"]
ratio = ws[0]["width"] / total
if abs(ratio - 0.3) > 0.12:
    print("ratio", round(ratio, 2), ws); sys.exit(1)
print("ratio", round(ratio, 2))
' 25

check_python "the dragged split ratio persisted" '
import json, sys
if not json.load(sys.stdin)["ratios"]:
    print("no saved ratio"); sys.exit(1)
print("saved")
'

# §16: a float is unmanaged — a hand resize must stick (no clamp/re-apply).
adrt ToggleFloat "$LID" >/dev/null 2>&1 || true
wait_settled 12

adrt BeginDrag "$LID" >/dev/null
adrt MoveWindow "$LID" 120 100 420 360 >/dev/null
sleep 1
adrt EndDrag "$LID" >/dev/null
wait_settled 8

check_python "a floating window keeps the size it was dragged to" '
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d["windows"] if x["id"] == int("'"$LID"'")), None)
if w is None:
    print("window gone"); sys.exit(1)
r = w["rect"]
if (abs(r["x"] - 120) > 4 or abs(r["y"] - 100) > 4
        or abs(r["width"] - 420) > 4 or abs(r["height"] - 360) > 4):
    print("float resized away from the drag:", r); sys.exit(1)
print("float kept", r)
'

ensure_clean
summary
