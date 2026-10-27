#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A172 The active-window highlight follows the §23 candidate rule on every path.
# A helper surface — an app's loader or placeholder — can take the focus before
# the real window arrives (a ddterm "prv" window did exactly that). Such a
# surface is neither a tile nor a modal, so `getsActiveHighlight` is false for
# it and the border must not be painted on it: the highlight would be drawn on
# a window that is about to disappear. The focus path refused it, but the state
# path set the border focus on whatever was focused, so the border came back.
#
# `SimulateAbove` is the reproduction: it calls `Meta.Window.make_above()`, the
# real compositor flag a "keep this above the tiling" surface carries. The
# classifier refuses the window for `above`, which is non-tileable and
# non-modal, so the border must not follow it — while the window still owns the
# focus, which is what makes the rule observable.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
spawn_window >/dev/null
wait_count 1 25 || true

helper="$(state_expr 'd["windows"][-1]["id"] if d["windows"] else ""')"
if [ -z "$helper" ]; then
  fail "the helper window was never tracked"
  ensure_clean
  summary
  exit 1
fi

# It must own the focus, or "no border" would prove nothing: the border only
# follows the focused window.
if wait_python 15 "import json,sys; sys.exit(0 if json.load(sys.stdin).get('focused') == $helper else 1)"; then
  pass "the helper window owns the focus"
else
  fail "the helper window never took the focus; the highlight rule cannot be observed"
  ensure_clean
  summary
  exit 1
fi

# A tiled window owns the border; this is the control that proves the scenario
# is looking at a live highlight and not at a border that is simply off.
sleep 1
if wait_python 10 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d['border']['visible'] else 1)"; then
  pass "a tiled, focused window owns the highlight"
else
  fail "the control failed: a tiled focused window has no highlight"
fi

# Now make it a helper surface: `above` is not a tile and not a modal.
adrt SimulateAbove "$helper" >/dev/null 2>&1 || true
if wait_python 15 "
import json, sys
d = json.load(sys.stdin)
w = next((w for w in d['windows'] if w['id'] == $helper), None)
sys.exit(0 if w is not None and not w['tileable'] and w.get('reason') == 'above' else 1)"; then
  pass "the helper surface is not a tile"
else
  fail "the helper surface was still classified as a tile ($(state_expr 'd["windows"][-1].get("reason")'))"
fi

# It must still own the focus after the flag change, or the next assertion
# would pass for the wrong reason.
if wait_python 10 "import json,sys; sys.exit(0 if json.load(sys.stdin).get('focused') == $helper else 1)"; then
  pass "the helper surface still owns the focus"
else
  skip "the helper surface lost the focus when it became non-tileable; the rule cannot be observed"
  ensure_clean
  summary
  exit 0
fi

# The highlight must be gone from it.
if wait_python 10 "
import json, sys
d = json.load(sys.stdin)
b = d.get('border') or {}
sys.exit(0 if not b.get('visible') else 1)"; then
  pass "no highlight is drawn on the focused helper surface"
else
  fail "the highlight was drawn on the focused helper surface ($(state_expr 'json.dumps(d["border"])'))"
fi

# And the journal must end with the border off it. A `focus` with `id: null`
# is a clear; the border may briefly be re-focused while a suppression cycle
# unwinds (the workspace-switch suppress/unsuppress dance), so this checks the
# *final* decision rather than requiring that no focus ever followed.
if journal_tail 400 border | python3 -c "
import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    rows = []
if not isinstance(rows, list):
    rows = []
focuses = [r for r in rows if isinstance(r, dict) and r.get('event') == 'focus']
last = focuses[-1] if focuses else None
if last is None:
    print('no border focus decision at all'); sys.exit(1)
if last.get('id') == $helper:
    print('the border ends focused on the helper', last); sys.exit(1)
print('border ends clear', last)
"; then
  pass "the journal ends with the border cleared off the helper surface"
else
  fail "the journal ends with the border focused on the helper surface"
fi

ensure_clean
summary
