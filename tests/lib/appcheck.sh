# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# shellcheck shell=bash
# The shared application-compatibility checklist. Every app gets the SAME
# assertions, driven from DumpState and the decision journal, so a new toolkit
# or a new client is a row, not a new scenario body. Source this from a runner
# library; never execute it directly.
#
# The runner must provide (resolved at call time, so leaving this file
# otherwise standalone is fine):
#   appcheck_reset              close the runner's windows and start clean
#   appcheck_spawn ENV ARGV     open a client; print the new window id ("" on fail)
#   appcheck_close ID           close one tracked window
# and the shared primitives from tests/lib/common.sh: adrt, dump, list_ids,
# poll, check_python, wait_python.
#
# Optionally the runner may provide `appcheck_tearoff ENV ARGV`, which creates a
# tear-off window and prints its id. A runner that cannot drive a real detach
# leaves it undefined; the checklist then skips that item with a reason (the
# nested decision is still covered by A155, the live detach by the S27 suite).

# A per-row skip. It is a named, deliberate outcome — never a failure — and it
# deliberately does NOT print the bare `SKIP` prefix the runner uses to mark the
# whole scenario skipped: one unavailable app must not hide the rows that ran.
appcheck_skip() { printf 'ROW SKIP  %s\n' "$*"; }

# A stable, order-independent snapshot of every tracked window's geometry.
appcheck_geometry() {
  dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ws = sorted(d["windows"], key=lambda w: w["id"])
print(";".join(
    "%s:%s,%s,%s,%s@%s" % (w["id"], w["rect"]["x"], w["rect"]["y"], w["rect"]["width"], w["rect"]["height"], w["workspace"])
    for w in ws
))'
}

# One assertion: wait out a settlement budget, then pass. On failure the
# predicate's own message is reported (one settled sample after the budget),
# never a bare "failed".
appcheck_assert() { # label code [timeout]
  local label="$1" code="$2" timeout="${3:-25}" detail
  if wait_python "$timeout" "$code"; then
    pass "$label"
    return 0
  fi
  detail="$(dump | python3 -c "$code" 2>&1 | tail -1)"
  fail "$label${detail:+ — $detail}"
  return 1
}

# Block until the geometry stops changing for three consecutive polls. This is
# the "the layout settles (no oscillation) within a bounded time" assertion.
appcheck_settles() { # timeout
  local timeout="${1:-20}" prev="__init__" same=0 cur
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    cur="$(appcheck_geometry)"
    if [ "$cur" = "$prev" ]; then
      same=$((same + 1))
      [ "$same" -ge 3 ] && return 0
    else
      same=0
      prev="$cur"
    fi
    sleep 0.4
  done
  return 1
}

# The sequence number of the newest decision, so a phase counts only its own
# decisions even on a worker that already ran other scenarios.
appcheck_journal_seq() {
  adrt DumpDecisions 1 2>/dev/null | python3 "$PARSE" 2>/dev/null | python3 -c 'import json,sys
try:
    e = json.load(sys.stdin)
    print(e[-1]["seq"] if e else 0)
except Exception:
    print(0)' 2>/dev/null || echo 0
}

# How many decisions named EVENT were journalled after SINCE for window ID
# (matched against id/a/b). Prints a number, always.
appcheck_decisions_since() { # since event [id]
  local since="$1" event="$2" id="${3:-}"
  adrt DumpDecisions 400 2>/dev/null | python3 "$PARSE" 2>/dev/null | python3 -c "
import json, sys
since = int('$since')
event = '$event'
wid = '$id'
try:
    entries = json.load(sys.stdin)
except Exception:
    entries = []
n = 0
for e in entries:
    if e.get('seq', 0) <= since:
        continue
    if e.get('event') != event:
        continue
    if wid and wid not in (str(e.get('id', '')), str(e.get('a', '')), str(e.get('b', ''))):
        continue
    n += 1
print(n)" 2>/dev/null || echo 0
}

