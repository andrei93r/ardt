#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A138 OS-sourced animation timing. The resolved timing follows each screen's
# refresh rate (re-derived at runtime, not cached at enable) and the OS
# animation state; adrt's own `disable-animations` skips adrt's animations
# without ever flipping GNOME's global accessibility state.
#
# The nested Shell's `--virtual-monitor` is a *fixed* rate, so true variable
# refresh (VRR) cannot be exercised here: the varying-interval path is covered
# by tests/core/timing.test.ts and by the frame-clock design. Refresh changes
# are driven through the `SimulateScreens` fixture, which carries `refreshRate`
# per screen exactly as Mutter reports it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# A one- or two-screen fixture with explicit refresh rates.
timing_fixture() {
  local r0="$1" r1="${2:-}"
  python3 -c "
import json, sys
rate0 = float('$r0')
out = [{'index': 0, 'connector': 'M0', 'x': 0, 'y': 0, 'width': 1280, 'height': 800,
        'isPrimary': True, 'refreshRate': rate0,
        'workArea': {'x': 0, 'y': 0, 'width': 1280, 'height': 800}}]
if '$r1':
    out.append({'index': 1, 'connector': 'M1', 'x': 1280, 'y': 0, 'width': 1280, 'height': 800,
                'isPrimary': False, 'refreshRate': float('$r1'),
                'workArea': {'x': 1280, 'y': 0, 'width': 1280, 'height': 800}})
print(json.dumps(out))
"
}

# Wait until the resolved timing satisfies a predicate over d['timing'].
wait_timing() {
  local timeout="$1" code="$2"
  wait_python "$timeout" "
import json, sys
t = json.load(sys.stdin).get('timing', {})
$code"
}

ensure_clean

# 1. DumpState exposes the resolved timing (add-only shape).
check_python "DumpState exposes a resolved timing block" '
import json, sys
d = json.load(sys.stdin)
t = d.get("timing")
if not isinstance(t, dict):
    print("timing missing"); sys.exit(1)
for key in ("animationsEnabled", "osAnimationsEnabled", "slowDownFactor", "screens",
            "baseFrameIntervalMs", "observedFrameIntervalMs", "variableRefresh"):
    if key not in t:
        print("timing missing", key); sys.exit(1)
if not t["screens"] or "frameIntervalMs" not in t["screens"][0]:
    print("screens", t["screens"]); sys.exit(1)
print("screens", t["screens"])
'

# 2. A fixed 60 Hz screen resolves to ~16.667 ms per frame.
adrt SimulateScreens "$(timing_fixture 60)" >/dev/null
if wait_timing 10 '
s = t["screens"]
sys.exit(0 if len(s) == 1 and abs(s[0]["refreshRate"] - 60) < 0.01
         and abs(s[0]["frameIntervalMs"] - 16.6667) < 0.01 else 1)
'; then
  pass "a 60 Hz screen resolves to a 16.67 ms frame interval"
else
  fail "60 Hz timing did not resolve (see DumpState.timing)"
fi

# 3. Change the refresh at runtime to 144 Hz: the resolved timing must follow,
#    not stay cached from enable.
adrt SimulateScreens "$(timing_fixture 144)" >/dev/null
if wait_timing 10 '
s = t["screens"]
sys.exit(0 if abs(s[0]["refreshRate"] - 144) < 0.01
         and abs(s[0]["frameIntervalMs"] - 6.9444) < 0.01
         and abs(t["baseFrameIntervalMs"] - 6.9444) < 0.01 else 1)
'; then
  pass "a runtime change to 144 Hz re-derives the frame interval (6.94 ms)"
else
  fail "144 Hz timing did not re-derive (see DumpState.timing)"
fi

# 4. Fixed-timer cadences re-derive from the refresh too: 3 frames at 144 Hz is
#    ~21 ms, and the ~500 ms retile budget is ~24 ticks (not a fixed 50/10).
check_python "the motion sampler and retile cadence follow the 144 Hz refresh" '
import json, sys
t = json.load(sys.stdin)["timing"]
poll, ticks = t.get("motionPollMs", 0), t.get("motionRetileTicks", 0)
if not (15 <= poll <= 25):
    print("motionPollMs", poll); sys.exit(1)
if not (20 <= ticks <= 28):
    print("motionRetileTicks", ticks); sys.exit(1)
