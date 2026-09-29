#!/usr/bin/env bash
# A25 Settings change: the extension reacts to a GSettings change.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
original="$(get_setting gaps-base)"
set_setting gaps-base 24
sleep 1
open_pair

check_python "gap change took effect" '
import json, sys
ws = json.load(sys.stdin)["windows"]
if not ws:
    print("no windows"); sys.exit(1)
if min(w["rect"]["x"] for w in ws) != 24:
    print("xs", [w["rect"]["x"] for w in ws]); sys.exit(1)
print("gap 24 applied")
'

set_setting gaps-base "$original"
sleep 1
ensure_clean
summary