# The sibling an app opens for the pair is not always a peer tile: the toolkit
# may open a dialog/utility/transient it never tiles, or the window may close
# itself right after opening. Both are correct product behaviour, so poll a
# bounded time for a tileable sibling and let the caller skip the pair-dependent
# items when there is none. Returns 0 when a tileable sibling is present, 1 when
# the sibling exists but is not tileable, 3 when it closed itself, and 4 when the
# FIRST window closed (a real bug the caller must still report as a failure).
appcheck_pair_peer() { # id1 id2 [timeout]
  local id1="$1" id2="$2" timeout="${3:-10}"
  local deadline=$((SECONDS + timeout)) state
  while [ "$SECONDS" -lt "$deadline" ]; do
    state="$(dump | python3 -c "
import json, sys
d = json.load(sys.stdin)
w1 = next((x for x in d['windows'] if x['id'] == $id1), None)
w2 = next((x for x in d['windows'] if x['id'] == $id2), None)
if w1 is None:
    print('first-gone'); raise SystemExit
if w2 is None:
    print('gone'); raise SystemExit
print('tileable' if w2.get('tileable') else 'untileable')
" 2>/dev/null)"
    case "$state" in
      tileable)   return 0 ;;
      gone)       return 3 ;;
      first-gone) return 4 ;;
      *)          sleep 0.4 ;;
    esac
  done
  return 1
}

# The strict 50/50 pair predicate as a status. Unlike appcheck_assert it does not
# print pass/fail: it returns 0 when the pair is proven and 1 otherwise, leaving
# the predicate's last message on stdout on failure. The caller re-checks the
# peer before deciding, because the sibling can close itself or lose tileability
# in the window between the pre-check and this assert (or after it), and that is
# a race — not a product failure.
appcheck_pair_status() { # id1 id2 [timeout]
  local id1="$1" id2="$2" timeout="${3:-30}" code
  code="
import json, sys
d = json.load(sys.stdin)
w1 = next((x for x in d['windows'] if x['id'] == $id1), None)
w2 = next((x for x in d['windows'] if x['id'] == $id2), None)
if w1 is None or w2 is None:
    print('a window is gone'); sys.exit(1)
area = {m['index']: (m.get('workArea') or m['geometry']) for m in d['monitors']}[w1['monitor']]
tiles = [x for x in d['windows'] if x.get('tileable') and not x.get('minimized') and x.get('layer') != 2
         and x['workspace'] == w1['workspace'] and x['monitor'] == w1['monitor']]
if [x['id'] for x in tiles] != sorted([$id1, $id2]):
    print('pair not formed', [(x['id'], x['workspace'], x['maximized']) for x in d['windows']]); sys.exit(1)
if any(x.get('maximized') for x in tiles):
    print('a pair member is still maximized'); sys.exit(1)
a, b = sorted((x['rect'] for x in tiles), key=lambda r: r['x'])
if a['x'] < b['x'] + b['width'] - 2 and b['x'] < a['x'] + a['width'] - 2 \
   and a['y'] < b['y'] + b['height'] - 2 and b['y'] < a['y'] + a['height'] - 2:
    print('pair overlaps', a, b); sys.exit(1)
share = min(a['width'], b['width']) / (a['width'] + b['width'])
axis = w1.get('axis') or 'horizontal'
connector = next((m.get('connector') for m in d['monitors'] if m['index'] == w1['monitor']), '')
expected = (d.get('ratios') or {}).get(connector + ':' + str(w1['workspace']) + ':' + axis, 0.5)
if abs(share - expected) > 0.12:
    print('split is', round(share, 2), 'expected', expected, a['width'], b['width']); sys.exit(1)
for r in (a, b):
    if r['x'] < area['x'] - 2 or r['x'] + r['width'] > area['x'] + area['width'] + 2 \
       or r['y'] < area['y'] - 2 or r['y'] + r['height'] > area['y'] + area['height'] + 2:
        print('tile outside the work area', r, area); sys.exit(1)
print('pair', a, b, 'share', round(share, 2))
"
  if wait_python "$timeout" "$code"; then
    return 0
  fi
  dump | python3 -c "$code" 2>&1 | tail -1
  return 1
}

