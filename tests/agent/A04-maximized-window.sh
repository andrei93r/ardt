#!/usr/bin/env bash
# A4 Maximized window: maximizing a window with a sibling sends it to a new workspace.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt MaximizeWindow "${ids[1]}" >/dev/null
sleep 3

check_python "maximized window moved to its own workspace" '
import json, sys
d = json.load(sys.stdin)
maxed = [w for w in d["windows"] if w["maximized"]]
others = [w for w in d["windows"] if not w["maximized"]]
if not maxed:
    print("no maximized window"); sys.exit(1)
if any(o["workspace"] == maxed[0]["workspace"] for o in others):
    print("sibling still on the same workspace"); sys.exit(1)
print("moved to workspace", maxed[0]["workspace"])
'

ensure_clean
summary
