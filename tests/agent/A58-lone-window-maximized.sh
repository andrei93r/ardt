#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A58 A lone window is always maximized: the periodic sweep enforces the model
# even if the policy misses it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
spawn_window >/dev/null
wait_count 1 15 || true
ids=($(list_ids))
id="${ids[0]}"

if wait_python 12 '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$id"'")]
sys.exit(0 if w and w[0]["maximized"] else 1)'; then
  pass "a lone window is maximized"
else
  fail "a lone window was not maximized ($(state_expr '[(w["id"], w["maximized"]) for w in d["windows"]]'))"
fi

# Force it out of the maximized state; the model (and the 700 ms sweep) must
# put it back.
adrt UnmaximizeWindow "$id" >/dev/null
if wait_python 10 '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$id"'")]
sys.exit(0 if w and w[0]["maximized"] else 1)'; then
  pass "an unmaximized lone window is maximized again"
else
  fail "lone window left unmaximized ($(state_expr '[(w["id"], w["maximized"], w["rect"]) for w in d["windows"]]'))"
fi

poll "the window fills the work area" '
import json, sys
d = json.load(sys.stdin)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
w = [x for x in d["windows"] if x["id"] == int("'"$id"'")]
if not w:
    print("window gone"); sys.exit(1)
r = w[0]["rect"]
sys.exit(0 if r["width"] >= area["width"] - 2 and r["height"] >= area["height"] - 2 else 1)
' 25

ensure_clean
summary
