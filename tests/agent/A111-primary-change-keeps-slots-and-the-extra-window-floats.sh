#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A111 §9 primary change (decision 67): the primary is read from GNOME, never
# set. When it changes, no window moves between screens; the pair keeps its
# slots and the extra window from the old primary's other workspace floats.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# This scenario describes 2 screens; on another
# count the same rules are exercised by the matrix runs, so skip with a reason.
screens="$(screen_count)"
if [ "$screens" -ne 2 ]; then
  skip "A111-primary-change-keeps-slots-and-the-extra-window-floats: needs exactly 2 screens (this harness has $screens)"
  exit 0
fi

ensure_clean
monitors="$(state_expr 'len(d["monitors"])')"
if [ "${monitors:-1}" -lt 2 ]; then
  skip "A111 needs two monitors to exercise a primary change"
  summary
  exit 0
fi

open_pair
# A third window overflows onto a fresh workspace of the primary.
spawn_window >/dev/null
wait_count 3 20 || true
wait_settled 15
wait_python 20 '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"]]
sys.exit(0 if len(ws) >= 3 and len({w["workspace"] for w in ws}) >= 2 else 1)' || true

pair="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["maximized"] and w["layer"] != 2]
if len(ws) < 2:
    print("-1 -1"); raise SystemExit
ws.sort(key=lambda w: w["rect"]["x"])
print(ws[0]["id"], ws[1]["id"])
')"
read -r A B <<<"$pair"
if [ "$A" = "-1" ]; then
  fail "the pair did not form before the primary change"
  summary
  exit 0
fi

# The view must be on the pair's workspace: routing the third window switched it
# to the new workspace, and decision 67 keeps the *viewed* pair and floats the
# others. Bring the view back to the pair and wait for the switch, not a clock.
adrt ActivateWorkspace 0 >/dev/null
wait_python 10 "import json,sys; sys.exit(0 if json.load(sys.stdin)['activeWorkspace'] == 0 else 1)" || true

fixture="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
mons = sorted(d["monitors"], key=lambda m: m["geometry"]["x"])
out = []
for m in mons:
    g = m["geometry"]
    a = m.get("workArea") or g
    out.append({
        "index": m["index"], "connector": m["connector"],
        "x": g["x"], "y": g["y"], "width": g["width"], "height": g["height"],
        "isPrimary": not m["isPrimary"], "workArea": a,
    })
print(json.dumps(out))
')"
adrt SimulateScreens "$fixture" >/dev/null

poll "the pair keeps its slots and the extra window floats over it" '
import json, sys
d = json.load(sys.stdin)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not a or not b:
    print("pair window gone"); sys.exit(1)
if a[0]["layer"] == 2 or b[0]["layer"] == 2:
    print("a pair member floated"); sys.exit(1)
if a[0]["slot"] is None or b[0]["slot"] is None:
    print("pair lost its slots", a[0]["slot"], b[0]["slot"]); sys.exit(1)
if a[0]["slot"] != 0 or b[0]["slot"] != 1:
    print("slots changed", a[0]["slot"], b[0]["slot"]); sys.exit(1)
pair_ws = {a[0]["workspace"], b[0]["workspace"]}
others = [w for w in d["windows"] if w["id"] not in (int("'"$A"'"), int("'"$B"'"))]
if not others:
    print("the extra window vanished"); sys.exit(1)
if not any(w["layer"] == 2 for w in others):
    print("the extra window did not float", [(w["id"], w["layer"]) for w in others]); sys.exit(1)
print("pair slots", a[0]["slot"], b[0]["slot"], "extra floats")
' 25

adrt SimulateScreens null >/dev/null
ensure_clean
summary
