#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A85 The arrival takes the right slot (§3): a lone maximized window is split by
# the newcomer, which lands in slot 1, and the pair tiles side by side.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
spawn_window >/dev/null
wait_count 1 15 || true
sleep 1

poll "the first window is alone and maximized" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"]]
if len(ws) != 1:
    print("windows", len(ws)); sys.exit(1)
sys.exit(0 if ws[0]["maximized"] else 1)
' 15

spawn_window >/dev/null
wait_count 2 15 || true
wait_settled 12

poll "the newcomer takes slot 1 and the pair tiles" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
if len({w["workspace"] for w in ws}) != 1:
    print("not on one workspace", [(w["id"], w["workspace"]) for w in ws]); sys.exit(1)
if any(w["maximized"] for w in ws):
    print("a window is still maximized", [(w["id"], w["maximized"]) for w in ws]); sys.exit(1)
if (len({w["slot"] for w in ws}) != 2) or (None in {w["slot"] for w in ws}):
    print("slots", [(w["id"], w["slot"]) for w in ws]); sys.exit(1)
newest = max(ws, key=lambda w: w["id"])
if newest["slot"] != 1:
    print("the newcomer is not in slot 1", newest["slot"]); sys.exit(1)
print("pair", [(w["id"], w["slot"]) for w in ws])
' 20

ensure_clean
summary
