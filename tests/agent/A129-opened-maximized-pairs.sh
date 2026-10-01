#!/usr/bin/env bash
# Generated with AI for personal use.
# A129 A window that opens fully maximized (an app-open maximize, not a user
# request) pairs with the sibling already on its workspace and stays paired
# (§16). Before the fix our own maximize on a window left behind by a forming
# pair was read as a user maximize, and the paired window was exiled to its own
# workspace — which is what broke S05's "third window alone on its workspace"
# setup and made a minimize look like it failed to reap.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
# Let the maximized client's request land before adrt's first-frame ready
# timeout reads the window's flags, and keep the pair-forming retile animating
# across a coherence sweep so the sweep cannot mistake the pair for a lone
# window (the S05 race).
set_setting gnome-animation-delay 600
set_setting animation-duration 1000

spawn_window >/dev/null
wait_count 1 15 || true
spawn_window "python3 $(cd "$(dirname "$0")" && pwd)/maximized-client.py" >/dev/null
wait_count 2 20 || true
wait_settled 15

poll "the opened-maximized window tiles with its sibling on one workspace" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", [(w["id"], w["workspace"], w["maximized"]) for w in ws]); sys.exit(1)
if len({w["workspace"] for w in ws}) != 1:
    print("not on one workspace", [(w["id"], w["workspace"]) for w in ws]); sys.exit(1)
if any(w["maximized"] for w in ws):
    print("a window is still maximized", [(w["id"], w["maximized"]) for w in ws]); sys.exit(1)
a, b = ws[0]["rect"], ws[1]["rect"]
if a["x"] < b["x"] + b["width"] - 2 and b["x"] < a["x"] + a["width"] - 2 \
   and a["y"] < b["y"] + b["height"] - 2 and b["y"] < a["y"] + a["height"] - 2:
    print("still stacked:", a, b); sys.exit(1)
print("paired", [(w["id"], w["rect"]["x"]) for w in ws])
' 20

ensure_clean
set_setting gnome-animation-delay 0
set_setting animation-duration 180
summary
