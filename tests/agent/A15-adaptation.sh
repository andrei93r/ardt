#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A15 Adaptation: injected verify failures create an adaptation record.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
adrt ResetPerApp org.gnome.TextEditor >/dev/null 2>&1 || true
open_pair
ids=($(list_ids))
adrt InjectVerifyFailure "${ids[0]}" 6 >/dev/null
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.35 >/dev/null

if wait_for 25 bash -c "bash '$NESTED' dbus GetAdaptations | python3 '$PARSE' | python3 -c 'import json,sys; sys.exit(0 if len(json.load(sys.stdin)) > 0 else 1)'"; then
  pass "adaptation record created after repeated refusals"
else
  fail "no adaptation record was created"
fi

ensure_clean
adrt ResetPerApp org.gnome.TextEditor >/dev/null 2>&1 || true
summary
