#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# A167 §3.1 `screens-changed` bounce: a topology change must leave a window
# owned by exactly one screen plan, and that plan must be stable — the recorder
# caught a window alternating between the clamp-to-screen target and the tiler's
# plan on a monitor change (`resize_retry reason=clamp-to-screen` on two
# different rects, `self-unmaximize`, `stubborn`). The one-owner rule (§1.2,
# §9, §35) says the clamp and the tiler must agree across a replan, so this
# scenario places a window hard against the seam (the clamp's own edge case),
# replans the topology, and then measures stability rather than a single frame:
# the geometry is identical across two settles, the window is not stubborn, and
# neither the clamp nor the retry decisions keep arriving after the settle.
#
# Two screens are required; on any other count the same rules are exercised by
# the matrix runs, so it skips with a reason (the A105/A109 convention). Marked
# multi-monitor-only in tests/agent/smoke-multi.list.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

screens="$(screen_count)"
if [ "$screens" -ne 2 ]; then
  skip "A167-screens-change-one-plan: needs exactly 2 screens (this harness has $screens)"
  exit 0
fi

# New decisions for one window since a mark: the retry/refusal/clamp ladder that
# the bounce produced. Counted from the shared sequence so earlier scenarios on
# this worker cannot contribute.
decisions_since() { # mark id
  decisions_json 3000 | python3 -c '
import json, sys
entries = json.load(sys.stdin)
mark, wid = int("'"$1"'"), int("'"$2"'")
counts = {"resize_retry": 0, "stubborn": 0, "self-unmaximize": 0, "clamp": 0}
for e in entries:
    if e.get("seq", 0) <= mark:
        continue
    if e.get("ev") == "resize_retry" and e.get("id") == wid:
        counts["resize_retry"] += 1
    elif e.get("ev") == "stubborn" and e.get("id") == wid:
        counts["stubborn"] += 1
    elif e.get("ev") == "tile" and e.get("id") == wid and e.get("reason") == "self-unmaximize":
        counts["self-unmaximize"] += 1
    elif e.get("ev") == "clamp_to_screen" and e.get("id") == wid:
        counts["clamp"] += 1
print(" ".join(str(counts[k]) for k in ("resize_retry", "stubborn", "self-unmaximize", "clamp")))'
}

# Stable snapshot of one window (id, monitor, workspace, rect): the "one plan"
# the window must end in. `snapshot_geometry` already sorts by id and is
# order-independent, so comparing it across two settles is the stability test.
window_plan() { # id
  dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
w = next((w for w in d["windows"] if w["id"] == int("'"$1"'")), None)
if w is None:
    print("gone"); raise SystemExit
g = next((m for m in d["monitors"] if m["index"] == w["monitor"]), None)
print("%s@%s/%s %s,%s,%s,%s stubborn=%s" % (
    w["id"], w["monitor"], w["workspace"], w["rect"]["x"], w["rect"]["y"],
    w["rect"]["width"], w["rect"]["height"], w["stubborn"]))
'
}

ensure_clean
adrt ForgetDisplayMemory >/dev/null 2>&1 || true

open_pair
wait_settled 15
ids=($(list_ids))
if [ "${#ids[@]}" -lt 2 ]; then
  fail "the pair did not form"
  summary
  exit 0
fi
TILE="${ids[0]}"
FLOAT="${ids[1]}"
# The second window floats so it can be placed on the seam; the first stays the
# tiled owner of the primary.
adrt ToggleFloat "$FLOAT" >/dev/null
wait_settled 12

# Place the float straddling the seam (its right edge crosses into screen 1).
# The clamp owns the out-of-bounds frame and pulls it back to its own monitor:
# exactly one plan, with its right edge on the seam. The `clamped` flag is only
# true for the pass that acted and is cleared on the next one, so the counter
# rising is the reliable signal that the pass ran; the geometry check below
# proves the result. The base is captured *before* the move because the clamp
# can fire inside the same drain that applies the move.
clamps_before="$(counter clampsApplied)"
adrt MoveWindow "$FLOAT" 900 40 640 700 >/dev/null
clamp_grew() {
  local base="$1" deadline=$((SECONDS + 20)) now
  while [ "$SECONDS" -lt "$deadline" ]; do
    now="$(counter clampsApplied)"
    case "$now" in
      ''|*[!0-9]*) : ;;
      *) [ "$now" -gt "$base" ] 2>/dev/null && return 0 ;;
    esac
    sleep 0.5
  done
  return 1
}
if clamp_grew "$clamps_before"; then
  pass "the seam-straddling float is pulled back by the one owner"
else
  fail "the seam-straddling float was never clamped by the one owner (counter stayed $clamps_before)"
fi
wait_settled 12

float_plan="$(window_plan "$FLOAT")"
tile_plan="$(window_plan "$TILE")"
echo "before the topology change: float [$float_plan] tile [$tile_plan]"

# The premise: one owner. The float is inside exactly one monitor's work area.
check_python "the seam-straddling float ends inside exactly one monitor" '
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d["windows"] if x["id"] == int("'"$FLOAT"'")), None)
if w is None:
    print("float gone"); sys.exit(1)
