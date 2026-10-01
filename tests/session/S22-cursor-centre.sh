#!/usr/bin/env bash
# Generated with AI for personal use.
# S22 Cursor to the centre of the active window (requested feature): the trigger
# puts the pointer in the focused window's middle, and with `cursor-follows-focus`
# on it follows every focus change. The setting defaults to off. The scenario
# skips with a reason on a build that does not expose the feature yet.
#
# The keybinding itself (kb-cursor-centre) cannot be injected from here: the
# live session owns the input seat and ydotool is not available, so this drives
# the same code path through the CursorToCentre trigger and the automatic mode.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

EXT_SCHEMAS="$HOME/.local/share/gnome-shell/extensions/adrt@adrt.dev/schemas"

# Support gate: the setting, the DumpState pointer and the trigger must exist.
if ! gsettings --schemadir "$EXT_SCHEMAS" list-keys org.gnome.shell.extensions.adrt 2>/dev/null | grep -qx 'cursor-follows-focus'; then
  skip "the running build has no cursor-follows-focus setting (rebuild, install, log back in)"
  summary
  exit $?
fi
if ! dump | python3 -c 'import json,sys; sys.exit(0 if "pointer" in json.load(sys.stdin) else 1)' 2>/dev/null; then
  skip "the running build does not report the pointer in DumpState"
  summary
  exit $?
fi
if ! adrt CursorToCentre >/dev/null 2>&1; then
  skip "the running build does not expose the CursorToCentre trigger"
  summary
  exit $?
fi

cursor_follows_focus() {
  gsettings --schemadir "$EXT_SCHEMAS" set org.gnome.shell.extensions.adrt cursor-follows-focus "$1"
}
cursor_follows_focus false

spawn "$FILES"
wait_tests 1 15 || true
spawn "$CHROME"
wait_tests 2 15 || true
first="$(test_ids | awk '{print $1}')"
second="$(test_ids | awk '{print $2}')"

if [ -z "$first" ] || [ -z "$second" ] || [ "$first" = "$second" ]; then
  fail "two distinct test windows did not open (got '$first' '$second')"
  cursor_follows_focus false
  summary
  exit $?
fi

adrt ActivateWindow "$first" >/dev/null
wait_python 10 "import json,sys; sys.exit(0 if json.load(sys.stdin)['focused'] == $first else 1)" || true

# Move the pointer away first, so a no-op cannot pass by luck.
adrt InjectPointerMove 5 5 >/dev/null 2>&1 || true
sleep 0.3

adrt CursorToCentre >/dev/null 2>&1 || true

if wait_python 10 "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $first), None)
p = d.get('pointer') or {}
if not w or 'x' not in p:
    sys.exit(1)
cx = w['rect']['x'] + w['rect']['width'] / 2
cy = w['rect']['y'] + w['rect']['height'] / 2
sys.exit(0 if abs(p['x'] - cx) <= 3 and abs(p['y'] - cy) <= 3 else 1)"; then
  pass "the trigger puts the pointer in the middle of the focused window"
else
  check_python "the trigger puts the pointer in the middle of the focused window" "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $first), None)
print('pointer', d.get('pointer'), 'window', (w or {}).get('rect')); sys.exit(1)
"
fi

# Automatic mode: with cursor-follows-focus on, a focus change moves the pointer.
cursor_follows_focus true
adrt ActivateWindow "$second" >/dev/null
if wait_python 12 "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $second), None)
p = d.get('pointer') or {}
if not w or 'x' not in p:
    sys.exit(1)
cx = w['rect']['x'] + w['rect']['width'] / 2
cy = w['rect']['y'] + w['rect']['height'] / 2
sys.exit(0 if abs(p['x'] - cx) <= 3 and abs(p['y'] - cy) <= 3 else 1)"; then
  pass "with cursor-follows-focus on, the pointer follows a focus change"
else
  check_python "with cursor-follows-focus on, the pointer follows a focus change" "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $second), None)
print('pointer', d.get('pointer'), 'window', (w or {}).get('rect')); sys.exit(1)
"
fi
cursor_follows_focus false

summary
