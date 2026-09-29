#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A43 Closing the last window on a workspace switches away and removes it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
spawn_window >/dev/null
wait_count 3 15 || true
wait_settled 12

read -r third third_ws <<<"$(dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"]]
pair_ws = min(w["workspace"] for w in ws)
extra = [w for w in ws if w["workspace"] != pair_ws]
w = max(extra, key=lambda x: x["workspace"])
print(w["id"], w["workspace"])
')"
before="$(state_expr 'd["workspaces"]')"
echo "closing $third on ws$third_ws (workspaces=$before)"

close_window "$third"

# The user must be switched away from the emptied workspace...
if wait_for 12 bash -c "
  d=\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[\"activeWorkspace\"])')
  [ \"\$d\" != '$third_ws' ]
"; then
  pass "the view switched away from the emptied workspace"
else
  fail "the view stayed on the emptied workspace"
fi

# ...and the empty workspace must be removed.
if wait_for 20 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"workspaces\"])')\" -lt '$before' ]"; then
  pass "the emptied workspace was removed"
else
  fail "the emptied workspace was not removed ($before -> $(state_expr 'd["workspaces"]'))"
fi

ensure_clean
summary
