# Testing

Adrt is verified at three levels: pure core unit tests, autonomous agent
scenarios in a nested GNOME Shell, and manual scenarios that need hardware
(touchpad gestures, suspend/resume, hot-plug).

## Automated

```bash
npm run lint          # eslint src tests
npm run build         # tsc
npm run test:core     # Vitest, plain Node
npm run test:agent    # 35 scenarios in a nested GNOME Shell
npm run test:all      # all of the above
```

`scripts/agent-test.sh` starts `gnome-shell --devkit --wayland --headless`,
installs the extension into an isolated `XDG_DATA_HOME`, enables it, and drives
it through D-Bus. It requires no display, no touchpad and no human.
### Keybindings need the interactive session

A22–A24 inject real key events with `ydotool`. A nested **headless** Shell does
not own the input seat, so those events never reach it — the scenarios report
`SKIP` there by design. Run them against your live session instead:

```bash
bash scripts/keybinding-test.sh   # Adrt enabled + ydotoold running
```

It injects `Super+Z`, `Super+Right` and `Super+f`, so expect your desktop to see
those shortcuts.

### Agent scenarios (§40.4)

| #   | Area             | How it is driven                          |
| --- | ---------------- | ----------------------------------------- |
| A1  | Pair tiling      | `SpawnWindow` ×2, assert non-overlapping  |
| A2  | Third window     | `SpawnWindow` ×3, assert new workspace    |
| A3  | Lone maximize    | `CloseWindow`, assert maximized           |
| A4  | Maximized window | `MaximizeWindow`, assert new workspace    |
| A5  | Unmaximize       | `UnmaximizeWindow`, assert return         |
| A6  | Focus follows    | `ActivateWindow`, assert border rect      |
| A7  | Inner-edge drag  | `SimulateResize(a, b, ratio)`             |
| A8  | Pair swap        | `SwapPair(a, b)`                          |
| A9  | Undo             | `Undo()` after a retile                   |
| A10 | Nudge split      | `NudgeSplit(direction, step)`             |
| A11 | Float toggle     | `ToggleFloat(id)`                         |
| A12 | Workspace switch | `ActivateWorkspace(index)`                |
| A13 | Lock screen      | `SimulateSessionMode('unlock-dialog')`    |
| A14 | Monitor change   | `InjectSignal('screens-changed', '')`     |
| A15 | Adaptation       | `InjectVerifyFailure(id, n)`              |
| A16 | Config export    | `ExportConfig()`                          |
| A17 | Config import    | `ImportConfig(json, false)`               |
| A18 | Gesture 3-horiz  | `SimulateGesture('swipe-3-horizontal', …)` |
| A19 | Gesture 3-vert   | `SimulateGesture('swipe-3-vertical', …)`  |
| A20 | Gesture pinch    | `SimulateGesture('pinch-in', …)`          |
| A21 | Gesture disabled | disable via GSettings, expect `false`     |
| A22 | Keybinding undo  | `ydotool` on the interactive session      |
| A23 | Keybinding focus | `ydotool` on the interactive session      |
| A24 | Keybinding float | `ydotool` on the interactive session      |
| A25 | Settings change  | `gsettings set gaps-base`                 |
| A26 | Shell restart    | restart the nested Shell                  |
| A27 | Session unlock   | `SimulateSessionMode('user')`             |
| A28 | Screen sharing   | `SimulateSessionMode('screen-sharing')`   |
| A29 | Frame timing     | `trace-enabled`, assert history events    |
| A30 | Memory bounds    | open/close repeatedly, assert bounds      |
| A31 | Swap (keyboard)  | `MoveToward('right')`                     |
| A32 | Swap (drag)      | `BeginDrag`, `MoveWindow`, `EndDrag`      |
| A33 | Reconcile all    | move a window, assert every workspace coherent |
| A34 | App opens maximized | `SpawnWindow('nautilus')`, assert it tiles with the sibling |
| A35 | Minimize         | `MinimizeWindow`, assert return + empty workspace removed |

Extra D-Bus test triggers beyond §40.4: `SpawnWindow`, `CloseWindow`,
`BeginDrag`, `BeginResize`, `EndDrag`, `MoveWindow`, `MaximizeWindow`,
`UnmaximizeWindow`, `ResetLayoutState`, `ActivateWindow`, `ActivateWorkspace`,
`FocusDirection`, `FocusCycle`.

## Manual scenarios (§31.3)

Run `npm run dev`, then use the nested Shell. Scenarios that need real
hardware are marked.

## Settings coverage

Every key the code reads is declared in the schema (`npm run check:core`
verifies the core boundary; the schema is the source of truth). All settings
listed in §19.1 are wired except:

- `escape-fullscreen-only-fullscreen` — Adrt never grabs `Escape`; the Shell
  and the focused app own that key, so the flag has nothing to gate. It is
  declared for compatibility and intentionally inert.

1. **Basic pair tiling.** Two normal windows on an empty workspace tile side
   by side (stacked on portrait). Neither overlaps; the gap is correct.
2. **Third window.** A third window moves to a new workspace; the pair is
   unchanged.
3. **Lone maximize.** Close one of a pair; the remaining window maximizes.
   Open a new window; it unmaximizes and the two tile.
4. **Maximized window.** Maximize a window with a sibling; it moves to its own
   workspace. Unmaximize; it returns.
5. **Workspace switch (keyboard).** The border stays hidden during the
   transition and appears once it completes.
6. **Workspace switch (gesture).** *(hardware)* Hold a 3-finger swipe
   mid-switch; the border stays hidden until release.
7. **Focus follows.** Move the mouse between tiles; the border follows with no
   flicker.
8. **Inner-edge drag.** Drag the shared edge; both windows resize, the ratio is
   saved and reused for the same app pair.
9. **Problem window.** A misbehaving app fails verification, enters the
   adaptation record, and its delays grow.
10. **Suspend/resume.** *(hardware)* Suspend and resume; windows are still
    tiled and the border is on the focused window.
11. **Shell restart.** `Alt+F2`, `r`; state is reconciled and tiling is
    correct.
12. **Disable/enable.** Disable, move windows, re-enable; the extension picks
    up the new layout.
13. **Multi-monitor hot-plug.** *(hardware)* Unplug a monitor; its windows move
    to a workspace on the remaining monitor. Replug; they return.
14. **Fractional scaling.** At 125% or 150%, tiles do not overflow and gaps
    look consistent.
15. **Lock screen.** Lock; no tiling, no indicator, no retiles. Unlock; the
    active workspace retiles once.
16. **Screen sharing.** Start a share; the indicator is hidden and tiling
    continues. Stop; the indicator returns.
17. **Frame timing.** Enable `trace-enabled`, retile, inspect the history for
    `frame_timing` events.
18. **Overview.** Open the overview; the indicator is not visible. Close it;
    the indicator returns on the focused window.
19. **3-finger horizontal swipe.** *(hardware)* Switches workspace; the border
    is suppressed during and appears after.
20. **3-finger vertical swipe.** *(hardware)* Toggles the overview per config.
21. **4-finger swipe.** *(hardware)* Runs the configured action.
22. **Pinch in/out.** *(hardware)* Runs the configured action.
23. **Gesture + drag.** *(hardware)* A gesture during a window drag does not
    conflict.
24. **Gesture sensitivity.** *(hardware)* Changing the threshold changes the
    trigger point immediately.