# Status form of "alone on its workspace it maximises". The user's own windows
# can share the spawn monitor, so when the newcomer is not alone it is moved to
# an empty workspace once and re-checked. Returns 0 when proven, 1 otherwise,
# leaving the predicate's message on stdout.
appcheck_alone_status() { # id [timeout]
  local id="$1" timeout="${2:-25}" code empty
  code="
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $id), None)
if w is None:
    print('window', $id, 'is gone'); sys.exit(1)
area = {m['index']: (m.get('workArea') or m['geometry']) for m in d['monitors']}[w['monitor']]
tiles = [x for x in d['windows'] if x.get('tileable') and not x.get('minimized') and x.get('layer') != 2
         and x['workspace'] == w['workspace'] and x['monitor'] == w['monitor'] and x['id'] != $id]
if len(tiles) > 0:
    print('workspace holds', len(tiles) + 1, 'tiles'); sys.exit(1)
r = w['rect']
covers = abs(r['x'] - area['x']) <= 2 and abs(r['y'] - area['y']) <= 2 \
    and abs(r['width'] - area['width']) <= 2 and abs(r['height'] - area['height']) <= 2
if not (w['maximized'] or covers):
    print('not maximised', r, 'area', area); sys.exit(1)
print('maximised', w['maximized'], 'rect', r)
"
  if wait_python "$timeout" "$code"; then return 0; fi
  dump | python3 -c "$code" 2>&1 | tail -1
  return 1
}

# Status form of "maximize moves it to its own workspace, maximized". Returns 0
# when proven, 1 otherwise, leaving the predicate's message on stdout; callers
# distinguish a still-present sibling (real failure) from the user's windows.
appcheck_maximize_status() { # id [timeout]
  local id="$1" timeout="${2:-30}" code
  code="
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $id), None)
if w is None or not w['maximized']:
    print('not maximized', None if w is None else w['rect']); sys.exit(1)
if any(x['workspace'] == w['workspace'] and x['id'] != $id and x.get('tileable') for x in d['windows']):
    print('maximize did not give it its own workspace'); sys.exit(1)
"
  if wait_python "$timeout" "$code"; then return 0; fi
  dump | python3 -c "$code" 2>&1 | tail -1
  return 1
}


# Guard the start of a sibling-dependent step (maximize, unmaximize). The second
# window can close itself or lose tileability in the gap since the pair was
# proven — a race, not a product failure — so a lost sibling records one skip and
# stops the row. A vanished FIRST window is a real bug. Returns 0 to continue, 2
# to skip the row, and 1 to fail it; both windows are closed when the row stops.
appcheck_pair_guard() { # label id1 id2
  local label="$1" id1="$2" id2="$3" peer
  appcheck_pair_peer "$id1" "$id2" 5; peer=$?
  case "$peer" in
    0) return 0 ;;
    4) fail "$label: the first window is gone"
       appcheck_close "$id2"
       appcheck_close "$id1"
       return 1 ;;
    *) appcheck_skip "$label: the second window closed itself / is no longer tileable — pair/max/tear-off N/A"
       appcheck_close "$id2"
       appcheck_close "$id1"
       return 2 ;;
  esac
}

# A trigger delivered during a transition can be dropped at the compositor level:
# no maximize signal arrives at all, while a real user simply presses the key
# again. Give the first request a short bounded wait for its effect, and when
# none arrived send it once more. The caller's long assert runs unchanged after
# this, so a genuine policy failure still fails after two requests.
appcheck_trigger_retry() { # id want-maximized trigger...
  local id="$1" want="$2"; shift 2
  local code
  if [ "$want" = "true" ]; then
    code="import json,sys; d=json.load(sys.stdin); w=next((x for x in d['windows'] if x['id'] == $id), None); sys.exit(0 if w is not None and w['maximized'] else 1)"
  else
    code="import json,sys; d=json.load(sys.stdin); w=next((x for x in d['windows'] if x['id'] == $id), None); sys.exit(0 if w is not None and not w['maximized'] else 1)"
  fi
  adrt "$@" >/dev/null 2>&1 || true
  wait_python 5 "$code" && return 0
  adrt "$@" >/dev/null 2>&1 || true
  return 0
}

