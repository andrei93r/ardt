#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A103 `record` exposes the journal and decisions as a replayable trace (§22,
# Stage 6): the trace carries the initial model state, the ordered model events
# (window-opened / layout / …) and the decisions on the shared sequence.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
set_setting record true
open_pair
wait_settled 15

assert_eq "the record flag is reported" "true" "$(state_expr 'str(d["flags"]["record"]).lower()')"

trace="$(adrt DumpTrace 300 2>/dev/null | python3 "$PARSE" 2>/dev/null || true)"
if [ -z "$trace" ] || ! printf '%s' "$trace" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1; then
  fail "DumpTrace returns JSON (got: ${trace:-<empty>})"
  set_setting record false
  ensure_clean
  summary
  exit 1
fi

label="the trace has the replayable shape"
if adrt DumpTrace 300 | python3 "$PARSE" | python3 -c '
import json, sys
trace = json.load(sys.stdin)
if trace.get("version") != 1:
    print("version", trace.get("version")); sys.exit(1)
initial = trace.get("initial")
if not isinstance(initial, dict):
    print("no initial state"); sys.exit(1)
if not isinstance(initial.get("workspaces"), list) or not isinstance(initial.get("windows"), list):
    print("initial state missing workspaces/windows"); sys.exit(1)
if not isinstance(initial.get("viewed"), int):
    print("initial viewed is not an index"); sys.exit(1)
events = trace.get("events")
if not isinstance(events, list) or len(events) < 2:
    print("too few events:", len(events) if isinstance(events, list) else events); sys.exit(1)
seqs = [e["seq"] for e in events]
if seqs != sorted(seqs):
    print("events out of sequence"); sys.exit(1)
kinds = {e["event"] for e in events}
for want in ("window-opened", "layout"):
    if want not in kinds:
        print("missing event kind", want, "have", sorted(kinds)[:8]); sys.exit(1)
for e in events:
    if e.get("source") != "model":
        print("event not from the model recorder:", e); sys.exit(1)
decisions = trace.get("decisions")
if not isinstance(decisions, list):
    print("no decisions array"); sys.exit(1)
print("trace: %d events, %d decisions, kinds %s" % (len(events), len(decisions), sorted(kinds)[:5]))
'; then
  pass "$label"
else
  fail "$label"
fi

set_setting record false
ensure_clean
summary
