#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A120 A dialog floats, is centred on its parent and raised (§16): a transient
# window is not tiled, it is placed at its parent's centre and stacked above it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
# A parent window that opens a transient modal dialog after a moment.
spawn_window "python3 $ROOT_DIR/tests/agent/dialog-client.py" >/dev/null
wait_count 2 25 || true
# No wait_settled here: the dialog's frame keeps changing while it is centred and
# raised, so settling never converges and just burns the timeout. The poll below
# waits for the condition itself, which is the real assertion.

poll "the dialog is not tiled and is centred on its parent" '
import json, sys
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["tileable"]]
dialogs = [w for w in d["windows"] if not w["tileable"] and w["transient"]]
if len(tiles) != 1:
    print("tileable windows", len(tiles)); sys.exit(1)
if len(dialogs) != 1:
    print("transient dialogs", len(dialogs)); sys.exit(1)
parent = tiles[0]["rect"]
dialog = dialogs[0]["rect"]
pcx, pcy = parent["x"] + parent["width"] / 2, parent["y"] + parent["height"] / 2
dcx, dcy = dialog["x"] + dialog["width"] / 2, dialog["y"] + dialog["height"] / 2
if abs(dcx - pcx) > 40 or abs(dcy - pcy) > 40:
    print("dialog not centred on its parent:", dialog, "parent", parent); sys.exit(1)
if dialogs[0]["layer"] == 1:
    print("the dialog is in the tiled layer"); sys.exit(1)
print("dialog centred:", dialog, "on", parent)
' 20

poll "the dialog is raised above its parent" '
import json, sys
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["tileable"]]
dialogs = [w for w in d["windows"] if not w["tileable"] and w["transient"]]
if not tiles or not dialogs:
    print("windows gone"); sys.exit(1)
sys.exit(0 if dialogs[0]["z"] >= tiles[0]["z"] else 1)
' 12

ensure_clean
summary
