#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A150 An application drag-and-drop — a Chrome tab tear-off, a VS Code
# editor-tab or panel drag, a GTK DnD — holds the pointer button but starts no
# Meta window move/resize grab. adrt must not read it as a window move: no
# move/drag state, no drop interpretation (no bogus pair swap), no preview and
# no retile storm. A window created mid-gesture is routed once when it ends.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! probe_supports injection; then
  skip "A150 app DnD: the shell was not started with ADRT_INJECT=1"
  exit 0
fi

# The journal sequence of the newest entry, so a phase counts only its own
# events even on a worker that already ran other scenarios.
journal_seq() {
  journal_tail 1 2>/dev/null | python3 -c 'import json,sys
e=json.load(sys.stdin)
print(e[-1]["seq"] if e else 0)' 2>/dev/null || echo 0
}

# `track_drag_is_not_a_move <label> <code>`: count this phase's drag-state
# events and fail on any, then run the python predicate.
no_drag_events() {
  local label="$1" since="$2" out
  out="$(journal_tail 400 2>/dev/null | python3 -c '
import json,sys
base = int("'"$since"'")
try:
    es = json.load(sys.stdin)
except Exception:
    sys.exit(0)
bad = [e for e in es if e.get("seq", 0) > base and (
    e.get("event") == "layout" and e.get("reason") == "user-adjust"
    or e.get("event") == "suppress" and e.get("reason") == "drag"
    or e.get("event") == "release" and e.get("reason") == "drag"
)]
if bad:
    print("drag-state events:", [(e.get("event"), e.get("reason")) for e in bad[:4]])
    sys.exit(1)
')" && pass "$label" || fail "$label — $out"
}

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
wait_settled 15

read -r AX AY AW AH BX BY BW BH <<<"$(dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
ws=sorted([w for w in d["windows"] if w["tileable"]], key=lambda w: w["rect"]["x"])
print(*[ws[0]["rect"][k] for k in ("x","y","width","height")],
      *[ws[1]["rect"][k] for k in ("x","y","width","height")])
')"

# --- Part 1: the application moves a tracked window under a held button. ---
since="$(journal_seq)"
# Press in A's client area (never a titlebar or edge, which would start a real
# compositor grab), then let the app reposition A as it would a torn-off tab.
inject_pointer "$((AX + AW / 2))" "$((AY + AH / 2))"
sleep 0.4
adrt InjectPointerButton 1 true >/dev/null 2>&1 || true
sleep 0.4
for i in 1 2 3 4 5 6; do
  adrt MoveWindow "$A" "$((BX - 4 - i * 4))" "$((AY + i * 12))" "$BW" "$BH" >/dev/null 2>&1 || true
  sleep 0.15
done
# ADJUST_SETTLE_MS is 150 ms: a mistaken user-adjust would have interpreted and
# applied a drop (the pair would have swapped) well within this window.
sleep 1.5

check_python "an app DnD does not enter adrt's window-move drag state" '
import json,sys
d=json.load(sys.stdin)
drag=d.get("drag") or {}
if drag.get("windowDrag"): print("windowDrag set:", drag); sys.exit(1)
if drag.get("adjustId") is not None: print("adjustId set:", drag); sys.exit(1)
if "drag" in (d["indicator"].get("suppressed") or []): print("drag border suppression"); sys.exit(1)
if d["indicator"]["preview"]["visible"]: print("preview shown"); sys.exit(1)
print("no window drag; clientInteraction=%s displayGrab=%s" % (drag.get("clientInteraction"), drag.get("displayGrab")))
'

check_python "the app DnD did not swap the pair" '
import json,sys
d=json.load(sys.stdin)
by={w["id"]:w["rect"]["x"] for w in d["windows"]}
a=by.get(int("'"$A"'"), 1 << 30)
b=by.get(int("'"$B"'"), -1)
if not (a < b): print("swapped:", by); sys.exit(1)
print("pair unswapped (A x=%s < B x=%s)" % (a, b))
'

