#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# A138 Screen topology, gated by signature (1 to 4 screens, any arrangement).
#
# The case declares the exact topology signature it needs — the
# resolution-independent string from src/core/topology.ts: screen count,
# per-screen orientation, and the relative arrangement (which screens share a
# row, a column, a diagonal). It computes the signature the harness actually
# has and runs only on an exact match; otherwise it skips, naming both.
#
#   ADRT_TOPO_EXPECT='2:LP:01R'  # the matrix runs one declared combination
#   (unset)                      # accept any canonical 1-4 screen topology
#
# On the topology it matches it asserts: every screen's own split axis matches
# its orientation (portrait stacks top/bottom, landscape side by side) and the
# window is contained in that screen; and a window moved from one screen onto an
# adjacent one arrives on the side it came from (slot 0 from left/above, slot 1
# from right/below), pairing with the resident. The matrix
# (scripts/topology-matrix.sh) starts one nested Shell per canonical
# combination with its ADRT_MONITORS spec, arranges the real virtual monitors
# into its shape, and runs this scenario with the matching ADRT_TOPO_EXPECT.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
# Ignore minimum sizes so the axis itself is what is tested: a small portrait
# screen can otherwise (correctly) fall back to a side-by-side split.
set_setting min-size-policy ignore

sig="$(topology_signature)"
expect="${ADRT_TOPO_EXPECT:-}"
if [ -n "$expect" ]; then
  if [ "$sig" != "$expect" ]; then
    skip "topology $sig present, this case needs $expect"
    ensure_clean
    summary
    exit 0
  fi
elif ! topology_canonical_signatures | grep -qxF "$sig"; then
  skip "topology $sig present, this case needs a canonical 1-4 screen topology"
  ensure_clean
  summary
  exit 0
fi

log "topology $sig"

spawn_window >/dev/null
wait_count 1 15 || true
ID="$(list_ids | awk '{print $1}')"
if [ -z "$ID" ]; then
  fail "no test window opened"
  ensure_clean
  summary
  exit 1
fi

# Every screen: the window reaches it, and its own split axis matches its own
# orientation, with the window contained in that screen.
mapfile -t IDXS < <(dump | python3 -c '
import json, sys
print("\n".join(str(m["index"]) for m in sorted(json.load(sys.stdin)["monitors"], key=lambda m: m["index"])))')

for idx in "${IDXS[@]}"; do
  if ! topology_move_screen "$ID" "$idx"; then
    fail "topology $sig: could not walk the test window to screen $idx"
    continue
  fi
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

# The cross-screen side rule, on the first adjacent pair the topology has (a
# single screen has none). A resident is put on the target, then the lone window
# is moved onto it from the known side: it must take the slot on that side and
# push the resident to the other.
read -r SRC DST DIR ARRIVAL <<<"$(topology_first_adjacency)"

if [ "$SRC" != "none" ] && [ "$ARRIVAL" != "-1" ]; then
  if ! topology_move_screen "$ID" "$SRC"; then
    fail "topology $sig: could not return the test window to screen $SRC"
  else
    # Minimize the mover first, so the resident opens alone and crosses to the
    # target alone (a visible pair would swap instead of moving). The mover is
    # restored and then walks onto the occupied target.
    adrt MinimizeWindow "$ID" >/dev/null 2>&1 || true
    if ! wait_python 15 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(w['id']==$ID and w['minimized'] for w in d['windows']) else 1)"; then
      fail "topology $sig: the test window did not minimize before the side test"
    else
      before_ids="$(list_ids)"
      spawn_window >/dev/null
      wait_python 15 "import json,sys; sys.exit(0 if len(json.load(sys.stdin)['windows']) >= 2 else 1)" || true
      sleep 1
      RESIDENT="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
      if [ -z "$RESIDENT" ]; then
        fail "topology $sig: no resident window opened for the side test"
      elif ! topology_move_screen "$RESIDENT" "$DST"; then
        fail "topology $sig: could not put the resident on screen $DST"
      else
        adrt ActivateWindow "$ID" >/dev/null 2>&1 || true
        if ! wait_python 15 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(w['id']==$ID and not w['minimized'] for w in d['windows']) else 1)"; then
          fail "topology $sig: the test window did not restore before the side test"
        else
          # Re-establish the two ends, then let the mover cross with the same
          # retrying walk the earlier phases use; the resident stays put.
          topology_move_screen "$ID" "$SRC" || true
          if ! wait_python 15 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(w['id']==$RESIDENT and w['monitor']==$DST for w in d['windows']) else 1)"; then
            fail "topology $sig: the resident left screen $DST before the arrival"
          elif ! topology_move_screen "$ID" "$DST"; then
            fail "topology $sig: the test window did not arrive on screen $DST"
          else
            wait_settled 15
            poll "topology $sig: arriving from the $DIR takes slot $ARRIVAL on screen $DST" "
import json, sys
d = json.load(sys.stdin)
w = next((w for w in d['windows'] if w['id'] == $ID), None)
r = next((w for w in d['windows'] if w['id'] == $RESIDENT), None)
if w is None or r is None:
    print('window gone'); sys.exit(1)
if w['monitor'] != $DST or r['monitor'] != $DST:
    print('not both on screen', $DST, w['monitor'], r['monitor']); sys.exit(1)
if w['workspace'] != r['workspace']:
    print('not paired', w['workspace'], r['workspace']); sys.exit(1)
if w['slot'] != $ARRIVAL:
    print('the arrival took slot', w['slot'], 'expected', $ARRIVAL); sys.exit(1)
if r['slot'] != $(( 1 - ARRIVAL )):
    print('the resident is in slot', r['slot'], 'expected', $(( 1 - ARRIVAL ))); sys.exit(1)
print('arrival slot', w['slot'], 'resident slot', r['slot'])
" 25
          fi
        fi
      fi
    fi
  fi
fi

ensure_clean
summary
