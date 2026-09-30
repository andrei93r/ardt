# Changelog

All notable changes to Adrt are documented here. This project follows
[Semantic Versioning](https://semver.org/): MAJOR for a Shell bump that needs
code changes, MINOR for features, PATCH for fixes.

## [0.1.0] - 2026-09-29

### Added

- Pure `core/` decision logic: classification, pair tiling with learned split
  ratios, rule matching, config bundle merge, border state machine, retile
  coalescing, gesture and session state machines, app profiles, plan
  invariants.
- `platform/` interfaces designed for a future KWin adapter.
- GNOME Shell 48–50 adapter: window lifecycle, workspace policy, animation,
  verification and problem-window adaptation, D-Bus interface, event history.
- Touchpad gestures: 3- and 4-finger swipes and pinch, with a pure state
  machine and D-Bus simulation.
- Active window indicator with a single visibility owner.
- Autonomous agent harness that runs 30 scenarios in a nested GNOME Shell.
- 114 core unit tests.

### Recently completed

- Per-window min/max dimensions are captured from Mutter once and cached, so
  tile calculation never re-queries the compositor.
- Dynamic workspaces are removed when they become empty; workspace reorders
  re-derive every index and retile.
- `respect-user-workspace-move` + `workspace-move-grace-seconds`: policies
  leave a window alone after the user moves it.
- `float-persistence` stores opt-in floats in `behavior.json` and restores
  them on the next launch.
- `reflow-keeps-edges` can keep a lone window at its current rect.
- `keybindings` accepts `name=accelerator` overrides.
- `perf` telemetry measures scan reconciliation and retile application time.
- `workspace-auto-name` names spawned workspaces.
- Dragging a window freezes reflow and hides the border; releasing interprets
  the gesture: an inner-edge resize saves the split ratio (§12), dragging a
  window past its sibling swaps the pair (§13), and anything else reflows.
- Resizing a tile is detected from frame changes, not just compositor grabs,
  so client-side (CSD) resizes work: the sibling follows live and the ratio
  persists instead of snapping back.
- A plan is re-applied when a window no longer matches it, not only when the
  plan changes. Previously a window moved outside the drag path (or by the
  user after a missed signal) was never put back, leaving tiles overlapping
  and half the screen empty.
- Every window on every screen and workspace is re-checked after any create,
  close, move, resize, workspace or screen event, and corrected when it does
  not match its plan. Window creation/destruction, mapping, focus, monitor
  changes, workspace add/remove/count/switch and screen/work-area changes all
  funnel into the same debounced reconcile pass.
- Dragging a window swaps with its sibling when it lands on the sibling's area
  (its centre inside, or ≥35% overlap), not only when it crosses the sibling's
  centre. Move-vs-resize is inferred from the geometry, so it no longer depends
  on which grab-op code the compositor reports.
- An app that opens maximized (e.g. Files/Nautilus) is tiled with its siblings
  instead of being exiled; only a user-initiated maximize gets its own
  workspace.
- Workspace model: new space is created to the right and a maximized window
  gets its own workspace there; finishing (close/unmaximize/minimize) returns
  the view to the left.
- Focus by direction falls back to the opposite side when there is no window
  in the requested direction (and does nothing with no neighbour at all).
- Every empty workspace is reaped (not only ones Adrt created), never while
  active, and closing the last window switches the view away first.
- Apps that open maximized (Files) are unmaximized and tiled with their
  siblings; registration-time maximize/workspace signals no longer exile the
  first window.
- Unmaximizing a window onto a workspace that already holds a pair floats the
  newcomer on top, centred with a margin, so the tiled pair stays visible
  instead of being completely covered.
- A new workspace is created immediately to the **right** of the current one
  (appended then reordered) and the view follows the window there, instead of
  parking it at the end of the workspace line.
- Empty dynamic workspaces are reaped on the safety-net scan and never while
  the user is on them, which avoids the Shell bouncing into the overview when
  a workspace is removed mid-action.
- Window resizing no longer depends on the mouse-button state being reported;
  a frame change that differs from the last planned rect (and is not our own
  apply, an animation, a maximize/fullscreen/minimize state change, or a
  stubborn refusal) is treated as the user resizing.
- `DumpState` reports `workspaceActors`, `wsSwitchEvents` and
  `motionSuppressions` to diagnose border suppression on real hardware.
- Tiling keeps running while the overview is open; only the border is hidden
  there (and it returns when the overview closes). The overview never pauses
  or suspends the tiler.
- Unmaximizing a window whose **left** workspace already holds a pair returns it
  there floating on top of the pair (not tiled, not re-maximized in place), and
  the view follows it back — finishing never strands you on an empty workspace.
  Scenario A50.
- The active-window highlight is suppressed while the focused tile is covered
  by a floating window, so it can no longer be drawn over a window above it.
- A drag swap takes effect as soon as the window is dropped instead of waiting
  out the reconcile debounce (now 60 ms). Scenario A32 asserts the latency.
- A fresh pair splits 50/50 when the windows' minimum sizes allow it; the live
  suite clears the ratios it sets so a test run cannot leave your pairs on a
  test split.
- An emptied workspace is reaped promptly: the post-close prune runs again once
  the asynchronous workspace switch has landed, and a debounced reconcile only
  records undo for user adjusts.
- GNOME's dynamic workspaces re-create one empty workspace at the end. Adrt
  reaps empty workspaces but, once it sees a removal re-created, stops reaping
  the trailing one — so it no longer churns against the compositor while a
  window is focused.
- Undo restores the split ratios along with the window rects, so the restored
  layout agrees with the plan and no later reconcile re-tiles over it. This was
  an existing inconsistency that the periodic tiling pass made visible.
- Safety-net passes (the scan tick, full reconciles on screens-changed/settings
  and the periodic retile) never record undo entries, and a debounced reconcile
  only does when it is a genuine user adjust. They also skip while an apply is
  animating, so they can never mask the entry a user action pushed.
- The nested harness closes the overview when its Shell comes up (a headless
  devkit Shell opens it during startup; a real session never does), and the
  live scenarios wait for a settled state instead of sampling once, so the
  slower real Shell no longer produces false failures. No test ever opens the
  overview.
- Live scenarios run on a window-free workspace and rotate the client across
  Files, Chrome and Calculator, so several real apps (Chrome in particular)
  exercise the tiler.
- The border's workspace-switch suppression is driven by GNOME's
  `WorkspaceAnimationController`: the swipe tracker's `begin`/`update` hide it
  the instant a touchpad gesture starts, and the motion watcher polls
  `_switchData` for keyboard animations. GNOME slides window *clones* during a
  switch, so the old position-based watcher never saw a gesture and left the
  active-window border stuck on screen for the whole swipe. Scenario A47.
- The tiling plan is re-run on a slow cadence — every ~10 samples of the
  focused-window watcher, about 500 ms — as a backstop for a layout that
  drifted without a usable signal. The countdown restarts after any tile has
  landed, so the periodic pass never stacks on top of a fresh apply. A
  `motionRetiles` counter is exposed in `DumpState`. Scenario A48.
- The close ghost only animates for windows that were actually tiled, and
  override-redirect surfaces (popups, context menus, tooltips) are no longer
  tracked at all, so closing a right-click menu no longer flashes a border.
- Keybinding defaults no longer collide with GNOME's own bindings: focus is
  `Super+Alt+{h,j,k,l}`, swap is `Super+Shift+{h,l}`, nudge split is
  `Super+Ctrl+{h,l}`. The previous `Super+Shift+Left/Right` was shadowed by
  GNOME's move-to-monitor action, so keyboard swap never fired.
- User geometry changes are recognised by the mouse button being held, so the
  tiler never mistakes its own applies (retiles, undo, follow) for user input.
- Plan validation is work-area-relative, so a monitor with a top panel no
  longer reports false out-of-bounds placements.
- Agent suite gains a scenario per fixed bug: A31 keyboard swap, A32 drag
  swap (landing zone), A33 global reconcile, A34 app opens maximized, A35
  minimize, A36 close ghost, A37 overview suspend, A38 indicator style, A39
  keybinding conflicts; 39 scenarios total.
- A window counts as tiled (and so gets a close ghost, and is subject to
  user-change detection) from the moment a plan is aimed at it, not only once
  verification succeeds.- The border hides during any workspace transition — keyboard or touchpad —
  by watching the focused actor's stage-space position (so a sliding workspace
  parent is detected), returning once it settles.
