#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A173 The focus highlight is not drawn before the window is in position (§23.3).
# A focus change arrives *before* the model has placed the window, so the rect the
# focus signal carries is the window's pre-placement frame. Drawing the border
# then paints the highlight at the old position for a frame and snaps it into
# place — the bug reported by the recorder as "focus is drawn before the window
# is in position and stabilized".
#
# The journal is the evidence, because a 20 Hz snapshot can miss the one-frame
# transient but the journal never does: `border.focus` with a non-null `rect` is
# a *draw*. The invariant: while a focus change to a window is still open (the
# model has not yet reported its focus-driven layout), no border may be drawn for
# that window.
#
# The headless Shell finishes placing a window before the compositor's focus
# signal reaches the extension, so a single focus change rarely exposes the race.
# The scenario therefore cycles focus between a tiled pair many times: a build
# that settles the border on an unrelated model pass (a route, a self-heal, a
# drag) draws at the pre-placement frame within a handful of episodes, and the
# assertion catches it. A build that settles only on the focus layout, or on the
# window's frame actually moving, never draws early.
#
# This pins the *settle timing* of the border; the pure `BorderState` gate itself
# (a fresh focus does not draw until settled) is pinned by the core unit tests,
# which can stage the pre-placement frame directly.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
adrt ActivateWorkspace 0 >/dev/null 2>&1 || true

# A pair gives two tiles to move focus between.
open_pair
if [ "$(count_windows)" -lt 2 ]; then
  skip "could not open a pair; the focus ordering cannot be observed"
  ensure_clean
  summary
  exit 0
fi
ids=($(list_ids))
first="${ids[0]}"
second="${ids[1]}"

# Cycle focus many times. Each change is a fresh pre-placement signal, so a build
# that draws early does so within a few episodes instead of relying on luck.
for _ in $(seq 1 25); do
  adrt ActivateWindow "$first" >/dev/null 2>&1 || true
  adrt ActivateWindow "$second" >/dev/null 2>&1 || true
done
# End on a *confirmed* focus change to each window in turn: activating the window
# that already holds focus is a no-op, so without this the final episode may never
# have a focus-driven pass and the control below would be unreliable.
adrt ActivateWindow "$first" >/dev/null 2>&1 || true
wait_python 15 "import json,sys; sys.exit(0 if json.load(sys.stdin).get('focused') == $first else 1)" || true
adrt ActivateWindow "$second" >/dev/null 2>&1 || true
wait_python 15 "import json,sys; sys.exit(0 if json.load(sys.stdin).get('focused') == $second else 1)" || true
sleep 1

# Walk the journal in sequence. A focus change to a window opens an episode; the
# model's focus-driven layout closes it; a drawn border for that window while the
# episode is open is the violation.
order_ok="$(journal_tail 4000 '' | python3 -c "
import json, sys
rows = [r for r in json.load(sys.stdin) if isinstance(r, dict)]
pending = set()
episodes = 0
violations = []
for r in rows:
    src, ev = r.get('source'), r.get('event')
    if src == 'host' and ev == 'focus-changed' and r.get('id') is not None:
        pending.add(r.get('id'))
        episodes += 1
    elif src == 'model' and ev == 'layout' and r.get('reason') == 'focus':
        pending.clear()
    elif (src == 'border' and ev == 'focus' and r.get('id') is not None
          and r.get('rect') is not None and r.get('id') in pending):
        violations.append(r.get('seq'))
if episodes == 0:
    print('no host focus change was recorded'); sys.exit(1)
if violations:
    print('a drawn border precedes the focus layout in %d of %d focus episodes (first at seq %s)'
          % (len(violations), episodes, violations[0]))
    sys.exit(1)
print('no border was drawn before its focus layout across %d focus episodes' % episodes)
")"
if [ "$(printf '%s' "$order_ok" | grep -c 'no border was drawn before')" -ge 1 ]; then
  pass "the focus highlight is never drawn before the model places the window ($order_ok)"
else
  fail "the focus highlight was drawn before the window was placed ($order_ok)"
fi

# Control: the border really is drawn for the focused window, so the ordering
# check above is not passing merely because the border never draws.
if wait_python 15 "
import json, sys
d = json.load(sys.stdin)
b = d.get('border') or {}
sys.exit(0 if b.get('visible') and d.get('focused') == int('$second') else 1)"; then
  pass "the focused window owns the highlight once it has settled"
else
  diag_focused="$(state_expr 'd.get("focused")')"
  diag_border="$(state_expr 'd.get("border")')"
  diag_suppressed="$(state_expr 'd["indicator"]["suppressed"]')"
  diag_overview="$(state_expr 'd.get("overview")')"
  fail "the focused window never got a highlight, so the ordering check is vacuous (focused: $diag_focused, border: $diag_border, suppressed: $diag_suppressed, overview: $diag_overview)"
fi

ensure_clean
summary
