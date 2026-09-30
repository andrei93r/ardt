#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A62 Minimizing a window onto the left workspace must not un-minimize it: a
# floated window keeps the flag (and gains the float rect) when it is restored.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
pair_ws="$(window_field "${ids[0]}" workspace)"

# A third window takes its own workspace to the right and is maximized there.
before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 3 20 || true
third="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
if ! wait_python 30 '
import json, sys
d = json.load(sys.stdin)
ws = [w["workspace"] for w in d["windows"] if w["tileable"]]
sys.exit(0 if ws and max(ws) > int("'"$pair_ws"'") else 1)'; then
  fail "the third window never took its own workspace"
  ensure_clean
  summary
  exit 1
fi

adrt MinimizeWindow "$third" >/dev/null

# It slides left onto the pair's workspace and must STAY minimized.
if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$third"'")]
sys.exit(0 if w and w[0]["workspace"] == int("'"$pair_ws"'") else 1)'; then
  pass "the minimized window slid to the left workspace"
else
  fail "window did not slide left ($(state_expr "[(w['id'], w['workspace'], w['minimized']) for w in d['windows']]"))"
fi

poll "it is still minimized (not popped back on screen)" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$third"'")]
if not w:
    print("window gone"); sys.exit(1)
sys.exit(0 if w[0]["minimized"] else 1)
' 8

# Restoring it floats it over the pair rather than tiling a third window.
adrt ActivateWindow "$third" >/dev/null
sleep 1
dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
w=[x for x in d["windows"] if x["id"]==int("'"$third"'")][0]
print("after restore: minimized", w["minimized"], "layer", w["layer"], "ws", w["workspace"])
' >/dev/null 2>&1
poll "restoring it floats it over the pair" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$third"'")]
if not w:
    print("window gone"); sys.exit(1)
if w[0]["minimized"]:
    print("still minimized"); sys.exit(1)
sys.exit(0 if w[0]["layer"] == 2 else 1)
' 12

ensure_clean
summary
