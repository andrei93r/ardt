#!/usr/bin/env bash
# Generated with AI for personal use.
# S09 Minimize on the live session: follows back, empty workspace reaped.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
spawn
wait_tests 2 15 || true
spawn
wait_tests 3 15 || true
sleep 1.5

TEST_IDS="$(test_ids)" check_python "three test windows with one on a later workspace" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["id"] in ids]
if len({w["workspace"] for w in ws}) < 2:
    print("no later workspace"); sys.exit(1)
print("ok")
'

third="$(test_id_on_highest_ws)"
third_ws="$(window_workspace "$third")"
before="$(state_expr 'd["workspaces"]')"
echo "minimizing $third on ws$third_ws (workspaces=$before)"

adrt MinimizeWindow "$third" >/dev/null

TEST_IDS="$(test_ids)" poll "the window followed back to the previous workspace" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$third"'")]
if not w or not w[0]["minimized"]:
    print("not minimized"); sys.exit(1)
if w[0]["workspace"] != int("'"$third_ws"'") - 1:
    print("on ws", w[0]["workspace"], "expected", int("'"$third_ws"'") - 1); sys.exit(1)
print("on ws", w[0]["workspace"])
' 20

if [ "$before" -gt 1 ]; then
  deadline=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(state_expr 'd["workspaces"]')" -lt "$before" ] && break
    sleep 1
  done
  now="$(state_expr 'd["workspaces"]')"
  if [ "$now" -lt "$before" ]; then pass "the emptied workspace was reaped"; else fail "workspace not reaped ($before -> $now)"; fi
fi

summary