inside = []
for m in d["monitors"]:
    a = m.get("workArea") or m["geometry"]
    r = w["rect"]
    if r["x"] >= a["x"] - 2 and r["y"] >= a["y"] - 2 and r["x"] + r["width"] <= a["x"] + a["width"] + 2 and r["y"] + r["height"] <= a["y"] + a["height"] + 2:
        inside.append(m["index"])
print("inside monitors", inside, "rect", w["rect"])
sys.exit(0 if len(inside) == 1 else 1)
'

# Two settles must yield the identical geometry (the window is not bouncing).
if wait_settled 12 && first="$(snapshot_geometry)" && wait_settled 12 && [ "$(snapshot_geometry)" = "$first" ]; then
  pass "the layout is identical across two settles before the change"
else
  fail "the layout was not stable across two settles before the change"
fi

mark="$(decisions_json 3000 | python3 -c 'import json,sys; e=json.load(sys.stdin); print(e[-1]["seq"] if e else 0)')"

# The topology change. A real monitor signal is the honest trigger the Shell
# itself emits (`monitors-changed`/`workareas-changed`); it re-reads the live
# screens and replans without pretending the geometry changed.
assert_true "the injected topology change is accepted" "$(adrt InjectSignal screens-changed '' | python3 "$PARSE")"
wait_settled 15

# Stability after the change, measured twice.
if wait_settled 12 && changed="$(snapshot_geometry)" && wait_settled 12 && [ "$(snapshot_geometry)" = "$changed" ]; then
  pass "the layout is identical across two settles after the topology change"
else
  fail "the layout was not stable across two settles after the topology change"
fi

check_python "the float is still in exactly one plan after the change" '
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d["windows"] if x["id"] == int("'"$FLOAT"'")), None)
if w is None:
    print("float gone"); sys.exit(1)
if w["stubborn"]:
    print("float went stubborn", w["rect"]); sys.exit(1)
a = next((m.get("workArea") or m["geometry"] for m in d["monitors"] if m["index"] == w["monitor"]), None)
r = w["rect"]
ok = a is not None and r["x"] >= a["x"] - 2 and r["y"] >= a["y"] - 2 and r["x"] + r["width"] <= a["x"] + a["width"] + 2 and r["y"] + r["height"] <= a["y"] + a["height"] + 2
print("float monitor", w["monitor"], "rect", r, "stubborn", w["stubborn"])
sys.exit(0 if ok else 1)
'

# A settle window in which no retry, refusal or self-unmaximize may still be
# arriving: the counters are frozen, not merely low.
read -r rr st su cl <<<"$(decisions_since "$mark" "$FLOAT")"
assert_num "no resize_retry for the float after the change" "==" "$rr" "0"
assert_num "no stubborn record for the float after the change" "==" "$st" "0"
assert_num "no self-unmaximize for the float after the change" "==" "$su" "0"

# The clamp counter must not keep growing after the settle: the seam float is
# inside its screen now, so no pass has anything to pull back.
clamps_a="$(counter clampsApplied)"
sleep 4
clamps_b="$(counter clampsApplied)"
assert_num "no clamp keeps firing after the settle" "==" "$((clamps_b - clamps_a))" "0"

# The strong version of "one owner": remove the secondary entirely. The float
# must be rescued to the primary as one plan, stable, and never stubborn.
mark="$(decisions_json 3000 | python3 -c 'import json,sys; e=json.load(sys.stdin); print(e[-1]["seq"] if e else 0)')"
fixture="$(screens_fixture 1)"
assert_true "the screen list shrinks to the primary" "$(adrt SimulateScreens "$fixture" | python3 "$PARSE")"
wait_settled 15

check_python "the rescued float is a single stable plan on the primary" '
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d["windows"] if x["id"] == int("'"$FLOAT"'")), None)
if w is None:
    print("float gone"); sys.exit(1)
if w["monitor"] != 0:
    print("not on the primary", w["monitor"], w["rect"]); sys.exit(1)
if w["stubborn"]:
    print("stubborn after rescue", w["rect"]); sys.exit(1)
a = next((m.get("workArea") or m["geometry"] for m in d["monitors"] if m["index"] == 0), None)
r = w["rect"]
ok = a is not None and r["x"] >= a["x"] - 2 and r["y"] >= a["y"] - 2 and r["x"] + r["width"] <= a["x"] + a["width"] + 2 and r["y"] + r["height"] <= a["y"] + a["height"] + 2
print("rescued float", w["monitor"], r)
sys.exit(0 if ok else 1)
'

if wait_settled 12 && rescue="$(snapshot_geometry)" && wait_settled 12 && [ "$(snapshot_geometry)" = "$rescue" ]; then
  pass "the rescued layout is identical across two settles"
else
  fail "the rescued layout was not stable across two settles"
fi
read -r rr st su cl <<<"$(decisions_since "$mark" "$FLOAT")"
assert_num "no resize_retry for the rescued float" "==" "$rr" "0"
assert_num "no self-unmaximize for the rescued float" "==" "$su" "0"

adrt SimulateScreens null >/dev/null 2>&1 || true
ensure_clean
summary
