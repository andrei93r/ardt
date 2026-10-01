#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A89 On a single-workspace screen (§4) maximize is in place and minimizes the
# other managed windows; unmaximize brings them back.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
set_static_workspaces 1

open_pair
wait_python 15 '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"]]
sys.exit(0 if len(ws) == 2 and len({w["workspace"] for w in ws}) == 1 else 1)' || true
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"

adrt MaximizeWindow "$B" >/dev/null

poll "maximize is in place and minimizes the other window" '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
if not b or not a:
    print("window gone"); sys.exit(1)
if not b[0]["maximized"]:
    print("B is not maximized"); sys.exit(1)
if not a[0]["minimized"]:
    print("A is not minimized"); sys.exit(1)
if b[0]["workspace"] != a[0]["workspace"]:
    print("workspaces differ"); sys.exit(1)
if d["workspaces"] != 1:
    print("a workspace was created on a single-workspace screen:", d["workspaces"]); sys.exit(1)
print("B max, A minimized, ws", b[0]["workspace"])
' 20

adrt UnmaximizeWindow "$B" >/dev/null

poll "unmaximize restores the minimized window into the pair" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("visible tiles", [(w["id"], w["minimized"]) for w in d["windows"]]); sys.exit(1)
if any(w["maximized"] for w in ws):
    print("still maximized"); sys.exit(1)
if len({w["workspace"] for w in ws}) != 1 or d["workspaces"] != 1:
    print("workspace changed", d["workspaces"]); sys.exit(1)
print("restored pair", [(w["id"], w["slot"]) for w in ws])
' 25

ensure_clean
summary
