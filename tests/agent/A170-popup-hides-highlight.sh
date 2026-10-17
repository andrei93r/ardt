#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A170 The active-window highlight must not be painted over an app popup. App
# menus, popovers and tooltips are window actors below the chrome layer, so a
# highlight drawn in `uiGroup` sits on top of an open menu (the bug recorded as
# "highlight over menu"). The focused window's popup now suppresses the
# highlight (`popup`), and the border returns when the popup closes.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
spawn_window_argv \
  "$(argv_json_from_string "python3 $ROOT_DIR/tests/agent/popup-client.py")" \
  '{"ADRT_POPUP_CLOSE_MS":"3000"}' >/dev/null
wait_count 1 25 || true
ID="$(list_ids | awk 'NR == 1 {print $1}')"
if [ -z "$ID" ]; then
  fail "the popup host window never appeared (windows: $(list_ids))"
  ensure_clean
  summary
  exit 1
fi
adrt ActivateWindow "$ID" >/dev/null

# In the headless Shell the synthetic popup is short-lived, so state sampling
# can miss it; the journal is the exact record. The suppression must be
# followed by a hidden highlight (`border focus` with a null id).
if wait_for 20 bash -c "bash '$NESTED' dbus DumpEvents 400 border | python3 '$PARSE' | python3 -c '
import json, sys
entries = json.load(sys.stdin)
suppressed = False
for entry in entries:
    if entry.get(\"event\") == \"suppress\" and entry.get(\"reason\") == \"popup\":
        suppressed = True
    elif suppressed and entry.get(\"event\") == \"focus\" and entry.get(\"id\") is None:
        sys.exit(0)
sys.exit(1)'"; then
  pass "an open popup suppresses the focused window's highlight"
else
  fail "popup did not suppress the highlight (border events: $(journal_tail 20 border))"
fi

# The popup closes after the client's timeout: the release must be journalled
# and the highlight must come back, so a stuck suppression cannot pass silently.
if wait_for 20 bash -c "bash '$NESTED' dbus DumpEvents 400 border | python3 '$PARSE' | python3 -c '
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get(\"event\") == \"release\" and e.get(\"reason\") == \"popup\" for e in entries) else 1)'"; then
  pass "the popup release is journalled with its reason"
else
  fail "no border release record with reason popup (events: $(journal_tail 20 border))"
fi

if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d["focused"] == int("'"$ID"'")
         and d["border"]["visible"]
         and "popup" not in d["indicator"]["suppressed"] else 1)'; then
  pass "the highlight returns on the focused window once the popup closes"
else
  fail "the highlight did not return (focused: $(state_expr 'd["focused"]'), suppressed: $(state_expr 'd["indicator"]["suppressed"]'), visible: $(border_visible))"
fi

ensure_clean
summary
