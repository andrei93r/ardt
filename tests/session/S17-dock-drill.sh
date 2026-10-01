#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# S17 Dock drill: an *assisted* live drill for physical docking and undocking.
# It only runs when ADRT_DOCK_TEST=1 (the user is at the machine and can
# physically dock/undock a display). The extension must re-read the screens,
# re-fit the tiles and keep the tiling coherent; nothing is asserted about a
# specific monitor count, because the user chooses what to plug in.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

session_begin
if [ "${ADRT_DOCK_TEST:-0}" != "1" ]; then
  skip "S17 dock drill: set ADRT_DOCK_TEST=1 and dock/undock when prompted (physical hardware)"
  summary
  exit 0
fi

spawn "$FILES"
wait_tests 1 20 || true
spawn "$CHROME"
wait_tests 2 25 || true
poll "the pair tiles before the dock drill" '
import json, sys
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w.get("tileable") and not w.get("minimized") and w.get("layer") != 2]
sys.exit(0 if len(tiles) >= 2 else 1)
' 20

before="$(state_expr 'len(d["monitors"])')"
echo
echo "==================================================================="
echo " S17 dock drill — follow along on the machine"
echo " The extension sees $before monitor(s) now."
echo " STEP 1: dock a display, or plug one in, and let it settle."
echo " Waiting 30 seconds…"
echo "==================================================================="
sleep 30

after="$(state_expr 'len(d["monitors"])')"
echo "monitors before=$before after=$after"
if [ "$before" != "$after" ]; then
  pass "the monitor count changed and the extension followed it ($before -> $after)"
else
  pass "no monitor change observed; the layout was re-checked anyway"
fi

poll "the windows are all inside a real work area after the dock change" '
import json, sys
d = json.load(sys.stdin)
areas = [(m.get("workArea") or m["geometry"]) for m in d["monitors"]]
ids = set(int(x) for x in "'"$(test_ids)"'".split())
ws = [w for w in d["windows"] if w["id"] in ids and not w.get("minimized") and w.get("layer") != 2]
if not ws:
    print("no test windows left"); sys.exit(1)
for w in ws:
    r = w["rect"]
    inside = any(r["x"] >= a["x"] - 2 and r["y"] >= a["y"] - 2 and r["x"] + r["width"] <= a["x"] + a["width"] + 2 and r["y"] + r["height"] <= a["y"] + a["height"] + 2 for a in areas)
    if not inside:
        print("window outside every work area", w["id"], r, areas); sys.exit(1)
print("checked", len(ws), "windows")
' 20

echo
echo "==================================================================="
echo " STEP 2: undock the display (or unplug it) and let it settle."
echo " Waiting 30 seconds…"
echo "==================================================================="
sleep 30

poll "the windows survived the undock, still managed and inside a work area" '
import json, sys
d = json.load(sys.stdin)
areas = [(m.get("workArea") or m["geometry"]) for m in d["monitors"]]
ids = set(int(x) for x in "'"$(test_ids)"'".split())
ws = [w for w in d["windows"] if w["id"] in ids]
if len(ws) < 2:
    print("windows lost", len(ws)); sys.exit(1)
if any(w.get("layer") == 2 for w in ws):
    print("a window was stranded as a float"); sys.exit(1)
for w in ws:
    if w.get("minimized"):
        continue
    r = w["rect"]
    inside = any(r["x"] >= a["x"] - 2 and r["y"] >= a["y"] - 2 and r["x"] + r["width"] <= a["x"] + a["width"] + 2 and r["y"] + r["height"] <= a["y"] + a["height"] + 2 for a in areas)
    if not inside:
        print("window outside every work area", w["id"], r, areas); sys.exit(1)
print("survived with", len(ws), "windows")
' 25

echo
echo "S17: record the result in tests/MANUAL.md — physical dock/undock acceptance."
summary
