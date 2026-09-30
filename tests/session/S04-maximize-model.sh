#!/usr/bin/env bash
# Generated with AI for personal use.
# S04 Maximize model: maximize gets its own workspace to the right and the view
# follows; unmaximize returns to the pair; finishing returns the view left and
# the emptied workspace is reaped.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn "$FILES"
wait_tests 1 12 || true
spawn "$CHROME"
wait_tests 2 15 || true
read -r A B <<<"$(test_pair_by_x)"
pair_ws="$(window_workspace "$A")"
echo "pair $A $B on ws$pair_ws"

adrt MaximizeWindow "$B" >/dev/null
TEST_IDS="$(test_ids)" poll "maximize gave it the workspace to the right and followed" '
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
' 18

adrt UnmaximizeWindow "$B" >/dev/null
TEST_IDS="$(test_ids)" poll "unmaximizing returned it to the pair" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["id"] in ids]
if len({w["workspace"] for w in ws}) != 1:
    print("workspaces", {w["workspace"] for w in ws}); sys.exit(1)
if any(w["maximized"] for w in ws):
    print("still maximized"); sys.exit(1)
print("returned")
' 20

adrt MaximizeWindow "$B" >/dev/null
sleep 3
adrt CloseWindow "$B" >/dev/null

deadline=$((SECONDS + 15))
moved=0
while [ "$SECONDS" -lt "$deadline" ]; do
  [ "$(state_expr 'd["activeWorkspace"]')" = "$pair_ws" ] && { moved=1; break; }
  sleep 0.5
done
if [ "$moved" = "1" ]; then pass "closing returned the view to the left"; else fail "view did not return left (active $(state_expr 'd["activeWorkspace"]'))"; fi

poll_no_stray_empty_workspaces

summary
