#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A53 A workspace reduced to a single tile plus an automatic float re-tiles
# both: no floating leftover once the pair loses a member.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
pair_ws="$(window_field "$A" workspace)"

# Maximize B: it gets its own workspace.
adrt MaximizeWindow "$B" >/dev/null
wait_python 15 '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
sys.exit(0 if b and b[0]["maximized"] and b[0]["workspace"] != int("'"$pair_ws"'") else 1)' || true

# Put a second window back on the pair's workspace so it holds two tiles.
adrt ActivateWorkspace "$pair_ws" >/dev/null
sleep 1
spawn_window >/dev/null
wait_count 3 15 || true
wait_settled 12

# Return B: it floats over the full pair.
adrt UnmaximizeWindow "$B" >/dev/null
if ! wait_python 15 '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
sys.exit(0 if b and b[0]["layer"] == 2 else 1)'; then
  fail "the returned window did not float over the pair"
  ensure_clean
  summary
  exit 1
fi
pass "the returned window floats over the pair"

# Remove one of the two tiles: the workspace is left with one tile and the
# auto-float, and both must be tiled again.
adrt CloseWindow "$A" >/dev/null
if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
ws = int("'"$pair_ws"'")
here = [w for w in d["windows"] if w["workspace"] == ws and w["tileable"] and not w["minimized"]]
floating = [w for w in here if w["layer"] == 2]
tiled = [w for w in here if w["layer"] != 2]
sys.exit(0 if len(tiled) == 2 and not floating else 1)'; then
  pass "the remaining two windows re-tiled (no floating leftover)"
else
  check_python "the remaining two windows re-tiled (no floating leftover)" '
import json, sys
d = json.load(sys.stdin)
ws = int("'"$pair_ws"'")
print([(w["id"], w["layer"], w["rect"]) for w in d["windows"] if w["workspace"] == ws]); sys.exit(1)
'
fi

ensure_clean
summary
