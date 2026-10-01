#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A28 Screen sharing (§19): sharing is ignored entirely while
# `pause-during-sharing` is off (the default); with it on, sharing pauses
# tiling and hides the highlight, then resumes on the way back to `user`.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_settled 12
wait_border_visible 20 || true

# --- default: off means ignored -------------------------------------------
assert_eq "pause-during-sharing defaults off" "false" "$(state_expr 'str(d["pauseDuringSharing"]).lower()')"
adrt SimulateSessionMode screen-sharing >/dev/null
wait_settled 12
assert_eq "sharing does not pause while the option is off" "false" "$(state_expr 'str(d["paused"]).lower()')"
assert_true "the highlight stays while sharing is ignored" "$(border_visible)"
assert_eq "tiling continues while sharing is ignored" "2" "$(count_windows)"

# --- opt-in: sharing reuses the pause path --------------------------------
set_setting pause-during-sharing true
adrt SimulateSessionMode user >/dev/null
wait_settled 12
adrt SimulateSessionMode screen-sharing >/dev/null
wait_settled 12
assert_eq "sharing pauses once opted in" "true" "$(state_expr 'str(d["paused"]).lower()')"
assert_eq "the highlight hides while sharing (opt-in)" "false" "$(border_visible)"
assert_eq "tiling is frozen while sharing (opt-in)" "2" "$(count_windows)"

# --- resume ---------------------------------------------------------------
adrt SimulateSessionMode user >/dev/null
wait_border_visible 20 || true
assert_true "border returns after sharing stops" "$(border_visible)"
assert_eq "resumed after sharing" "false" "$(state_expr 'str(d["paused"]).lower()')"

set_setting pause-during-sharing false
ensure_clean
summary
