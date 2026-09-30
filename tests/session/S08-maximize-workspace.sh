#!/usr/bin/env bash
# Generated with AI for personal use.
# S08 Maximize gets its own workspace; unmaximize returns to the pair.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
spawn
wait_tests 2 15 || true
sleep 1
read -r A B <<<"$(test_pair_by_x)"

adrt MaximizeWindow "$B" >/dev/null
TEST_IDS="$(test_ids)" poll "the maximized window has its own workspace" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["id"] in ids]
maxed = [w for w in ws if w["maximized"]]
if not maxed:
    print("nothing maximized"); sys.exit(1)
if any(w["workspace"] == maxed[0]["workspace"] for w in ws if not w["maximized"]):
    print("sibling shares the workspace"); sys.exit(1)
print("own workspace", maxed[0]["workspace"])
' 15

adrt UnmaximizeWindow "$B" >/dev/null
TEST_IDS="$(test_ids)" poll "unmaximizing returned it to the pair" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["id"] in ids]
if len({w["workspace"] for w in ws}) != 1:
    print("workspaces", {w["workspace"] for w in ws}); sys.exit(1)
if any(w["maximized"] for w in ws):
    print("still maximized"); sys.exit(1)
print("returned")
' 20

summary
