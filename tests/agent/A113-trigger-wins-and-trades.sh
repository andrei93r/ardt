#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A113 When a split cannot exist the trigger wins (§10 step 4): on a
# single-workspace screen the window that does not fit keeps the screen
# maximized and the other minimizes; restoring the other reverses the two.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
set_static_workspaces 1

spawn_window >/dev/null
wait_count 1 15 || true
sleep 1
A="$(list_ids)"

# A client that insists on a width wider than half the screen: a split is
# impossible, so the newcomer is the trigger.
spawn_window "python3 $ROOT_DIR/tests/support/refusing-client.py 900 400 stubborn" >/dev/null
wait_count 2 20 || true
B="$(list_ids | tr ' ' '\n' | grep -v "^$A$" | tr -d '\n' | xargs)"
wait_settled 12

poll "the refusing newcomer maximizes and the other window minimizes" '
import json, sys
d = json.load(sys.stdin)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not a or not b:
    print("window gone"); sys.exit(1)
if not b[0]["maximized"]:
    print("the trigger is not maximized"); sys.exit(1)
if not a[0]["minimized"]:
    print("the reactor is not minimized"); sys.exit(1)
if d["workspaces"] != 1:
    print("a workspace was created", d["workspaces"]); sys.exit(1)
print("trigger", b[0]["id"], "maximized; reactor minimized")
' 20

# Restoring the reactor makes it the trigger in turn.
adrt ActivateWindow "$A" >/dev/null

poll "restoring the other window makes it the trigger" '
import json, sys
d = json.load(sys.stdin)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not a or not b:
    print("window gone"); sys.exit(1)
if not a[0]["maximized"]:
    print("the restored window did not take the screen"); sys.exit(1)
if not b[0]["minimized"]:
    print("the previous trigger was not minimized"); sys.exit(1)
print("traded: ", a[0]["id"], "maximized;", b[0]["id"], "minimized")
' 25

ensure_clean
summary
