#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A139 §10 / decisions 15 and 74: gaps are per side (left/right/top/bottom) and
# between windows. The outer edges inset by the per-side values (default flush,
# 0), the split by gaps-between (default gaps-base), and changing only
# gaps-between moves only the split. A gap of 0 is exactly 0.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean

# The gap keys are not reset by ensure_clean; remember them so the shard's next
# scenario starts from the same settings.
orig_base="$(get_setting gaps-base)"
orig_portrait="$(get_setting gaps-portrait)"
orig_landscape="$(get_setting gaps-landscape)"
orig_left="$(get_setting gaps-left)"
orig_right="$(get_setting gaps-right)"
orig_top="$(get_setting gaps-top)"
orig_bottom="$(get_setting gaps-bottom)"
orig_between="$(get_setting gaps-between)"

restore_gaps() {
  set_setting gaps-base "$orig_base"
  set_setting gaps-portrait "$orig_portrait"
  set_setting gaps-landscape "$orig_landscape"
  set_setting gaps-left "$orig_left"
  set_setting gaps-right "$orig_right"
  set_setting gaps-top "$orig_top"
  set_setting gaps-bottom "$orig_bottom"
  set_setting gaps-between "$orig_between"
}

# The new gap keys are not (yet) in the extension's reactive watcher list, so a
# change needs a forced reconcile: ResetLayoutState schedules one and clears the
# signatures that would otherwise suppress a plan whose geometry only changed.
retile_gaps() {
  adrt ResetLayoutState >/dev/null
  wait_settled 15
}

# Check the pair against the configured insets, read from the monitor's work
# area so the scenario is independent of the nested screen size. $1 label,
# $2..$6 left right top bottom between.
check_gaps() {
  local label="$1" left="$2" right="$3" top="$4" bottom="$5" between="$6"
  poll "$label" '
import json, sys
d = json.load(sys.stdin)
primary = [m for m in d["monitors"] if m["isPrimary"]]
m = primary[0] if primary else sorted(d["monitors"], key=lambda m: m["geometry"]["x"])[0]
a = m.get("workArea") or m["geometry"]
tiles = sorted(
    [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2],
    key=lambda w: w["rect"]["x"],
)
if len(tiles) != 2:
    print("expected the pair, got", len(tiles)); sys.exit(1)
l, r = tiles[0]["rect"], tiles[1]["rect"]
left, right, top, bottom, between = '"$left"', '"$right"', '"$top"', '"$bottom"', '"$between"'
exp_left = a["x"] + left
exp_y = a["y"] + top
exp_h = a["height"] - top - bottom
exp_right = a["x"] + a["width"] - right
if l["x"] != exp_left:
    print("left inset", l["x"], "!=", exp_left); sys.exit(1)
if l["y"] != exp_y or l["height"] != exp_h:
    print("left vertical", l, "expected y", exp_y, "h", exp_h); sys.exit(1)
if r["y"] != exp_y or r["height"] != exp_h:
    print("right vertical", r, "expected y", exp_y, "h", exp_h); sys.exit(1)
if r["x"] + r["width"] != exp_right:
    print("right inset", r["x"] + r["width"], "!=", exp_right); sys.exit(1)
if r["x"] - (l["x"] + l["width"]) != between:
    print("split gap", r["x"] - (l["x"] + l["width"]), "!=", between); sys.exit(1)
if l["width"] + r["width"] != a["width"] - left - right - between:
    print("width sum", l["width"] + r["width"], "expected", a["width"] - left - right - between); sys.exit(1)
print("left", l, "right", r, "gap", between)
' 20
}

set_setting gaps-base 8
set_setting gaps-portrait -1
set_setting gaps-landscape -1
set_setting gaps-left 12
set_setting gaps-right 4
set_setting gaps-top 10
set_setting gaps-bottom 6
set_setting gaps-between 30

open_pair
retile_gaps

# 1. The per-side outer insets and the 30 px split are exactly as prescribed.
check_gaps "outer sides inset and the split gapped by gaps-between" 12 4 10 6 30

# 2. Changing only gaps-between moves only the split.
set_setting gaps-between 50
retile_gaps
check_gaps "changing gaps-between moves only the split" 12 4 10 6 50

# 3. An explicit 0 on every side and at the split is exactly flush: no tile gap.
set_setting gaps-left 0
set_setting gaps-right 0
set_setting gaps-top 0
set_setting gaps-bottom 0
set_setting gaps-between 0
retile_gaps
check_gaps "zero gaps are exactly flush" 0 0 0 0 0

restore_gaps
ensure_clean
summary
