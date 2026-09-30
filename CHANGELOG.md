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
- The adaptation store no longer learns a minimum width from a window that
  refused to *grow* (a max-size app): that recorded its current size as a
  minimum, which pinned e.g. Chrome to 1477 px and made a 50/50 split
  impossible. Only a window that refused to shrink teaches a minimum.
- The border is hidden at once when Adrt moves a window to another workspace
  (a third window going right), instead of being drawn at the old spot while
  the window is pushed away.
- Animation frames are clamped to the screen's work area and eased out cubic
  at 130-190 ms (up to 240 ms for large moves), so a reflow stays smooth
  without exceeding the boundary.
- A pair is laid out by where its windows actually are, not by window id, so
  the window on the left stays the left tile (and the top one stays on top in
  a stacked split) even after a window is created or reordered out of id order.
  A pair the user marked *swapped* keeps the stable id order instead, so the
  two rules cannot fight and oscillate.
- Keyboard-driven focus system: directional focus (left/right/up/down) relative
  to the selected window, following the layout — side-by-side for a horizontal
  pair, stacked for a vertical one — and reaching other monitors. It only ever
  considers the current workspace: focusing never switches or navigates to
  another workspace. Directional move, fullscreen toggle and quit are bound too.
  All shortcuts are customisable (`kb-*` keys and the new Keys page in the
  preferences window); changing one re-registers it immediately. Core covers the
  directional picker (`pickDirectional`) and A57 covers the bindings.
- The coherence sweep walks the whole system every 700 ms: every workspace,
  every monitor, every window. A single tileable window is maximized (there is
  no such thing as an untiled single window), a pair is tiled, more than a pair
  floats the extra, and an automatic float left alone is pulled back into the
  tiling. It is no longer skipped while any animation runs — it skips only the
  individual windows that are animating — and it retries a lone window at most
  every 3 s so a refusing window is not hammered. `coherenceFixes` is exposed in
  `DumpState` (A56/A58/A59).
- Returning from a maximize no longer overshoots: its workspace switch runs with
  no slide/clones (like the maximize-right), and the landing is applied snapped
  instead of animating a maximized rect down to a tile while the workspace
  changes. The minimize-return snaps too.
- A workspace that ends up with more than a pair no longer floats an extra that
  simply *opened* there: a window the user dragged in (the overview) floats over
  the pair, while a newly opened third window goes to its own workspace, as the
  model requires. The sweep could previously float a fresh third window before
  the register policy moved it right.
- The history log is a real append with size-based rotation: `append()` used to
  read the whole file and rewrite it on *every* event, which is what turned a
  200 MB log into an out-of-memory crash. It now appends through a stream,
  rotates at `history-max-bytes` (default 8 MiB) into `<day>.N.jsonl`, keeps 5
  parts per day and prunes the rest (core/rotation.ts, A65).
- `DumpState.build` reports the running module (version + install-directory
  mtime) so "is the running build the one I installed?" is one call away; the
  enable log records it too (A65).
- Vertical Workspaces (V-Shell) compatibility: the tile axis, `moveToward` and
  the tiler all read the same signal V-Shell sets
  (`override_workspace_layout(rows = -1, columns = 1)`), so a pair splits 50/50
  top/bottom and moving a window up/down swaps it (A64).
- Performance work starts with measurement (stage 0 of `PERFORMANCE_PLAN.md`):
  `DumpState.counters` reports the per-call costs that matter — coherence sweeps
  and their timing, classify calls and cache misses, config builds, rules
  parses, plans computed/applied, Mutter frame reads from the sweep, host window
  lookups, `list_all_windows()` scans and log events. The agent harness gains
  `counters`, `counter`, `counter_delta` and `assert_num` helpers; scenario A66
  is the baseline every later stage measures against. No behaviour changes: the
  counters are only observed, never read to decide anything.
- Client text is bounded (core/text.ts): a window title is clipped at 256 chars
  and every history payload string at 512. A corrupted client title (a
  mojibake-doubling one reached 805 million characters) produced a 256 MB
  history line and exhausted GJS, which crashed the Shell with SIGSEGV in
  layout.js. `surface.title`/`appId` and the history writer clip at the edges;
  A63 guards it and 6 core tests cover the clipper.
