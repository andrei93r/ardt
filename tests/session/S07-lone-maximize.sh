#!/usr/bin/env bash
# Generated with AI for personal use.
# S07 Lone maximize on the live session.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 25 || true
spawn
wait_tests 2 30 || true
sleep 2
read -r A _ <<<"$(test_pair_by_x)"

adrt CloseWindow "$A" >/dev/null
sleep 3

TEST_IDS="$(test_ids)" check_python "the remaining window is maximized" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["id"] in ids]
if len(ws) != 1:
    print("expected one remaining test window, got", len(ws)); sys.exit(1)
if not ws[0]["maximized"]:
    print("not maximized"); sys.exit(1)
print("maximized")
'

summary
