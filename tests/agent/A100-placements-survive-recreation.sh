#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A100 §12: placements are keyed by instance id with a durable per-app ordinal
# that only ever rolls forward, so windows recreated after a restart (or after
# closing) match the previous session in order.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
adrt ForgetApp org.gnome.TextEditor >/dev/null 2>&1 || true

open_pair
ids=($(list_ids))
if [ "${#ids[@]}" -lt 2 ]; then
  fail "the pair did not open"
  summary
  exit 0
fi

poll "the two windows have durable placements, ordinals 1 and 2" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w.get("ordinal")]
ords = sorted(w["ordinal"] for w in ws)
if ords[:2] != [1, 2]:
    print("ordinals", ords); sys.exit(1)
print("ordinals", ords)
' 25

# Close both and recreate them. The entry survives, and the ordinal counter
# rolls forward: the recreated windows take 3 and 4, never 1 and 2 again.
for id in "${ids[@]}"; do close_window "$id"; done
wait_for 20 bash -c "[ \"\$(bash '$NESTED' dbus ListWindows | python3 '$PARSE' | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))')\" = 0 ]" || true

spawn_window >/dev/null
wait_count 1 20 || true
spawn_window >/dev/null
wait_count 2 20 || true
wait_settled 15

poll "recreated windows continue the ordinal roll-up and the entry persists" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w.get("ordinal")]
ords = sorted(w["ordinal"] for w in ws)
if ords[:2] != [3, 4]:
    print("ordinals after recreation", ords); sys.exit(1)
entry = [e for e in d.get("registry", []) if e["appId"] == "org.gnome.TextEditor"]
if not entry:
    print("registry entry was lost"); sys.exit(1)
if entry[0]["windowsSeen"] < 4:
    print("windowsSeen", entry[0]["windowsSeen"]); sys.exit(1)
print("ordinals", ords, "windowsSeen", entry[0]["windowsSeen"])
' 25

ensure_clean
adrt ForgetApp org.gnome.TextEditor >/dev/null 2>&1 || true
summary
