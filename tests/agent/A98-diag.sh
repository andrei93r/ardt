#!/usr/bin/env bash
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
wait_settled 12
ids=($(list_ids))
a="${ids[0]}"; b="${ids[1]}"
echo "pair: a=$(window_field "$a" rect) b=$(window_field "$b" rect) ratios=$(state_expr 'd["ratios"]')"
adrt SimulateResize "$a" "$b" 0.25 >/dev/null
wait_settled 12
echo "resize: a=$(window_field "$a" rect) ratios=$(state_expr 'd["ratios"]') retiles=$(state_expr 'd["motionRetiles"]')"
adrt Undo >/dev/null
sleep 1
echo "undo+1s: a=$(window_field "$a" rect) ratios=$(state_expr 'd["ratios"]') retiles=$(state_expr 'd["motionRetiles"]')"
sleep 5
echo "undo+6s: a=$(window_field "$a" rect) ratios=$(state_expr 'd["ratios"]') retiles=$(state_expr 'd["motionRetiles"]')"
ensure_clean
summary
