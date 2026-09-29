#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A26 Shell restart: the extension survives a nested Shell restart and tiles again.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
bash "$NESTED" restart >/dev/null 2>&1
bash "$NESTED" wait-adrt 40 || { fail "adrt did not come back after restart"; summary; exit 1; }
pass "extension reloaded after Shell restart"

open_pair
assert_eq "tiles again after restart" "2" "$(count_windows)"
check_python "tiles are valid after restart" '
import json, sys
ws = [w["rect"] for w in json.load(sys.stdin)["windows"]]
if len(ws) != 2:
    print("expected 2"); sys.exit(1)
for r in ws:
    if r["width"] <= 0 or r["height"] <= 0:
        print("bad rect", r); sys.exit(1)
print("ok")
'

ensure_clean
summary
