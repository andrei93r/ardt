#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A124 A window moving to another *screen* takes the slot on the side it came
# from (§3) — the screen case of the arrival side rule A117 covers for
# workspaces. Needs two monitors; skips with a reason on one.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
monitors="$(state_expr 'len(d["monitors"])')"
if [ "${monitors:-1}" -lt 2 ]; then
  skip "A124 needs two monitors to exercise the cross-screen arrival side"
  summary
  exit 0
fi

send_right() {
  local id="$1" target="$2"
  adrt ActivateWindow "$id" >/dev/null
  sleep 0.5
  adrt MoveDirection right >/dev/null
  wait_python 15 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if [w for w in d['windows'] if w['id']==$id and w['monitor']==$target] else 1)" || true
}

# A pair on the primary: A is minimized so Y stands alone, then Y leaves for
# the secondary; restoring A leaves it alone on the primary.
spawn_window >/dev/null
wait_count 1 15 || true
sleep 1
A="$(list_ids | tr ' ' '\n' | head -1)"
before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 2 15 || true
Y="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
wait_settled 12

adrt MinimizeWindow "$A" >/dev/null
wait_python 12 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(w['id']==$A and w['minimized'] for w in d['windows']) else 1)" || true
send_right "$Y" 1
wait_settled 12

adrt ActivateWindow "$A" >/dev/null
wait_python 12 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(w['id']==$A and not w['minimized'] for w in d['windows']) else 1)" || true
wait_settled 12

# A follows Y, arriving on the secondary from the left: it takes slot 0 and the
# resident Y is pushed to slot 1 (the default would leave A in slot 1).
send_right "$A" 1
wait_settled 15

poll "arriving from the left takes slot 0 and the resident moves right" '
import json, sys
d = json.load(sys.stdin)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
y = [w for w in d["windows"] if w["id"] == int("'"$Y"'")]
if not a or not y:
    print("window gone"); sys.exit(1)
if a[0]["monitor"] != 1 or y[0]["monitor"] != 1:
    print("not both on the secondary", a[0]["monitor"], y[0]["monitor"]); sys.exit(1)
if a[0]["workspace"] != y[0]["workspace"]:
    print("not paired", a[0]["workspace"], y[0]["workspace"]); sys.exit(1)
if a[0]["slot"] != 0:
    print("the arrival took slot", a[0]["slot"], "expected 0"); sys.exit(1)
if y[0]["slot"] != 1:
    print("the resident was not pushed to slot 1, it is in", y[0]["slot"]); sys.exit(1)
print("from-left: arrival slot", a[0]["slot"], "resident slot", y[0]["slot"])
' 25

ensure_clean
summary
