#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A04 Maximized window: maximizing a window with a sibling sends it to a new workspace.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt MaximizeWindow "${ids[1]}" >/dev/null

if wait_python 25 '
import json, sys
d = json.load(sys.stdin)
maxed = [w for w in d["windows"] if w["maximized"]]
others = [w for w in d["windows"] if not w["maximized"]]
if not maxed:
    sys.exit(1)
if any(o["workspace"] == maxed[0]["workspace"] for o in others):
    sys.exit(1)'; then
  pass "maximized window moved to its own workspace"
else
  fail "maximized window did not get its own workspace"
fi

ensure_clean
summary
