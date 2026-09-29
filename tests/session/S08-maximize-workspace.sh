#!/usr/bin/env bash
# Generated with AI for personal use.
# S08 Maximize gets its own workspace; unmaximize returns to the pair.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 25 || true
spawn
wait_tests 2 30 || true
sleep 2
read -r A B <<<"$(test_pair_by_x)"

adrt MaximizeWindow "$B" >/dev/null
sleep 4
TEST_IDS="$(test_ids)" check_python "the maximized window has its own workspace" '
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
'

adrt UnmaximizeWindow "$B" >/dev/null
sleep 4
TEST_IDS="$(test_ids)" check_python "unmaximizing returned it to the pair" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["id"] in ids]
if len({w["workspace"] for w in ws}) != 1:
    print("workspaces", {w["workspace"] for w in ws}); sys.exit(1)
if any(w["maximized"] for w in ws):
    print("still maximized"); sys.exit(1)
print("returned")
'

summary
