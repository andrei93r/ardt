#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# S18 The trigger wins on the live session (§10 steps 3-4): two windows that cannot
# share the screen — a refusing client with a large minimum and a normal window —
# leave the screen to the one the action was about, and the other gives way.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

# A client that will not go below 1700 px wide: on a 2560 px screen it cannot share.
REFUSING="${ADRT_SESSION_REFUSING:-python3 $ROOT_DIR/tests/support/refusing-client.py 1700 400 stubborn}"
spawn "$REFUSING"
wait_tests 1 20 || true
refusing="$(test_ids | tr ' ' '\n' | head -1)"

# The newcomer arrives on top of it: this is the action that must win.
spawn "$FILES"
wait_tests 2 20 || true

TEST_IDS="$(test_ids)" poll "the newcomer keeps the screen and the other gives way" '
import os, json, sys
ids = [int(x) for x in os.environ["TEST_IDS"].split()]
d = json.load(sys.stdin)
ws = {w["id"]: w for w in d["windows"] if w["id"] in ids}
if len(ws) < 2:
    print("only", len(ws), "test windows"); sys.exit(1)
refusing, newcomer = ids[0], ids[1]
r, n = ws.get(refusing), ws.get(newcomer)
if r is None or n is None:
    print("missing window"); sys.exit(1)
# Exactly one of the two may be visible, and it must be the newcomer, maximized.
if r["minimized"] is False and n["minimized"] is False:
    print("both visible"); sys.exit(1)
if n["minimized"] is True:
    print("the trigger was the one that gave way"); sys.exit(1)
if not n["maximized"]:
    print("the trigger is not maximized"); sys.exit(1)
print("newcomer maximized, refusing client minimized")
' 25

session_cleanup
summary
