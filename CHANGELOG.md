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
- Dragging a window freezes reflow and hides the border; releasing reflows the
  workspace into a valid plan (`grab-op-begin`/`grab-op-end`).
- The border hides during any workspace transition — keyboard or touchpad —
  by watching the focused actor's position, and returns once it settles. This
  also covers gesture-driven switches, which emit no start signal.
