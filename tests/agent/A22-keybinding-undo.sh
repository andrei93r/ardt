#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A22 Keybinding undo through injected input: Super+Z restores the ratio a
# SimulateResize changed. Runs in the nested Shell now that real input can be
# injected (Stage 0).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! probe_supports injection; then
  skip "A22 keybinding undo: needs ADRT_INJECT=1 (the nested harness sets it)"
  exit 0
fi

ensure_clean
open_pair
ids=($(list_ids))
rect_of() {
  dump | python3 -c "
import json, sys
d = json.load(sys.stdin)
w = [x for x in d['windows'] if x['id'] == ${ids[0]}]
print(json.dumps(w[0]['rect']) if w else '')"
}
before="$(rect_of)"
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.3 >/dev/null
wait_settled 12
if [ "$(rect_of)" = "$before" ]; then
  fail "precondition: the resize changed the geometry"
  summary
  exit 1
fi

inject_hotkey 65515 122   # Super+Z

# The undo lands when the drain runs: poll for the restored rectangle instead of
# sampling once after the geometry happens to go quiet.
poll "the undo keybinding restored the ratio" "
import json, sys
d = json.load(sys.stdin)
w = [x for x in d['windows'] if x['id'] == ${ids[0]}]
same = bool(w) and w[0]['rect'] == json.loads('''$before''')
if not same:
    print('now', w[0]['rect'] if w else None, 'was', '''$before''')
sys.exit(0 if same else 1)
" 20

ensure_clean
summary
