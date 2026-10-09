#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# A168 §3.2 coherence/stubborn storm + top flip: a window that refuses geometry
# must climb the bounded retry ladder once and then stop — the recorder caught
# `resize_retry reason=coherence` arriving forever and the tiler's top for the
# same window flipping between two values (`y=32` and `y=711`). The ladder is
# deliberately bounded (`retriesMs` then `stubborn`, §12); this scenario injects
# a finite number of refused verifies, forces a replan, and then asserts the
# outcome the pure model promises: the retry/refusal decisions stop (a settle
# window adds none), the window stops being stubborn, and its top is a single
# value across polls — never an alternation between two plans.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# New retry/refusal decisions for one window since a sequence mark.
ladder_since() { # mark id
  decisions_json 3000 | python3 -c '
import json, sys
entries = json.load(sys.stdin)
mark, wid = int("'"$1"'"), int("'"$2"'")
retries = stubborn = 0
for e in entries:
    if e.get("seq", 0) <= mark or e.get("id") != wid:
        continue
    if e.get("ev") == "resize_retry":
        retries += 1
    elif e.get("ev") == "stubborn":
        stubborn += 1
print(retries, stubborn)'
}

# The top of a window, as the tiler would read it. Sampled repeatedly to catch
# an alternation (the flip) rather than a single frame.
tops_of() { # id count
  local id="$1" n="$2" i out=""
  for i in $(seq 1 "$n"); do
    out="$out $(window_field "$id" rect | python3 -c 'import ast,sys; print(ast.literal_eval(sys.stdin.read().strip())["y"])')"
    sleep 0.7
  done
  echo "$out"
}

ensure_clean
open_pair
wait_settled 15
ids=($(list_ids))
if [ "${#ids[@]}" -lt 2 ]; then
  fail "the pair did not form"
  summary
  exit 0
fi
A="${ids[0]}"

mark="$(decisions_json 3000 | python3 -c 'import json,sys; e=json.load(sys.stdin); print(e[-1]["seq"] if e else 0)')"

# Force a finite batch of refused verifies, then make the tiler replan so the
# ladder runs: a vertical replan, back to horizontal, then vertical again. The
# window reaches each plan (the injection only fakes the *verify*), but the
# ladder is what a real refusal walks — retries, then a bounded stubborn record.
adrt InjectVerifyFailure "$A" 6 >/dev/null
adrt SimulateWorkspaceOrientation true >/dev/null
sleep 1
adrt SimulateWorkspaceOrientation false >/dev/null
sleep 1
adrt SimulateWorkspaceOrientation true >/dev/null

# Wait out the ladder: the window must return to the plan and stop being marked
# stubborn (the coherence sweep clears a refusal once the frame is on-plan).
if wait_python 25 "
import json, sys
d = json.load(sys.stdin)
w = next((w for w in d['windows'] if w['id'] == $A), None)
sys.exit(0 if w is not None and not w['stubborn'] else 1)"; then
  pass "the refused window returns to the plan and is no longer stubborn"
else
  fail "the window stayed stubborn (rect $(window_field "$A" rect))"
fi
wait_settled 15

# The ladder is bounded: the injected batch can only be consumed once, so the
# retries since the mark cannot exceed the batch plus the retries a couple of
# replans add. A storm would blow straight past this.
read -r retries stubborn <<<"$(ladder_since "$mark" "$A")"
assert_num "the retry ladder is bounded" "<=" "$retries" "12"

# The counter stabilises: a settle window adds no new retry or refusal.
mark2="$(decisions_json 3000 | python3 -c 'import json,sys; e=json.load(sys.stdin); print(e[-1]["seq"] if e else 0)')"
sleep 5
read -r retries2 stubborn2 <<<"$(ladder_since "$mark2" "$A")"
assert_num "no retry arrives after the settle" "==" "$retries2" "0"
assert_num "no stubborn record arrives after the settle" "==" "$stubborn2" "0"

# The top does not alternate between two values: sample it across polls. A flip
# (the recorder's y=32 <-> y=711) would show two distinct values for one window.
tops="$(tops_of "$A" 10)"
distinct="$(printf '%s\n' $tops | sort -u | wc -l | tr -d ' ')"
if [ "$distinct" = "1" ]; then
  pass "the window's top is one value across polls ($tops)"
else
  fail "the window's top alternated across polls: $tops"
fi

# The window is a single stable plan: inside its own work area, one slot, one
# workspace, and it did not get self-unmaximized by the churn.
check_python "the window ends in exactly one stable plan" '
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d["windows"] if x["id"] == int("'"$A"'")), None)
if w is None:
    print("window gone"); sys.exit(1)
if w["stubborn"]:
    print("stubborn", w["rect"]); sys.exit(1)
a = next((m.get("workArea") or m["geometry"] for m in d["monitors"] if m["index"] == w["monitor"]), None)
r = w["rect"]
ok = a is not None and r["x"] >= a["x"] - 2 and r["y"] >= a["y"] - 2 and r["x"] + r["width"] <= a["x"] + a["width"] + 2 and r["y"] + r["height"] <= a["y"] + a["height"] + 2
print("window", w["id"], "slot", w["slot"], "axis", w["axis"], "rect", r)
sys.exit(0 if ok else 1)
'
if wait_settled 12 && plan="$(snapshot_geometry)" && wait_settled 12 && [ "$(snapshot_geometry)" = "$plan" ]; then
  pass "the pair is identical across two settles after the refusal"
else
  fail "the pair was not stable across two settles after the refusal"
fi

adrt SimulateWorkspaceOrientation false >/dev/null
ensure_clean
summary
