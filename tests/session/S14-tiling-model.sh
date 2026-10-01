#!/usr/bin/env bash
# Generated with AI for personal use.
# S14 The whole tiling model, end to end, on the live session:
#   1. the first window is maximized on its own workspace
#   2. a second window tiles beside it
#   3. maximizing either slides it to a new workspace to the right, still
#      maximized, with the view following
#   4. closing one re-maximizes the other
#   5. a third window slides to a further workspace and is maximized
#   6. minimizing it slides it back left: floating over a pair, tiled when the
#      left workspace holds one window
#   7. the active-window marker follows the focused window's geometry
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
# RETIRED in v2: this scenario asserted the v1 tiling model end to end; the v2 rules are covered live by S02, S04, S05, S06, S10, S13, S15 and S18-S20, and exhaustively by the nested suite (117 scenarios).
# Replaced by: S02/S04/S05/S06/S10/S13/S15/S18-S20.
skip "S14-tiling-model.sh: this scenario asserted the v1 tiling model end to end; the v2 rules are covered live by S02, S04, S05, S06, S10, S13, S15 and S18-S20, and exhaustively by the nested suite (117 scenarios)"
exit 0

session_begin

# 1. First window is maximized on its own workspace.
spawn
wait_tests 1 12 || true
if wait_python 12 'import json,sys
d = json.load(sys.stdin)
ids = set(int(x) for x in "'"$(test_ids)"'".split())
w = [x for x in d["windows"] if x["id"] in ids]
sys.exit(0 if len(w) == 1 and w[0]["maximized"] else 1)'; then
  pass "the first window is maximized"
else
  fail "the first window is not maximized ($(state_expr '[(w["id"], w["maximized"]) for w in d["windows"]]'))"
fi
ws1="$(state_expr 'min([w["workspace"] for w in d["windows"]])')"

# 2. A second window tiles beside it.
spawn
wait_tests 2 15 || true
if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
ids = set(int(x) for x in "'"$(test_ids)"'".split())
w = [x for x in d["windows"] if x["id"] in ids]
if len(w) < 2 or len({x["workspace"] for x in w}) != 1:
    sys.exit(1)
if any(x["maximized"] for x in w):
    sys.exit(1)
a, b = w[0]["rect"], w[1]["rect"]
if a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"]:
    sys.exit(1)
sys.exit(0)'; then
  pass "the second window tiles beside it"
else
  fail "the pair did not tile ($(state_expr '[(w["id"], w["rect"], w["maximized"]) for w in d["windows"]]'))"
fi

read -r A B <<<"$(test_pair_by_x)"
echo "pair $A $B on ws$ws1"

# 3. Maximize B: it slides right, still maximized, and the view follows.
adrt MaximizeWindow "$B" >/dev/null
if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
sys.exit(0 if b and b[0]["maximized"] and b[0]["workspace"] == int("'"$ws1"'") + 1
         and d["activeWorkspace"] == b[0]["workspace"] else 1)'; then
  pass "maximize slid it right, kept it maximized, and the view followed"
else
  fail "maximize did not slide it right ($(state_expr 'next(((w["workspace"], w["maximized"]) for w in d["windows"] if w["id"] == $B), None)'), active $(state_expr 'd["activeWorkspace"]'))"
fi

# 4. Unmaximize: it returns to the pair.
adrt UnmaximizeWindow "$B" >/dev/null
if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] in set(int(i) for i in "'"$(test_ids)"'".split())]
sys.exit(0 if len({x["workspace"] for x in w}) == 1 and not any(x["maximized"] for x in w) else 1)'; then
  pass "unmaximize returned it to the pair"
else
  fail "unmaximize did not return it ($(state_expr '[(w["id"], w["workspace"], w["maximized"]) for w in d["windows"]]'))"
fi

# 5. A third window slides to a further workspace and is maximized.
spawn
wait_tests 3 15 || true
read -r third third_ws <<<"$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ids = set(int(x) for x in "'"$(test_ids)"'".split())
ws = [w for w in d["windows"] if w["id"] in ids]
top = max(w["workspace"] for w in ws)
w = [x for x in ws if x["workspace"] == top][0]
print(w["id"], top)')"
if wait_python 12 '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$third"'")]
sys.exit(0 if w and w[0]["workspace"] > int("'"$ws1"'") and d["activeWorkspace"] == w[0]["workspace"] else 1)'; then
  pass "the third window slid to a further workspace and was followed"
else
  fail "the third window did not slide right (third on ws$third_ws)"
fi

# 6. Minimize it: it slides back left. The left workspace holds a pair here, so
#    it must come back floating on top of them.
adrt MinimizeWindow "$third" >/dev/null
if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$third"'")]
sys.exit(0 if w and w[0]["workspace"] == int("'"$ws1"'") else 1)'; then
  pass "minimize slid it back to the left workspace"
else
  fail "minimize did not slide it left ($(state_expr 'next(((w["workspace"], w["minimized"]) for w in d["windows"] if w["id"] == $third), None)'))"
fi

check_python "over a pair it comes back floating, not tiled" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$third"'")]
if not w:
    print("window gone"); sys.exit(1)
if w[0]["layer"] != 2:
    print("layer", w[0]["layer"], "- expected it to float over the pair"); sys.exit(1)
print("floats over the pair")
'

# 7. The marker follows the focused window.
adrt ActivateWindow "$A" >/dev/null
if wait_python 12 '
import json, sys
d = json.load(sys.stdin)
f = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
b = d["border"]
if not f or not b["visible"] or b["rect"] is None:
    sys.exit(1)
r, q = b["rect"], f[0]["rect"]
sys.exit(0 if abs(r["x"] - q["x"]) <= 2 and abs(r["y"] - q["y"]) <= 2
         and abs(r["width"] - q["width"]) <= 2 and abs(r["height"] - q["height"]) <= 2 else 1)'; then
  pass "the active-window marker matches the focused window"
else
  fail "marker $(state_expr 'str(d["border"])') vs window $(state_expr 'next((w["rect"] for w in d["windows"] if w["id"] == $A), None)')"
fi

summary
