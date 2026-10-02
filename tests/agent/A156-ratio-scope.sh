#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# A156 Ratios are per workspace (per pair) (§10, decision 14): a ratio the user
# sets on one pair must not leak to a different pair of the same app. The old
# key was the app pair (`appA|appB|axis`), so a fresh pair of the same app
# inherited the saved ratio; the key is now `screen:workspace:axis`. This sets
# 30/70 on the first pair and asserts a second pair of the same app on a fresh
# workspace is 50/50.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
wait_settled 15

ids=($(list_ids))
ws0="$(window_field "${ids[0]}" workspace)"

# Set the ratio on the first pair only.
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.3 >/dev/null
wait_settled 12

# The first pair must really be at ~30/70, or the scope assertion below would
# pass vacuously.
poll "the first pair takes the 30/70 ratio" '
import json, sys
d = json.load(sys.stdin)
ws = [w["rect"] for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
total = ws[0]["width"] + ws[1]["width"]
ratio = min(r["width"] for r in ws) / total
if abs(ratio - 0.3) > 0.1:
    print("ratio", round(ratio, 2)); sys.exit(1)
print("ratio", round(ratio, 2))
' 20

# A different pair of the same app: a third window gets its own workspace
# (maximized), the fourth pairs with it there.
spawn_window >/dev/null
wait_count 3 20 || true
spawn_window >/dev/null
wait_count 4 20 || true
wait_settled 25

poll "the second pair of the same app is 50/50, not the first pair's ratio" "
import json, sys
d = json.load(sys.stdin)
ws0 = int('$ws0')
byws = {}
for w in d['windows']:
    if w['tileable'] and not w['minimized'] and w['layer'] != 2:
        byws.setdefault(w['workspace'], []).append(w['rect'])
pairs = {k: v for k, v in byws.items() if len(v) == 2}
if ws0 not in pairs:
    print('the first pair vanished', byws); sys.exit(1)
others = [k for k in pairs if k != ws0]
if not others:
    print('the second pair never formed', byws); sys.exit(1)
for k in others:
    total = sum(r['width'] for r in pairs[k])
    ratio = min(r['width'] for r in pairs[k]) / total
    if abs(ratio - 0.5) > 0.1:
        print('ratio leaked to workspace', k, round(ratio, 2), pairs[k]); sys.exit(1)
print('second pair 50/50 on', others)
" 30

ensure_clean
summary
