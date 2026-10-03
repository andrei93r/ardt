# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
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

# --- the checklist -----------------------------------------------------------

# appcheck_run <label> <env-json> <argv-json>
# Returns 0 when every assertion passed (including any per-row skips), 1 when
# one failed, 2 when the app is not available or cannot form a pair here (the
# caller records the named reason and moves on).
appcheck_run() {
  local label="$1" env_json="$2" argv_json="$3"
  local id1 id2 id3 rc=0

  appcheck_reset

  # 1. opens and is tracked.
  id1="$(appcheck_spawn "$env_json" "$argv_json")"
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

  # 2a. alone on its workspace it maximises.
  appcheck_assert "$label: alone on its workspace it maximises" "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $id1), None)
if w is None:
    print('window', $id1, 'is gone'); sys.exit(1)
area = {m['index']: (m.get('workArea') or m['geometry']) for m in d['monitors']}[w['monitor']]
tiles = [x for x in d['windows'] if x.get('tileable') and not x.get('minimized') and x.get('layer') != 2
         and x['workspace'] == w['workspace'] and x['monitor'] == w['monitor']]
if len(tiles) != 1:
    print('workspace holds', len(tiles), 'tiles'); sys.exit(1)
r = w['rect']
covers = abs(r['x'] - area['x']) <= 2 and abs(r['y'] - area['y']) <= 2 \
    and abs(r['width'] - area['width']) <= 2 and abs(r['height'] - area['height']) <= 2
if not (w['maximized'] or covers):
    print('not maximised', r, 'area', area); sys.exit(1)
print('maximised', w['maximized'], 'rect', r)
" 25 || rc=1

  # 2b. with a sibling it forms a 50/50 pair. The app is already running, so a
  # second window is quick; a single-instance app is detected sooner.
  id2="$(appcheck_spawn "$env_json" "$argv_json" 15)"
  if [ -z "$id2" ] || [ "$id2" = "0" ]; then
    appcheck_skip "$label: a second window did not open (single-instance app) — pair/max/tear-off N/A"
    appcheck_close "$id1"
    return 2
  fi

  appcheck_assert "$label: with a sibling it forms a 50/50 pair" "
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
if abs(share - 0.5) > 0.12:
    print('split is', round(share, 2), 'not ~0.50', a['width'], b['width']); sys.exit(1)
for r in (a, b):
    if r['x'] < area['x'] - 2 or r['x'] + r['width'] > area['x'] + area['width'] + 2 \
       or r['y'] < area['y'] - 2 or r['y'] + r['height'] > area['y'] + area['height'] + 2:
        print('tile outside the work area', r, area); sys.exit(1)
print('pair', a, b, 'share', round(share, 2))
" 30 || rc=1

  # 3. maximize / unmaximize round-trips.
  adrt MaximizeWindow "$id2" >/dev/null 2>&1 || true
  appcheck_assert "$label: maximize moves it to its own workspace, maximized" "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $id2), None)
if w is None or not w['maximized']:
    print('not maximized', None if w is None else w['rect']); sys.exit(1)
if any(x['workspace'] == w['workspace'] and x['id'] != $id2 and x.get('tileable') for x in d['windows']):
    print('maximize did not give it its own workspace'); sys.exit(1)
" 30 || rc=1

  adrt UnmaximizeWindow "$id2" >/dev/null 2>&1 || true
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
