#!/usr/bin/env bash
# Generated with AI for personal use.
# S10 An app that opens maximized (Files) tiles with the sibling.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

# The premise is an app that opens maximized, so pin Files for both windows and
# wait for the first to be maximized before the sibling arrives.
spawn "$FILES"
wait_tests 1 12 || true
wait_python 15 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if any(w["maximized"] for w in d["windows"]) else 1)' || true
adrt SpawnWindow "$FILES" >/dev/null
wait_tests 2 15 || true

TEST_IDS="$(test_ids)" poll "the maximized app was tiled with its sibling" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
ws = [w for w in d["windows"] if w["id"] in ids]
if len(ws) < 2:
    print("only", len(ws), "test windows"); sys.exit(1)
if len({w["workspace"] for w in ws}) != 1:
    print("different workspaces"); sys.exit(1)
if any(w["maximized"] for w in ws):
    print("a window is still maximized"); sys.exit(1)
for w in ws:
    if w["rect"]["width"] >= area["width"] - 1:
        print("window fills the monitor", w["id"]); sys.exit(1)
print("paired")
' 20

summary
