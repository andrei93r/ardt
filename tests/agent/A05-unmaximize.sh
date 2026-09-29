#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A5 Unmaximize: the window returns to the pair's workspace.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt MaximizeWindow "${ids[1]}" >/dev/null
sleep 3
adrt UnmaximizeWindow "${ids[1]}" >/dev/null
sleep 3

check_python "unmaximized window returned to the pair workspace" '
import json, sys
d = json.load(sys.stdin)
ws = sorted({w["workspace"] for w in d["windows"]})
if len(ws) != 1:
    print("split across workspaces", ws); sys.exit(1)
print("returned to workspace", ws[0])
'

ensure_clean
summary
