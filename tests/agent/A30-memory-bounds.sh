#!/usr/bin/env bash
# A30 Memory bounds: repeated open/close leaves bounded state.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
for _ in $(seq 1 6); do
  spawn_window >/dev/null
  sleep 1
done
sleep 3
opened="$(count_windows)"
if [ "$opened" -ge 2 ]; then pass "opened $opened windows"; else fail "only $opened windows opened"; fi

ensure_clean
check_python "window map returns to zero and state stays bounded" '
import json, sys
d = json.load(sys.stdin)
b = d["bounds"]
if b["windows"] != 0:
    print("windows", b["windows"]); sys.exit(1)
if b["signals"] > 64 or b["sources"] > 64:
    print("unbounded", b); sys.exit(1)
print("bounds", b)
'

summary
