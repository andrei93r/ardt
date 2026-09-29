#!/usr/bin/env bash
# Generated with AI for personal use.
# S01 Extension health on the live session.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

check_python "DumpState is well formed" '
import json, sys
d = json.load(sys.stdin)
if d.get("format") != "adrt.state":
    print("bad format", d.get("format")); sys.exit(1)
print("workspaces", d["workspaces"], "windows", len(d["windows"]))
'

check_python "the monitor exposes a work area and the indicator resolves" '
import json, sys
d = json.load(sys.stdin)
m = d["monitors"][0]
if "workArea" not in m:
    print("no workArea"); sys.exit(1)
i = d["indicator"]
if not i.get("color"):
    print("no indicator colour"); sys.exit(1)
print(m["connector"], m["workArea"], i["color"], i["width"])
'

summary
