#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A118 A request that changes nothing is announced, never silent (§17/§21):
# nothing to undo, nothing to nudge, and a move on a one-workspace screen all
# raise their plain-language notice.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

decisions_has() {
  local key="$1"
  adrt DumpDecisions 300 2>/dev/null | python3 "$PARSE" 2>/dev/null | python3 -c "
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get('event') == 'notice' and e.get('key') == '$key' for e in entries) else 1)" 2>/dev/null
}

ensure_clean

adrt Undo >/dev/null 2>&1 || true
if wait_for 8 decisions_has nothing-to-undo; then
  pass "an undo with nothing to revert is announced"
else
  fail "no nothing-to-undo notice was raised"
fi

spawn_window >/dev/null
wait_count 1 15 || true
sleep 1
adrt NudgeSplit left 5 >/dev/null 2>&1 || true
if wait_for 8 decisions_has nothing-to-nudge; then
  pass "a nudge with nothing to nudge is announced"
else
  fail "no nothing-to-nudge notice was raised"
fi

# A single-workspace screen has no next workspace to move to.
set_static_workspaces 1
win="$(list_ids | tr ' ' '\n' | head -1)"
adrt ActivateWindow "$win" >/dev/null 2>&1 || true
wait_python 10 "import json,sys; sys.exit(0 if json.load(sys.stdin)['focused'] == $win else 1)" || true
adrt MoveFocusedToWorkspace 1 >/dev/null 2>&1 || true
if wait_for 8 decisions_has cannot-move-workspace; then
  pass "moving on a one-workspace screen is announced"
else
  fail "no cannot-move-workspace notice was raised"
fi

ensure_clean
summary
