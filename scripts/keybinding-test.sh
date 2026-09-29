#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Run the keybinding checks (A22-A24) against the *interactive* session.
#
# Keybindings cannot be driven inside a nested headless Shell: it does not own
# the input seat. This script injects real key events with ydotool, so it must
# run where Adrt is enabled and focused.
#
#   WARNING: it injects Super+Z, Super+Alt+l and Super+f into your session.
#
# Requirements:
#   - Adrt enabled and running:  gnome-extensions info adrt@adrt.dev
#   - ydotoold running with /dev/uinput access
#
# Usage: bash scripts/keybinding-test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARSE="$ROOT/tests/agent/parse.py"
CLIENT="${ADRT_TEST_CLIENT:-gnome-text-editor --new-window}"

checks=0
failures=0

pass() { checks=$((checks + 1)); printf 'PASS  %s\n' "$*"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf 'FAIL  %s\n' "$*"; }
skip() { printf 'SKIP  %s\n' "$*"; }

adrt() {
  gdbus call --session --dest org.adrt.Adrt --object-path /org/adrt/Adrt \
    --method "org.adrt.Adrt.$1" -- "${@:2}"
}

dump() { adrt DumpState | python3 "$PARSE"; }

ids() { adrt ListWindows | python3 "$PARSE" | python3 -c 'import json,sys; print(" ".join(str(w["id"]) for w in json.load(sys.stdin)))'; }

count() { dump | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["windows"]))'; }

field() {
  dump | python3 -c "
import json,sys
for w in json.load(sys.stdin)['windows']:
    if w['id'] == int('$1'):
        print(w['$2']); break
"
}

wait_count() {
  local target="$1" deadline=$((SECONDS + 20))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(count)" -ge "$target" ] && return 0
    sleep 0.5
  done
  return 1
}

# --- preconditions ---------------------------------------------------------
if ! adrt DumpState >/dev/null 2>&1; then
  echo "keybinding-test: org.adrt.Adrt is not on the session bus." >&2
  echo "  Enable Adrt and log out/in first: gnome-extensions enable adrt@adrt.dev" >&2
  exit 2
fi
if ! command -v ydotool >/dev/null 2>&1 || ! pgrep -x ydotoold >/dev/null 2>&1; then
  echo "keybinding-test: ydotool/ydotoold not ready." >&2
  exit 2
fi

echo "This will inject Super+Z, Super+Alt+l and Super+f into your session."
echo

# --- fixtures --------------------------------------------------------------
adrt SpawnWindow "$CLIENT" >/dev/null || true
adrt SpawnWindow "$CLIENT" >/dev/null || true
wait_count 2 || { echo "keybinding-test: could not open two windows" >&2; exit 1; }
sleep 2
set -- $(ids)
A="$1"
B="$2"
echo "windows: a=$A b=$B"

# --- A22 undo --------------------------------------------------------------
adrt ActivateWindow "$A" >/dev/null
sleep 1
before="$(field "$A" rect)"
adrt SimulateResize "$A" "$B" 0.25 >/dev/null
sleep 2
ydotool key 125:1 44:1 44:0 125:0
sleep 2
after="$(field "$A" rect)"
if [ "$before" = "$after" ]; then pass "A22 Super+Z restored the previous rects"; else fail "A22 Super+Z did nothing (before $before, after $after)"; fi

# --- A23 focus -------------------------------------------------------------
adrt ActivateWindow "$A" >/dev/null
sleep 1
border_before="$(dump | python3 -c 'import json,sys; print(json.load(sys.stdin)["border"]["rect"])')"
ydotool key 125:1 56:1 38:1 38:0 56:0 125:0
sleep 2
border_after="$(dump | python3 -c 'import json,sys; print(json.load(sys.stdin)["border"]["rect"])')"
if [ "$border_before" != "$border_after" ]; then pass "A23 Super+Alt+l moved focus"; else fail "A23 Super+Alt+l did not move focus"; fi

# --- A24 float -------------------------------------------------------------
adrt ActivateWindow "$A" >/dev/null
sleep 1
ydotool key 125:1 33:1 33:0 125:0
sleep 2
layer="$(field "$A" layer)"
if [ "$layer" = "2" ]; then pass "A24 Super+F floated the focused window"; else fail "A24 Super+F did not float (layer $layer)"; fi

# --- cleanup ---------------------------------------------------------------
for id in $A $B; do adrt CloseWindow "$id" >/dev/null 2>&1 || true; done

echo
echo "checks=$checks failures=$failures"
[ "$failures" -eq 0 ]
