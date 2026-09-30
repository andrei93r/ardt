#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A56 The coherence sweep: a normal window left untiled beside a sibling is
# retiled by the periodic check, even after its applies were refused.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"

# Make every apply to A fail, then ask for a reflow: A stays where it was.
adrt InjectVerifyFailure "$A" 40 >/dev/null
adrt SimulateResize "$A" "$B" 0.35 >/dev/null
sleep 2

if wait_python 12 '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    sys.exit(1)
a, b = ws[0]["rect"], ws[1]["rect"]
if a["x"] < b["x"] + b["width"] - 2 and b["x"] < a["x"] + a["width"] - 2 \
   and a["y"] < b["y"] + b["height"] - 2 and b["y"] < a["y"] + a["height"] - 2:
    sys.exit(1)
sys.exit(0)'; then
  pass "the untiled window was retiled"
else
  fail "window left untiled ($(state_expr '[(w["id"], w["rect"]) for w in d["windows"]]'))"
fi

# The periodic check itself runs (whether or not it had to act this time).
before="$(state_expr 'd["coherenceSweeps"]')"
if wait_for 8 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"coherenceSweeps\"])')\" -gt '$before' ]"; then
  pass "the periodic coherence sweep runs"
else
  fail "the coherence sweep never ran (still $(state_expr 'd["coherenceSweeps"]'))"
fi

ensure_clean
summary
