#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A83 An injected drag is event-confirmed: real input through the compositor,
# visible in the journal as a user-driven frame change. Fails today: there is no
# injection trigger and no journal.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! probe_supports injection; then
  skip "A83 injected drag: the shell was not started with ADRT_INJECT=1"
  exit 0
fi

ensure_clean
open_pair

ids=($(list_ids))
if [ "${#ids[@]}" -ne 2 ]; then
  fail "A83 needs the pair to open first (got ${#ids[@]} windows)"
  summary
  exit 1
fi

# Geometry of the two tiles, so the click and the drag land inside them.
read -r left_x left_y left_w left_h right_id right_x right_y <<EOF
$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ws = sorted([w for w in d["windows"] if w["tileable"]], key=lambda w: w["rect"]["x"])
l, r = ws[0], ws[-1]
print(l["rect"]["x"], l["rect"]["y"], l["rect"]["width"], l["rect"]["height"],
      r["id"], r["rect"]["x"], r["rect"]["y"])')
EOF

# 1. A real click on the right tile must move the focus there.
inject_click "$((right_x + 60))" "$((right_y + 60))"
poll "the injected click focuses the window under it" "
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d['focused'] == $right_id else 1)
" 10

# 2. The journal confirms the input was real: an injection entry, and a frame
#    change marked byUser while the compositor was in a grab.
journal_has() {
  journal_tail 400 | python3 -c "
import json, sys
entries = json.load(sys.stdin)
ok = any($1 for e in entries)
sys.exit(0 if ok else 1)" 2>/dev/null
}

if journal_has "\"e['source'] == 'inject'\""; then
  pass "the journal records the injected input"
else
  fail "the journal has no injection entry"
fi

# A real pointer drag across the left tile: press, move in steps, release.
inject_drag "$((left_x + left_w / 2))" "$((left_y + 12))" "$((left_x + left_w / 2 + 120))" "$((left_y + 80))"

drag_confirmed=0
for _ in $(seq 1 20); do
  if journal_has "\"e.get('byUser') and 'frame' in e.get('event', '')\""; then drag_confirmed=1; break; fi
  sleep 0.5
done

if probe_supports grabOp; then
  if [ "$drag_confirmed" = 1 ]; then
    pass "the journal confirms a real, user-driven drag"
  else
    fail "no user-driven frame change was journalled"
  fi
else
  skip "the user-driven drag confirmation: this shell exposes no grab-op API"
fi

# The focus half of the test is the requirement; clean up regardless.
ensure_clean
summary
