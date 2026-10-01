#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A86 A full active workspace creates one immediately to the right and puts the
# newcomer there maximized; the view follows the newcomer (§3).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
pair_ws="$(state_expr 'min(w["workspace"] for w in d["windows"] if w["tileable"])')"
spawn_window >/dev/null
wait_count 3 15 || true
wait_settled 12

poll "the newcomer is maximized one workspace to the right, and the view follows" '
import json, sys
d = json.load(sys.stdin)
pair_ws = int("'"$pair_ws"'")
others = [w for w in d["windows"] if w["workspace"] != pair_ws]
if len(others) != 1:
    print("expected one extra window, got", len(others)); sys.exit(1)
w = others[0]
if w["workspace"] != pair_ws + 1:
    print("on ws", w["workspace"], "expected", pair_ws + 1); sys.exit(1)
if not w["maximized"]:
    print("not maximized"); sys.exit(1)
if d["activeWorkspace"] != w["workspace"]:
    print("view did not follow: active", d["activeWorkspace"], "window ws", w["workspace"]); sys.exit(1)
print("newcomer", w["id"], "on ws", w["workspace"], "active", d["activeWorkspace"])
' 20

ensure_clean
summary
