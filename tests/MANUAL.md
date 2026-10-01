# Adrt — manual hardware acceptance checklist

Everything that cannot be exercised on the nested headless harness is listed
here. Each item has exact steps and the expected result. Tick a box only after
the expected result happens; if it does not, note what you saw and the journal
(`~/.local/share/adrt/history/<date>.jsonl`, plus `journalctl --user`).

Before starting: run the automated suites once so the extension is installed and
known green —

```bash
npm run lint && npm run build && npm run test:core
ADRT_BASE_STATE=/tmp/adrt-accept ADRT_WORKERS=8 npm run test:agent
ADRT_MONITORS='2560x1440:1920x1080:1080x1920:1280x720' \
  ADRT_BASE_STATE=/tmp/adrt-accept ADRT_WORKERS=4 npm run test:agent
```

Then enable Adrt in the live session. `DumpState` is reachable with:

```bash
gdbus call --session --dest org.adrt.Adrt --object-path /org/adrt/Adrt \
  --method org.adrt.Adrt.DumpState
```

The live drill helpers: `ADRT_DOCK_TEST=1 bash scripts/session-test.sh S17`.

---

## 1. Physical hotplug and docking

Automated coverage: `A109`, `A110`, `A111`, `A112`, `A122` (fixtures) and `S15`
(two real monitors). This section is the physical part.

### 1.1 Unplug a display with windows on it

1. Open two or three apps on the secondary display and let them tile.
2. Physically unplug that display.
3. Wait for the desktop to settle (the remaining screen becomes the only one).

Expected:
- The windows move to the primary, grouped two per workspace, inserted to the
  physical side the removed display was on (right → right of the current
  workspace, left/above/below → left).
- The view does **not** move.
- The pair keeps its order (the left window stays left); a lone window is
  maximized on its new workspace; minimized windows stay minimized; floats stay
  floats; fullscreen is preserved.
- No window is lost and no `[adrt] ERROR` appears in the journal.

### 1.2 Re-plug the same display

1. With the windows now on the primary, re-plug the display at the same port.
2. Wait for it to come back.

Expected:
- The windows that were on that connector are replayed back into their previous
  slots, matched by instance id, clamped into the fresh work area.
- Replay never floats a window and never creates a workspace; a window opened
  while the display was away is left where it is.
- If the display was away longer than `display-memory-minutes` (default 30), the
  memory has expired and nothing is replayed — that is correct.

### 1.3 Dock (a laptop dock with one or two displays)

1. Dock the machine with windows open; let the screens change.
2. Undock.

Expected: the same as 1.1/1.2 for each connector; the dock's reserved struts
(non-autohiding panels, fixed docks) shrink the work area and the tiles re-fit by
ratio, never floating or changing workspace. Run the assisted drill with
`ADRT_DOCK_TEST=1` to be guided through both steps.

### 1.4 Primary change

1. With windows on two displays, use Settings → Displays to make the other
   display the primary (or plug in the display that GNOME then makes primary).

Expected:
- Adrt never sets the primary itself; it follows it.
- No window moves between screens. The screen that loses workspace capability
  shows everything it held at once, and the extra windows from its other
  workspaces become **floats** over the pair that stays.
- The pair keeps its slots.

---

## 2. Real touchpad gestures

Automated coverage: `A18`–`A21` (synthetic). This section is the real hardware.

1. `gsettings set org.gnome.shell.extensions.adrt gesture-enabled true`.
2. On the touchpad:
   - three-finger horizontal swipe — expected: switch workspace (the default
     action), with the active-window border hidden for the whole gesture and
     back once it settles;
   - three-finger vertical swipe — expected: toggle the overview;
   - four-finger horizontal / vertical, and pinch — expected: their configured
     actions (set them in the Gestures prefs page to test each);
   - repeat with `gesture-enabled` off — expected: nothing happens.
3. During a three-finger workspace swipe, watch the windows.

Expected:
- No window is drawn twice and no clone/shadow artefact appears (clone-free
  slides).
- The highlight (border) is hidden for the duration and returns after.
- Tiling resumes on the settled workspace with no stacked or untiled window.
- A gesture on one screen does not move windows on a screen that has no
  workspaces; that screen keeps its windows exactly.

---

## 3. Suspend and logind lock

Automated coverage: `A13`/`A27`/`A28` (session-mode transitions via the D-Bus
trigger). This section is the real suspend/lock.

1. Open a pair, then lock the screen (`Super+L`).
2. While locked, open a new window from a launcher on the lock screen if you can
   (or use a second session to open one) — otherwise unlock and continue.
3. Unlock.
4. Repeat with a real suspend: `systemctl suspend`, then wake.

Expected:
- Lock and suspend **pause new work**: the queue finishes what it already holds,
  nothing is dropped, and the highlight is hidden.
- On resume the layout is re-derived once and every window is tiled: no window is
  left half-sized, stacked or exiled, and no workspace is stranded empty except
  GNOME's trailing spare.
- Suspend behaves exactly like lock (it is treated as lock).
- Screen sharing keeps tiling; only the highlight is hidden.

---

## 4. Fractional scaling

1. Settings → Displays → set one display to 125% or 150% scaling (and, if
   available, keep a second display at 100%).
2. Open a pair on the scaled display and drag the inner edge; open a dialog; move
   a window across the two displays of different scale.

Expected:
- Tiles stay flush inside the work area on both displays; no 1px seams or
  overhangs at fractional scale.
- The pair stays flush while the inner edge is dragged; the outer edges snap back
  (a tile always fills its region).
- A dialog floats, is centred on its parent and raised.
- A window moved across displays is clamped to the target's work area and is not
  left with a stale flag.

---

## 5. GPU / visual checks

1. With animations enabled (`disable-animations` off), maximize and unmaximize,
   switch workspaces, and drag one window of a pair onto the other.

Expected:
- Animations are smooth; a maximize → workspace-switch shows the reference
  behaviour (no clones, no doubles, no overshoot).
- Turning `disable-animations` on also switches off GNOME's own Shell
  animations.
- The closing-window ghost fades at the closing window's rect.

---

## Recording the result

For each box ticked, note the date and the GNOME Shell version. Anything that
does not match the expected result is a release blocker: attach the journal tail
(`adrt DumpEvents 200`, `adrt DumpDecisions 200`) to the report.