# --- the checklist -----------------------------------------------------------

# appcheck_run <label> <env-json> <argv-json>
# Returns 0 when every assertion passed (including any per-row skips), 1 when
# one failed, 2 when the app is not available or cannot form a pair here (the
# caller records the named reason and moves on).
appcheck_run() {
  local label="$1" env_json="$2" argv_json="$3"
  local id1 id2 id3 rc=0 peer pair_detail

  appcheck_reset

  # 1. opens and is tracked.
  id1="$(appcheck_spawn "$env_json" "$argv_json" 45)"
  if [ -z "$id1" ] || [ "$id1" = "0" ]; then
    appcheck_skip "$label: cannot open a window in this session"
    return 2
  fi
  if appcheck_assert "$label: opens and is tracked (id $id1)" "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == int('$id1')), None)
if w is None:
    print('window', $id1, 'not tracked'); sys.exit(1)
if w.get('provisional'):
    print('provisional identity'); sys.exit(1)
if not w.get('identity'):
    print('no identity'); sys.exit(1)
print('identity', w['identity'])
" 30; then
    :
  else
    appcheck_close "$id1"
    return 1
  fi

  local tileable
  tileable="$(dump | python3 -c "import json,sys; d=json.load(sys.stdin); w=next((x for x in d['windows'] if x['id']==$id1),{}); print(str(w.get('tileable')).lower())")"
  if [ "$tileable" != "true" ]; then
    appcheck_skip "$label: opens a non-tileable window (dialog/utility) — tiling checks N/A"
    appcheck_close "$id1"
    return 2
  fi

  # 2a. alone on its workspace it maximises. A busy desktop can put the user's
  # windows on the same workspace; a workspace that holds an external window
  # records a skip rather than a product failure.
  alone_detail="$(appcheck_alone_status "$id1" 25)"; alone=$?
  if [ "$alone" -eq 0 ]; then
    pass "$label: alone on its workspace it maximises"
  else
    why="$(dump | python3 -c "
import json, sys
d = json.load(sys.stdin); tid = $id1
w = next(x for x in d['windows'] if x['id'] == tid)
if not w.get('tileable'):
    print('notileable'); raise SystemExit
if w.get('stubborn'):
    print('stubborn'); raise SystemExit
area = {m['index']: (m.get('workArea') or m['geometry']) for m in d['monitors']}[w['monitor']]
mn, mx = w.get('min') or {}, w.get('max') or {}
fixed = (mn.get('width', 0) > 0 and mn.get('height', 0) > 0
         and mx.get('width', 0) > 0 and mx.get('height', 0) > 0
         and mn['width'] >= mx['width'] - 1 and mn['height'] >= mx['height'] - 1)
oversized = mn.get('width', 0) > area['width'] / 2 or mn.get('height', 0) > area['height'] / 2
if fixed or oversized:
    print('sizelimited'); raise SystemExit
others = [x['id'] for x in d['windows'] if x['id'] != tid and x.get('tileable')
          and not x.get('minimized') and x.get('layer') != 2
          and x['workspace'] == w['workspace'] and x['monitor'] == w['monitor']]
if others:
    print('external')")"
    case "$why" in
      notileable)
        appcheck_skip "$label: alone — the window is no longer tileable"
        appcheck_close "$id1"
        return 2 ;;
      stubborn)
        appcheck_skip "$label: alone — the window refuses geometry (stubborn); maximize checks N/A"
        appcheck_close "$id1"
        return 2 ;;
      sizelimited)
        appcheck_skip "$label: alone — the window cannot fit a share (§16 escape); maximize checks N/A"
        appcheck_close "$id1"
        return 2 ;;
      external)
        appcheck_skip "$label: alone — the workspace also holds the user's windows"
        appcheck_close "$id1"
        return 2 ;;
    esac
    fail "$label: alone on its workspace it maximises${alone_detail:+ — $alone_detail}"
    rc=1
  fi

  # 2b. with a sibling it forms a pair. The app is already running, so a
  # second window is quick; a single-instance app is detected sooner.
  id2="$(appcheck_spawn "$env_json" "$argv_json" 30)"
  if [ -z "$id2" ] || [ "$id2" = "0" ]; then
    appcheck_skip "$label: a second window did not open (single-instance app) — pair/max/tear-off N/A"
    appcheck_close "$id1"
    return 2
  fi

  # The sibling may not be a peer tile: it can close itself right after opening,
  # or be a dialog/utility/transient the toolkit never tiles. Both are correct
  # behaviour, so wait a bounded time for a tileable peer; only then is the
  # strict 50/50 assert meaningful. A vanished FIRST window is a real bug and
  # still fails hard here (not a skip).
  appcheck_pair_peer "$id1" "$id2" 10; peer=$?
  case "$peer" in
    0) : ;;
    3) appcheck_skip "$label: the second window closed itself — pair/max/tear-off N/A"
       appcheck_close "$id1"
       return 2 ;;
    4) appcheck_close "$id2"
       appcheck_close "$id1"
       fail "$label: with a sibling it forms a pair — the first window is gone"
       return 1 ;;
    *) appcheck_skip "$label: the second window is not tileable (dialog/utility) — pair/max/tear-off N/A"
       appcheck_close "$id2"
       appcheck_close "$id1"
       return 2 ;;
  esac

  # The strict assert is a status, not a print, so its failure can be re-checked:
  # the sibling can close itself or lose tileability in the window between the
  # pre-check and the assert. Only a pair that is still present and tileable is
  # a real failure; otherwise the row is skipped once and the remaining pair
  # steps (maximize/unmaximize/focus) do not run.
  if pair_detail="$(appcheck_pair_status "$id1" "$id2" 30)"; then
    pass "$label: with a sibling it forms a pair"
  else
    appcheck_pair_peer "$id1" "$id2" 5; peer=$?
    case "$peer" in
      4) fail "$label: with a sibling it forms a pair — the first window is gone"
         appcheck_close "$id2"
         appcheck_close "$id1"
         return 1 ;;
      0)
         external="$(dump | python3 -c "
