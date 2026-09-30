#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A51 Adrt only reaps the workspaces it created, and never one that holds a
# window. Workspaces the user or the session own are left alone, so there is no
# add/remove churn against GNOME's dynamic workspaces.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
wait_settled 12

# A workspace that is empty and not Adrt's must survive: GNOME's dynamic
# workspaces keep one at the end, and reaping it just makes the compositor
# re-create it (churn).
before="$(state_expr 'd["workspaces"]')"
foreign="$(dump | python3 -c '
import json,sys
d = json.load(sys.stdin)
used = {w["workspace"] for w in d["windows"]}
empties = [i for i in range(d["workspaces"]) if i not in used]
print(empties[-1] if empties else -1)')"
echo "workspaces=$before foreign empty=$foreign"

sleep 5
after="$(state_expr 'd["workspaces"]')"
if [ "$after" = "$before" ]; then
  pass "the workspace count is stable (no prune churn)"
else
  fail "workspace count churned ($before -> $after)"
fi

# No repeated removal of the same index in the recent history.
hist="$(history_file)"
if [ -f "$hist" ]; then
  churn="$(python3 - "$hist" <<'PY'
import sys, json
lines = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
removals = [d for d in lines if d.get("ev") == "ws_removed" and d.get("reason") == "pruned"]
if not removals:
    print(0); raise SystemExit
window = removals[-6:]
span = window[-1]["t"] - window[0]["t"]
indices = [d.get("workspaceId") for d in window]
print(len(window) if span < 4000 and len(set(indices)) < len(indices) else 0)
PY
)"
  if [ "$churn" = "0" ]; then
    pass "no repeated prune of the same workspace"
  else
    fail "prune churn detected ($churn removals within 4s)"
  fi
fi

ensure_clean
summary
