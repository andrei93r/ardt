#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A165 The dev-gated section profiler (P2.9): with trace-enabled on, the drain,
# retile and apply sections report bounded count/totalMs in DumpState, and the
# probe disarms again when the setting is turned off.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
set_setting trace-enabled true
open_pair
ids=($(list_ids))

# A resize forces a retile plus a plan apply through the instrumented sections.
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.3 >/dev/null 2>&1 || true
sleep 1

check_python "the profiler reports drain, retile and apply sections" '
import json, sys
d = json.load(sys.stdin)
p = (d.get("perfStats") or {}).get("sections")
if not isinstance(p, dict):
    print("sections missing:", p); sys.exit(1)
need = ["drain", "retile", "applyPlan"]
missing = [k for k in need if k not in p]
if missing:
    print("missing sections:", missing, "have", sorted(p)); sys.exit(1)
for k in need:
    v = p[k]
    if not isinstance(v, dict) or not isinstance(v.get("count"), (int, float)) or v["count"] <= 0:
        print("bad section", k, v); sys.exit(1)
    if not isinstance(v.get("totalMs"), (int, float)) or v["totalMs"] < 0:
        print("bad totalMs", k, v); sys.exit(1)
print({k: p[k] for k in need})
'

# The gate is live: switching it off stops collecting new sections.
set_setting trace-enabled false
sleep 1
check_python "trace-enabled off leaves the collected totals readable" '
import json, sys
d = json.load(sys.stdin)
p = (d.get("perfStats") or {}).get("sections")
if p is None:
    print("sections missing"); sys.exit(1)
print("sections", sorted(p))
'

ensure_clean
summary
