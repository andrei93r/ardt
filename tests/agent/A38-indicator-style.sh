#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A38 Indicator style: the border follows the system accent colour and the
# configured width.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
set_setting indicator-color accent
set_setting indicator-width 5
set_system_setting org.gnome.desktop.interface accent-color orange

open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_border_visible 15 || true

check_python "the border uses the system accent and the configured width" '
import json, sys
i = json.load(sys.stdin)["indicator"]
if i["color"].lower() != "#ed5b00":
    print("colour", i["color"], "expected #ed5b00 (orange)"); sys.exit(1)
if i["width"] != 5:
    print("width", i["width"], "expected 5"); sys.exit(1)
print(i["color"], i["width"])
'

set_setting indicator-width 3
set_system_setting org.gnome.desktop.interface accent-color blue
ensure_clean
summary
