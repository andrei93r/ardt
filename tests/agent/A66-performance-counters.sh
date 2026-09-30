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
assert_num "the coherence sweep keeps running" '>' "$(counter_delta sweeps 5)" 0
# Classification is consulted on every pass, so a tiled pair must be counted.
assert_num "classification is counted" '>' "$(counter_delta classifyCalls 5)" 0
# The sweep is timed, so a maximum must have been recorded.
assert_num "the sweep is timed" '>' "$(state_expr 'd["counters"]["sweepMsMax"]')" 0

# A user-visible action is counted too: a split resize moves windows and logs.
A="${ids[0]}"
B="${ids[1]}"
before_applied="$(counter plansApplied)"
before_logged="$(counter logEvents)"
adrt SimulateResize "$A" "$B" 0.35 >/dev/null
sleep 2
assert_num "a resize is counted as a plan applied" '>' \
  "$(python3 -c "print($(counter plansApplied) - $before_applied)")" 0
assert_num "logging is counted" '>' \
  "$(python3 -c "print($(counter logEvents) - $before_logged)")" 0

ensure_clean
summary
