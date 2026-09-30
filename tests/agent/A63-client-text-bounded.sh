#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A63 Client text is bounded: a window title is clipped, and no history line can
# grow without limit. An 805-million-character title once produced a 256 MB log
# line and an out-of-memory crash of the Shell.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
wait_settled 12

check_python "every reported title is clipped" '
import json, sys
d = json.load(sys.stdin)
for w in d["windows"]:
    t = w.get("title") or ""
    if len(t) > 300:
        print("title of", w["id"], "is", len(t), "chars"); sys.exit(1)
print("titles ok")
'

hist="$(history_file)"
if [ -f "$hist" ]; then
  big="$(python3 - "$hist" <<'PY'
import sys
n = 0
with open(sys.argv[1], 'r', encoding='utf-8', errors='replace') as fh:
    for line in fh:
        if len(line) > 65536:
            n += 1
print(n)
PY
)"
  if [ "$big" = "0" ]; then
    pass "no oversized history lines"
  else
    fail "$big history line(s) exceed 64 KiB"
  fi
else
  skip "no history file"
fi

ensure_clean
summary
