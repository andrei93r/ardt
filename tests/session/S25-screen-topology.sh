#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# S25 Screen topology: every connected screen keeps its own split axis, for any
# arrangement (any count, any positions, any resolutions/orientations). It walks
# one test window to each monitor with the real cross-screen move and, on every
# one, asserts the axis the extension reports for that screen matches its
# orientation (portrait stacks top/bottom, landscape side by side) and the window
# is inside that screen.
#
# Live cannot simulate a topology, so the gate is the same signature the nested
# case uses (src/core/topology.ts): it computes the signature of the real
# screens and runs only when it is one of the canonical 1-4 screen topologies,
# skipping otherwise with both the present and the wanted signatures named.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

sig="$(topology_signature)"
if ! topology_canonical_signatures | grep -qxF "$sig"; then
  skip "topology $sig present, S25 needs a canonical 1-4 screen topology (one row/column/L/2x2)"
  summary
  exit 0
fi

spawn "$FILES"
wait_tests 1 15 || true
ID="$(test_ids | awk '{print $1}')"
if [ -z "$ID" ]; then
  fail "no test window opened"
  summary
  exit 1
fi

mapfile -t IDXS < <(dump | python3 -c '
import json, sys
print("\n".join(str(m["index"]) for m in sorted(json.load(sys.stdin)["monitors"], key=lambda m: m["index"])))')

for idx in "${IDXS[@]}"; do
  if ! topology_move_screen "$ID" "$idx"; then
    fail "topology $sig: could not walk the test window to screen $idx"
    continue
  fi
  pass "topology $sig: the test window reached screen $idx"
  check_python "topology $sig: screen $idx keeps its own split axis and contains the window" "
import json, sys
d = json.load(sys.stdin)
m = next(x for x in d['monitors'] if x['index'] == $idx)
g = m['geometry']
axis = 'vertical' if g['height'] > g['width'] else 'horizontal'
w = next((w for w in d['windows'] if w['id'] == $ID), None)
if w is None:
    print('window gone'); sys.exit(1)
if w['axis'] != axis:
    print('axis', w['axis'], 'expected', axis, 'for', g['width'], 'x', g['height']); sys.exit(1)
r = w['rect']
if r['x'] < g['x'] - 2 or r['y'] < g['y'] - 2 or r['x'] + r['width'] > g['x'] + g['width'] + 2 or r['y'] + r['height'] > g['y'] + g['height'] + 2:
    print('outside the screen', r, g); sys.exit(1)
print('axis', w['axis'], 'inside', g)"
done

summary
