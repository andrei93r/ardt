#!/usr/bin/env bash
# Generated with AI for personal use.
# A128 The workspace-switch border suppression is a property of the animation
# (§23.2): once the switch is over it must clear, even when focus was lost while
# it ran and the motion watcher (the usual clearing path) stopped. Before the
# fix a switch that ended with no focused window left 'workspace-switch' set
# forever, hiding the highlight for every window that followed.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
spawn_window >/dev/null
wait_count 1 15 || true
id="$(list_ids | awk '{print $1}')"
adrt ActivateWindow "$id" >/dev/null
if ! wait_python 20 'import json,sys; sys.exit(0 if json.load(sys.stdin)["border"]["visible"] else 1)'; then
  fail "the border never became visible before the switch"
  summary
  exit 1
fi
pass "the border is visible before the switch"

if ! adrt SimulateWorkspaceSwitch 800 | grep -q true; then
  skip "SimulateWorkspaceSwitch unsupported by the running build"
  summary
  exit 0
fi

# Wait until the switch really is holding the suppression.
if ! wait_python 10 'import json,sys; sys.exit(0 if "workspace-switch" in json.load(sys.stdin)["indicator"]["suppressed"] else 1)'; then
  fail "the switch never suppressed the border"
  summary
  exit 1
fi
pass "the switch suppressed the border"

# Close the only window while the switch is held: focus is lost, so the motion
# watcher stops. The suppression must still clear when the animation ends.
adrt CloseWindow "$id" >/dev/null
wait_count 0 10 || true

if wait_python 8 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if (not d["workspaceAnimating"] and "workspace-switch" not in d["indicator"]["suppressed"]) else 1)'; then
  pass "the switch suppression cleared once the switch ended"
else
  fail "the switch suppression stayed set (suppressed: $(state_expr 'd["indicator"]["suppressed"]'), animating: $(state_expr 'd["workspaceAnimating"]'))"
fi

# A fresh window must get its highlight back.
spawn_window >/dev/null
wait_count 1 15 || true
new="$(list_ids | awk '{print $1}')"
adrt ActivateWindow "$new" >/dev/null
if wait_python 20 'import json,sys; sys.exit(0 if json.load(sys.stdin)["border"]["visible"] else 1)'; then
  pass "a later window shows the highlight"
else
  fail "the highlight never returned (suppressed: $(state_expr 'd["indicator"]["suppressed"]'))"
fi

ensure_clean
summary
