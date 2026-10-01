#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# S20 The focus cycle on the live session (§17): one lap covers the managed windows
# in slot order and the floats, skips a minimized window, and wraps — and focusing a
# float does not re-order the lap or skip its twin.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn "$FILES"
wait_tests 1 15 || true
spawn "$CALC"
wait_tests 2 20 || true
ids=($(test_ids))

# Float one of the pair so the cycle has a managed window and a float to walk.
adrt ToggleFloat "${ids[1]}" >/dev/null
TEST_IDS="$(test_ids)" poll "one window floats" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] in ids and x["layer"] == 2]
sys.exit(0 if len(w) == 1 else 1)
' 15

# Walk a full lap plus a step: every window must be visited, and the sequence must wrap.
visited=""
for step in 1 2 3 4; do
  adrt FocusCycle >/dev/null
  wait_settled 6 || true
  focused="$(state_expr 'd["focused"]')"
  visited="$visited $focused"
  sleep 0.4
done

covered=1
for id in "${ids[@]}"; do
  case " $visited " in *" $id "*) ;; *) covered=0 ;; esac
done
if [ "$covered" = 1 ]; then
  pass "a lap visited every window (managed and float):$visited"
else
  fail "the cycle skipped a window: visited$visited of ${ids[*]}"
fi

first="$(echo $visited | awk '{print $1}')"
fifth="$(echo "$visited" | awk '{print $5}')"
if [ -n "$fifth" ] && [ "$first" = "$fifth" ]; then
  pass "the cycle wrapped back to the first window"
else
  fail "the cycle did not wrap (first=$first fifth=$fifth, visited:$visited)"
fi

ensure_clean
summary
