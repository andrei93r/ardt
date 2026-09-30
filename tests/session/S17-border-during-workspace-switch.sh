#!/usr/bin/env bash
# Generated with AI for personal use.
# S17 The active-window border hides for the whole of a workspace switch —
# including the touchpad-gesture path, which slides clones rather than moving
# the real actor — and comes back once the switch is over.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
sleep 1
id="$(test_ids | awk '{print $1}')"
adrt ActivateWindow "$id" >/dev/null
sleep 1

if ! adrt SimulateWorkspaceSwitch 1500 | grep -q true; then
  skip "SimulateWorkspaceSwitch unsupported by the running build"
  summary
  exit 0
fi
sleep 0.5

check_python "border hidden while the workspace switch is open" '
import json, sys
d = json.load(sys.stdin)
if d["border"]["visible"]:
    print("border stayed visible"); sys.exit(1)
sup = d["indicator"]["suppressed"]
if "workspace-switch" not in sup:
    print("suppressions:", sup); sys.exit(1)
print("suppressed:", sup)
'

if wait_python 10 'import json,sys
sys.exit(0 if json.load(sys.stdin)["border"]["visible"] else 1)'; then
  pass "border returns after the switch completes"
else
  fail "border never came back (suppressions: $(state_expr 'd["indicator"]["suppressed"]'))"
fi

summary
