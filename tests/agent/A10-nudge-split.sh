#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A10 Nudge split: the keyboard nudge changes and saves the ratio.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.5 >/dev/null
wait_settled 12
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 1
adrt NudgeSplit right 10 >/dev/null
wait_settled 12

check_python "ratio moved away from 0.5 and was saved" '
import json, sys
d = json.load(sys.stdin)
ratios = list(d["ratios"].values())
if not ratios:
    print("no ratio saved"); sys.exit(1)
if abs(ratios[-1] - 0.5) < 0.01:
    print("ratio unchanged"); sys.exit(1)
print("ratio", round(ratios[-1], 3))
'

# The 95% limit: a further nudge right changes nothing and is announced.
adrt NudgeSplit right 50 >/dev/null
wait_settled 12
limited="$(adrt NudgeSplit right 50 | python3 "$PARSE")"
assert_eq "NudgeSplit at the 95% limit reports no change" "false" "$limited"
check_python "the nudge ratio never exceeds the 95% limit" '
import json, sys
ratios = list(json.load(sys.stdin)["ratios"].values())
if not ratios or max(ratios) > 0.9501:
    print("ratios", ratios); sys.exit(1)
print("ratio", round(max(ratios), 3))
'
if wait_for 8 bash -c "bash '$NESTED' dbus DumpDecisions 400 | python3 '$PARSE' | python3 -c \"
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get('event') == 'notice' and e.get('key') == 'resize-limit' for e in entries) else 1)\""; then
  pass "a nudge already at the limit is announced"
else
  fail "no resize-limit notice was raised by the nudge"
fi

ensure_clean
summary
