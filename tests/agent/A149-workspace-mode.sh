#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A145 Workspace-mode settings (§1): `dynamic-workspaces`,
# `workspaces-only-on-primary` and `num-workspaces` are read per drain to decide
# each screen's class and slot routing. Flipping one must re-derive that state at
# once (a `screens_changed`/`workspace-mode` decision) instead of staying stale
# until an unrelated Mutter signal.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean

# Baseline: GNOME defaults (dynamic, only-primary, four workspaces).
check_python "DumpState exposes the live workspace-mode settings" '
import json, sys
w = json.load(sys.stdin).get("workspaceMode")
if not isinstance(w, dict) or not all(k in w for k in ("dynamic", "onlyPrimary", "numWorkspaces")):
    print("workspaceMode", w); sys.exit(1)
print("workspaceMode", w)
'

# 1. dynamic-workspaces off: the extension must re-derive.
set_system_setting org.gnome.mutter dynamic-workspaces false
if wait_decisions 20 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if any(e.get("event") == "screens_changed" and e.get("reason") == "workspace-mode"
                  and e.get("key") == "dynamic-workspaces" for e in d) else 1)'; then
  pass "flipping dynamic-workspaces re-derives the placement state"
else
  fail "no screens_changed/workspace-mode decision after dynamic-workspaces"
fi
assert_eq "DumpState reflects dynamic-workspaces off" "false" "$(state_expr 'str(d["workspaceMode"]["dynamic"]).lower()')"

# 2. num-workspaces: a second key on the wm-preferences schema.
set_system_setting org.gnome.desktop.wm.preferences num-workspaces 2
if wait_decisions 20 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if any(e.get("event") == "screens_changed" and e.get("reason") == "workspace-mode"
                  and e.get("key") == "num-workspaces" for e in d) else 1)'; then
  pass "flipping num-workspaces re-derives the placement state"
else
  fail "no screens_changed/workspace-mode decision after num-workspaces"
fi
assert_eq "DumpState reflects num-workspaces" "2" "$(state_expr 'd["workspaceMode"]["numWorkspaces"]')"

# 3. workspaces-only-on-primary: the third watched key.
set_system_setting org.gnome.mutter workspaces-only-on-primary false
if wait_decisions 20 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if any(e.get("event") == "screens_changed" and e.get("reason") == "workspace-mode"
                  and e.get("key") == "workspaces-only-on-primary" for e in d) else 1)'; then
  pass "flipping workspaces-only-on-primary re-derives the placement state"
else
  fail "no screens_changed/workspace-mode decision after workspaces-only-on-primary"
fi
assert_eq "DumpState reflects workspaces-only-on-primary off" "false" "$(state_expr 'str(d["workspaceMode"]["onlyPrimary"]).lower()')"

# 4. The extension keeps tiling coherent after the flips.
open_pair
check_python "tiling is coherent after the workspace-mode flips" '
import json, sys
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
for i in range(len(tiles)):
    for j in range(i + 1, len(tiles)):
        x, y = tiles[i]["rect"], tiles[j]["rect"]
        if x["x"] < y["x"] + y["width"] - 2 and y["x"] < x["x"] + x["width"] - 2 \
           and x["y"] < y["y"] + y["height"] - 2 and y["y"] < x["y"] + x["height"] - 2:
            print("stacked", x, y); sys.exit(1)
print("coherent", len(tiles), "tiles")
'

ensure_clean
summary
