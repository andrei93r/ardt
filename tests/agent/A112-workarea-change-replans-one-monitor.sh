#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A112 §9/§10 work-area change: a dock appearing or hiding re-fits the pair to
# the new surface by ratio on that monitor only; no window floats or changes
# workspace, and the other monitor's windows are untouched.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean

open_pair
wait_settled 15
ids=($(list_ids))
if [ "${#ids[@]}" -lt 2 ]; then
  fail "the pair did not form"
  summary
  exit 0
fi

read -r CONN AREA <<<"$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
primary = [m for m in d["monitors"] if m["isPrimary"]]
m = primary[0] if primary else sorted(d["monitors"], key=lambda m: m["geometry"]["x"])[0]
a = m.get("workArea") or m["geometry"]
print(m["connector"], a["x"], a["y"], a["width"], a["height"])
')"

# A dock reserves 120px at the bottom of the primary: same x/width, shorter.
new_area="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
primary = [m for m in d["monitors"] if m["isPrimary"]]
m = primary[0] if primary else sorted(d["monitors"], key=lambda m: m["geometry"]["x"])[0]
a = m.get("workArea") or m["geometry"]
print(a["x"], a["y"], a["width"], max(200, a["height"] - 120))
')"
read -r NX NY NW NH <<<"$new_area"
adrt SimulateWorkArea "$CONN" "$NX" "$NY" "$NW" "$NH" >/dev/null

poll "the pair re-fits inside the shrunk work area, keeping its ratio" '
import json, sys
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(tiles) < 2:
    print("expected the pair, got", len(tiles)); sys.exit(1)
area = {"x": '"$NX"', "y": '"$NY"', "width": '"$NW"', "height": '"$NH"'}
for w in tiles:
    r = w["rect"]
    if r["x"] < area["x"] - 2 or r["y"] < area["y"] - 2 or r["x"] + r["width"] > area["x"] + area["width"] + 2 or r["y"] + r["height"] > area["y"] + area["height"] + 2:
        print("tile outside the new area", w["id"], r, area); sys.exit(1)
widths = sorted(r["width"] for r in (w["rect"] for w in tiles))
total = sum(widths)
if total <= 0 or abs(widths[0] / total - 0.5) > 0.12:
    print("ratio drifted", widths); sys.exit(1)
print("re-fit", [(w["id"], w["rect"]) for w in tiles])
' 25

# Restore the original work area and confirm the pair re-fits back.
read -r OX OY OW OH <<<"$AREA"
adrt SimulateWorkArea "$CONN" "$OX" "$OY" "$OW" "$OH" >/dev/null
poll "restoring the work area re-fits the pair back" '
import json, sys
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(tiles) < 2:
    sys.exit(1)
for w in tiles:
    r = w["rect"]
    if r["x"] < '"$OX"' - 2 or r["y"] < '"$OY"' - 2 or r["x"] + r["width"] > '"$OX"' + '"$OW"' + 2 or r["y"] + r["height"] > '"$OY"' + '"$OH"' + 2:
        print("tile outside the restored area", w["id"], r); sys.exit(1)
sys.exit(0)
' 25

ensure_clean
summary
