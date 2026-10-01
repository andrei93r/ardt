#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A80 Platform probe: the capability JSON the harness relies on. Fails today:
# there is no ProbePlatform trigger.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean

probe="$(probe_json)"
if [ -z "$probe" ] || ! printf '%s' "$probe" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1; then
  fail "ProbePlatform returns JSON (got: ${probe:-<empty>})"
  summary
  exit 1
fi

label="the probe reports the capabilities the harness needs"
if printf '%s' "$probe" | python3 -c '
import json, sys
d = json.load(sys.stdin)
need = ["gnome", "session", "monitors", "layoutRows", "laters", "virtualInput", "injection"]
missing = [k for k in need if k not in d]
if missing:
    print("missing", missing)
    sys.exit(1)
if not d["laters"].get("beforeRedraw", False):
    print("no BEFORE_REDRAW later")
    sys.exit(1)
if d["monitors"] < 1 or not isinstance(d["layoutRows"], int):
    print("bad monitors/layoutRows", d["monitors"], d["layoutRows"])
    sys.exit(1)
print("gnome", d["gnome"], "monitors", d["monitors"], "layoutRows", d["layoutRows"])
'; then
  pass "$label"
else
  fail "$label — $(printf '%s' "$probe" | python3 -c '
import json, sys
d = json.load(sys.stdin)
need = ["gnome", "session", "monitors", "layoutRows", "laters", "virtualInput", "injection"]
print("missing", [k for k in need if k not in d], "laters", d.get("laters"))' 2>&1)"
fi

# The probe must see exactly the monitors the harness started.
expected_monitors=1
if [ -n "${ADRT_MONITORS:-}" ]; then
  expected_monitors="$(printf '%s' "$ADRT_MONITORS" | tr ':' '\n' | grep -c .)"
fi
assert_eq "the probe sees the harness's monitors" "$expected_monitors" \
  "$(printf '%s' "$probe" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("monitors", -1))' 2>/dev/null || echo -1)"

# The dump carries what the layout tests need: the axis, a derived slot per
# window, the gaps in force, and why focus last moved.
open_pair
if wait_python 20 '
import json, sys
d = json.load(sys.stdin)
if d.get("focusedReason", None) is None:
    print("no focusedReason"); sys.exit(1)
gaps = d.get("gaps") or {}
if "base" not in gaps or "landscape" not in gaps or "portrait" not in gaps:
    print("no gaps", gaps); sys.exit(1)
for w in d["windows"]:
    if w.get("axis") not in ("horizontal", "vertical"):
        print("bad axis", w.get("axis")); sys.exit(1)
    if w.get("slot") not in (0, 1, None):
        print("bad slot", w.get("slot")); sys.exit(1)
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"]]
slots = sorted(w["slot"] for w in tiles if w["slot"] is not None)
if slots != [0, 1]:
    print("a pair should read as slots 0 and 1:", [(w["id"], w["slot"]) for w in tiles]); sys.exit(1)
sys.exit(0)'; then
  pass "DumpState reports the axis, the slots, the gaps and the focus reason"
else
  check_python "DumpState reports the axis, the slots, the gaps and the focus reason" '
import json, sys
d = json.load(sys.stdin)
print("focusReason", d.get("focusedReason"), "gaps", d.get("gaps"), "windows", [(w["id"], w.get("slot"), w.get("axis")) for w in d["windows"]])
sys.exit(1)'
fi

ensure_clean
summary
