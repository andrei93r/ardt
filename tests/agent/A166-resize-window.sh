#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A166 Resize window: the axis-following "increase"/"decrease" shortcuts grow or
# shrink the FOCUSED window along its pair's shared edge, and refuse when there
# is no pair to resize.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.5 >/dev/null
wait_settled 12

# The saved ratio is the lower-id window's share along the split axis (see
# `Tiling.pairFor`/`setRatioForPair`), so focusing that window makes the
# direction unambiguous: "increase" must grow the focused window's share no
# matter which axis the pair follows.
focus="$(python3 -c 'import sys; print(min(int(x) for x in sys.argv[1:]))' "${ids[@]}")"
adrt ActivateWindow "$focus" >/dev/null
sleep 1

check_python "the pair starts at an even split" '
import json, sys
ratios = list(json.load(sys.stdin)["ratios"].values())
if not ratios or abs(ratios[-1] - 0.5) > 0.01:
    print("ratios", ratios); sys.exit(1)
print("ratio", round(ratios[-1], 3))
'

adrt ResizeFocused increase 10 >/dev/null
wait_settled 12
check_python "ResizeFocused increase grows the focused window's share" '
import json, sys
ratios = list(json.load(sys.stdin)["ratios"].values())
if not ratios:
    print("no ratio saved"); sys.exit(1)
r = ratios[-1]
if r <= 0.55:
    print("ratio did not grow the focused window:", r); sys.exit(1)
print("ratio", round(r, 3))
'

adrt ResizeFocused decrease 10 >/dev/null
wait_settled 12
check_python "ResizeFocused decrease moves the edge back towards the sibling" '
import json, sys
ratios = list(json.load(sys.stdin)["ratios"].values())
if not ratios:
    print("no ratio saved"); sys.exit(1)
r = ratios[-1]
if not (0.45 < r < 0.55):
    print("ratio did not return towards the sibling:", r); sys.exit(1)
print("ratio", round(r, 3))
'

# Past the 5–95% limit the keystroke changes nothing and must say so, not
# silently rewrite the same ratio, re-log split_resize and re-reconcile.
adrt ResizeFocused increase 50 >/dev/null
wait_settled 12
limited="$(adrt ResizeFocused increase 50 | python3 "$PARSE")"
assert_eq "ResizeFocused at the 95% limit reports no change" "false" "$limited"
wait_settled 8
check_python "ResizeFocused never exceeds the 95% limit" '
import json, sys
ratios = list(json.load(sys.stdin)["ratios"].values())
if not ratios:
    print("no ratio saved"); sys.exit(1)
r = max(ratios)
if r > 0.9501:
    print("ratio exceeded the limit:", r); sys.exit(1)
if r < 0.94:
    print("ratio did not reach the limit:", r); sys.exit(1)
print("ratio", round(r, 3))
'

# The at-the-limit refusal is the new resize-limit notice, not nothing-to-nudge
# (a pair exists; its edge simply cannot move further).
decisions_has() {
  local key="$1"
  adrt DumpDecisions 400 2>/dev/null | python3 "$PARSE" 2>/dev/null | python3 -c "
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get('event') == 'notice' and e.get('key') == '$key' for e in entries) else 1)" 2>/dev/null
}
if wait_for 8 decisions_has resize-limit; then
  pass "a resize already at the limit is announced"
else
  fail "no resize-limit notice was raised"
fi

# No pair: a lone window has no shared edge, so the trigger reports no change.
ensure_clean
spawn_window >/dev/null
wait_count 1 15 || true
single="$(list_ids | awk '{print $1}')"
adrt ActivateWindow "$single" >/dev/null
sleep 1
assert_eq "ResizeFocused with no pair reports no change" "false" "$(adrt ResizeFocused increase 10 | python3 "$PARSE")"

ensure_clean
summary
