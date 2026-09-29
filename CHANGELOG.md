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
- Minimizing a lone window on a later workspace moves it back, switches the
  view to follow it, and removes the workspace it left.
- Tiling is suspended while the overview is open and resumed with a single
  pass on close, which removes the reconcile churn that could stall the Shell.
- The border's workspace-switch suppression is driven by the workspace actors'
  positions (they move only during a switch), so it is focus-independent and
  fires for touchpad gestures as well as keyboard switches.
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
- Agent suite gains A31 (keyboard swap), A32 (drag swap) and A33 (global
  reconcile); 33 scenarios total.
- The border hides during any workspace transition — keyboard or touchpad —
  by watching the focused actor's stage-space position (so a sliding workspace
  parent is detected), returning once it settles.
