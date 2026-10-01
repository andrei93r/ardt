#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A2 Third window: it moves to a workspace immediately to the right, and the
# view follows it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
pair_ws="$(dump | python3 -c 'import json,sys; print(json.load(sys.stdin)["windows"][0]["workspace"])')"
spawn_window >/dev/null

# As soon as the third window appears, Adrt pushes it right: the highlight must
# not linger at its spawn position. That suppression is transient, so assert the
# journalled event (with its reason) rather than catching it live.
suppressed=0
for _ in $(seq 1 20); do
  if journal_tail 200 '' | python3 -c '
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get("event") == "suppress" and e.get("reason") == "workspace-switch" for e in entries) else 1)' 2>/dev/null; then
    suppressed=1
    break
  fi
  sleep 0.5
done
if [ "$suppressed" = "1" ]; then
  pass "the highlight was suppressed while the window was pushed right"
else
  fail "no workspace-switch suppression was journalled"
fi

wait_count 3 15 || true
wait_settled 12

assert_eq "three windows are tracked" "3" "$(count_windows)"
poll "the third window is on its own workspace, one to the right, and focused" '
import json, sys
d = json.load(sys.stdin)
pair_ws = int("'"$pair_ws"'")
third = [w for w in d["windows"] if w["workspace"] != pair_ws]
if not third:
    print("no third window on a separate workspace"); sys.exit(1)
target = third[0]["workspace"]
if target != pair_ws + 1:
    print("third window on ws", target, "expected", pair_ws + 1); sys.exit(1)
if d["activeWorkspace"] != target:
    print("view did not follow: active", d["activeWorkspace"], "third ws", target); sys.exit(1)
print("third window on ws", target, "active", d["activeWorkspace"])
' 20

ensure_clean
summary
