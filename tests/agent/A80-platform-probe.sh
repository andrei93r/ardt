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

ensure_clean
summary
