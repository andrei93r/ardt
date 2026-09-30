#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A1 Pair tiling: two windows tile side by side, non-overlapping, inside the monitor.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair

assert_eq "two windows are tracked" "2" "$(count_windows)"
if wait_python 20 '
import json, sys
ws = [w["rect"] for w in json.load(sys.stdin)["windows"]]
if len(ws) != 2:
    sys.exit(1)
for i in range(len(ws)):
    for j in range(i + 1, len(ws)):
        a, b = ws[i], ws[j]
        if a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"] and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]:
            sys.exit(1)
    r = ws[i]
    if r["x"] < 0 or r["y"] < 0 or r["x"] + r["width"] > 1281 or r["y"] + r["height"] > 801:
        sys.exit(1)
sys.exit(0)'; then
  pass "tiles are non-overlapping and inside the monitor"
else
  check_python "tiles are non-overlapping and inside the monitor" '
import json, sys
ws = [w["rect"] for w in json.load(sys.stdin)["windows"]]
print("rects", ws); sys.exit(1)
'
fi

# A fresh split is 50/50 when the windows' minimum sizes allow it. It can take
# a moment to settle (the pair forms while the lone window is still maximizing),
# so poll for it.
poll "a fresh pair splits evenly" '
import json, sys
d = json.load(sys.stdin)
ws = [w["rect"] for w in d["windows"] if w["tileable"] and w["layer"] != 2]
if len(ws) != 2:
    print("expected two windows"); sys.exit(1)
total = sum(r["width"] for r in ws)
share = min(r["width"] for r in ws) / total
if abs(share - 0.5) > 0.08:
    print("split is", round(share, 2), "not ~0.50", [r["width"] for r in ws]); sys.exit(1)
print("split", round(share, 2))
' 15

ensure_clean
summary
