#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A44 Focus direction fallback: RETIRED in Stage 3. The v1 rule fell back to the
# opposite direction; the v2 model (§6/§17, decision 58) says a direction with
# nothing that way stays silent. Cross-screen focus and the silent direction are
# covered by A121 and A57.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

skip "the opposite-direction fallback is retired: a direction with nothing that way stays silent (§6/§17)"
summary
exit 0

ensure_clean
open_pair
read -r left right <<<"$(dump | python3 -c '
import json,sys
ws = sorted((w for w in json.load(sys.stdin)["windows"] if w["tileable"]), key=lambda w: w["rect"]["x"])
print(ws[0]["id"], ws[1]["id"])')"
echo "left=$left right=$right"

focused_is() {
  local id="$1" border target
  border="$(dump | python3 -c 'import json,sys; b=json.load(sys.stdin)["border"]["rect"]; print(b["x"] if b else "")')"
  target="$(dump | python3 -c '
import json, sys
w = [x for x in json.load(sys.stdin)["windows"] if x["id"] == int(sys.argv[1])]
print(w[0]["rect"]["x"] if w else "")' "$id")"
  [ -n "$border" ] && [ "$border" = "$target" ]
}

# Focus the left window, then ask for "left": no left neighbour → focus right.
adrt ActivateWindow "$left" >/dev/null
sleep 1
adrt FocusDirection left >/dev/null
sleep 1
if focused_is "$right"; then pass "no left window: focused the right one"; else fail "did not fall back to the right window"; fi

# Focus the right window, then ask for "right": no right neighbour → focus left.
adrt ActivateWindow "$right" >/dev/null
sleep 1
adrt FocusDirection right >/dev/null
sleep 1
if focused_is "$left"; then pass "no right window: focused the left one"; else fail "did not fall back to the left window"; fi

# With a single window, neither direction has a target → nothing happens.
close_window "$right"
wait_count 1 15 || true
sleep 2
adrt ActivateWindow "$left" >/dev/null
sleep 1
adrt FocusDirection left >/dev/null
sleep 1
if focused_is "$left"; then pass "single window: focus stayed put"; else fail "focus moved with no neighbour"; fi

ensure_clean
summary
