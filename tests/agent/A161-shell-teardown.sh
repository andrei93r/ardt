#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A161 §Shell stability: extension teardown is dispose-safe. At session end the
# Shell destroys adrt's chrome actors itself (the indicator, the drop preview,
# close ghosts, the panel button) *before* `disable()` runs. This scenario
# drives the real teardown paths against chrome the Shell has already destroyed
# (`SimulateChromeTeardown` does exactly what the session end does), then
# repeats plain enable/disable cycles with live chrome present, and asserts the
# journal recorded no disposed-actor touch: no `[adrt] ERROR`, no Gjs "already
# been disposed" in adrt's frames, and no `clutter_actor_remove_child` /
# `g_closure_unref` assertion.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

LOG_FILE="${ADRT_STATE_DIR:-${XDG_RUNTIME_DIR:-/tmp}/adrt-nested}/shell.log"

# The banned patterns this scenario gates on. A "has been already disposed"
# line is only adrt's when the stack trace below it names adrt's files; the
# Shell's own teardown noise (the ibus candidate popup at shutdown) is not this
# target.
scan_banned() { # $1 = byte offset the delta starts at
  local delta banned=""
  delta="$(tail -c +"$(($1 + 1))" "$LOG_FILE")"
  if printf '%s' "$delta" | grep -aqE '\[adrt\] ERROR'; then
    banned="$banned adrt-error"
  fi
  if printf '%s' "$delta" | grep -aqE 'clutter_actor_remove_child: assertion|g_closure_unref: assertion'; then
    banned="$banned actor-assertion"
  fi
  # A ghost timer/ease removed twice is a teardown bug of its own; the GLib
  # critical it logs appears in no healthy run.
  if printf '%s' "$delta" | grep -aqE 'Source ID [0-9]+ was not found when attempting to remove it'; then
    banned="$banned double-remove"
  fi
  if printf '%s' "$delta" | grep -aA12 'has been already disposed' | grep -aq 'adrt@adrt.dev'; then
    banned="$banned disposed-touch"
  fi
  printf '%s' "$banned"
}

# The highlight follows focus; a live drag keeps the drop preview visible.
show_border_and_preview() {
  local ids id
  ids=($(list_ids))
  [ "${#ids[@]}" -ge 1 ] || return 1
  id="${ids[0]}"
  adrt ActivateWindow "$id" >/dev/null
  wait_border_visible 15 || true
  adrt BeginDrag "$id" >/dev/null
  adrt MoveWindow "$id" 320 220 640 400 >/dev/null
  wait_python 8 '
import json, sys
sys.exit(0 if json.load(sys.stdin)["indicator"]["preview"]["visible"] else 1)'
}

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
# The highlight is a derived property (focus + a settled frame); poll it with a
# settle budget like every other state assertion in the suite.
if ! wait_python 20 '
import json, sys
sys.exit(0 if json.load(sys.stdin)["border"]["visible"] else 1)'; then
  skip "A161 could not get the highlight to follow the focused window"
  ensure_clean
  summary
  exit 0
fi
pass "the highlight follows the focused window"

# A live drag keeps the drop preview on screen, and a short fade arms a close
# ghost — every chrome actor adrt owns is present for the teardown below.
adrt BeginDrag "${ids[0]}" >/dev/null
adrt MoveWindow "${ids[0]}" 320 220 640 400 >/dev/null
if ! wait_python 8 '
import json, sys
sys.exit(0 if json.load(sys.stdin)["indicator"]["preview"]["visible"] else 1)'; then
  skip "A161 could not put the drop preview on screen"
  ensure_clean
  summary
  exit 0
fi
pass "the drop preview is visible during the drag"
set_setting close-animation-duration 250
adrt CloseWindow "${ids[1]}" >/dev/null
if ! wait_python 6 '
import json, sys
sys.exit(0 if json.load(sys.stdin)["indicator"]["ghosts"] >= 1 else 1)'; then
  skip "A161 could not arm a close ghost"
  ensure_clean
  summary
  exit 0
fi
pass "a close ghost is fading"

mark="$(wc -c < "$LOG_FILE")"

# 1. The session-end ordering: the Shell destroys every chrome actor, and only
#    then `disable()` runs (the nested controller's own disable path).
assert_true "the chrome-teardown trigger runs" "$(adrt SimulateChromeTeardown | python3 "$PARSE")"
# Let the ghost's fade timer and its ease completion land on the destroyed ghost.
sleep 1.5
bash "$NESTED" disable
bash "$NESTED" enable
bash "$NESTED" wait-adrt 30 >/dev/null

# 2. Repeated plain enable/disable cycles with live chrome present again
#    (indicator + drop preview), through the same controller path.
for cycle in 1 2 3; do
  ids=($(list_ids))
  [ "${#ids[@]}" -ge 1 ] || spawn_window >/dev/null
  show_border_and_preview || true
  bash "$NESTED" disable
  bash "$NESTED" enable
  bash "$NESTED" wait-adrt 30 >/dev/null
done

# The extension is still fully alive and its chrome is back after every cycle.
assert_true "the extension still answers after the stress" "$(adrt DumpState | python3 "$PARSE" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("format") == "adrt.state" else 1)' && echo true || echo false)"
assert_eq "the panel is present again" "True" "$(state_expr 'd["panel"]["present"]')"
if wait_python 15 '
import json, sys
sys.exit(0 if json.load(sys.stdin)["border"]["visible"] else 1)'; then
  pass "the highlight returns after the stress"
else
  fail "the highlight did not return after the stress"
fi

banned="$(scan_banned "$mark")"
if [ -n "$banned" ]; then
  fail "the journal must show no disposed-actor touch (got:$banned)"
  tail -c +"$((mark + 1))" "$LOG_FILE" | grep -aB2 -aA12 'adrt\|already been disposed\|assertion' | head -40
else
  pass "the journal shows no disposed-actor touch across every disable/enable"
fi

set_setting close-animation-duration 150
ensure_clean
summary
