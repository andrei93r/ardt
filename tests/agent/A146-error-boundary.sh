#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A146 Error boundary (§36): a throw inside a guarded callback (enable, a signal
# handler, the drain) must be caught, logged and journalled, and must not take
# adrt — or the Shell — down. `InjectFault` runs a real throw through the same
# boundary; the marker it logs is a test-only one so the harness's `[adrt]
# ERROR` journal gate is not tripped by the expected fault.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean

before="$(state_expr 'd.get("errors", 0)')"
assert_true "InjectFault runs through the boundary" "$(adrt InjectFault drain | python3 "$PARSE")"
after="$(state_expr 'd.get("errors", 0)')"
assert_num "the boundary counted the caught fault" ">" "$after" "$before"

# The extension is still alive and answering D-Bus after the caught throw.
assert_true "the extension still answers after a caught fault" "$(adrt DumpState | python3 "$PARSE" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("format") == "adrt.state" else 1)' && echo true || echo false)"

# A second injected fault is also caught (the boundary is not one-shot).
assert_true "a second injected fault is caught" "$(adrt InjectFault signal | python3 "$PARSE")"

# And tiling still works end to end.
open_pair
assert_eq "tiling still works after caught faults" "2" "$(count_windows)"

ensure_clean
summary
