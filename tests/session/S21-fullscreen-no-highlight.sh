#!/usr/bin/env bash
# Generated with AI for personal use.
# S21 No highlight on a fullscreen window (user report): a fullscreen window
# covers the whole monitor, so an "active" marker drawn on it is noise and can
# show over its content. The highlight must be gone while it is fullscreen and
# back once fullscreen is left.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn "$FILES"
wait_tests 1 12 || true
id="$(test_ids | awk '{print $1}')"
adrt ActivateWindow "$id" >/dev/null

# Precondition: the highlight is visible on the focused window, so a later
# "hidden" cannot be the border never having been shown at all.
if wait_python 20 'import json,sys
sys.exit(0 if json.load(sys.stdin)["border"]["visible"] else 1)'; then
  pass "the highlight is visible on a normal focused window"
else
  fail "the highlight never appeared (suppressed: $(state_expr 'd["indicator"]["suppressed"]'))"
fi

# Fullscreen the focused window and wait until it really fills the monitor.
adrt ToggleFullscreen "$id" >/dev/null 2>&1 || true
if wait_python 15 "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $id), None)
m = next((x for x in d['monitors'] if x['index'] == (w['monitor'] if w else 0)), d['monitors'][0])
g = m['geometry']
sys.exit(0 if w and w['rect']['width'] >= g['width'] - 2 and w['rect']['height'] >= g['height'] - 2 else 1)"; then
  pass "the window fills the monitor in fullscreen"
else
  skip "the running build did not put the window into fullscreen"
  summary
  exit $?
fi

# The rule: hidden while fullscreen, with the reason the model names (§11).
if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if (not d["border"]["visible"]) and ("fullscreen" in d["indicator"]["suppressed"]) else 1)'; then
  pass "the highlight is hidden on the fullscreen window"
else
  check_python "the highlight is hidden on the fullscreen window" '
import json, sys
d = json.load(sys.stdin)
if d["border"]["visible"]:
    print("the highlight is still visible on a fullscreen window"); sys.exit(1)
print("suppressions:", d["indicator"]["suppressed"]); sys.exit(1)
'
fi

# Leaving fullscreen brings the highlight back.
adrt ToggleFullscreen "$id" >/dev/null 2>&1 || true
if wait_python 15 'import json,sys
sys.exit(0 if json.load(sys.stdin)["border"]["visible"] else 1)'; then
  pass "the highlight returns when fullscreen is left"
else
  fail "the highlight did not come back (suppressed: $(state_expr 'd["indicator"]["suppressed"]'))"
fi

summary
