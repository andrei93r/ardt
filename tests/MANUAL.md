# Adrt — manual hardware acceptance checklist

Everything the nested headless harness cannot exercise lives here: physical
hotplug and docking, real touchpad gestures, suspend and logind lock, fractional
scaling, and the GPU/animation path. Each item gives exact steps and the expected
result. **Tick a box only when the expected result happens.** If it does not,
leave it unticked, note what you saw, and collect the evidence in §11.

Before starting:

- The live machine is a real GNOME 50 session on Wayland.
- The build is installed (§0) and you have **logged out and back in** since then.
- Adrt answers on the session bus: `gdbus call --session --dest org.adrt.Adrt --object-path /org/adrt/Adrt --method org.adrt.Adrt.DumpState`.

## 0. Install, load, and confirm the running build

- [ ] **Install.** From the repo root run `npm run install:local` (same as
  `bash scripts/install.sh`). It builds when `dist/` is stale, copies into
  `~/.local/share/gnome-shell/extensions/adrt@adrt.dev`, compiles the schema, and
  tries to enable the extension. The last lines tell you the next step.
- [ ] **Enable.** `gnome-extensions enable adrt@adrt.dev`, then
  `gnome-extensions info adrt@adrt.dev` → `State: ENABLED`.
- [ ] **Log out and back in — Wayland caches the module.** GNOME Shell cannot
  reload itself on Wayland, so a running Shell keeps the old `extension.js` until
  a real logout/login (the installer prints this; there is no in-place reload).
  From now on "installed" means "installed before the last login".
