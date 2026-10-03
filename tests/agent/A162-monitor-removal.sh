#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A162 §Shell stability: no stale monitor index. After a topology change (a
# monitor removed), index-based Mutter calls must never be made with an index
# the live monitor list no longer holds — the compositor asserts in C (and for
# `move_to_monitor` bails out entirely), outside anything JS can catch.
#
# The scenario shrinks the screen list with `SimulateScreens` while a window
# sits on the removed screen, and the surviving screen carries an index that is
# NOT in the live compositor list — exactly what a stale/renumbered cache hands
# a plan mid-transition (a real unplug renumbers the survivors, and a plan
# computed against the old numbering is out of range). adrt must skip the
# Mutter call, never assert. A real gdctl unplug is not used here: the nested
# compositor logs its own window-migration criticals for a window on a removed
# monitor regardless of adrt, which would make the gate nondeterministic.
#
# It fails before the fix: the pre-fix plan calls `move_to_monitor` with the
# stale index and Mutter aborts (`meta_window_get_work_area_for_logical_monitor:
# assertion failed`, "Bail out!").
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

LOG_FILE="${ADRT_STATE_DIR:-${XDG_RUNTIME_DIR:-/tmp}/adrt-nested}/shell.log"

screens="$(screen_count)"
if [ "$screens" -ne 2 ]; then
  skip "A162-monitor-removal: needs exactly 2 screens (this harness has $screens)"
  exit 0
fi

ensure_clean
spawn_window >/dev/null
wait_count 1 20 || true
A="$(list_ids)"
# A window on the non-primary screen, which the shrink below removes.
primary="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(next((m["index"] for m in d["monitors"] if m["isPrimary"]), 0))')"
if [ "$primary" -eq 0 ]; then target=1; dir=right; else target=0; dir=left; fi
if ! move_to_monitor "$A" "$target" "$dir"; then
  skip "A162-monitor-removal: could not put a window on the monitor about to be removed"
  ensure_clean
  summary
  exit 0
fi
pass "a window sits on the monitor the shrink removes"

mark="$(wc -c < "$LOG_FILE")"

# Shrink to the primary alone, but under a stale index the live list does not
# hold (a renumbered surviving screen): the plan must route the window there
# without ever passing that index to the compositor.
fixture="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
m = next(m for m in d["monitors"] if m["isPrimary"])
g = m["geometry"]; a = m.get("workArea") or g
print(json.dumps([{
    "index": 99, "connector": m["connector"],
    "x": g["x"], "y": g["y"], "width": g["width"], "height": g["height"],
    "isPrimary": True, "workArea": a,
}]))')"
assert_true "the shrink fixture applies" "$(adrt SimulateScreens "$fixture" | python3 "$PARSE")"
sleep 4

delta="$(tail -c +"$((mark + 1))" "$LOG_FILE")"
assert_banned() {
  local label="$1" pattern="$2"
  if printf '%s' "$delta" | grep -aqE "$pattern"; then
    fail "$label"
    printf '%s' "$delta" | grep -aE "$pattern" | head -4
  else
    pass "$label"
  fi
}
assert_banned "no stale logical-monitor index assertion" 'meta_monitor_manager_get_logical_monitor_from_number: assertion'
assert_banned "no stale work-area monitor assertion" 'meta_workspace_get_work_area_for_monitor: assertion'
assert_banned "the compositor did not bail out" 'Bail out|meta_window_get_work_area_for_logical_monitor'
assert_banned "no adrt error across the shrink" '\[adrt\] ERROR'

# The extension survived the stale-index plan and still answers.
assert_true "the extension still answers after the stale-index shrink" "$(adrt DumpState | python3 "$PARSE" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("format") == "adrt.state" else 1)' && echo true || echo false)"
assert_eq "the window is still tracked" "1" "$(count_windows)"

adrt SimulateScreens null >/dev/null 2>&1 || true
ensure_clean
summary
