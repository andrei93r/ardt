#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A41 Same-app second window splits: opening a second window of the app that
# already has one must tile the two, not stack the newcomer maximized. The rule
# is client-independent, so the scenario drives it with whichever available
# client actually opens a second toplevel (an editor via `--new-window`, with
# Nautilus as the fallback), and skips only if every client on the box is
# single-instance and can therefore show nothing.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean

# Prefer a client that reliably opens a second *toplevel*: the rule is about
# two windows of one app, and a single-instance client cannot show it. Nautilus
# 51 is single-instance (a bare `nautilus trash://` raises the open window), so
# the scenario drives the split with an editor that supports `--new-window`,
# then falls back to Nautilus and skips if that too turns out single-instance.
open_second_window() { # argv-json
  adrt SpawnWindow "$1" '{}' >/dev/null 2>&1
  wait_count 2 15
}

spawn_window "gnome-text-editor --new-window" >/dev/null
wait_count 1 20 || true
wait_settled 15

if open_second_window '["gnome-text-editor","--new-window"]'; then
  app="the two editor windows"
else
  # Both windows must be gone before the fallback, or the count below would be
  # satisfied by a leftover.
  ensure_clean
  spawn_window "nautilus" >/dev/null
  wait_count 1 15 || true
  wait_settled 12
  if open_second_window '["nautilus","--new-window","trash://"]'; then
    app="the two Files windows"
  else
    skip "no available client opened a second toplevel (single-instance clients only raise the existing window); the same-app split rule cannot be observed"
    ensure_clean
    summary
    exit 0
  fi
fi
wait_settled 12

check_python "$app are tiled side by side" '
import json, sys
d = json.load(sys.stdin)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
ws = [w for w in d["windows"] if w["tileable"]]
if len(ws) < 2:
    print("expected two tileable windows, got", len(ws)); sys.exit(1)
if len({w["workspace"] for w in ws}) != 1:
    print("windows on different workspaces"); sys.exit(1)
if any(w["maximized"] for w in ws):
    print("a window is still maximized"); sys.exit(1)
for w in ws:
    # A side-by-side tile is full HEIGHT (§10: outer gaps default 0), so only a
    # window spanning both dimensions is a maximized single, not a tile.
    if w["rect"]["width"] >= area["width"] - 1 and w["rect"]["height"] >= area["height"] - 1:
        print("window spans the whole area", w["id"], w["rect"]); sys.exit(1)
a, b = ws[0]["rect"], ws[1]["rect"]
if a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"] and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]:
    print("windows overlap"); sys.exit(1)
print("split", a["width"], b["width"])
'

ensure_clean
summary
