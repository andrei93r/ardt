#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A152 A transition animates once per window. A title/frame signal can clear the
# per-workspace plan cache mid-transition; re-applying the identical plan then
# restarts the frame animation from wherever Mutter's own maximise/unmaximise
# transition has the window — the reported "overshoots, glitches and corrects
# itself". The bounded frame sampler records the animator's events so the
# scenario can assert one `start` per window, no frame activity after the
# animation ended, and monotonic motion toward the target.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# Assert the frame-sampler invariant for a single transition. `label` names the
# transition under test; the snippet reads DumpState.animRecords.
check_animation_once() {
  local label="$1"
  check_python "$label" '
import json, sys
recs = json.load(sys.stdin).get("animRecords") or []
per = {}
for r in recs:
    per.setdefault(r["id"], []).append(r)
for i, evs in per.items():
    starts = [e for e in evs if e["kind"] == "start"]
    if len(starts) > 1:
        print("window", i, "restarted its animation", len(starts), "times"); sys.exit(1)
    ended = False
    for e in evs:
        if e["kind"] == "end":
            ended = True
        elif ended and e["kind"] in ("start", "frame", "cancel"):
            print("window", i, "moved after its animation ended", e); sys.exit(1)
    frames = [e["rect"] for e in evs if e["kind"] in ("start", "frame", "end")]
    for key in ("x", "y", "width", "height"):
        vals = [f[key] for f in frames]
        nonincreasing = all(b <= a for a, b in zip(vals, vals[1:]))
        nondecreasing = all(b >= a for a, b in zip(vals, vals[1:]))
        if not (nonincreasing or nondecreasing):
            print("window", i, "non-monotonic", key, vals); sys.exit(1)
print("animations", {i: len([e for e in evs if e["kind"] == "start"]) for i, evs in per.items()},
      "events", len(recs))
'
}

ensure_clean
# The sampler only records when adrt actually animates; make sure a previous
# scenario that disabled OS animations cannot make every assertion vacuous.
set_system_setting org.gnome.desktop.interface enable-animations true
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
pair_ws="$(window_field "$A" workspace)"

# 1. Maximise a pair member; unmaximise it so it rejoins and the pair reflows.
adrt MaximizeWindow "$B" >/dev/null
wait_python 20 '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
sys.exit(0 if b and b[0]["maximized"] and b[0]["workspace"] != int("'"$pair_ws"'") else 1)' || true

adrt StartFrameRecording >/dev/null
adrt UnmaximizeWindow "$B" >/dev/null
poll "the unmaximized window rejoined the pair" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2 or len({w["workspace"] for w in ws}) != 1:
    print("tiles", [(w["id"], w["workspace"]) for w in ws]); sys.exit(1)
print("pair", [(w["id"], w["slot"]) for w in ws])
' 25
adrt StopFrameRecording >/dev/null
check_animation_once "the join animates once per window with no post-animation correction"

# 2. A split reflow animates both windows; each must be a single, monotonic run.
wait_settled 15
adrt StartFrameRecording >/dev/null
adrt SimulateResize "$A" "$B" 0.3 >/dev/null
wait_settled 15
adrt StopFrameRecording >/dev/null
check_animation_once "a split reflow animates once per window, monotonically"
poll "split moved to roughly 30/70" '
import json, sys
d = json.load(sys.stdin)
ws = [w["rect"] for w in d["windows"]]
total = sum(r["width"] for r in ws)
ratios = sorted(r["width"] / total for r in ws)
if abs(ratios[0] - 0.3) > 0.1:
    print("ratios", [round(x, 2) for x in ratios]); sys.exit(1)
print("ratios", [round(x, 2) for x in ratios])
' 30

# 3. Churn: a closed window disposes its actor; the motion sampler must
#    re-derive it from the focus, never touch the disposed one, and the Shell
#    must stay responsive (a wedged tick would time out the DumpState here).
for _ in 1 2 3; do
  before="$(list_ids)"
  spawn_window >/dev/null
  wait_count 3 15 || true
  wait_settled 15
  newest=""
  for id in $(list_ids); do
    case " $before " in *" $id "*) ;; *) newest="$id" ;; esac
  done
  [ -n "$newest" ] && close_window "$newest"
  wait_count 2 15 || true
  wait_settled 15
done
check_python "the Shell is responsive after window churn" '
import json, sys
d = json.load(sys.stdin)
if d.get("format") != "adrt.state":
    print("no state"); sys.exit(1)
print("windows", len(d["windows"]), "errors", d.get("errors"))
'

ensure_clean
summary
