#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A104 The queue drains back to zero and the perf block reports drain/apply
# latency percentiles (Stage 6, §22).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
wait_settled 15

check_python "the perf block reports queue depth and latency percentiles" '
import json, sys
d = json.load(sys.stdin)
p = d.get("perfStats")
if not isinstance(p, dict):
    print("perfStats missing"); sys.exit(1)
required = ["queueDepth", "drains", "drainMsP50", "drainMsP95", "applyMsP50", "applyMsP95"]
missing = [k for k in required if k not in p]
if missing:
    print("missing:", missing); sys.exit(1)
bad = {k: v for k, v in p.items() if not isinstance(v, (int, float)) or v < 0}
if bad:
    print("not a non-negative number:", bad); sys.exit(1)
print("drains=%s p50=%sms p95=%sms" % (p["drains"], p["drainMsP50"], p["drainMsP95"]))
'

depth="$(adrt SimulateBurst 12 perf-check | python3 "$PARSE")"
assert_eq "a burst coalesces into one queued entry" "1" "$depth"

if wait_python 15 'import json,sys; sys.exit(0 if json.load(sys.stdin)["perfStats"]["queueDepth"] == 0 else 1)'; then
  pass "the queue drains back to zero"
else
  fail "the queue never drained (depth $(state_expr 'd["perfStats"]["queueDepth"]'))"
fi

check_python "drain and apply latency were measured" '
import json, sys
p = json.load(sys.stdin)["perfStats"]
if p["drains"] < 1:
    print("no drains recorded"); sys.exit(1)
if p["drainMsP95"] < p["drainMsP50"] and p["drains"] > 3:
    print("p95 below p50:", p["drainMsP50"], p["drainMsP95"]); sys.exit(1)
print("drains=%s applyP50=%s" % (p["drains"], p["applyMsP50"]))
'

ensure_clean
summary
