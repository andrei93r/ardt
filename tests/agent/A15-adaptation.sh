#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A15 Refusal (§12/§16): a client that insists on a large minimum is accepted —
# it stays a managed window (its own workspace if it cannot share) — and the
# registry learns **timing only**: no minimum, no geometry is ever recorded.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
adrt ForgetApp dev.adrt.RefusingClient >/dev/null 2>&1 || true

spawn_window >/dev/null
wait_count 1 15 || true
A="$(list_ids | tr ' ' '\n' | head -1)"
pair_ws="$(window_field "$A" workspace)"

# min width 900 > half of the 1280 screen: it cannot share the pair.
spawn_window "python3 $ROOT_DIR/tests/support/refusing-client.py 900 400 stubborn" >/dev/null
wait_count 2 20 || true
B="$(list_ids | tr ' ' '\n' | grep -v "^$A$" | tr -d '\n' | xargs)"
wait_settled 15

if [ -z "$A" ] || [ -z "$B" ]; then
  fail "the refusing client did not open"
  summary
  exit 0
fi

# The refusing client is accepted: still managed (tileable, not floating) and
# neither window was evicted or lost.
poll "the refusing client is accepted, not evicted or floated" '
import json, sys
d = json.load(sys.stdin)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not a or not b:
    print("window gone"); sys.exit(1)
if not b[0]["tileable"] or b[0]["layer"] == 2:
    print("refuser is not managed:", b[0]["tileable"], b[0]["layer"]); sys.exit(1)
if not a[0]["tileable"]:
    print("the other window is not managed"); sys.exit(1)
print("accepted refuser", b[0]["id"], "on ws", b[0]["workspace"])
' 25

# No minimum / geometry is ever learned: the registry's adapt record for the
# refuser holds only timing keys.
check_python "the registry learned timing only, never geometry" '
import json, sys
d = json.load(sys.stdin)
entry = [e for e in d.get("registry", []) if e["appId"] == "dev.adrt.RefusingClient"]
if not entry:
    print("refuser not in the registry"); sys.exit(1)
adapt = entry[0].get("adapt", {})
allowed = {"unmaximizeDelayMs", "settleMs", "skipAnimation", "retries"}
extra = sorted(set(adapt) - allowed)
if extra:
    print("learned geometry:", extra, adapt); sys.exit(1)
txt = json.dumps(entry[0])
for field in ("refusedMinW", "refusedMinH", "acceptedW", "acceptedH"):
    if field in txt:
        print("geometry field present:", field); sys.exit(1)
print("adapt", adapt)
'

ensure_clean
adrt ForgetApp dev.adrt.RefusingClient >/dev/null 2>&1 || true
summary
