#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A05 Unmaximize: the window returns to the pair's workspace.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt MaximizeWindow "${ids[1]}" >/dev/null
wait_python 25 '
import json, sys
d = json.load(sys.stdin)
maxed = [w for w in d["windows"] if w["maximized"]]
if not maxed:
    sys.exit(1)
if any(w["workspace"] == maxed[0]["workspace"] for w in d["windows"] if not w["maximized"]):
    sys.exit(1)' || true

adrt UnmaximizeWindow "${ids[1]}" >/dev/null
if wait_python 25 '
import json, sys
d = json.load(sys.stdin)
if len({w["workspace"] for w in d["windows"]}) != 1:
    sys.exit(1)
if any(w["maximized"] for w in d["windows"]):
    sys.exit(1)'; then
  pass "unmaximized window returned to the pair workspace"
else
  check_python "unmaximized window returned to the pair workspace" '
import json, sys
d = json.load(sys.stdin)
print("workspaces", {w["id"]: w["workspace"] for w in d["windows"]}, "max", [w["id"] for w in d["windows"] if w["maximized"]], "active", d["activeWorkspace"]); sys.exit(1)
'
fi

ensure_clean
summary