import json, sys
d = json.load(sys.stdin); t1 = $id1
w = next(x for x in d['windows'] if x['id'] == t1)
print(' '.join(str(x['id']) for x in d['windows']
      if x['id'] not in ($id1, $id2) and x.get('tileable')
      and x['workspace'] == w['workspace']))")"
         if [ -n "$external" ]; then
           appcheck_skip "$label: with a sibling it forms a pair — the workspace also holds the user's windows"
           appcheck_close "$id2"
           appcheck_close "$id1"
           return 2
         fi
         fail "$label: with a sibling it forms a pair${pair_detail:+ — $pair_detail}"
         rc=1 ;;
      *) appcheck_skip "$label: the second window closed itself / is no longer tileable — pair/max/tear-off N/A"
         appcheck_close "$id2"
         appcheck_close "$id1"
         return 2 ;;
    esac
  fi

  # 3. maximize / unmaximize round-trips. Guard each sibling-dependent step
  # first: the second window can close itself or lose tileability between steps
  # (a race), in which case the row is skipped rather than failing on a window
  # that was never the product's fault.
  appcheck_pair_guard "$label" "$id1" "$id2"; peer=$?
  [ "$peer" -eq 0 ] || return "$peer"

  # A trigger dropped during a transition is re-sent once (see
  # appcheck_trigger_retry); the long assert below is unchanged either way.
  appcheck_trigger_retry "$id2" true MaximizeWindow "$id2"
  mx_detail="$(appcheck_maximize_status "$id2" 30)"; mx=$?
  if [ "$mx" -eq 0 ]; then
    pass "$label: maximize moves it to its own workspace, maximized"
  else
    external="$(dump | python3 -c "
