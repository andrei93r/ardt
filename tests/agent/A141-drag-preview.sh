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

# Journal marker: the highlight instrumentation (add-only `border focus` and
# `preview_show`/`preview_hide`) is asserted below for this phase only.
since="$(journal_tail 1 2>/dev/null | python3 -c 'import json,sys
e=json.load(sys.stdin)
print(e[-1]["seq"] if e else 0)' 2>/dev/null || echo 0)"

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

# Drag a back over its own origin slot. The drop there is a no-op — the window
# stays on its own tile — but the origin is still a valid landing and must be
# previewed at its own rect, not hidden.
adrt MoveWindow "$a" "$AX" "$AY" "$AW" "$AH" >/dev/null

if wait_python 10 '
import json, sys
d = json.load(sys.stdin)
p = d["indicator"]["preview"]
if not p["visible"]:
    sys.exit(1)
r = p["rect"]
want = (int("'"$AX"'"), int("'"$AY"'"), int("'"$AW"'"), int("'"$AH"'"))
got = (r["x"], r["y"], r["width"], r["height"])
sys.exit(0 if all(abs(g - w) <= 4 for g, w in zip(got, want)) else 1)'; then
  pass "the origin slot is previewed when the drag returns to it"
else
  fail "the origin slot was not previewed when the drag returned to it"
fi

adrt EndDrag "$a" >/dev/null
if wait_python 10 '
import json, sys
sys.exit(0 if not json.load(sys.stdin)["indicator"]["preview"]["visible"] else 1)'; then
  pass "the drop preview hides when the drag ends"
else
  fail "the drop preview stayed visible after the drop"
fi

# The overlay and the active-window highlight must leave a trace (§22): the new
# add-only `preview_show`/`preview_hide` and `border focus` events. Without them
# a highlight at the wrong rect or screen is invisible in the journal.
out="$(journal_tail 400 preview 2>/dev/null | python3 -c '
import json,sys
base = int("'"$since"'")
try:
    es = json.load(sys.stdin)
except Exception:
    sys.exit(0)
shows = [e for e in es if e.get("seq", 0) > base and e.get("event") == "preview_show"]
hides = [e for e in es if e.get("seq", 0) > base and e.get("event") == "preview_hide"]
if not shows:
    print("no preview_show"); sys.exit(1)
if not hides:
    print("no preview_hide"); sys.exit(1)
s = shows[-1]
if s.get("kind") not in ("swap", "slot", "float", "none", "maximize"):
    print("bad outcome kind", s); sys.exit(1)
if s.get("rect") is None or s.get("monitor") is None:
    print("no rect/monitor", s); sys.exit(1)
print("preview_show", s.get("kind"), "monitor", s.get("monitor"))
')" && pass "the drop overlay was journalled where it was drawn ($out)" || fail "the drop overlay was not journalled — $out"

out="$(journal_tail 400 border 2>/dev/null | python3 -c '
import json,sys
base = int("'"$since"'")
try:
    es = json.load(sys.stdin)
except Exception:
    sys.exit(0)
draws = [e for e in es if e.get("seq", 0) > base and e.get("source") == "border"
         and e.get("event") == "focus" and e.get("id") is not None]
if not draws:
    print("no border focus draw"); sys.exit(1)
d = draws[-1]
if d.get("rect") is None or d.get("monitor") is None:
    print("no rect/monitor", d); sys.exit(1)
print("border focus", d.get("id"), "monitor", d.get("monitor"))
')" && pass "the highlight was journalled where it was drawn ($out)" || fail "the highlight was not journalled — $out"

ensure_clean
summary
