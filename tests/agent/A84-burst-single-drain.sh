#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A84 Burst single drain: a burst of signals for the same work funnels into one
# deferred pass, the queue returns to empty, and the geometry is unchanged.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
wait_settled 20

before="$(snapshot_geometry)"
drains_before="$(counter drains)"
if [ -z "$drains_before" ]; then
  fail "DumpState has no drains counter (the queue is not in place)"
  summary
  exit 1
fi

# A same-frame storm: ten layout signals pushed inside one call. Sequential
# D-Bus calls each get their own frame (and their own drain), which is exactly
# right — coalescing is per frame, not per caller.
depth="$(adrt SimulateBurst 10 screens-changed | python3 "$PARSE")"
assert_eq "ten pushes coalesce to one queued entry" "1" "$depth"

deadline=$((SECONDS + 20))
while [ "$SECONDS" -lt "$deadline" ]; do
  [ "$(counter drains)" -gt "$drains_before" ] && break
  sleep 0.5
done
sleep 1
drains_after="$(counter drains)"
delta=$((drains_after - drains_before))
# The exact count cannot be isolated under load (sweeps and focus changes drain
# too); the coalescing proof is the depth above. This asserts the drain ran.
if [ "$delta" -ge 1 ]; then
  pass "the storm was drained ($delta pass(es)) and cost one queue entry"
else
  fail "the storm produced no drain at all"
fi

assert_eq "the queue is empty after the drain" "0" "$(counter queuePending)"

wait_settled 20
assert_eq "the geometry is unchanged by the burst" "$before" "$(snapshot_geometry)"

ensure_clean
summary
