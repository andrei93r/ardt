#!/usr/bin/env bash
# Generated with AI for personal use.
# S05 Minimize and close both return the view left and reap the emptied
# workspace.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn "$FILES"
wait_tests 1 12 || true
spawn "$CHROME"
wait_tests 2 15 || true
spawn "$CALC"
wait_tests 3 15 || true

TEST_IDS="$(test_ids)" poll "three test windows with one on a later workspace" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["id"] in ids]
if len({w["workspace"] for w in ws}) < 2:
    print("no later workspace"); sys.exit(1)
print("ok")
' 15

# --- minimize: the window follows left and its workspace is reaped ----------
third="$(test_id_on_highest_ws)"
third_ws="$(window_workspace "$third")"
before="$(state_expr 'd["workspaces"]')"
echo "minimizing $third on ws$third_ws (workspaces=$before)"

adrt MinimizeWindow "$third" >/dev/null
TEST_IDS="$(test_ids)" poll "the minimized window followed to the previous workspace" '
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

deadline=$((SECONDS + 25))
while [ "$SECONDS" -lt "$deadline" ]; do
  [ "$(state_expr 'd["workspaces"]')" -lt "$before" ] && break
  sleep 1
done
now="$(state_expr 'd["workspaces"]')"
if [ "$now" -lt "$before" ]; then pass "the emptied workspace was reaped after minimize"; else fail "workspace not reaped ($before -> $now)"; fi

adrt CloseWindow "$third" >/dev/null 2>&1 || true
sleep 1

# --- close the last window on a workspace: view left, workspace removed -----
spawn "$FILES"
wait_tests 3 15 || true
read -r last last_ws <<<"$(dump | python3 -c '
import json,sys
ws = [w for w in json.load(sys.stdin)["windows"] if w["tileable"]]
top = max(w["workspace"] for w in ws)
w = [x for x in ws if x["workspace"] == top][0]
print(w["id"], top)')"
before="$(state_expr 'd["workspaces"]')"
echo "closing $last on ws$last_ws (workspaces=$before)"

adrt CloseWindow "$last" >/dev/null
deadline=$((SECONDS + 15))
switched=0
while [ "$SECONDS" -lt "$deadline" ]; do
  [ "$(state_expr 'd["activeWorkspace"]')" = "$((last_ws - 1))" ] && { switched=1; break; }
  sleep 0.5
done
if [ "$switched" = "1" ]; then pass "closing switched the view to the left"; else fail "view did not move left (active $(state_expr 'd["activeWorkspace"]'))"; fi

deadline=$((SECONDS + 25))
while [ "$SECONDS" -lt "$deadline" ]; do
  [ "$(state_expr 'd["workspaces"]')" -lt "$before" ] && break
  sleep 1
done
now="$(state_expr 'd["workspaces"]')"
if [ "$now" -lt "$before" ]; then pass "the emptied workspace was removed"; else fail "the emptied workspace was not removed ($before -> $now)"; fi

summary