no_drag_events "no drag state or user-adjust was journalled" "$since"

# Release: the freeze lifts and the layout settles back into the unswapped pair.
adrt InjectPointerButton 1 false >/dev/null 2>&1 || true
poll "after the app DnD the pair re-settles unswapped and flush" '
import json,sys
d=json.load(sys.stdin)
tiles=[w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(tiles) != 2: print("tiles", len(tiles)); sys.exit(1)
ws=sorted(tiles, key=lambda w: w["rect"]["x"])
a, b = ws[0]["rect"], ws[1]["rect"]
if a["x"] + a["width"] > b["x"] + 2: print("overlap:", a, b); sys.exit(1)
if abs(a["height"] - b["height"]) > 4: print("not full-height:", a, b); sys.exit(1)
sys.exit(0)
' 15

check_python "the pair did not end up swapped" '
import json,sys
d=json.load(sys.stdin)
by={w["id"]:w["rect"]["x"] for w in d["windows"]}
if not (by.get(int("'"$A"'"), 1 << 30) < by.get(int("'"$B"'"), -1)):
    print("swapped:", by); sys.exit(1)
print("sides preserved")
'

# --- Part 2: a window created mid-gesture is routed once, after the DnD. ---
ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
wait_settled 15

read -r AX AY AW AH <<<"$(dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
ws=sorted([w for w in d["windows"] if w["tileable"]], key=lambda w: w["rect"]["x"])
a=ws[0]["rect"]
print(a["x"], a["y"], a["width"], a["height"])
')"
ids_before="$(list_ids)"
since="$(journal_seq)"

inject_pointer "$((AX + AW / 2))" "$((AY + AH / 2))"
sleep 0.4
adrt InjectPointerButton 1 true >/dev/null 2>&1 || true
sleep 0.4
# The tear-off: the app opens a new window under the held pointer.
spawn_window >/dev/null
wait_count 3 15 || true
NEW="$(dump | python3 -c '
import json,sys
before=set("'"$ids_before"'".split())
d=json.load(sys.stdin)
new=[str(w["id"]) for w in d["windows"] if str(w["id"]) not in before]
print(new[0] if new else "")')"
if [ -n "$NEW" ]; then
  for i in 1 2 3 4; do
    adrt MoveWindow "$NEW" "$((BX + i * 6))" "$((AY + i * 14))" 500 500 >/dev/null 2>&1 || true
    sleep 0.15
  done
fi
sleep 1.5

check_python "a window opening mid-gesture does not set the window-move drag state" '
import json,sys
d=json.load(sys.stdin)
drag=d.get("drag") or {}
if drag.get("windowDrag") or drag.get("adjustId") is not None:
    print("windowDrag:", drag); sys.exit(1)
if d["indicator"]["preview"]["visible"]: print("preview shown"); sys.exit(1)
print("no window drag")
'

no_drag_events "no drag state was journalled while the newcomer appeared" "$since"

adrt InjectPointerButton 1 false >/dev/null 2>&1 || true

if [ -n "$NEW" ]; then
  poll "the newcomer created mid-gesture is routed once and tiled" '
import json,sys
d=json.load(sys.stdin)
tiles=[w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
n=next((w for w in tiles if w["id"] == int("'"$NEW"'")), None)
if n is None: print("newcomer not tiled:", [(w["id"], w["workspace"], w["rect"]) for w in tiles]); sys.exit(1)
# It must not be stacked on a window sharing its workspace.
for w in tiles:
    if w["id"] == int("'"$NEW"'") or w["workspace"] != n["workspace"]: continue
    a, b = n["rect"], w["rect"]
    if a["x"] < b["x"] + b["width"] - 2 and b["x"] < a["x"] + a["width"] - 2 \
       and a["y"] < b["y"] + b["height"] - 2 and b["y"] < a["y"] + a["height"] - 2:
        print("newcomer overlaps", w["id"], a, b); sys.exit(1)
sys.exit(0)
' 15
fi

ensure_clean
summary
