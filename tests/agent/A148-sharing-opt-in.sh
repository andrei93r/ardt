#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A144 pause-during-sharing (§19): the sharing state is re-derived from the live
# session mode plus the setting, so flipping the option *while already sharing*
# takes effect immediately (no re-entry, no Mutter signal), and resuming retiles
# the pair exactly once.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_settled 12
wait_border_visible 20 || true

# 1. Sharing with the option off is ignored.
set_setting pause-during-sharing false
adrt SimulateSessionMode screen-sharing >/dev/null
wait_settled 12
assert_eq "sharing is ignored while off" "false" "$(state_expr 'str(d["paused"]).lower()')"
assert_true "the highlight stays while sharing is ignored" "$(border_visible)"

# 2. Flip the option on *while sharing*: the periodic re-derivation must pause
#    and hide the highlight without a new session-mode transition.
set_setting pause-during-sharing true
if wait_python 10 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d["paused"] and d["mode"] == "screen-sharing" and not d["border"]["visible"] else 1)'; then
  pass "turning the option on while sharing pauses at once"
else
  fail "the option did not take effect mid-sharing (paused=$(state_expr 'str(d["paused"]).lower()'))"
fi

# 3. Flip it back off while still sharing: ignored again.
set_setting pause-during-sharing false
if wait_python 10 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if not d["paused"] and d["mode"] == "screen-sharing" else 1)'; then
  pass "turning the option off while sharing resumes at once"
else
  fail "turning the option off mid-sharing did not take effect"
fi
wait_border_visible 20 || true
assert_true "the highlight returns when sharing is ignored again" "$(border_visible)"

# 4. Pause during sharing, shove a window out of place, then resume: the pair
#    must be retiled once on the way back to `user`.
set_setting pause-during-sharing true
if wait_python 10 'import json,sys; sys.exit(0 if json.load(sys.stdin)["paused"] else 1)'; then
  pass "sharing pauses again once opted in"
else
  fail "sharing did not pause on opt-in"
fi
target="${ids[0]}"
adrt MoveWindow "$target" 40 40 500 400 >/dev/null
assert_eq "the window was shoved while paused" "true" "$(state_expr "str(abs(next(w['rect']['x'] for w in d['windows'] if w['id'] == $target) - 40) <= 6).lower()")"

adrt SimulateSessionMode user >/dev/null
if wait_pair_tiled 25; then
  pass "resuming retiles the pair once"
else
  fail "the pair was not retiled after sharing"
fi
assert_eq "resumed after sharing" "false" "$(state_expr 'str(d["paused"]).lower()')"

set_setting pause-during-sharing false
ensure_clean
summary
