#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A47 The active-window border hides for the whole of a workspace switch and
# comes back afterwards. GNOME slides window *clones*, so the real actor never
# moves; this covers the touchpad gesture path, which used to leave the border
# stuck on screen while the workspaces slid.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_settled 15
wait_border_visible 20 || true

check_python "border is visible before the switch" '
import json, sys
d = json.load(sys.stdin)
if not d["border"]["visible"]:
    print("no border to begin with"); sys.exit(1)
print("visible")
'

# Start a workspace switch and hold it open for a while.
adrt SimulateWorkspaceSwitch 1200 >/dev/null
sleep 0.4

check_python "border is hidden while the workspaces slide" '
import json, sys
d = json.load(sys.stdin)
if d["border"]["visible"]:
    print("border stayed visible"); sys.exit(1)
sup = d["indicator"]["suppressed"]
if "workspace-switch" not in sup:
    print("suppressions:", sup); sys.exit(1)
print("suppressed:", sup)
'

# The switch tears down, the actor settles, the border comes back.
if wait_border_visible 20; then
  pass "border returns after the switch completes"
else
  fail "border never came back (suppressed: $(state_expr 'd["indicator"]["suppressed"]'))"
fi

ensure_clean
summary
