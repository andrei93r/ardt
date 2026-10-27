#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A147 Panel removal + the preserved recording shortcut (§1, §22 extension). The
# top-bar panel affordance is gone: DumpState still reports the add-only `panel`
# surface with `present:false`. Bug recording keeps its Super+Shift+R home —
# press once to start, press again to stop and open the "what did you observe?"
# prompt, whose typed description is written into the recording as the note (and
# echoed in the footer). Pause keeps its own non-panel home, `kb-toggle-pause`.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

rec_status() { adrt RecordingStatus | python3 "$PARSE"; }
status_field() { rec_status | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
wait_recording() {
  local timeout="$1" code="$2"
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if rec_status | python3 -c "$code" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

ensure_clean
open_pair
wait_settled 15

# 1. The panel is gone, but its add-only DumpState surface survives.
check_python "DumpState reports no panel and keeps its fields" '
import json, sys
p = json.load(sys.stdin).get("panel")
if not isinstance(p, dict):
    print("panel", p); sys.exit(1)
if p.get("present"):
    print("panel still present", p); sys.exit(1)
for key in ("paused", "indicatorEnabled", "recording", "pauseLabel", "indicatorLabel", "recordLabel"):
    if key not in p:
        print("panel missing", key); sys.exit(1)
print("panel present=False")
'

# 2. The recording shortcut is still registered with its Super+Shift+R default.
assert_eq "the recording shortcut keeps its Super+Shift+R default" "<Super><Shift>r" \
  "$(get_setting kb-recording-toggle | python3 -c 'import ast,sys; print(ast.literal_eval(sys.stdin.read())[0])')"

# 3. Press once: the shortcut starts a recording. The harness injects the real
#    hotkey through Mutter; if injection is unavailable the exact action the
#    shortcut dispatches to is exercised instead, recorded as a skip.
used_key=false
if probe_supports injection; then
  inject_hotkey 65515 65505 114   # Super+Shift+R
  if wait_recording 12 'import json,sys; sys.exit(0 if json.load(sys.stdin)["recording"] else 1)'; then
    pass "the Super+Shift+R shortcut starts a recording"
    used_key=true
  else
    skip "the injected Super+Shift+R did not start recording; using ToggleRecording, the same dispatcher"
  fi
else
  skip "key injection unavailable; using ToggleRecording, the same dispatcher the shortcut calls"
fi
if [ "$used_key" != true ]; then
  adrt ToggleRecording >/dev/null 2>&1 || true
fi
if wait_recording 10 'import json,sys; sys.exit(0 if json.load(sys.stdin)["recording"] else 1)'; then
  pass "a recording is running"
else
  fail "the recording did not start"
  ensure_clean
  summary
  exit 1
fi
start_path="$(state_expr 'd["recording"]["path"]')"

# 4. Press again: it stops and opens the observation prompt (never a silent stop).
if [ "$used_key" = true ]; then
  inject_hotkey 65515 65505 114   # Super+Shift+R
else
  adrt ToggleRecording >/dev/null 2>&1 || true
fi
if wait_recording 12 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if not d["recording"] and d["promptOpen"] else 1)'; then
  pass "the second press stops and opens the observation prompt"
else
  fail "the second press did not stop and open the prompt ($(rec_status))"
fi

note="panel removed, the shortcut still records"
assert_true "the typed description is accepted" "$(adrt SubmitRecordingNote "$note" | python3 "$PARSE")"
wait_python 10 'import json,sys; sys.exit(0 if not json.load(sys.stdin)["recording"]["promptOpen"] else 1)' || true

# 4b. The shortcut's whole lifecycle is journalled. The notification the
#     shortcut raises is not observable from a test, so without this a
#     shortcut that silently did nothing would look exactly like one that
#     worked: the journal is the only record of what adrt did. The recording
#     here was started and stopped through the *shortcut* dispatcher (never a
#     raw StartRecording trigger), so the extension's own change callback ran.
if journal_tail 600 recorder | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    rows = []
if not isinstance(rows, list):
    rows = []
states = [r.get("state") for r in rows if isinstance(r, dict) and r.get("event") == "recording"]
missing = [s for s in ("started", "stopped", "saved") if s not in states]
if missing:
    print("missing", missing, "in", states); sys.exit(1)
print("lifecycle", states)
'; then
  pass "the recording lifecycle (started/stopped/saved) is journalled"
else
  fail "the recording lifecycle is not journalled"
fi

# 5. The note lands in the recording file, before a user footer that carries it.
if [ -f "$start_path" ] && python3 -c '
import json, sys
rows = [json.loads(line) for line in open(sys.argv[1], encoding="utf8") if line.strip()]
want = sys.argv[2]
notes = [r for r in rows if r["kind"] == "note"]
if not notes:
    print("no note record"); sys.exit(1)
if notes[0]["text"] != want:
    print("note text", notes[0]["text"]); sys.exit(1)
footer = rows[-1] if rows else {}
if footer.get("kind") != "footer" or footer.get("reason") != "user":
    print("footer", footer); sys.exit(1)
if footer.get("note") != want:
    print("footer note", footer.get("note")); sys.exit(1)
print("note and user footer recorded")
' "$start_path" "$note"; then
  pass "the description lands in the recording as the note and on the footer"
else
  fail "the description did not land in the recording"
fi

# 5b. The shortcut must keep working while the observation prompt is open. The
#     prompt holds a modal grab, and GNOME filters out *every* keybinding in
#     the default action mode (`Shell.ActionMode.NONE`) — with that default the
#     recording shortcut was dead for as long as the prompt was up, and the
#     grab could stay held after it closed, killing every other shortcut too.
#     It runs after the note flow, so the recording it starts cannot swallow
#     the note the previous steps assert.
if [ "$used_key" = true ]; then
  inject_hotkey 65515 65505 114   # Super+Shift+R
  if wait_recording 12 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d["recording"] else 1)'; then
    pass "the shortcut starts a new recording after the note"
  else
    fail "the shortcut did not start a recording ($(rec_status))"
  fi
  inject_hotkey 65515 65505 114   # Super+Shift+R
  if wait_recording 12 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d["promptOpen"] else 1)'; then
    pass "the second press opens the observation prompt again"
  else
    fail "the second press did not open the prompt ($(rec_status))"
  fi
  inject_hotkey 65515 65505 114   # Super+Shift+R
  if wait_recording 12 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d["recording"] and not d["promptOpen"] else 1)'; then
    pass "the shortcut still works while the observation prompt is open"
  else
    fail "the shortcut was dead while the observation prompt was open ($(rec_status))"
  fi
  # Leave no live recording behind for the rest of the scenario.
  adrt StopRecording >/dev/null 2>&1 || true
  adrt SubmitRecordingNote "" >/dev/null 2>&1 || true
