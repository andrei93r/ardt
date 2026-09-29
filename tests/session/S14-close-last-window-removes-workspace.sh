#!/usr/bin/env bash
# Generated with AI for personal use.
# S14 Closing the last window on a workspace switches away and removes it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
spawn
wait_tests 2 15 || true
spawn
wait_tests 3 15 || true
sleep 2

read -r third third_ws <<<"$(dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"]]
pair_ws = min(w["workspace"] for w in ws)
extra = [w for w in ws if w["workspace"] != pair_ws]
w = max(extra, key=lambda x: x["workspace"])
print(w["id"], w["workspace"])
')"
before="$(state_expr 'd["workspaces"]')"
echo "closing $third on ws$third_ws (workspaces=$before)"

adrt CloseWindow "$third" >/dev/null

deadline=$((SECONDS + 12))
switched=0
while [ "$SECONDS" -lt "$deadline" ]; do
  [ "$(state_expr 'd["activeWorkspace"]')" != "$third_ws" ] && { switched=1; break; }
  sleep 0.5
done
if [ "$switched" = "1" ]; then pass "the view switched away from the emptied workspace"; else fail "the view stayed on the emptied workspace"; fi

deadline=$((SECONDS + 20))
while [ "$SECONDS" -lt "$deadline" ]; do
  [ "$(state_expr 'd["workspaces"]')" -lt "$before" ] && break
  sleep 1
done
now="$(state_expr 'd["workspaces"]')"
if [ "$now" -lt "$before" ]; then pass "the emptied workspace was removed"; else fail "the emptied workspace was not removed ($before -> $now)"; fi

summary
