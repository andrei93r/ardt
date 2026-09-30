#!/usr/bin/env bash
# Generated with AI for personal use.
# S11 Border is suppressed in the overview and during a workspace switch.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
sleep 1
id="$(test_ids | awk '{print $1}')"
adrt ActivateWindow "$id" >/dev/null
sleep 1

# Overview suppression.
if adrt SimulateOverview true | grep -q true; then
  sleep 1
  if wait_python 5 'import json,sys
sys.exit(0 if "overview" in json.load(sys.stdin)["indicator"]["suppressed"] else 1)'; then
    pass "border suppressed in the overview"
  else
    fail "border not suppressed in the overview"
  fi
  adrt SimulateOverview false >/dev/null
  sleep 1
else
  skip "SimulateOverview unsupported by the running build"
fi

# Workspace-switch suppression. Switch to any existing neighbour workspace
# (the sandbox may be the last one).
switch_to="$((START_WS + 1))"
[ "$switch_to" -ge "$(state_expr 'd["workspaces"]')" ] && switch_to="$((START_WS - 1))"
[ "$switch_to" -lt 0 ] && switch_to=0
adrt ActivateWorkspace "$switch_to" >/dev/null 2>&1 || true
if wait_python 4 'import json,sys
sys.exit(0 if "workspace-switch" in json.load(sys.stdin)["indicator"]["suppressed"] else 1)'; then
  pass "border suppressed during the workspace switch"
else
  fail "border not suppressed during the workspace switch"
fi
adrt ActivateWorkspace "$START_WS" >/dev/null 2>&1 || true

summary
