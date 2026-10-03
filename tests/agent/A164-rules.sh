#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A164 Placement rules at runtime (§23 decisions 91-93, gap G7): rules are
# written through the settings path (`rules-json`) and the tiler applies them —
# a `right-half` rule forces the lowest-id matching window to the right, a `full`
# rule fills the work area, `enabled:false` is ignored, and an invalid rule is
# reported in DumpState.rules.errors instead of being applied or silently
# dropped.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

set_rules() { set_setting rules-json "'$1'"; }

# Spawn two windows without the pair-tiled wait: a `full` rule legitimately
# leaves the other window unplaced, so the geometric pair wait would time out.
open_two() {
  spawn_window >/dev/null
  wait_count 1 20 || true
  spawn_window >/dev/null
  wait_count 2 20 || true
  wait_settled 20 || true
}

# The lowest/highest id of the current pair: rule lookup picks the lowest id.
pair_ids() { list_ids | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -n; }

ensure_clean
spawn_window >/dev/null
wait_count 1 20 || true
app="$(window_field "$(list_ids | awk '{print $1}')" cls)"
close_all
ensure_clean
if [ -z "$app" ]; then
  skip "A164 placement rules: could not resolve the test client's app id"
  summary
  exit 0
fi

# 1. A `right-half` rule forces the lowest-id matching window to the right half.
set_rules "[{\"match\":{\"appId\":\"$app\"},\"tile\":\"right-half\"}]"
open_two
read -r A B <<<"$(pair_ids | tr '\n' ' ')"
poll "a right-half rule forces the matching window to the right half" "
import json, sys
d = json.load(sys.stdin)
by = {w['id']: w for w in d['windows']}
a, b = by.get($A), by.get($B)
if a is None or b is None:
    print('missing window', $A, $B); sys.exit(1)
area = d['monitors'][a['monitor']].get('workArea') or d['monitors'][a['monitor']]['geometry']
ra, rb = a['rect'], b['rect']
if not ra['x'] > rb['x']:
    print('not forced right', ra, rb); sys.exit(1)
if abs((ra['x'] + ra['width']) - (area['x'] + area['width'])) > 4:
    print('does not reach the right edge', ra, area); sys.exit(1)
print('forced right')
" 20

# 2. A `full` rule gives the matching window the whole work area.
ensure_clean
set_rules "[{\"match\":{\"appId\":\"$app\"},\"tile\":\"full\"}]"
open_two
read -r A B <<<"$(pair_ids | tr '\n' ' ')"
poll "a full rule fills the matching window to the work area" "
import json, sys
d = json.load(sys.stdin)
by = {w['id']: w for w in d['windows']}
a = by.get($A)
if a is None:
    print('missing window', $A); sys.exit(1)
area = d['monitors'][a['monitor']].get('workArea') or d['monitors'][a['monitor']]['geometry']
r = a['rect']
if abs(r['x'] - area['x']) > 4 or abs(r['y'] - area['y']) > 4 \
   or abs(r['width'] - area['width']) > 4 or abs(r['height'] - area['height']) > 4:
    print('not full', r, area); sys.exit(1)
print('full')
" 20

# 3. `enabled:false` is ignored: the pair tiles normally (lowest id on the left).
ensure_clean
set_rules "[{\"match\":{\"appId\":\"$app\"},\"tile\":\"right-half\",\"enabled\":false}]"
open_two
read -r A B <<<"$(pair_ids | tr '\n' ' ')"
poll "a disabled rule is ignored and the pair tiles normally" "
import json, sys
d = json.load(sys.stdin)
by = {w['id']: w for w in d['windows']}
a, b = by.get($A), by.get($B)
if a is None or b is None:
    print('missing window', $A, $B); sys.exit(1)
area = d['monitors'][a['monitor']].get('workArea') or d['monitors'][a['monitor']]['geometry']
ra, rb = a['rect'], b['rect']
if not ra['x'] < rb['x']:
    print('disabled rule still forced a side', ra, rb); sys.exit(1)
if abs(ra['x'] - area['x']) > 4:
    print('not at the normal left edge', ra, area); sys.exit(1)
print('disabled ignored')
" 20

# 4. An invalid rule is reported, never applied and never silently dropped.
ensure_clean
set_rules "[{\"match\":{},\"tile\":\"nope\"}]"
open_two
read -r A B <<<"$(pair_ids | tr '\n' ' ')"
check_python "an invalid rule is surfaced in DumpState.rules with an error" '
import json, sys
r = json.load(sys.stdin).get("rules")
if not isinstance(r, dict):
    print("no rules surface", r); sys.exit(1)
if r.get("count") != 0:
    print("an invalid rule was applied", r); sys.exit(1)
if not r.get("errors"):
    print("no error reported", r); sys.exit(1)
print("errors", r["errors"])
'
poll "with only an invalid rule the pair still tiles normally" "
import json, sys
d = json.load(sys.stdin)
by = {w['id']: w for w in d['windows']}
a, b = by.get($A), by.get($B)
if a is None or b is None:
    print('missing window', $A, $B); sys.exit(1)
if not a['rect']['x'] < b['rect']['x']:
    print('an invalid rule forced a side', a['rect'], b['rect']); sys.exit(1)
print('normal')
" 20

# Never leak a rule set into the next scenario on this worker.
set_rules '[]'
ensure_clean
summary
