#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A123 Session modes (§19): lock pauses new work but lets the queue finish what
# it holds, then retiles once on resume; screen sharing is ignored unless
# `pause-during-sharing` is on, in which case it pauses and hides the highlight;
# suspend is treated as lock.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_settled 12

# --- screen sharing: ignored unless opted in ------------------------------
assert_eq "sharing is ignored while the option is off" "false" "$(state_expr 'str(d["pauseDuringSharing"]).lower()')"
adrt SimulateSessionMode screen-sharing >/dev/null
wait_settled 12
assert_eq "sharing does not pause while the option is off" "false" "$(state_expr 'str(d["paused"]).lower()')"
assert_true "the highlight stays while sharing is ignored" "$(border_visible)"
assert_eq "tiling continues while sharing is ignored" "2" "$(count_windows)"

set_setting pause-during-sharing true
adrt SimulateSessionMode user >/dev/null
wait_settled 12
adrt SimulateSessionMode screen-sharing >/dev/null
wait_settled 12
assert_eq "sharing pauses once opted in" "true" "$(state_expr 'str(d["paused"]).lower()')"
assert_eq "sharing hides the highlight once opted in" "false" "$(border_visible)"

adrt SimulateSessionMode user >/dev/null
wait_border_visible 20 || true
assert_true "the highlight returns after sharing" "$(border_visible)"
set_setting pause-during-sharing false

# --- suspend is lock ------------------------------------------------------
adrt SimulateSessionMode suspend >/dev/null
sleep 1
assert_eq "suspend pauses like lock" "true" "$(state_expr 'str(d["paused"]).lower()')"
assert_eq "suspend hides the highlight" "false" "$(border_visible)"

adrt SimulateSessionMode user >/dev/null
wait_settled 12
assert_eq "resumed after suspend" "false" "$(state_expr 'str(d["paused"]).lower()')"

# --- lock: the queue finishes what it holds, new work is refused ----------
depth="$(adrt SimulateBurst 6 lock-backlog | python3 "$PARSE")"
assert_eq "the backlog was queued" "1" "$depth"
adrt SimulateSessionMode unlock-dialog >/dev/null

if wait_python 15 'import json,sys; sys.exit(0 if json.load(sys.stdin)["perfStats"]["queueDepth"] == 0 else 1)'; then
  pass "the queue finished the work it held while paused"
else
  fail "the queue did not finish its backlog (depth $(state_expr 'd["perfStats"]["queueDepth"]'))"
fi
assert_eq "locked" "true" "$(state_expr 'str(d["paused"]).lower()')"

paused_depth="$(adrt SimulateBurst 6 during-pause | python3 "$PARSE")"
assert_eq "new work is refused while paused" "0" "$paused_depth"

# --- resume retiles once ---------------------------------------------------
adrt SimulateSessionMode user >/dev/null
wait_settled 15
assert_eq "resumed" "false" "$(state_expr 'str(d["paused"]).lower()')"
check_python "the pair is retiled after resume" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
a, b = ws[0]["rect"], ws[1]["rect"]
if a["x"] < b["x"] + b["width"] - 2 and b["x"] < a["x"] + a["width"] - 2:
    print("stacked:", a, b); sys.exit(1)
print("retiled once on resume")
'

ensure_clean
summary
