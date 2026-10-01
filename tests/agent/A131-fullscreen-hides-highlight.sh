#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A131 A fullscreen window must not be highlighted as active (§11/§16): it fills
# the screen, so the marker would be drawn over its own content. The suppression
# is a property of the focused window's fullscreen flag, re-derived in the drain,
# and must be journalled and lifted when the window leaves fullscreen.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
pair_ws="$(window_field "$A" workspace)"
wait_settled 12

adrt ActivateWindow "$A" >/dev/null
wait_python 10 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d["focused"] == int("'"$A"'") else 1)' || true
if ! wait_border_visible 20; then
  fail "the border was not visible before fullscreen (suppressed: $(state_expr 'd["indicator"]["suppressed"]'))"
fi

# Fullscreen A. On a workspace-capable screen this is the §4/§16 case: it gets
# its own workspace to the right and the view follows.
adrt ToggleFullscreen "$A" >/dev/null

poll "fullscreen gives the window its own workspace and the view follows" '
import json, sys
d = json.load(sys.stdin)
a = next((w for w in d["windows"] if w["id"] == int("'"$A"'")), None)
if a is None:
    print("window gone"); sys.exit(1)
if a["reason"] != "fullscreen" or a.get("fullscreen") is not True or a["workspace"] == int("'"$pair_ws"'"):
    print("not fullscreen on its own workspace:", a["reason"], a.get("fullscreen"), a["workspace"]); sys.exit(1)
if d["focused"] != int("'"$A"'") or d["activeWorkspace"] != a["workspace"]:
    print("focus/view not on the fullscreen window", d["focused"], d["activeWorkspace"]); sys.exit(1)
print("fullscreen on ws", a["workspace"])
' 20

if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if not d["border"]["visible"] and "fullscreen" in d["indicator"]["suppressed"] else 1)'; then
  pass "the highlight is hidden while the focused window is fullscreen"
else
  fail "fullscreen window is still highlighted (suppressed: $(state_expr 'd["indicator"]["suppressed"]'), visible: $(border_visible))"
fi

if journal_tail 400 border | python3 -c '
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get("event") == "suppress" and e.get("reason") == "fullscreen" for e in entries) else 1)'; then
  pass "the fullscreen suppression is journalled with its reason"
else
  fail "no border suppress record with reason fullscreen (events: $(journal_tail 20 border))"
fi

# Leaving fullscreen restores the pair and the highlight.
adrt ToggleFullscreen "$A" >/dev/null

poll "leaving fullscreen restores the pair" '
import json, sys
d = json.load(sys.stdin)
a = next((w for w in d["windows"] if w["id"] == int("'"$A"'")), None)
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if a is not None and a.get("fullscreen") is True:
    print("still fullscreen"); sys.exit(1)
sys.exit(0 if len(tiles) >= 2 else 1)
' 20

if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d["border"]["visible"] and "fullscreen" not in d["indicator"]["suppressed"] else 1)'; then
  pass "the highlight returns once the window leaves fullscreen"
else
  fail "border never came back (suppressed: $(state_expr 'd["indicator"]["suppressed"]'), visible: $(border_visible))"
fi

if journal_tail 400 border | python3 -c '
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get("event") == "release" and e.get("reason") == "fullscreen" for e in entries) else 1)'; then
  pass "the fullscreen release is journalled with its reason"
else
  fail "no border release record with reason fullscreen (events: $(journal_tail 20 border))"
fi

ensure_clean
summary
