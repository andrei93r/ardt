#!/usr/bin/env bash
# A28 Screen sharing: the indicator hides but tiling continues.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 1

adrt SimulateSessionMode screen-sharing >/dev/null
sleep 2
assert_eq "not paused while sharing" "false" "$(state_expr 'str(d["paused"]).lower()')"
assert_eq "border hidden while sharing" "false" "$(border_visible)"
assert_eq "tiling continues" "2" "$(count_windows)"

adrt SimulateSessionMode user >/dev/null
sleep 2
assert_true "border returns after sharing stops" "$(border_visible)"

ensure_clean
summary
