#!/usr/bin/env bash
# Generated with AI for personal use.
# A126 A newcomer that opens fully maximized (like Nautilus/Chrome do) onto a
# full pair is routed like any other arrival: it gets its own workspace to the
# right, maximized, and the view follows (§3/§4/§16). Opening maximized is not a
# user maximize, so it does not *place* the window — but it must still route.
# Before the fix the register-unmaximize path returned without routing and the
# newcomer was left stacked in a slot over the pair.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
# Let the maximized client's request land before adrt's first-frame ready
# timeout reads the window's flags (otherwise it reads a plain window).
set_setting gnome-animation-delay 600

spawn_window "gnome-calculator" >/dev/null
wait_count 1 15 || true
spawn_window "gnome-calculator" >/dev/null
wait_count 2 15 || true
wait_settled 12
pair_ws="$(state_expr 'min(w["workspace"] for w in d["windows"] if w["tileable"])')"
echo "pair on ws$pair_ws"

spawn_window "python3 $(cd "$(dirname "$0")" && pwd)/maximized-client.py" >/dev/null
wait_count 3 20 || true
wait_settled 15

poll "the maximized newcomer is on its own workspace, one to the right and focused" '
import json, sys
d = json.load(sys.stdin)
pair_ws = int("'"$pair_ws"'")
others = [w for w in d["windows"] if w["tileable"] and w["workspace"] != pair_ws]
if len(others) != 1:
    print("expected one window off the pair workspace, got",
          [(w["id"], w["workspace"], w["maximized"], w["rect"]) for w in d["windows"]]); sys.exit(1)
w = others[0]
if w["workspace"] != pair_ws + 1:
    print("newcomer on ws", w["workspace"], "expected", pair_ws + 1); sys.exit(1)
if not w["maximized"]:
    print("newcomer not maximized", w["rect"]); sys.exit(1)
if d["activeWorkspace"] != w["workspace"]:
    print("view did not follow: active", d["activeWorkspace"], "window ws", w["workspace"]); sys.exit(1)
print("newcomer", w["id"], "on ws", w["workspace"], "active", d["activeWorkspace"])
' 20

ensure_clean
set_setting gnome-animation-delay 0
summary
