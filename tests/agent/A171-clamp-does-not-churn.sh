#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A171 The self-heal clamp fires once and then leaves the layout alone.
#
# The clamp exists to rescue a window that ended up off-screen (a stale
# position restored from a display that is gone, a monitor unplugged under it).
# Its failure mode is a *loop*: the window is clamped to the work area, the
# frame reads back a pixel or two larger than that area (Mutter reports the
# frame including the toplevel's invisible client-side-decoration border), so
# the next pass clamps it again — forever. A tiled pair jittered by a pixel; a
# maximized window flickered between full screen and half width, because
# resizing a maximized window means unmaximizing it first.
#
# What this scenario can prove headlessly: the clamp fires exactly once for a
# window that is genuinely off-screen, the window ends up inside the work area,
# and neither the counter nor the geometry moves afterwards. A focused, tiled
# pair and a lone window must not be touched at all.
#
# What it *cannot* prove here, and why: the pixel-overflow itself comes from
# Mutter's CSD frame border, which the headless backend does not add, and a
# maximized window is owned and re-snapped by Mutter before the clamp sees it.
# Those two are the recorded manual check in tests/MANUAL.md §14 — the modelled
# half (a frame that overhangs the area) is unit-tested in `tests/core/clamp.ts`
# and `tests/core/types.ts`.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# The clamp's decisions since a mark: how many times it resized a window, and
# how many times the client refused the resize (adrt then gives up and calls the
# window "stubborn" — a lasting accusation for a window that did nothing wrong).
clamps_since() { # mark
  decisions_json 3000 | python3 -c '
import json, sys
entries = json.load(sys.stdin)
mark = int("'"$1"'")
clamps = retries = stubborn = 0
for e in entries:
    if e.get("seq", 0) <= mark:
        continue
    if e.get("ev") == "clamp_to_screen":
        clamps += 1
    elif e.get("ev") == "resize_retry":
        retries += 1
    elif e.get("ev") == "stubborn":
        stubborn += 1
print(clamps, retries, stubborn)'
}

mark_now() {
  decisions_json 3000 | python3 -c 'import json,sys; e=json.load(sys.stdin); print(e[-1]["seq"] if e else 0)'
}

ensure_clean

# The clamp's decisions reach the journal's decision ring only while the
# history is on (every history event is mirrored there), so the decision
# assertions below need it. The counters do not.
set_setting history-enabled true >/dev/null 2>&1 || true

# --- a settled pair is not touched ------------------------------------------
open_pair
wait_settled 15

pair_mark="$(mark_now)"
pair_clamps_before="$(counter clampsApplied)"
pair_geometry_before="$(snapshot_geometry)"
sleep 4
pair_clamps_after="$(counter clampsApplied)"
pair_geometry_after="$(snapshot_geometry)"
read -r pair_clamp_decisions pair_retries pair_stubborn <<<"$(clamps_since "$pair_mark")"

assert_num "the clamp does not fire on a settled pair" "==" "$pair_clamps_after" "$pair_clamps_before"
assert_eq "a settled pair does not move by a pixel" "$pair_geometry_before" "$pair_geometry_after"
assert_num "the clamp decides nothing on a settled pair" "==" "$pair_clamp_decisions" "0"
assert_num "the client is never asked to accept a clamped size" "==" "$pair_retries" "0"
assert_num "adrt does not call a settled client stubborn" "==" "$pair_stubborn" "0"

ensure_clean

# --- a window that is genuinely off-screen is rescued exactly once ----------
# A float is used deliberately: the tiler owns a tile and immediately restores
# its slot, so a tile never reaches the clamp. A float is the window the clamp
# is actually for.
spawn_window >/dev/null
wait_count 1 25 || true
float="$(state_expr 'd["windows"][-1]["id"] if d["windows"] else ""')"
if [ -z "$float" ]; then
  fail "the window was never tracked"
  ensure_clean
  summary
  exit 1
fi

adrt ToggleFloat "$float" >/dev/null 2>&1 || true
if ! wait_python 15 "import json,sys; d=json.load(sys.stdin); w=next((w for w in d['windows'] if w['id'] == $float), None); sys.exit(0 if w is not None and not w['tileable'] else 1)"; then
  skip "the window could not be floated; the clamp path needs a window the tiler does not own"
  ensure_clean
  summary
  exit 0
fi

# Push it well off the top-left corner: the clamp's reason to exist.
adrt MoveWindow "$float" -300 -200 500 400 >/dev/null 2>&1 || true

# It must land inside the work area.
if wait_python 15 "
import json, sys
d = json.load(sys.stdin)
w = next((w for w in d['windows'] if w['id'] == $float), None)
if w is None:
    sys.exit(1)
r = w['rect']
# The work area starts below the top bar; anything with a negative origin is
# still off-screen.
sys.exit(0 if r['x'] >= 0 and r['y'] >= 0 else 1)"; then
  pass "an off-screen float is pulled back into the work area"
else
  fail "the off-screen float was never clamped back ($(state_expr 'json.dumps([w[\"rect\"] for w in d[\"windows\"] if w[\"id\"] == %s])' 2>/dev/null || echo '?'))"
fi

# And then it is left alone: the rescue must not repeat.
clamp_mark="$(mark_now)"
clamp_geometry_before="$(snapshot_geometry)"
clamp_counter_before="$(counter clampsApplied)"
sleep 5
clamp_geometry_after="$(snapshot_geometry)"
clamp_counter_after="$(counter clampsApplied)"
read -r clamp_decisions clamp_retries clamp_stubborn <<<"$(clamps_since "$clamp_mark")"

assert_eq "the rescued float does not move again" "$clamp_geometry_before" "$clamp_geometry_after"
assert_num "the clamp does not fire a second time on the rescued float" "==" "$clamp_counter_after" "$clamp_counter_before"
assert_num "the clamp decides nothing after the rescue" "==" "$clamp_decisions" "0"
assert_num "the rescued float is never asked to accept a repeated size" "==" "$clamp_retries" "0"
assert_num "the rescued float is not called stubborn" "==" "$clamp_stubborn" "0"

# A settled layout must not be fighting anything.
if wait_python 10 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d["counters"].get("errors", 0) == 0 else 1)'; then
  pass "the settled layout raises no errors"
else
  fail "the settled layout raised errors"
fi

ensure_clean
summary
