#!/usr/bin/env bash
# Generated with AI for personal use.
# S03 Third window on the live session: new workspace one to the right, view follows.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
spawn
wait_tests 2 15 || true
sleep 1
spawn
wait_tests 3 15 || true
sleep 1

TEST_IDS="$(test_ids)" check_python "the third window is one workspace to the right and focused" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["id"] in ids]
if len(ws) < 3:
    print("only", len(ws), "test windows"); sys.exit(1)
by_ws = {}
for w in ws:
    by_ws.setdefault(w["workspace"], []).append(w)
pair_ws = min(by_ws)
extra = [k for k in by_ws if k != pair_ws]
if not extra:
    print("all test windows share a workspace"); sys.exit(1)
target = max(extra)
if target != pair_ws + 1:
    print("third window on ws", target, "expected", pair_ws + 1); sys.exit(1)
if d["activeWorkspace"] != target:
    print("view did not follow: active", d["activeWorkspace"], "target", target); sys.exit(1)
print("third on ws", target, "active", d["activeWorkspace"])
'

summary