import json, sys
d = json.load(sys.stdin); tid = $id2
w = next(x for x in d['windows'] if x['id'] == tid)
print(' '.join(str(x['id']) for x in d['windows']
      if x['id'] not in ($id1, $id2) and x.get('tileable')
      and x['workspace'] == w['workspace']))")"
    if [ -n "$external" ]; then
      appcheck_skip "$label: maximize — the workspace also holds the user's windows"
      appcheck_close "$id2"
      appcheck_close "$id1"
      return 2
    fi
    fail "$label: maximize moves it to its own workspace, maximized${mx_detail:+ — $mx_detail}"
    rc=1
  fi

  appcheck_pair_guard "$label" "$id1" "$id2"; peer=$?
  [ "$peer" -eq 0 ] || return "$peer"

  appcheck_trigger_retry "$id2" false UnmaximizeWindow "$id2"
  appcheck_assert "$label: unmaximize returns it to the pair" "
import json, sys
d = json.load(sys.stdin)
if len({x['workspace'] for x in d['windows'] if x['id'] in ($id1, $id2)}) != 1:
    print('not back on one workspace', {x['id']: x['workspace'] for x in d['windows'] if x['id'] in ($id1, $id2)}); sys.exit(1)
if any(x.get('maximized') for x in d['windows'] if x['id'] in ($id1, $id2)):
    print('a window is still maximized'); sys.exit(1)
" 30 || rc=1

  # 4. focus + the border land on the right window (and follow a change). Done
  # before the tear-off: a closing newcomer's focus can linger for an app that
  # defers its window close (Electron), which is not what this item proves.
  adrt ActivateWindow "$id2" >/dev/null 2>&1 || true
  appcheck_assert "$label: focus and the border land on the right window and screen" "
import json, sys
d = json.load(sys.stdin)
if d['focused'] != $id2:
    print('focused is', d['focused'], 'expected $id2'); sys.exit(1)
w = next((x for x in d['windows'] if x['id'] == $id2), None)
b = d.get('border') or {}
if w is None or not b.get('visible') or b.get('rect') is None:
    print('no border on the focused window', b); sys.exit(1)
r, br = w['rect'], b['rect']
if any(abs(br[k] - r[k]) > 3 for k in ('x', 'y', 'width', 'height')):
    print('border is not on the focused window', br, r); sys.exit(1)
g = next(m['geometry'] for m in d['monitors'] if m['index'] == w['monitor'])
if br['x'] < g['x'] - 2 or br['y'] < g['y'] - 2 \
   or br['x'] + br['width'] > g['x'] + g['width'] + 2 \
   or br['y'] + br['height'] > g['y'] + g['height'] + 2:
    print('border is not on the focused window screen', br, g); sys.exit(1)
print('focus', d['focused'], 'border', br)
" 20 || rc=1

  # 5. tear-off: a new window that tiles or maximises with no swap/storm.
  if declare -F appcheck_tearoff >/dev/null; then
    local since swaps clamps retries stubborn
    since="$(appcheck_journal_seq)"
    id3="$(appcheck_tearoff "$env_json" "$argv_json")"
    if [ -z "$id3" ] || [ "$id3" = "0" ]; then
      appcheck_skip "$label: tear-off — the newcomer did not appear"
    else
      # The app's newcomer may be the real window (assert it tiles) or an
      # app-internal utility (VS Code opens both); the no-swap/no-storm decision
      # below is asserted either way.
      local id3_kind
      id3_kind="$(dump | python3 -c "import json,sys; d=json.load(sys.stdin); w=next((x for x in d['windows'] if x['id']==$id3),{}); print('tileable' if (w.get('tileable') and w.get('layer') != 2) else 'utility')")"
      if [ "$id3_kind" = "tileable" ]; then
        appcheck_assert "$label: tear-off creates a window that tiles/maximises" "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $id3), None)
if w is None:
    print('tear-off window not tracked'); sys.exit(1)
