#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# A169 §3.4 early focus / window not visible: the recorder caught a `focus`
# record for a window before it was mapped/visible. The journal has no explicit
# "mapped" line, so its own ordering is read from the records it does carry:
# `surface-created` (the compositor's window-created, which can arrive with a
# degenerate 0x0 frame) is the arrival, and the `border focus` decision carries
# the rect the highlight was actually drawn at. The rule this asserts: a
# newcomer is only ever highlighted once it has a real frame — no `border focus`
# for it before its `surface-created`, and none with a degenerate rect. A build
# that focused the window on creation (before Mutter gave it a frame) would fail
# exactly here.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
# The shared journal is one sequence for the whole worker; only the newcomer's
# own records since this mark may be read.
mark="$(journal_tail 1 | python3 -c 'import json,sys; e=json.load(sys.stdin); print(e[-1]["seq"] if e else 0)')"
before="$(list_ids)"
spawn_window >/dev/null
wait_count 1 15 || true

NEW="$(list_ids | tr ' ' '\n' | grep -vxF "$(printf '%s\n' $before)" | head -1)"
if [ -z "${NEW:-}" ]; then
  fail "the newcomer never appeared"
  ensure_clean
  summary
  exit 1
fi
# Its first real frame before the event stream is read: `border focus` is only
# journalled on a change, so wait (bounded) for the highlight to be recorded.
for _ in $(seq 1 30); do
  if journal_tail 4000 | python3 -c "
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get('source') == 'border' and e.get('event') == 'focus' and e.get('id') == $NEW for e in entries) else 1)"; then
    break
  fi
  sleep 0.5
done
sleep 1

# The ordering assertion, over every record for the newcomer since the mark.
if journal_tail 4000 | python3 -c '
import json, sys
new = int("'"$NEW"'")
mark = int("'"$mark"'")
entries = [e for e in json.load(sys.stdin) if e.get("seq", 0) > mark]

created = [e for e in entries if e.get("source") == "host" and e.get("event") == "surface-created"
           and isinstance(e.get("surface"), dict) and e["surface"].get("id") == new]
focus_events = [e for e in entries if e.get("source") == "host" and e.get("event") == "focus-changed" and e.get("id") == new]
border = [e for e in entries if e.get("source") == "border" and e.get("event") == "focus" and e.get("id") == new]

if not created:
    print("no surface-created record for the newcomer"); sys.exit(1)
cseq = created[0]["seq"]

if focus_events and focus_events[0]["seq"] <= cseq:
    print("focus recorded before the window existed:", focus_events[0]["seq"], "<=", cseq); sys.exit(1)

if not border:
    print("the newcomer was never highlighted"); sys.exit(1)
first = border[0]
if first["seq"] <= cseq:
    print("highlight recorded before the window existed:", first["seq"], "<=", cseq); sys.exit(1)
r = first.get("rect")
if not isinstance(r, dict) or r.get("width", 0) <= 0 or r.get("height", 0) <= 0:
    print("the first highlight carried a non-visible rect", r); sys.exit(1)
# No highlight at the pre-map degenerate rect may precede the first real one.
for e in border:
    if e["seq"] >= first["seq"]:
        break
    rr = e.get("rect")
    if isinstance(rr, dict) and (rr.get("width", 0) <= 0 or rr.get("height", 0) <= 0):
        print("highlight drawn while the window was not visible", e["seq"], rr); sys.exit(1)
print("surface-created", cseq, "first border focus", first["seq"], "rect", r)
'; then
  pass "focus for the newcomer is recorded only once it is mapped/visible"
else
  fail "focus was recorded for the newcomer before it was visible"
fi

# The trace agrees: the model's own arrival event for the newcomer exists, so
# the ordering above is checked against a window the model actually adopted.
if adrt DumpTrace 400 | python3 "$PARSE" | python3 -c '
import json, sys
trace = json.load(sys.stdin)
new = int("'"$NEW"'")
opened = [e for e in trace.get("events", []) if e.get("event") == "window-opened" and e.get("id") == new]
if not opened:
    print("no window-opened event for the newcomer"); sys.exit(1)
print("window-opened", opened[0].get("seq"))
'; then
  pass "the model records the newcomer's arrival (window-opened)"
else
  fail "the model never recorded the newcomer's arrival"
fi

ensure_clean
summary
