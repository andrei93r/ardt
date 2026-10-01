#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A88 Maximize owns a workspace (§4): on a workspace-capable screen the window
# moves to a workspace created to the right, the window left behind is alone and
# maximizes, and the view follows.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
pair_ws="$(window_field "$A" workspace)"

adrt MaximizeWindow "$B" >/dev/null

poll "the maximized window owns a workspace to the right and the view follows" '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not b:
    print("window gone"); sys.exit(1)
w = b[0]
if not w["maximized"]:
    print("not maximized"); sys.exit(1)
if w["workspace"] != int("'"$pair_ws"'") + 1:
    print("on ws", w["workspace"], "expected", int("'"$pair_ws"'") + 1); sys.exit(1)
if d["activeWorkspace"] != w["workspace"]:
    print("view did not follow"); sys.exit(1)
a = [x for x in d["windows"] if x["id"] == int("'"$A"'")]
if not a or a[0]["workspace"] != int("'"$pair_ws"'"):
    print("the window left behind moved:", a); sys.exit(1)
if not a[0]["maximized"]:
    print("the window left behind is not maximized"); sys.exit(1)
print("B on ws", w["workspace"], "A max on ws", a[0]["workspace"])
' 20

ensure_clean
summary
