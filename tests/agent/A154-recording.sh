#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A154 bug recorder (§22 extension): the hotkey, the panel row and the D-Bus
# triggers all drive one lifecycle. StartRecording/ToggleRecording write one
# JSONL file per session under the Shell's data dir; every journal event and a
# ~20 Hz state snapshot flow into it; a *user* stop opens the observation prompt
# and defers the footer until SubmitRecordingNote (or a cancel) writes the note
# and the footer. A cap/disable auto-stop is silent and closes the file at once.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

rec_status() { adrt RecordingStatus | python3 "$PARSE"; }
status_field() { rec_status | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
footer_reason() {
  python3 -c '
import json, sys
rows = [json.loads(line) for line in open(sys.argv[1], encoding="utf8") if line.strip()]
print(rows[-1]["reason"] if rows and rows[-1]["kind"] == "footer" else "none")
' "$1" 2>/dev/null || echo "none"
}

ensure_clean
open_pair
wait_settled 15

# 1. Start: the trigger returns the path and the status/DumpState flip.
start_json="$(adrt StartRecording 0 | python3 "$PARSE")"
start_path="$(printf '%s' "$start_json" | tr -d '"')"
if [ -z "$start_path" ] || ! printf '%s' "$start_path" | grep -q '/adrt/recordings/rec-.*\.jsonl$'; then
  fail "StartRecording returns a recording path (got '${start_path:-<empty>}')"
  ensure_clean
  summary
  exit 1
fi
pass "StartRecording returns the recording path ($start_path)"
case "$start_path" in
  "$ADRT_STATE_DIR"/data/adrt/recordings/*) pass "the recording lives under the Shell's data dir" ;;
  *) fail "the recording is not under \$ADRT_STATE_DIR/data/adrt/recordings ($start_path)" ;;
esac

assert_eq "RecordingStatus reports recording" "true" "$(status_field recording | tr 'A-Z' 'a-z')"
assert_eq "RecordingStatus carries the counters" "true" \
  "$(rec_status | python3 -c 'import json,sys; d=json.load(sys.stdin); print(str(all(k in d for k in ("path","elapsedMs","bytes","events","snapshots","promptOpen","note"))).lower())')"
assert_eq "DumpState reflects the recording path" "$start_path" "$(state_expr 'd["recording"]["path"]')"
assert_eq "DumpState reflects the recording flag" "true" "$(state_expr 'str(d["recording"]["recording"]).lower()')"

# 2. A second start while recording is refused with a clear error string.
second="$(adrt StartRecording 0 | python3 "$PARSE" | tr -d '"')"
case "$second" in
  error:*) pass "a second StartRecording is rejected ($second)" ;;
  *) fail "a second StartRecording was not rejected (got '$second')" ;;
esac

# 3. Spawn, focus, move and close a window while recording.
before="$(list_ids)"
spawn_window >/dev/null
wait_count 3 20 || true
after="$(list_ids)"
new_id=""
for id in $after; do
  case " $before " in
    *" $id "*) ;;
    *) new_id="$id" ;;
  esac
done
assert_true "the spawned window is tracked" "$([ "$(count_windows)" -ge 3 ] && echo true || echo false)"
if [ -n "$new_id" ]; then
  adrt ActivateWindow "$new_id" >/dev/null
  wait_python 12 "import json,sys; sys.exit(0 if json.load(sys.stdin).get('focused') == $new_id else 1)" || true
  adrt MoveWindow "$new_id" 60 60 500 360 >/dev/null 2>&1 || true
  sleep 1.5
  close_window "$new_id"
  wait_for 15 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(len(json.load(sys.stdin)[\"windows\"]))')\" -lt 3 ]" || true
else
  fail "could not identify the spawned window"
fi

# 4. Stop: the prompt opens and the footer is deferred until the note is given.
note_one="the drag landed in the wrong slot"
stop_json="$(adrt StopRecording | python3 "$PARSE")"
stop_path="$(printf '%s' "$stop_json" | tr -d '"')"
assert_eq "StopRecording returns the same path" "$start_path" "$stop_path"
assert_eq "RecordingStatus reports stopped" "false" "$(status_field recording | tr 'A-Z' 'a-z')"
assert_eq "DumpState no longer reports recording" "false" "$(state_expr 'str(d["recording"]["recording"]).lower()')"
assert_eq "a user stop opens the observation prompt" "true" "$(status_field promptOpen | tr 'A-Z' 'a-z')"
assert_eq "DumpState reports the open prompt" "true" "$(state_expr 'str(d["recording"]["promptOpen"]).lower()')"
case "$(status_field promptMechanism)" in
  modal|overlay) pass "the observation prompt is a Shell-native $(status_field promptMechanism)" ;;
  *) fail "the observation prompt has no UI mechanism" ;;
esac
assert_true "SubmitRecordingNote accepts the text" "$(adrt SubmitRecordingNote "$note_one" | python3 "$PARSE")"
if wait_python 10 'import json,sys; sys.exit(0 if not json.load(sys.stdin)["recording"]["promptOpen"] else 1)'; then
  pass "the prompt closes after the note is submitted"
else
  fail "the prompt did not close after the note was submitted"
fi
assert_eq "RecordingStatus reports the note text" "$note_one" "$(status_field note)"

# 5. The file is well-formed: one header, one footer, events, deduped states and
#    the note record before the footer.
if [ ! -f "$stop_path" ]; then
  fail "the recording file exists ($stop_path)"
else
  pass "the recording file exists"
  if python3 -c '
import json, sys
rows = [json.loads(line) for line in open(sys.argv[1], encoding="utf8") if line.strip()]
want = sys.argv[2]
kinds = [r["kind"] for r in rows]
if kinds.count("header") != 1:
    print("headers", kinds.count("header")); sys.exit(1)
if kinds.count("footer") != 1:
    print("footers", kinds.count("footer")); sys.exit(1)
if kinds[0] != "header" or kinds[-1] != "footer":
    print("order", kinds[0], kinds[-1]); sys.exit(1)
events = [r for r in rows if r["kind"] == "event"]
states = [r for r in rows if r["kind"] == "state"]
notes = [r for r in rows if r["kind"] == "note"]
if len(events) < 1:
    print("no events"); sys.exit(1)
if len(states) < 1:
    print("no states"); sys.exit(1)
if len(notes) != 1:
    print("note records", len(notes)); sys.exit(1)
if notes[0]["text"] != want:
    print("note text", notes[0]["text"]); sys.exit(1)
if rows.index(notes[0]) >= rows.index(rows[-1]):
    print("note after footer"); sys.exit(1)
footer = rows[-1]
for key in ("reason", "durationMs", "events", "snapshots", "bytes", "path", "note"):
    if key not in footer:
        print("footer missing", key); sys.exit(1)
if footer["reason"] != "user":
    print("reason", footer["reason"]); sys.exit(1)
if footer["note"] != want:
    print("footer note", footer["note"]); sys.exit(1)
if footer["path"] != sys.argv[1]:
    print("footer path", footer["path"]); sys.exit(1)
# The states must be deduped: a run of identical snapshots is impossible.
keys = [json.dumps({k: v for k, v in s.items() if k != "t"}, sort_keys=True) for s in states]
if any(keys[i] == keys[i + 1] for i in range(len(keys) - 1)):
    print("consecutive duplicate states"); sys.exit(1)
print("rows=%d events=%d states=%d notes=%d" % (len(rows), len(events), len(states), len(notes)))
' "$stop_path" "$note_one"; then
    pass "the recording has one header/note/footer, events and deduped states"
  else
    fail "the recording has one header/note/footer, events and deduped states"
  fi

  # 6. A state snapshot carries the spawned window's id/rect and the focus.
  if [ -n "$new_id" ]; then
    if python3 -c '
import json, sys
rows = [json.loads(line) for line in open(sys.argv[1], encoding="utf8") if line.strip()]
wid = int(sys.argv[2])
states = [r for r in rows if r["kind"] == "state"]
seen_window = seen_focus = False
for s in states:
    for w in s.get("windows", []):
        if w.get("id") == wid:
            r = w.get("rect") or {}
            if all(isinstance(r.get(k), (int, float)) for k in ("x", "y", "width", "height")):
                seen_window = True
    if s.get("focused") == wid:
        seen_focus = True
if not seen_window:
    print("no state carries window", wid); sys.exit(1)
if not seen_focus:
    print("no state focuses window", wid); sys.exit(1)
print("states=%d window=%d" % (len(states), wid))
' "$stop_path" "$new_id"; then
      pass "a state snapshot carries the spawned window id/rect and the focused id"
    else
      fail "a state snapshot carries the spawned window id/rect and the focused id"
    fi
  fi
fi

# 7. The panel row drives the same lifecycle, prompt included.
adrt ActivatePanelItem record >/dev/null 2>&1 || true
if wait_python 10 'import json,sys; sys.exit(0 if json.load(sys.stdin)["recording"]["recording"] else 1)'; then
  pass "the panel record item starts a recording"
else
  fail "the panel record item did not start a recording"
fi
panel_path="$(state_expr 'd["recording"]["path"]')"
adrt ActivatePanelItem record >/dev/null 2>&1 || true
if wait_python 10 'import json,sys; d=json.load(sys.stdin)["recording"]; sys.exit(0 if not d["recording"] and d["promptOpen"] else 1)'; then
  pass "the panel record item stops and opens the prompt"
else
  fail "the panel record item did not stop and open the prompt"
fi
note_panel="panel observation"
assert_true "the panel stop's note is accepted" "$(adrt SubmitRecordingNote "$note_panel" | python3 "$PARSE")"
if [ -f "$panel_path" ] && python3 -c '
import json, sys
rows = [json.loads(line) for line in open(sys.argv[1], encoding="utf8") if line.strip()]
notes = [r for r in rows if r["kind"] == "note"]
sys.exit(0 if rows and rows[-1]["kind"] == "footer" and rows[-1]["reason"] == "user" and notes and notes[0]["text"] == sys.argv[2] else 1)
' "$panel_path" "$note_panel"; then
  pass "the panel-started recording closes with the note and a user footer"
else
  fail "the panel-started recording did not close with the note"
fi

# 8. ToggleRecording is the hotkey path: start, stop, prompt, note, footer.
assert_eq "ToggleRecording starts recording" "True" \
  "$(adrt ToggleRecording | python3 "$PARSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["recording"])')"
toggle_path="$(status_field path)"
assert_eq "ToggleRecording stops and opens the prompt" "True" \
  "$(adrt ToggleRecording | python3 "$PARSE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["promptOpen"] and not d["recording"])')"
note_toggle="hotkey observation"
assert_true "the toggle stop's note is accepted" "$(adrt SubmitRecordingNote "$note_toggle" | python3 "$PARSE")"
if [ -f "$toggle_path" ] && python3 -c '
import json, sys
rows = [json.loads(line) for line in open(sys.argv[1], encoding="utf8") if line.strip()]
notes = [r for r in rows if r["kind"] == "note"]
sys.exit(0 if rows and rows[-1]["kind"] == "footer" and rows[-1]["reason"] == "user" and notes and notes[0]["text"] == sys.argv[2] else 1)
' "$toggle_path" "$note_toggle"; then
  pass "the ToggleRecording file carries the note and a user footer"
else
  fail "the ToggleRecording file did not carry the note"
fi

# 9. The time cap auto-stops silently: no prompt, footer reason cap.
cap_path="$(adrt StartRecording 1 | python3 "$PARSE" | tr -d '"')"
if wait_python 10 'import json,sys; d=json.load(sys.stdin)["recording"]; sys.exit(0 if not d["recording"] else 1)'; then
  pass "the recording auto-stops at its time cap"
else
  fail "the recording did not auto-stop at its time cap"
fi
assert_eq "the cap stop reason is reported" "cap" "$(state_expr 'str(d["recording"]["stopReason"])')"
assert_eq "the cap stop does not open the prompt" "false" "$(state_expr 'str(d["recording"]["promptOpen"]).lower()')"
if [ -f "$cap_path" ] && python3 -c '
import json, sys
rows = [json.loads(line) for line in open(sys.argv[1], encoding="utf8") if line.strip()]
kinds = [r["kind"] for r in rows]
sys.exit(0 if rows and rows[-1]["kind"] == "footer" and rows[-1]["reason"] == "cap" and "note" not in kinds else 1)
' "$cap_path"; then
  pass "the capped recording closes at once with no note"
else
  fail "the capped recording did not close silently"
fi

# 10. A disable stop is silent too: the file closes at once, before any prompt.
dis_path="$(adrt StartRecording 0 | python3 "$PARSE" | tr -d '"')"
bash "$NESTED" disable >/dev/null 2>&1 || true
if wait_for 20 bash -c "[ \"\$(python3 -c 'import json,sys; rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]; print(rows[-1][\"reason\"] if rows and rows[-1][\"kind\"]==\"footer\" else \"none\")' '$dis_path' 2>/dev/null)\" = disable ]"; then
  pass "a disable stop closes the recording silently"
else
  fail "a disable stop did not close the recording (reason=$(footer_reason "$dis_path"))"
fi
if [ -f "$dis_path" ] && python3 -c '
import json, sys
rows = [json.loads(line) for line in open(sys.argv[1], encoding="utf8") if line.strip()]
sys.exit(0 if "note" not in [r["kind"] for r in rows] else 1)
' "$dis_path"; then
  pass "the disabled recording carries no note"
else
  fail "the disabled recording unexpectedly carries a note"
fi
bash "$NESTED" enable >/dev/null 2>&1 || true
bash "$NESTED" wait-adrt 60 || true

# Never leak a live recording into the next scenario.
adrt StopRecording >/dev/null 2>&1 || true
ensure_clean
summary
