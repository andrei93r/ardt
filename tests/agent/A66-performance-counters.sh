#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A66 Stage 0 diagnostics: DumpState reports the counter block, and the counters
# advance as the extension works. This is the measurement baseline for every
# later performance stage, so it asserts only that the counters exist and move —
# never a specific amount of work (later stages tighten their own scenarios).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean

check_python "the counter block is present and well-formed" '
import json, sys
c = json.load(sys.stdin).get("counters")
if not isinstance(c, dict):
    print("counters missing"); sys.exit(1)
required = ["sweeps", "sweepMsMax", "sweepMsAvg", "classifyCalls", "classifyMisses",
            "configBuilds", "rulesParses", "plansComputed", "plansApplied",
            "sweepFrameReads", "hostLookups", "hostScans", "logEvents"]
missing = [k for k in required if k not in c]
if missing:
    print("missing:", missing); sys.exit(1)
bad = {k: v for k, v in c.items() if not isinstance(v, (int, float)) or v < 0}
if bad:
    print("not a non-negative number:", bad); sys.exit(1)
print("sweeps=%s classifyCalls=%s sweepMsMax=%sms" % (c["sweeps"], c["classifyCalls"], c["sweepMsMax"]))
'

open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_settled 15

# The coherence sweep is the periodic guarantee (§35); it must keep running.
if wait_counter_grows sweeps 20; then
  pass "the coherence sweep keeps running"
else
  fail "the coherence sweep stopped (sweeps=$(counter sweeps))"
fi
# Classification is consulted on every pass, so a tiled pair must be counted.
if wait_counter_grows classifyCalls 20; then
  pass "classification is counted"
else
  fail "classification stopped being counted (classifyCalls=$(counter classifyCalls))"
fi
# The sweep is timed, so a maximum must have been recorded.
assert_num "the sweep is timed" '>' "$(state_expr 'd["counters"]["sweepMsMax"]')" 0

# The classifier config is resolved once and reused: it is read for every window
# on every pass, so a rebuild per call was the hottest allocation in the loop.
builds_before="$(counter configBuilds)"
classify_before="$(counter classifyCalls)"
wait_settled 10
builds_during="$(counter configBuilds)"
classify_during="$(counter classifyCalls)"
builds_delta=$((builds_during - builds_before))
classify_delta=$((classify_during - classify_before))
# It is read for every window on every pass, so the proof is the ratio, not a
# fixed count: a write anywhere (including ours) legitimately busts the memo.
if [ "$builds_delta" -le 10 ] && [ "$classify_delta" -gt "$((builds_delta * 5))" ]; then
  pass "the classifier config is memoised ($classify_delta classifications cost $builds_delta build(s))"
else
  fail "the classifier config was rebuilt $builds_delta times for $classify_delta classifications"
fi

# A user-visible action is counted too: a split resize moves windows and logs.
# Two opposite ratios guarantee the plan changes whichever ratio the pair is on,
# and the counter is polled because a retile can land late under load.
A="${ids[0]}"
B="${ids[1]}"
before_applied="$(counter plansApplied)"
before_logged="$(counter logEvents)"
adrt SimulateResize "$A" "$B" 0.3 >/dev/null
adrt SimulateResize "$A" "$B" 0.7 >/dev/null
if wait_for 15 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"counters\"][\"plansApplied\"])')\" -gt '$before_applied' ]"; then
  pass "a resize is counted as a plan applied"
else
  fail "a resize is counted as a plan applied (still $(counter plansApplied), was $before_applied)"
fi
if wait_counter_grows logEvents 20; then
  pass "logging is counted"
else
  fail "logging stopped being counted (logEvents=$(counter logEvents), was $before_logged)"
fi

ensure_clean
summary
