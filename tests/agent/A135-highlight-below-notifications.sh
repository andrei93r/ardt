#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A135 The active-window highlight is stacked below the notification tray, so a
# notification banner is never painted through by it. `addChrome` inserts each
# new actor just below `top_window_group`, which puts a highlight added after the
# tray *above* it; the fix keeps it below.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
spawn_window >/dev/null
wait_count 1 15 || true
id="$(list_ids | awk '{print $1}')"
[ -n "$id" ] && adrt ActivateWindow "$id" >/dev/null

if wait_python 15 'import json,sys
sys.exit(0 if json.load(sys.stdin)["border"]["visible"] else 1)'; then
  pass "the highlight is visible on the focused window"
else
  fail "the highlight never appeared"
fi

check_python "the highlight sits below the notification tray" '
import json, sys
d = json.load(sys.stdin)
ind = d["indicator"]
if ind.get("stackedBelowTray") is not True:
    print("indicator", {k: ind.get(k) for k in ("visible", "stackedBelowTray")}); sys.exit(1)
print("stackedBelowTray", ind.get("stackedBelowTray"))
'

ensure_clean
summary
