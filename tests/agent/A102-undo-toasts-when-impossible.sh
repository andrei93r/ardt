#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A102 An undo that cannot be applied toasts and changes nothing (§13/§21): when
# an instance the change needs is gone, no partial restore happens.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

decisions_has() {
  adrt DumpDecisions 400 2>/dev/null | python3 "$PARSE" 2>/dev/null | python3 -c "
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get('event') == 'notice' and e.get('key') == '$1' for e in entries) else 1)" 2>/dev/null
}

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
wait_settled 15

# Capture a change (maximize B) and then destroy one of its instances.
adrt MaximizeWindow "$B" >/dev/null
wait_python 20 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(w['id']==$B and w['maximized'] for w in d['windows']) else 1)" || true

close_window "$B"
wait_count 1 20 || true
sleep 1
before_rect="$(window_field "$A" rect)"

adrt Undo >/dev/null 2>&1 || true
if wait_for 8 decisions_has undo-impossible; then
  pass "an undo whose instance is gone is announced"
else
  if wait_for 4 decisions_has nothing-to-undo; then
    pass "an undo with nothing to apply is announced"
  else
    fail "no undo-impossible notice was raised"
  fi
fi

sleep 1
after_rect="$(window_field "$A" rect)"
if [ "$before_rect" = "$after_rect" ]; then
  pass "nothing was applied by the impossible undo"
else
  fail "the impossible undo moved a window ($before_rect -> $after_rect)"
fi

# A fresh undo with no change at all also announces itself.
adrt Undo >/dev/null 2>&1 || true
if wait_for 8 decisions_has nothing-to-undo; then
  pass "an undo with nothing to revert is announced"
else
  fail "no nothing-to-undo notice was raised"
fi

ensure_clean
summary
