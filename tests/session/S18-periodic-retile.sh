#!/usr/bin/env bash
# Generated with AI for personal use.
# S18 The tiling plan is re-run on its own slow cadence, and a window that
# drifted out of the layout is put back without any further user action.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
spawn
wait_tests 2 15 || true
sleep 2
ids="$(test_ids)"
set -- $ids
target="$1"

adrt ActivateWindow "$target" >/dev/null
sleep 1
wait_python 8 'import json,sys
sys.exit(0 if json.load(sys.stdin)["border"]["visible"] else 1)' || true

before="$(state_expr 'd["motionRetiles"]')"
if wait_python 10 "import json,sys
sys.exit(0 if json.load(sys.stdin)['motionRetiles'] > $before else 1)"; then
  pass "the tiling plan re-runs on its own (was $before)"
else
  fail "no periodic tiling pass (still $(state_expr 'd["motionRetiles"]'))"
fi

# Drift the focused window out of the layout; the plan must win it back to the
# width it had (the live session may have a persisted split ratio).
plan_width="$(state_expr "next((w['rect']['width'] for w in d['windows'] if w['id'] == $target), 0)")"
adrt MoveWindow "$target" 60 90 420 320 >/dev/null
if wait_python 15 "import json,sys
for w in json.load(sys.stdin)['windows']:
    if w['id'] == $target:
        sys.exit(0 if abs(w['rect']['width'] - $plan_width) <= 20 else 1)
sys.exit(1)"; then
  pass "the drifted window was restored to the plan (width $plan_width)"
else
  fail "window stayed at $(state_expr "next(w['rect']['width'] for w in d['windows'] if w['id'] == $target)")"
fi

summary