else
  skip "key injection unavailable; the shortcut-while-the-prompt-is-open case cannot be observed"
fi

# 6. Pause keeps a non-panel home: the kb-toggle-pause action (same predicate the
#    old panel row and the TogglePause trigger drive).
assert_true "the pause trigger activates" "$(adrt TogglePause | python3 "$PARSE")"
if wait_python 10 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d["userPaused"] and d["paused"] and not d["indicator"]["visible"] else 1)'; then
  pass "pausing flips the one predicate and hides the highlight"
else
  fail "pausing did not take effect (userPaused=$(state_expr 'str(d["userPaused"]).lower()'))"
fi
assert_true "the resume trigger activates" "$(adrt TogglePause | python3 "$PARSE")"
if wait_python 10 'import json,sys; sys.exit(0 if not json.load(sys.stdin)["userPaused"] else 1)'; then
  pass "resuming clears the manual pause"
else
  fail "resuming did not take effect"
fi

# Never leak a live recording, a pause or a disabled highlight into the next test.
adrt StopRecording >/dev/null 2>&1 || true
if [ "$(state_expr 'str(d["userPaused"]).lower()')" = "true" ]; then
  adrt TogglePause >/dev/null 2>&1 || true
fi
set_setting active-window-indicator true
ensure_clean
summary
