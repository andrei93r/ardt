#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A52 A window that refuses to grow past a size must not teach the adaptation
# store a *minimum* of its current size. Recording that pinned e.g. Chrome to
# its current width and made a 50/50 split impossible (the window ended up
# larger than requested, which is a max, not a min).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
a="${ids[0]}"
b="${ids[1]}"
app="$(window_field "$a" cls)"
echo "app=$app"

# Shrink A below its tile, then ask the tiler to grow it while every apply to A
# fails: A stays smaller than the target, which must not become a minimum.
adrt MoveWindow "$a" 100 100 500 400 >/dev/null
adrt InjectVerifyFailure "$a" 12 >/dev/null
adrt SimulateResize "$a" "$b" 0.7 >/dev/null

# The refusal is observed over the next few applies; give it a real budget and
# then read the final state.
adapt=""
for _ in $(seq 1 20); do
  adapt="$(adrt GetAdaptations | python3 "$PARSE")"
  if echo "$adapt" | python3 -c '
import json, sys
recs = json.load(sys.stdin)
rec = [r for r in recs if r.get("appId") == "'"$app"'"]
sys.exit(0 if rec else 1)' 2>/dev/null; then
    break
  fi
  sleep 1
done
if echo "$adapt" | python3 -c '
import json, sys
recs = json.load(sys.stdin)
app = "'"$app"'"
rec = [r for r in recs if r.get("appId") == app]
if not rec:
    print("app has no adaptation record (fine)"); sys.exit(0)
r = rec[0]
if r.get("refusedMinW") is not None or r.get("refusedMinH") is not None:
    print("refusedMin", r.get("refusedMinW"), r.get("refusedMinH")); sys.exit(1)
print("no refusedMin for", app)
'; then
  pass "no bogus minimum was learned from the refusal"
else
  fail "a minimum was recorded from a window that refused to grow"
fi

# And the pair can still be split 50/50 afterwards.
adrt SimulateResize "$a" "$b" 0.5 >/dev/null
if wait_python 12 '
import json, sys
d = json.load(sys.stdin)
ws = [w["rect"] for w in d["windows"]]
total = sum(r["width"] for r in ws)
share = min(r["width"] for r in ws) / total if total else 0
sys.exit(0 if abs(share - 0.5) <= 0.08 else 1)'; then
  pass "the pair still splits ~50/50"
else
  fail "split is not 50/50: $(state_expr '[w["rect"]["width"] for w in d["windows"]]')"
fi

ensure_clean
summary