area = {m['index']: (m.get('workArea') or m['geometry']) for m in d['monitors']}[w['monitor']]
r = w['rect']
inside = r['x'] >= area['x'] - 2 and r['y'] >= area['y'] - 2 \
    and r['x'] + r['width'] <= area['x'] + area['width'] + 2 \
    and r['y'] + r['height'] <= area['y'] + area['height'] + 2
if not (w['maximized'] or inside):
    print('tear-off window neither maximised nor inside the screen', r, area); sys.exit(1)
print('tear-off', w['id'], 'maximized', w['maximized'], 'rect', r)
" 25 || rc=1
      else
        appcheck_skip "$label: tear-off newcomer is a utility/undecided window — tiling N/A"
      fi
      swaps="$(appcheck_decisions_since "$since" swap "$id3")"
      if [ "${swaps:-1}" -eq 0 ] 2>/dev/null; then
        pass "$label: tear-off records no swap"
      else
        fail "$label: tear-off records no swap (got $swaps)"
        rc=1
      fi
      clamps="$(appcheck_decisions_since "$since" clamp_to_screen "$id3")"
      if [ "${clamps:-99}" -le 3 ] 2>/dev/null; then
        pass "$label: tear-off has no clamp_to_screen storm ($clamps)"
      else
        fail "$label: tear-off has no clamp_to_screen storm (got $clamps)"
        rc=1
      fi
      retries="$(appcheck_decisions_since "$since" resize_retry "$id3")"
      if [ "${retries:-99}" -le 6 ] 2>/dev/null; then
        pass "$label: tear-off has no resize_retry storm ($retries)"
      else
        fail "$label: tear-off has no resize_retry storm (got $retries)"
        rc=1
      fi
      stubborn="$(dump | python3 -c "import json,sys; d=json.load(sys.stdin); w=next((x for x in d['windows'] if x['id']==$id3),{}); print(str(w.get('stubborn')).lower())")"
      if [ "$stubborn" = "false" ]; then
        pass "$label: tear-off does not mark the app stubborn"
      else
        fail "$label: tear-off does not mark the app stubborn (got $stubborn)"
        rc=1
      fi
      appcheck_close "$id3"
      # A deferred close must finish before the settle check, so a vanishing
      # newcomer is not read as oscillation.
      wait_python 15 "import json,sys; sys.exit(0 if not any(x['id'] == $id3 for x in json.load(sys.stdin)['windows']) else 1)" || true
    fi
  else
    appcheck_skip "$label: tear-off (covered by A155 nested / the live tear-off suite)"
  fi

  # 6. the layout settles without oscillation.
  if appcheck_settles 20; then
    pass "$label: the layout settles without oscillation"
  else
    fail "$label: the layout settles without oscillation"
    rc=1
  fi

  appcheck_close "$id2"
  appcheck_close "$id1"
  return "$rc"
}

# appcheck_row <label> [--env K=V]... [--] argv...
# Builds the argv/env JSON pair and runs the checklist. Use `--env` for each
# extra environment variable, `--` to terminate env and start the argv.
appcheck_row() {
  local label="$1"; shift
  local -a env=() argv=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --env) shift; env+=("$1");;
      --) : ;;
      *) argv+=("$1");;
    esac
    shift
  done
  local argv_json env_json
  argv_json="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "${argv[@]}")"
  env_json="$(python3 -c '
import json, sys
out = {}
for item in sys.argv[1:]:
    key, _, value = item.partition("=")
    out[key] = value
print(json.dumps(out))' "${env[@]}")"
  appcheck_run "$label" "$env_json" "$argv_json"
}

# Gate helpers: an absent app is a recorded skip, never a launch timeout.
appcheck_have_bin() { command -v "$1" >/dev/null 2>&1; }
appcheck_have_snap() { command -v snap >/dev/null 2>&1 && snap list "$1" >/dev/null 2>&1; }
appcheck_have_flatpak() { command -v flatpak >/dev/null 2>&1 && flatpak info "$1" >/dev/null 2>&1; }