- [ ] **Confirm the running build.** `DumpState.build` reports
  `{version, dirMtimeMs}`; `dirMtimeMs` is the mtime (milliseconds) of the
  installed extension directory. Compare it with the install:
  ```bash
  gdbus call --session --dest org.adrt.Adrt --object-path /org/adrt/Adrt \
    --method org.adrt.Adrt.DumpState | python3 tests/agent/parse.py \
    | python3 -c 'import json,sys; b=json.load(sys.stdin)["build"]; print("version", b["version"], "dir mtime", b["dirMtimeMs"] // 1000)'
  stat -c '%Y  %n' ~/.local/share/gnome-shell/extensions/adrt@adrt.dev
  ```
  Expected: the `dir mtime` seconds equal the `stat` seconds (both are the
  install's mtime), so the running Shell loaded the build you just installed.
  If `bash scripts/session-test.sh` warns *"the installed extension is newer than
  the running Shell"*, you installed after the login — log out/in again.
- [ ] **Confirm the enable line in the journal.** The enable is journalled with
  the same build stamp:
  ```bash
  grep '"event":"enable"' ~/.local/share/adrt/journal/$(date +%F).jsonl | tail -1
  ```
  Expected: one line with `"version"` and `"buildDirMtimeMs"` matching
  `DumpState.build`.

Journal and log locations (used throughout):

| What | Where |
| --- | --- |
| Journal (raw events + decisions, one sequence) | `~/.local/share/adrt/journal/<YYYY-MM-DD>.jsonl` (rotated parts `…-2.jsonl` …) |
| History (human narrative) | `~/.local/share/adrt/history/<YYYY-MM-DD>.jsonl` |
| Shell log | `journalctl --user -b -o cat \| grep '\[adrt\]'` (a `[adrt] ERROR` is a failure) |

Helpers while you test: the `adrt` wrapper and `dump` from `tests/session/lib.sh`;
the assisted dock drill is `ADRT_DOCK_TEST=1 bash scripts/session-test.sh S17`.

---

## 1. The v2 model, quickly

Run these on the primary screen with GNOME's defaults
(`gsettings get org.gnome.mutter dynamic-workspaces` → `true`).

- [ ] **A third window on a full workspace creates a workspace right, maximised,
  and the view follows.**
  1. Open two apps on one workspace; they tile as a pair (left | right).
  2. Open a third app.
  Expected: a new workspace appears **immediately to the right** of the current
  one; the third window is **maximised** there; the view **follows** it. The pair
  you left is untouched (nothing was evicted).
- [ ] **Unmaximise joins the left workspace as its second half.**
  1. From the third window maximised on its own workspace, unmaximise it
     (double-click the title bar, or drag down from the maximised state).
  Expected: it moves to the **left** workspace into the **right** slot; the window
  already there keeps the left; a pair forms; the workspace it left is reaped; the
  view returns.
- [ ] **When the left is full, it is parked minimised.**
  1. Repeat: open another third window and let it own a workspace to the right.
  2. Make the left workspace hold a full pair (open one more window there if it
     holds only one).
  3. Unmaximise the right-hand window.
  Expected: it is **minimised and moved into the left** workspace — there is no
  free slot to pair with — and the emptied workspace is reaped. **No** other
  window is moved to make room.
- [ ] **Closing a window maximises the survivor and reaps an emptied workspace.**
  1. On a pair, close one window (`Super+Alt+Q`, or the app's own close).
  Expected: the survivor is **maximised** on that workspace; if the pair had a
  workspace of its own, that now-empty workspace is reaped.
- [ ] **A lone managed window is always maximised; a new one splits it.**
  1. On an empty workspace, open one app → maximised.
  2. Open a second → the first keeps the left, the newcomer takes the right.
  Expected: two flush tiles, nothing floating.

## 2. Single-workspace screens

Setup: attach a second display with `workspaces-only-on-primary` on (GNOME's
default: `gsettings get org.gnome.mutter workspaces-only-on-primary` → `true`).
That screen then has exactly one workspace.

- [ ] **First window → maximised.**
- [ ] **Second window → a persistent pair.** The pair does not move when the
  primary switches workspace.
- [ ] **Third window → floats** (overflow on a screen that cannot create a
  workspace). If one of the pair is minimised and you open a window, the newcomer
  **splits with the visible one** instead (a minimised window holds no slot).
- [ ] **Maximise is in place and minimises the others.** Maximise one of the
  pair on the extra screen. Expected: it fills that screen where it is (no
  workspace is created) and the **other managed windows on that monitor only** are
  minimised. Unmaximise/minimise/close it → they return.
- [ ] **Fullscreen behaves the same** on that screen: fills in place, minimises
  the others, restores them on exit.
- [ ] **A workspace switch on the primary does not move the extra screen.**
  Expected: its arrangement is byte-for-byte unchanged, and nothing is notified.

## 3. Drags and drops

- [ ] **A slight overlap swaps a pair.** Drag one half of a pair until it just
  **crosses** the other's perimeter and release. Expected: the two **trade
  sides**; a slight overlap is enough (the rectangles need not cover each other).
- [ ] **A free slot wins over a crossing.** On a target that has a free slot,
  drop a window over another window. Expected: the dropped window takes the free
  slot; a swap happens only when the target has no free slot.
- [ ] **A cross-screen drag takes the slot on the side it came from.** Drag a
  window onto a second screen whose slot is free. Expected: from the left/above →
  slot 0 (left/top); from the right/below → slot 1 (right/bottom) — it lands
  against the edge it just crossed.
- [ ] **A full target floats it.** Drag onto a target with both slots taken and
  not over a window. Expected: it **floats** where it was dropped (the target's
  pair stays intact).
- [ ] **A maximised window dragged across is un-maximised at the drop.**
  Expected: it leaves full size the moment it is dropped, then follows the same
  slot/swap/float ladder on the target.

## 4. Floats

- [ ] **The float key leaves the window exactly where it is.** Focus a tile and
  press `Super+F`. Expected: it becomes unmanaged, keeps its exact rect, and the
  sibling fills the screen. Press `Super+F` again with a free slot → it re-tiles.
- [ ] **Un-float with both slots taken toasts and changes nothing.** With a float
  over a full pair, press `Super+F`. Expected: a notification ("cannot un-float:
  both slots are taken"); the window stays floating exactly where it was.
- [ ] **An always-on-top window (a video PiP) floats and keeps its flag.** Open a
  picture-in-picture video or any always-on-top window. Expected: it is never
  tiled, it floats, and adrt does **not** clear its always-on-top flag. (This
  reverses the old A61 behaviour.)
- [ ] **A dialog centres on its parent and is raised.** Open a dialog from a tiled
  window. Expected: it floats, centred on its parent, above the tiling.
- [ ] **A `neverTile` app always floats.** In prefs → Apps, switch an app to
  never-tile, then open it. Expected: it floats (durable across restarts).
- [ ] **A float pins its workspace.** Close every managed window on a workspace
  that still holds a float. Expected: the workspace is kept, the view stays, and
  the float does not move.

## 5. Focus

- [ ] **The four directions cross screens positionally.**
  `Super+Alt+H/J/K/L` focus left/down/up/right. On a pair, left/right pick slot
  0/1 along the pair's own axis (on a portrait screen, or with vertical
  workspaces, up/down are the pair axis). From the bottom half of a stacked pair,
  focusing toward the next screen lands on the window at the **same height**, not
  the first one there. Focus never switches workspace.
- [ ] **The cycle walks managed windows then floats, left to right.** Press
  `Super+grave` (the backquote key, left of `1`). Expected: managed windows in
  slot order, then floats left to right (perfect overlaps by stacking order),
  wrapping; **minimised windows are skipped**; focusing a float raises it.
- [ ] **A direction with nothing that way is silent.** Press a direction key into
  empty space. Expected: nothing happens and **no** notification — the one
  deliberately silent no-op.

## 6. Undo

- [ ] **`Super+Z` reverses the last change.** Check each of: a maximise, an
  unmaximise, a drag-swap, and an un-float. Expected: the previous configuration
  is restored exactly, including the workspace an unmaximise deleted and the split
  ratio.
- [ ] **Undo toasts when it cannot.** Close the affected window, then `Super+Z`.
  Expected: a notification ("undo is no longer possible…"), and **nothing** is
  applied partially. A newly opened (routed) window is **not** the undoable change
  — undo acts on the previous change, or says "nothing to undo".
- [ ] **Exactly one change is held, in memory only.** After a fresh logout/login,
  `Super+Z` has nothing to undo.

## 7. Displays: physical hotplug and docking

- [ ] **Unplug the external display while it holds windows.**
  1. Open two or three apps on the external display and let them tile.
  2. Physically unplug it; wait for the desktop to settle.
  Expected:
  - Its windows are **rescued to the primary** as fresh workspaces, inserted on
    the **physical side the screen was on** (screen to the right → workspaces to
    the right of the current one; left/above/below → left). The two-per-workspace
    pairing and order are kept (the left window stays left).
  - **The view does not move.** A lone window is maximised on its new workspace;
    minimised windows stay minimised; floats stay floats; fullscreen is preserved.
  - No window is lost and no `[adrt] ERROR` appears in the journal.
- [ ] **Plug the same display back in.** Expected: the layout is **replayed** into
  its remembered slots by instance id, clamped to the fresh work area. Replay
  never floats a window and never creates a workspace; a window opened while the
  display was away stays where it is.
- [ ] **Memory expiry is correct.** If the display was away longer than
  `display-memory-minutes` (default 30), nothing is replayed. Verify quickly by
  setting the key to `0`: after that, a reconnect changes nothing.
- [ ] **Changing the primary moves no window.** Settings → Displays → make the
  other display primary. Expected:
  - adrt never sets the primary itself; it only follows it.
  - **No window moves between screens.** Each screen's work area changes (the top
    bar's strut exists on the primary only) and the tiles re-fit by ratio.
  - A screen that loses workspace capability shows everything it held; the extra
    windows from its other workspaces become **floats** over the pair that stays,
    whose slots are kept.
- [ ] **Assisted dock drill.**
  `ADRT_DOCK_TEST=1 bash scripts/session-test.sh S17` prompts you to dock a
  display, settle, then undock. Expected: the monitor count is followed, no
  window is stranded as a float, and every window stays inside a real work area.
  Record the result.

## 8. Hardware-only: real touchpad gestures

- [ ] `gsettings set org.gnome.shell.extensions.adrt gesture-enabled true`
- [ ] **Three-finger horizontal** → switch workspace (the default action). During
  the gesture watch that no window is drawn twice and no clone/shadow appears
  (clone-free slides); the active-window border is hidden for the whole gesture
  and returns once it settles; tiling resumes on the settled workspace with
  nothing stacked or untiled.
- [ ] **Three-finger vertical** → toggle the overview.
- [ ] **Four-finger horizontal/vertical and pinch** → their configured actions
  (set each in prefs → Gestures to test them).
- [ ] **A gesture on a screen with no workspaces** does not move windows on the
  other screen; that screen keeps its windows exactly.
- [ ] **With `gesture-enabled` off**, the same gestures do nothing.

## 9. Hardware-only: suspend and logind lock

- [ ] **Lock (`Super+L`) and unlock.** Expected: lock **pauses new work** (the
  queue finishes what it already holds, nothing is dropped, the highlight is
  hidden); on unlock the layout is re-derived once and every window is tiled — no
  window left half-sized, stacked or exiled, and no stranded empty workspace
  except GNOME's trailing spare.
- [ ] **`systemctl suspend`, then wake.** Expected: exactly like lock (suspend is
  treated as lock).
- [ ] **Screen sharing** (GNOME remote desktop / a portal share): tiling keeps
  running; only the highlight is hidden.

## 10. Hardware-only: fractional scaling, animations, GPU

- [ ] **Fractional scaling.** Set one display to 125% or 150% (keep a second at
  100% if available), open a pair on the scaled display, drag the inner edge, open
  a dialog, and move a window across the two scales. Expected: tiles stay flush
  (no 1px seams or overhangs at fractional scale); the pair stays flush while the
  inner edge is dragged and the outer edges snap back; a dialog centres on its
  parent; a window moved across displays is clamped to the target's work area with
  no stale flag; floats are untouched.
- [ ] **Animations.** With `disable-animations` off, maximise/unmaximise, switch
  workspaces, and drag one of a pair onto the other. Expected: smooth; clone-free
  slides; no doubles or overshoot; the closing-window ghost fades at the closing
  window's rect.
- [ ] **`disable-animations` on** stops adrt's own animations, but does not change
  GNOME's global animation setting (`org.gnome.desktop.interface enable-animations`).
  A user who disabled animations keeps them disabled after enabling/disabling adrt.
- [ ] **Watch for artefacts:** a stuck border, a window drawn twice, a tear, or a
  clone left behind after a switch.

---

## 11. What to send back

Collect these for any item that did not behave as expected:

- [ ] **The journal**, `~/.local/share/adrt/journal/<YYYY-MM-DD>.jsonl` and any
  rotated `…-N.jsonl` parts, plus `~/.local/share/adrt/history/<YYYY-MM-DD>.jsonl`.
- [ ] **`DumpState`** (the whole snapshot, and its `build` block) with the command
  from §0.
- [ ] **`DumpEvents 200`** and **`DumpDecisions 200`**; `DumpTrace` when the
  `record` flag is on.
- [ ] **The Shell's `[adrt]` lines**:
  `journalctl --user -b -o cat | grep '\[adrt\]'` (attach the tail around the
  failure).
- [ ] **A nested-harness reproduction** when the failure looks model/logic rather
  than hardware, run on its own (it needs the machine):
  ```bash
  ADRT_SCENARIOS='A93' bash scripts/agent-test.sh   # one scenario
  npm run test:agent                                 # the whole suite
  bash scripts/dev.sh                                # an interactive nested Shell
  ```
- [ ] **The environment:** `gnome-shell --version`, the date, and the `build`
  block.

A single mismatch is a release blocker; the hardware-only sections are the
acceptance gate for the release.

---

## 12. Fast smoke check (the one-configuration "is the build sane" signal)

The full nested suite is the release gate; it now runs in ~80 s and must stay
green. For day-to-day work there is a separate, curated smoke run:

```bash
npm run test:smoke            # == ADRT_SMOKE=1 bash scripts/agent-test.sh
ADRT_SMOKE=1 ADRT_SMOKE_WORKERS=6 bash scripts/agent-test.sh
ADRT_SMOKE=1 ADRT_SMOKE_LIST=/tmp/my.list bash scripts/agent-test.sh
```

`ADRT_SMOKE=1` replaces the `A[0-9][0-9]*` scenario glob with the ordered list
in `tests/agent/smoke.list`, in **one configuration only** — a single 1280x800
screen with dynamic workspaces (the harness default). It runs the same
scenarios, so no assertion is weakened and there is no second copy of a feature
test to rot: the smoke set is a subset of the maintained suite. With the flag
absent the normal path is unchanged (`npm run test:agent` still runs all 123).
`ADRT_SMOKE_WORKERS` overrides the smoke default of 10 nested Shells;
`ADRT_WORKERS` wins over both. Concurrent runs are still serialised by the
shared worker budget, so run one suite at a time.

**It cannot silently drop a scenario.** Every id in `smoke.list` must resolve to
a real `tests/agent/<id>.sh`; a renamed or deleted scenario aborts the run before
the preflight and names the offending entry on stderr. That is what keeps the
list honest as scenarios move.

The list covers every feature area with at least one scenario each (a couple of
areas get two or three); the mapping is kept as comments in
`tests/agent/smoke.list` and summarised here:

| area | scenario(s) |
| --- | --- |
| tiling / split / axis | `A01-pair-tiling`, `A64-vertical-workspaces` |
| arrival routing (third window gets its own workspace) | `A02-third-window` |
| focus (cycle + direction) | `A121-focus-cycle-order`, `A57-keyboard-focus-system` |
| move (toward, onto a full workspace → float) | `A127-swap-is-invertible`, `A54-overview-move-onto-pair` |
| resize ratio + undo | `A09-undo` |
| swap (invertible) + undo | `A127-swap-is-invertible`, `A101-undo-restores-instance-and-config` |
| maximize / unmaximize ladders | `A04-maximized-window`, `A90-unmaximise-joins-pair-forming-left`, `A91-unmaximise-parks-when-no-neighbour-can-pair` |
| fullscreen | `A57-keyboard-focus-system`, `A131-fullscreen-hides-highlight` |
| float / above-floats | `A11-float-toggle`, `A61-above-floats` |
| minimize / reap | `A35-minimize-removes-workspace` |
| lone-window maximize | `A58-lone-window-maximized` |
| workspaces (create / reorder / move / sticky) | `A96-reorder-is-honoured-and-an-empty-workspace-is-pruned`, `A117-arrival-side-rule`, `A72-sticky-window-untiled` |
| overview (coherence + drop-is-a-move) | `A56-coherence-sweep`, `A74-overview-drop-is-a-move` |
| registry / identity | `A98-registry-lists-every-app` |
| displays (plan / rescue / replay) | `A112-workarea-change-replans-one-monitor` |
| session modes (pause/lock hide the border) | `A13-lock-screen` |
| highlight (occlusion, fullscreen) | `A130-occlusion-hides-highlight`, `A131-fullscreen-hides-highlight` |
| undo (swap, un-float) | `A101-undo-restores-instance-and-config` |
| flags / trace / `DumpState` shape | `A103-record-trace-shape` |

Multi-monitor scenarios are **added automatically when they apply**: the runner
appends `tests/agent/smoke-multi.list` (nested) or `tests/session/smoke-multi.list`
(live) when the run has more than one monitor — `ADRT_MONITORS` with two or more
specs nested, or two or more connected screens live. So a laptop run stays short
and a docked run still exercises cross-screen routing, disconnect rescue and
reconnect replay, the per-screen axis and the four-monitor matrix
(`A105`–`A111`, `A122`, `A124`, `A81`; `S15` live), each self-skipping when the
screen count is not the one it needs. Only the opt-in long churn run (`A125`)
stays out.

> Note on versions: `metadata.json` carries `version-name` **0.2.0** while
> `DumpState.build.version` is the internal module build (`1`), and `package.json`
> still says `0.1.0`. Use the `dirMtimeMs` to match the running module to the
> install; the three version numbers are tracked separately (reported, not fixed
> here).
