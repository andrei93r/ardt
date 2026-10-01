#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A108 A maximized window dragged across screens is un-maximized at the drop and
# then re-evaluated by the target's rules (§6): landing alone there, the lone law
# maximizes it again. Needs two monitors.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
monitors="$(state_expr 'len(d["monitors"])')"
if [ "${monitors:-1}" -lt 2 ]; then
  skip "A108 needs two monitors to exercise a cross-screen drag"
  summary
  exit 0
fi

spawn_window >/dev/null
wait_count 1 15 || true
sleep 1
A="$(list_ids)"
pair_ws="$(window_field "$A" workspace)"

adrt MaximizeWindow "$A" >/dev/null
wait_python 15 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if [w for w in d['windows'] if w['id']==$A and w['maximized']] else 1)" || true

adrt ActivateWindow "$A" >/dev/null
sleep 0.5
adrt MoveDirection right >/dev/null
wait_settled 20

poll "the dropped window is alone on the target and maximized there" '
import json, sys
d = json.load(sys.stdin)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
if not a:
    print("window gone"); sys.exit(1)
if a[0]["monitor"] != 1:
    print("still on monitor", a[0]["monitor"]); sys.exit(1)
if not a[0]["maximized"]:
    print("a lone dropped window is not maximized"); sys.exit(1)
if a[0]["workspace"] != int("'"$pair_ws"'"):
    print("it changed workspace", a[0]["workspace"]); sys.exit(1)
print("alone and maximized on the target screen")
' 25

ensure_clean
summary
