#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A13 Lock screen: the extension pauses and hides the indicator.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 1

# §19 fix: the metadata must declare `unlock-dialog`, or the Shell disables the
# extension on lock and the notify::current-mode handler never runs. This is the
# property the (otherwise misleading) SimulateSessionMode scenarios cannot check.
meta="$(ext_dir)/metadata.json"
if python3 -c "
import json, sys
try:
    m = json.load(open('$meta'))
except Exception as e:
    print('metadata: ', e); sys.exit(1)
modes = m.get('session-modes', [])
if 'user' not in modes or 'unlock-dialog' not in modes:
    print('session-modes', modes); sys.exit(1)
print('session-modes', modes)
"; then
  pass "metadata keeps the extension resident on the lock screen"
else
  fail "metadata.json does not declare session-modes [user, unlock-dialog]"
fi

assert_true "SimulateSessionMode returns true" "$(adrt SimulateSessionMode unlock-dialog | python3 "$PARSE")"
sleep 1
assert_eq "extension is paused" "true" "$(state_expr 'str(d["paused"]).lower()')"
assert_eq "the mode property follows the lock" "unlock-dialog" "$(state_expr 'd["mode"]')"
assert_eq "border is hidden" "false" "$(border_visible)"

adrt SimulateSessionMode user >/dev/null
wait_settled 12
assert_eq "extension resumed" "false" "$(state_expr 'str(d["paused"]).lower()')"
assert_eq "the mode property follows the unlock" "user" "$(state_expr 'd["mode"]')"

ensure_clean
summary
