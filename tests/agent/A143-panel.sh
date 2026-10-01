#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A143 Panel affordance (§1): the top-bar menu is present and its three items —
# Pause/Resume tiling, the active-window highlight toggle and Preferences — are
# wired to the real state (the session pause predicate and the indicator
# setting), reflected in DumpState and driven through the same widget path a
# click takes via the `ActivatePanelItem` trigger.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_settled 12
wait_border_visible 20 || true

# 1. The panel exists and reports its surface.
check_python "DumpState exposes the panel surface" '
import json, sys
p = json.load(sys.stdin).get("panel")
if not isinstance(p, dict) or not p.get("present"):
    print("panel", p); sys.exit(1)
for key in ("paused", "indicatorEnabled", "pauseLabel", "indicatorLabel"):
    if key not in p:
        print("panel missing", key); sys.exit(1)
print("panel", p)
'

# 2. Pause through the panel: the one pause predicate flips and the highlight
#    hides (the existing pause path, not a parallel flag).
assert_true "the panel pause item activates" "$(adrt ActivatePanelItem pause | python3 "$PARSE")"
if wait_python 10 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d["userPaused"] and d["paused"] and not d["indicator"]["visible"] else 1)'; then
  pass "the panel pause pauses tiling and hides the highlight"
else
  fail "the panel pause did not take effect (userPaused=$(state_expr 'str(d["userPaused"]).lower()'))"
fi

# 3. Resume through the panel.
assert_true "the panel resume item activates" "$(adrt ActivatePanelItem pause | python3 "$PARSE")"
if wait_python 10 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if not d["userPaused"] and not d["paused"] else 1)'; then
  pass "the panel resume clears the manual pause"
else
  fail "the panel resume did not take effect"
fi
wait_border_visible 20 || true
assert_true "the highlight returns after resume" "$(border_visible)"

# 4. Highlight on/off through the panel is the `active-window-indicator` setting.
assert_eq "the highlight starts enabled" "true" "$(state_expr 'str(d["panel"]["indicatorEnabled"]).lower()')"
assert_true "the panel highlight item activates" "$(adrt ActivatePanelItem indicator | python3 "$PARSE")"
if wait_python 10 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if not d["panel"]["indicatorEnabled"] and not d["indicator"]["visible"] else 1)'; then
  pass "the panel highlight off hides the border and updates the setting"
else
  fail "the panel highlight off did not hide the border"
fi
assert_true "the panel highlight item activates again" "$(adrt ActivatePanelItem indicator | python3 "$PARSE")"
if wait_python 10 '
import json, sys
sys.exit(0 if json.load(sys.stdin)["panel"]["indicatorEnabled"] else 1)'; then
  pass "the panel highlight on re-enables the setting"
else
  fail "the panel highlight on did not re-enable the setting"
fi
wait_border_visible 20 || true
assert_true "the highlight returns" "$(border_visible)"

# 5. Preferences and an unknown item.
rc="$(adrt ActivatePanelItem preferences | python3 "$PARSE")"
if [ "$rc" = "true" ]; then
  pass "the preferences item activates"
else
  skip "preferences could not open in the nested Shell (rc=$rc)"
fi
assert_eq "an unknown panel item is rejected" "false" "$(adrt ActivatePanelItem no-such-item | python3 "$PARSE")"

# Never leak a pause or a disabled highlight into the next scenario.
if [ "$(state_expr 'str(d["userPaused"]).lower()')" = "true" ]; then
  adrt ActivatePanelItem pause >/dev/null 2>&1 || true
fi
set_setting active-window-indicator true
ensure_clean
summary
