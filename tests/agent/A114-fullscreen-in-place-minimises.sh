#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A114 Fullscreen on a single-workspace screen (§4/§7) behaves as maximize: it
# fills the screen where it is and minimizes the other managed windows.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
set_static_workspaces 1

open_pair
wait_python 15 '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"]]
sys.exit(0 if len(ws) == 2 else 1)' || true
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"

adrt ActivateWindow "$B" >/dev/null
wait_python 10 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d["focused"] == int("'"$B"'") else 1)' || true

adrt ToggleFullscreen "$B" >/dev/null

poll "fullscreen stays in place and minimizes the other window" '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
if not b or not a:
    print("window gone"); sys.exit(1)
if a[0]["minimized"] is not True:
    print("the other window is not minimized"); sys.exit(1)
if b[0]["workspace"] != a[0]["workspace"]:
    print("workspaces differ"); sys.exit(1)
if d["workspaces"] != 1:
    print("a workspace was created", d["workspaces"]); sys.exit(1)
print("fullscreen in place on ws", b[0]["workspace"])
' 20

poll "the fullscreen window is not highlighted" '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if not d["border"]["visible"] and "fullscreen" in d["indicator"]["suppressed"] else 1)
' 12

adrt ToggleFullscreen "$B" >/dev/null

poll "leaving fullscreen restores the pair" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("visible tiles", [(w["id"], w["minimized"]) for w in d["windows"]]); sys.exit(1)
if d["workspaces"] != 1:
    print("workspaces", d["workspaces"]); sys.exit(1)
print("restored pair", [(w["id"], w["slot"]) for w in ws])
' 25

poll "the highlight returns after fullscreen" '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d["border"]["visible"] and "fullscreen" not in d["indicator"]["suppressed"] else 1)
' 12

ensure_clean
summary
