#!/usr/bin/env bash
# Generated with AI for personal use.
# S11 The border is suppressed while the workspace slides during a switch.
# The overview is never opened: only ever test with it closed.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
sleep 1
id="$(test_ids | awk '{print $1}')"
adrt ActivateWindow "$id" >/dev/null
sleep 1

# Workspace-switch suppression. Switch to any existing neighbour workspace
# (the sandbox may be the last one).
switch_to="$((START_WS + 1))"
[ "$switch_to" -ge "$(state_expr 'd["workspaces"]')" ] && switch_to="$((START_WS - 1))"
[ "$switch_to" -lt 0 ] && switch_to=0
adrt ActivateWorkspace "$switch_to" >/dev/null 2>&1 || true
if wait_python 8 'import json,sys
sys.exit(0 if "workspace-switch" in json.load(sys.stdin)["indicator"]["suppressed"] else 1)'; then
  pass "border suppressed during the workspace switch"
else
  fail "border not suppressed during the workspace switch"
fi
adrt ActivateWorkspace "$START_WS" >/dev/null 2>&1 || true

summary
