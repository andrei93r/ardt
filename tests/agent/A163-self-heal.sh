#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A163 Self-heal (§36): caught errors never take the Shell down; when they come
# in bursts the extension restarts itself in place; when a fault outlives the
# restart cap it self-disables cleanly with a toast — and the Shell keeps
# running throughout. Uses the existing `InjectFault` fault injection.
#
# Hard truth, stated plainly: a JS try/catch cannot catch the failures that
# actually take GNOME down (`already disposed`, `clutter_actor_remove_child`,
# `g_closure_unref`, Mutter monitor assertions are C-level) — the dispose-safe
# teardown (A161) and the monitor-index bounds (A162) prevent those. This
# scenario gates what JS *can* catch: contain, restart in place, self-disable.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_settled 12 || true

restarts="$(state_expr 'd.get("restarts", 0)')"
disables="$(state_expr 'd.get("selfDisables", 0)')"

# 1. A single caught fault is contained: counted, no restart, Shell alive.
errors_before="$(state_expr 'd.get("errors", 0)')"
assert_true "the first fault is caught" "$(adrt InjectFault drain | python3 "$PARSE")"
sleep 1
assert_num "the boundary counted the fault" ">" "$(state_expr 'd.get("errors", 0)')" "$errors_before"
assert_eq "one fault is below the restart threshold" "$restarts" "$(state_expr 'd.get("restarts", 0)')"
# P6h: the caught fault is mirrored into the bounded recent-errors ring with
# its context and a non-empty message.
recent_fault="$(state_expr 'str(any(e.get("context") == "fault-test:drain" and bool(e.get("message")) for e in d.get("recentErrors", []))).lower()')"
assert_true "the caught fault appears in recentErrors (context + message)" "$recent_fault"
assert_true "the Shell still answers after the fault" "$(adrt DumpState | python3 "$PARSE" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("format") == "adrt.state" else 1)' && echo true || echo false)"

# 2. The threshold is crossed while a drag is live: the restart is deferred
#    until the gesture ends — never cut mid-interaction.
adrt BeginDrag "${ids[0]}" >/dev/null
adrt InjectFault drain >/dev/null
adrt InjectFault signal >/dev/null
adrt InjectFault drain >/dev/null
sleep 1.5
assert_eq "no restart while the drag is live" "$restarts" "$(state_expr 'd.get("restarts", 0)')"
adrt EndDrag "${ids[0]}" >/dev/null
if wait_python 20 '
import json, sys
sys.exit(0 if json.load(sys.stdin).get("restarts", 0) > int("'"$restarts"'") else 1)'; then
  pass "the deferred restart lands once the drag ends"
else
  fail "the deferred restart never landed after the drag ended"
fi
assert_eq "exactly one restart so far" "$((restarts + 1))" "$(state_expr 'd.get("restarts", 0)')"

# 3. The Shell survives the in-place restart: the extension answers and tiling
#    still works end to end.
assert_true "the extension answers after the restart" "$(adrt DumpState | python3 "$PARSE" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("format") == "adrt.state" else 1)' && echo true || echo false)"
if grep -aq 'extension_restart' "$(history_file)" 2>/dev/null; then
  pass "the restart is journalled (extension_restart)"
else
  fail "the restart is not journalled"
fi
wait_pair_tiled 20 || true
assert_eq "tiling still works after the restart" "2" "$(count_windows)"

# 4. A persistent fault climbs the ladder: two more restarts, then the cap is
#    reached and the extension self-disables cleanly — the Shell stays alive.
inject_three() {
  adrt InjectFault drain >/dev/null 2>&1
  adrt InjectFault signal >/dev/null 2>&1
  adrt InjectFault drain >/dev/null 2>&1
}
expect_restarts() { # $1 = wanted value
  wait_python 30 "
import json, sys
sys.exit(0 if json.load(sys.stdin).get('restarts', 0) == $1 else 1)"
}
inject_three
if expect_restarts "$((restarts + 2))"; then
  pass "the second burst restarts once more"
else
  fail "the second burst did not restart (restarts=$(state_expr 'd.get("restarts", 0)'))"
fi
inject_three
if expect_restarts "$((restarts + 3))"; then
  pass "the third burst restarts (the cap)"
else
  fail "the third burst did not restart (restarts=$(state_expr 'd.get("restarts", 0)'))"
fi
# P6h: after repeated faults the ring holds exactly the last ten — it never
# grows past its bound. (`errors` counts every caught fault; the ring is the
# last min(errors, 10) of them.)
recent_bounded="$(state_expr 'str(len(d.get("recentErrors", [])) == min(d.get("errors", 0), 10)).lower()')"
assert_true "recentErrors is bounded to the last min(errors, 10)" "$recent_bounded"
inject_three
# The self-disable tears the D-Bus down synchronously; detect it by the stable
# disappearance of the name (a restart only flaps it for a moment, so a single
# failed call is not enough).
wait_self_disable() {
  local i
  for i in $(seq 1 40); do
    if adrt DumpState >/dev/null 2>&1; then
      sleep 0.5
      continue
    fi
    sleep 1
    if adrt DumpState >/dev/null 2>&1; then
      sleep 0.5
      continue
    fi
    return 0
  done
  return 1
}
if wait_self_disable; then
  pass "the outlived fault self-disables the extension"
else
  fail "the extension never self-disabled"
fi

# The self-disable tore everything down: the D-Bus is gone, the Shell is fine.
if adrt DumpState >/dev/null 2>&1; then
  fail "the extension still answers after the self-disable"
else
  pass "the self-disable stopped the extension"
fi
if bash "$NESTED" status >/dev/null 2>&1; then
  pass "the Shell is still alive after the self-disable"
else
  fail "the Shell died with the self-disable"
fi
if grep -aq 'extension_self_disable' "$(history_file)" 2>/dev/null; then
  pass "the self-disable is journalled (extension_self_disable)"
else
  fail "the self-disable is not journalled"
fi

# 5. A re-enable from the harness controller revives the extension cleanly.
bash "$NESTED" disable >/dev/null 2>&1 || true
bash "$NESTED" enable >/dev/null 2>&1
bash "$NESTED" wait-adrt 30 >/dev/null
assert_true "the extension revives after re-enable" "$(adrt DumpState | python3 "$PARSE" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("format") == "adrt.state" else 1)' && echo true || echo false)"
assert_eq "the self-disable counter stays (add-only)" "$((disables + 1))" "$(state_expr 'd.get("selfDisables", 0)')"

ensure_clean
summary