- Floating a window over a pair never touches a *minimized* window's geometry:
  applying a frame to a minimized window makes Mutter un-minimize it, so a
  window the user minimized popped back on screen. It now keeps the float
  state and receives the float rect when it is restored (A62).
- Adrt's own float paths set Mutter's "always on top" flag (`applyLayer(FLOATING)`
  → `make_above()`), and the classifier then treated `above` as non-tileable, so
  a window we had floated over a pair stayed an orphan after the pair was gone.
  `above` no longer disqualifies a normal window, the flag is cleared whenever
  the window is tiled, and it is cleared on close with a sweep so a leftover
  auto-float returns to the tiling (A59/A61).
- Swap pairs are pruned on enable: they are keyed by window id, which does not
  survive a restart.
- A workspace-switch animation that never finishes leaves its clone group on
  screen, which is the doubled/frozen view seen in a screenshot. A watchdog now
  tears it down when it is still running after 1.5 s and no gesture owns it (a
  live swipe is left alone). `workspaceAnimating` is exposed in `DumpState`;
  A60 covers it.
- Our frame animations no longer run for a window that is maximized or
  minimized, and are cancelled when a window is minimized, so they cannot fight
  Mutter's own transitions.
- Maximizing a window with a sibling keeps its size and slides it onto its own
  workspace (it arrives maximized) instead of unmaximizing and re-maximizing it.
- Minimizing a window whose workspace empties slides it to the workspace on the
  left; if that one already holds a pair it comes back floating on top of it,
  otherwise it tiles with the window already there.
- The active-window marker follows the focused window's geometry, including
  during the animations Adrt runs (it used to keep the rect from focus time).
- The preferences window works again: `indicator-color` is a plain string and
  `entryRow` called `get_strv` on it, which returned null and aborted the whole
  window.
- Live scenario S14 walks the whole model on the real Shell.
- With a vertical workspace layout (e.g. the Vertical Workspaces extension) a
  pair splits 50/50 **top/bottom** instead of left/right; every other rule is
  unchanged. `workspaceLayoutRows` is exposed in `DumpState`.
- Moving a window to another workspace outside Adrt (the overview) now triggers
  a full recalculation of **every** workspace. Change detection compares
  against the index Adrt last recorded, because a per-frame `refresh()` copied
  the live workspace into the cache before the signal arrived and the move was
  silently ignored. If the move races a drag, the recalculation is retried once
  the drag ends. Switching workspaces recalculates every workspace too.
  Scenarios A54/A55 and live S13.
- A workspace that ends up holding more than a pair (e.g. a window was dragged
  here in the overview) never leaves an extra stacked: the newest extra floats
  centred over the pair, which also retiles the pair. Both the origin and the
  target workspace are retiled after such a move.
- Maximizing a window with a sibling moves it to its own workspace at its
  current size and maximizes it there, instead of animating the grow on the
  workspace it is about to leave.
- The live test suite no longer calls ResetLayoutState, which had been wiping
  the split ratios the user set by hand.
- A workspace reduced to a single tile plus an automatic float tiles both again
  (no floating leftover), ahead of the lone-maximize policy. A window the user
  floated themselves, and the 2-tiles-plus-1-float case, are left alone.
  Scenario A53.
- Adrt cancels a window's in-flight frame animation before moving it to another
  workspace, so Mutter's workspace-switch clone no longer doubles the window or
  lags behind it.
- Maximize keeps the immediate view follow: delaying it so the window lands
  first was tried and Mutter drops the maximise while the window sits on a
  workspace the view has not reached. The border is hidden during the move
  instead, so the window is not "selected" on the workspace it leaves.
- An emptied workspace is reaped promptly: the post-close prune runs again once
  the asynchronous workspace switch has landed, and a debounced reconcile only
  records undo for user adjusts.
- Only the workspaces Adrt itself creates (third-window, maximize-right and
  minimize policies) are reaped when empty, and never one that holds any window
  — tracked or not. Reaping a workspace out from under a window is what made
  one "disappear", and reaping a workspace the user or the session owns caused
  churn against GNOME's dynamic workspaces.
- Unmaximizing is robust against a stale workspace index (workspaces reaped
  since the maximize): it falls back to the nearest workspace that holds
  windows instead of doing nothing.
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
