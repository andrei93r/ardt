#!/usr/bin/env bash
# Generated with AI for personal use.
# S07 Border across a workspace switch: hidden the instant the switch starts
# (including the touchpad-gesture path, which slides clones rather than moving
# the real actor) and back once it is over. The overview is never opened.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn "$FILES"
wait_tests 1 12 || true
id="$(test_ids | awk '{print $1}')"
adrt ActivateWindow "$id" >/dev/null
if wait_python 20 'import json,sys
d = json.load(sys.stdin)
sys.exit(0 if d["border"]["visible"] else 1)'; then
  pass "border is visible before any switch"
else
  fail "border never became visible (suppressed: $(state_expr 'd["indicator"]["suppressed"]'))"
fi

# Gesture path: hold the switch state open.
if adrt SimulateWorkspaceSwitch 800 | grep true >/dev/null; then
  sleep 0.4
  check_python "border hidden while a switch is in progress" '
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
    fail "border never came back (suppressed: $(state_expr 'd["indicator"]["suppressed"]'))"
  fi
else
  skip "SimulateWorkspaceSwitch unsupported by the running build"
fi

# Keyboard/API path: switch to a real neighbour workspace and back.
switch_to="$((START_WS + 1))"
[ "$switch_to" -ge "$(state_expr 'd["workspaces"]')" ] && switch_to="$((START_WS - 1))"
[ "$switch_to" -lt 0 ] && switch_to=0
# A fast API switch can set and clear the suppression between DumpState samples,
# so accept either the live state or the border-suppress record the drain wrote
# to the journal (source=border, reason=workspace-switch, at >= the trigger).
trigger_ms="$(date +%s%3N)"
adrt ActivateWorkspace "$switch_to" >/dev/null 2>&1 || true
if wait_python 8 'import json,sys
sys.exit(0 if "workspace-switch" in json.load(sys.stdin)["indicator"]["suppressed"] else 1)' \
   || adrt DumpEvents 600 '' 2>/dev/null | python3 "$PARSE" 2>/dev/null | TRIGGER_MS="$trigger_ms" python3 -c '
import os, json, sys
entries = json.load(sys.stdin)
t = int(os.environ["TRIGGER_MS"])
ok = any(
    e.get("source") == "border" and e.get("event") == "suppress"
    and e.get("reason") == "workspace-switch" and e.get("at", 0) >= t
    for e in entries
)
sys.exit(0 if ok else 1)
'; then
  pass "border suppressed during a workspace switch"
else
  fail "border not suppressed during a workspace switch"
fi
adrt ActivateWorkspace "$START_WS" >/dev/null 2>&1 || true

summary
