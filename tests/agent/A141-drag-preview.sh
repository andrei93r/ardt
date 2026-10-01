#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A141 Drop-assist preview: while a window is dragged, a translucent overlay
# outlines the exact rect it will land in — the model's own drag decision, not a
# second policy — drawn in the active-window accent colour. It hides at the drop.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
# Pin the accent so the resolved colour is deterministic.
set_setting indicator-color accent
set_system_setting org.gnome.desktop.interface accent-color orange

open_pair
ids=($(list_ids))
a="${ids[0]}"
b="${ids[1]}"

read -r AX AY AW AH BX BY BW BH <<<"$(dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
by={w["id"]:w["rect"] for w in d["windows"]}
a=by[int("'"$a"'")]
b=by[int("'"$b"'")]
print(a["x"],a["y"],a["width"],a["height"],b["x"],b["y"],b["width"],b["height"])
')"
# Drag a over b, so its perimeter crosses b and the drop swaps the pair.
NX=$((BX - 4))

adrt BeginDrag "$a" >/dev/null
adrt MoveWindow "$a" "$NX" "$AY" "$BW" "$BH" >/dev/null

if wait_python 10 '
import json, sys
sys.exit(0 if json.load(sys.stdin)["indicator"]["preview"]["visible"] else 1)'; then
  pass "the drop preview appears while the window is dragged"
else
  fail "the drop preview never appeared"
fi

check_python "the preview outlines the tile the drop will land in" '
import json, sys
d = json.load(sys.stdin)
preview = d["indicator"]["preview"]
if not preview["visible"]:
    print("preview not visible"); sys.exit(1)
rects = {w["id"]: w["rect"] for w in d["windows"]}
target = rects[int("'"$b"'")]
r = preview["rect"]
for key in ("x", "y", "width", "height"):
    if abs(r[key] - target[key]) > 4:
        print(key, r[key], "expected", target[key]); sys.exit(1)
print(r)
'

check_python "the preview uses the same resolved accent as the active-window border" '
import json, sys
i = json.load(sys.stdin)["indicator"]
if i["preview"]["colour"].lower() != i["color"].lower():
    print("preview", i["preview"]["colour"], "border", i["color"]); sys.exit(1)
if i["color"].lower() != "#ed5b00":
    print("accent not resolved:", i["color"]); sys.exit(1)
print(i["color"])
'

adrt EndDrag "$a" >/dev/null
if wait_python 10 '
import json, sys
sys.exit(0 if not json.load(sys.stdin)["indicator"]["preview"]["visible"] else 1)'; then
  pass "the drop preview hides when the drag ends"
else
  fail "the drop preview stayed visible after the drop"
fi

ensure_clean
summary