print("poll", poll, "ticks", ticks)
'

# 5. A mixed-refresh setup keeps each screen's own interval and uses the tightest
#    as the base (no single assumed rate).
adrt SimulateScreens "$(timing_fixture 60 144)" >/dev/null
if wait_timing 10 '
s = {m["index"]: m for m in t["screens"]}
sys.exit(0 if len(s) == 2
         and abs(s[0]["frameIntervalMs"] - 16.6667) < 0.01
         and abs(s[1]["frameIntervalMs"] - 6.9444) < 0.01
         and abs(t["baseFrameIntervalMs"] - 6.9444) < 0.01 else 1)
'; then
  pass "a 60/144 mixed setup keeps per-screen intervals and the tightest base"
else
  fail "mixed-refresh timing did not resolve (see DumpState.timing)"
fi

# 6. Back to a single 60 Hz screen: the motion cadence returns to 50 ms.
adrt SimulateScreens "$(timing_fixture 60)" >/dev/null
if wait_timing 10 'sys.exit(0 if t.get("motionPollMs") == 50 else 1)'; then
  pass "returning to 60 Hz re-derives the 50 ms motion cadence"
else
  fail "60 Hz motion cadence did not return (see DumpState.timing)"
fi

# 7. The platform probe reports the refresh source and adaptive-sync support, so
#    diagnostics can tell fixed from variable mode.
probe="$(probe_json)"
if echo "$probe" | python3 -c '
import json, sys
p = json.load(sys.stdin)
r = p.get("refresh")
if not isinstance(r, dict):
    print("probe.refresh missing"); sys.exit(1)
if "source" not in r or "adaptiveSyncSupported" not in r or not r.get("screens"):
    print("probe.refresh incomplete", r); sys.exit(1)
print("source", r["source"], "adaptiveSync", r["adaptiveSyncSupported"])
'; then
  pass "ProbePlatform reports the refresh source and adaptive-sync support"
else
  fail "ProbePlatform does not report refresh/adaptive-sync"
fi

# 8. adrt's `disable-animations` skips its own animations internally but never
#    flips GNOME's global state (osAnimationsEnabled stays true, mutated false).
set_setting disable-animations true
if wait_timing 10 '
sys.exit(0 if t["animationsEnabled"] is False and t["osAnimationsEnabled"] is True
         and t.get("mutated") is False else 1)
'; then
  pass "adrt animation off is internal; GNOME's global state is untouched"
else
  fail "adrt mutated GNOME's global animation state (see DumpState.timing)"
fi
set_setting disable-animations false
wait_timing 10 'sys.exit(0 if t["animationsEnabled"] is True and t["osAnimationsEnabled"] is True else 1)' || true

# 9. The OS setting is the source of truth: disabling animations system-wide
#    resolves every duration to 0 (including the indicator pulse).
set_system_setting org.gnome.desktop.interface enable-animations false
if wait_timing 10 '
sys.exit(0 if t["animationsEnabled"] is False and t["osAnimationsEnabled"] is False else 1)
'; then
  pass "the OS enable-animations=false resolves animations off"
else
  fail "the OS disabled state was not honoured (see DumpState.timing)"
fi
check_python "with animations off the resolved durations are zero" '
import json, sys
d = json.load(sys.stdin)
t = d["timing"]
if t["animationsEnabled"] is not False:
    print("animationsEnabled", t["animationsEnabled"]); sys.exit(1)
pulse = d.get("indicator", {}).get("pulseDurationMs")
if pulse != 0:
    print("pulseDurationMs", pulse); sys.exit(1)
print("pulseDurationMs", pulse)
'
set_system_setting org.gnome.desktop.interface enable-animations true
wait_timing 10 'sys.exit(0 if t["animationsEnabled"] is True and t["osAnimationsEnabled"] is True else 1)' || true

# 10. The pre-enable baseline is still GNOME's value (adrt re-enabled nothing).
check_python "adrt never changed GNOME's animation baseline" '
import json, sys
t = json.load(sys.stdin)["timing"]
b = t.get("baseline", {})
if b.get("enableAnimations") is not True:
    print("baseline", b); sys.exit(1)
if t.get("mutated") is not False:
    print("mutated", t.get("mutated")); sys.exit(1)
print("baseline", b)
'

adrt SimulateScreens null >/dev/null
ensure_clean
summary
