#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A82 Event journal: every platform event is recorded with one monotonic
# sequence, readable through DumpEvents and written to one file per day. Fails
# today: there is no DumpEvents trigger.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair

events="$(journal_tail 300 '')"
if [ -z "$events" ] || ! printf '%s' "$events" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1; then
  fail "DumpEvents returns JSON (got: ${events:-<empty>})"
  summary
  exit 1
fi

label="the journal holds the events that just happened, in one sequence"
if printf '%s' "$events" | python3 -c '
import json, sys
entries = json.load(sys.stdin)
if not isinstance(entries, list) or len(entries) < 4:
    print("too few entries:", len(entries) if isinstance(entries, list) else entries)
    sys.exit(1)
for e in entries:
    for key in ("seq", "source", "event", "at"):
        if key not in e:
            print("entry missing", key, e)
            sys.exit(1)
seqs = [e["seq"] for e in entries]
if seqs != sorted(seqs) or len(set(seqs)) != len(seqs):
    print("sequence is not strictly increasing:", seqs[:12])
    sys.exit(1)
kinds = {e["event"] for e in entries}
for want in ("surface-created", "focus-changed"):
    if want not in kinds:
        print("missing event kind", want, "have", sorted(kinds))
        sys.exit(1)
print("entries", len(entries), "kinds", sorted(kinds)[:6])
'; then
  pass "$label"
else
  fail "$label — $(printf '%s' "$events" | python3 -c '
import json, sys
entries = json.load(sys.stdin)
print("entries", len(entries), "kinds", sorted({e.get("event") for e in entries})[:8])' 2>&1)"
fi

# The journal is also a file: one per day, in the data directory.
if ls "$ADRT_STATE_DIR/data/adrt/journal/"*.jsonl >/dev/null 2>&1; then
  pass "the journal is on disk, one file per day"
else
  fail "no journal file under $ADRT_STATE_DIR/data/adrt/journal/"
fi

# A filter narrows the tail to one kind.
filtered="$(journal_tail 50 'surface-created')"
if printf '%s' "$filtered" | python3 -c '
import json, sys
entries = json.load(sys.stdin)
if not entries:
    sys.exit(1)
if any("surface-created" not in e["event"] and "surface-created" not in e["source"] for e in entries):
    sys.exit(1)
'; then
  pass "DumpEvents filters by kind"
else
  fail "DumpEvents filter returned the wrong entries: $(printf '%s' "$filtered" | head -c 200)"
fi

# Decisions share the same sequence and are read the same way.
decisions="$(adrt DumpDecisions 200 2>/dev/null | python3 "$PARSE" 2>/dev/null || true)"
if printf '%s' "$decisions" | python3 -c '
import json, sys
entries = json.load(sys.stdin)
if not isinstance(entries, list) or len(entries) < 3:
    print("too few decisions:", len(entries) if isinstance(entries, list) else entries)
    sys.exit(1)
for e in entries:
    for key in ("seq", "source", "event", "at"):
        if key not in e:
            print("decision missing", key, e)
            sys.exit(1)
    if e["source"] != "decision":
        print("not a decision:", e)
        sys.exit(1)
seqs = [e["seq"] for e in entries]
if seqs != sorted(seqs):
    print("decision sequence is not increasing:", seqs[:8])
    sys.exit(1)
print("decisions", len(entries))
'; then
  pass "DumpDecisions returns the decisions on the shared sequence"
else
  fail "DumpDecisions — $(printf '%s' "$decisions" | head -c 200)"
fi

# The notification catalogue: a nothing-happened notice is always shown, is
# deduplicated per subject, and an opt-in decision stays silent until enabled.
first="$(adrt SimulateNotice nothing-to-undo subject-A | python3 "$PARSE")"
second="$(adrt SimulateNotice nothing-to-undo subject-A | python3 "$PARSE")"
third="$(adrt SimulateNotice nothing-to-undo subject-B | python3 "$PARSE")"
optin="$(adrt SimulateNotice did-not-fit subject-A | python3 "$PARSE")"
assert_eq "an always-on notice is shown" "True" "$first"
assert_eq "the same notice for the same subject is deduplicated" "False" "$second"
assert_eq "a different subject is its own notice" "True" "$third"
assert_eq "an opt-in decision stays silent by default" "False" "$optin"

ensure_clean
summary
