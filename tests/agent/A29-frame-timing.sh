#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A29 Frame timing: a retile writes history events without errors.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
set_setting trace-enabled true
set_setting debug-enabled true
sleep 1
open_pair
ids=($(list_ids))
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.4 >/dev/null
wait_settled 25

file="$(history_file)"
if [ -f "$file" ]; then
  if grep -q '"ev":"tile"' "$file"; then pass "history recorded tile events"; else fail "no tile events in history"; fi
  if grep -qE '\[adrt\] (ERROR|WARN)' "$ADRT_STATE_DIR/shell.log"; then fail "extension logged an ERROR/WARN"; else pass "no ERROR/WARN in the journal"; fi
else
  fail "history file $file was not created"
fi

set_setting trace-enabled false
set_setting debug-enabled false
ensure_clean
summary
