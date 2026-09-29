#!/usr/bin/env bash
# Generated with AI for personal use.
# S16 Workspace model on the live session: maximize gives a window the workspace
# to the right and follows; finishing returns left and the workspace is reaped.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
spawn
wait_tests 2 15 || true
sleep 2
read -r A B <<<"$(test_pair_by_x)"
pair_ws="$(window_workspace "$A")"
echo "pair $A $B on ws$pair_ws"

adrt MaximizeWindow "$B" >/dev/null
sleep 4
TEST_IDS="$(test_ids)" check_python "maximize gave it the workspace to the right and followed" '
import os, json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not b or not b[0]["maximized"]:
    print("not maximized"); sys.exit(1)
if b[0]["workspace"] != int("'"$pair_ws"'") + 1:
    print("workspace", b[0]["workspace"]); sys.exit(1)
if d["activeWorkspace"] != b[0]["workspace"]:
    print("view did not follow"); sys.exit(1)
print("ws", b[0]["workspace"])
'

before="$(state_expr 'd["workspaces"]')"
adrt CloseWindow "$B" >/dev/null

deadline=$((SECONDS + 12))
moved=0
while [ "$SECONDS" -lt "$deadline" ]; do
  [ "$(state_expr 'd["activeWorkspace"]')" = "$pair_ws" ] && { moved=1; break; }
  sleep 0.5
done
if [ "$moved" = "1" ]; then pass "closing returned the view to the left"; else fail "view did not return left (active $(state_expr 'd["activeWorkspace"]'))"; fi

deadline=$((SECONDS + 20))
while [ "$SECONDS" -lt "$deadline" ]; do
  [ "$(state_expr 'd["workspaces"]')" -lt "$before" ] && break
  sleep 1
done
now="$(state_expr 'd["workspaces"]')"
if [ "$now" -lt "$before" ]; then pass "the workspace to the right was reaped"; else fail "workspace not reaped ($before -> $now)"; fi

summary
