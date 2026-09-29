# Adrt — Specification

A GNOME 50+ tiling window manager extension for Wayland laptops. This document is authoritative. It is written so that a second platform (KDE Plasma 6 / KWin) can be added later by writing a new adapter, without changing `core/`.

---

## 0. Mission

Tile windows into pairs per monitor. Exactly two windows share a monitor, side by side or stacked, split by a learned ratio. A third window on the same workspace gets pushed to a new workspace. A single window fills the monitor. A maximized window gets its own workspace. Floating, modals, and dialog chrome sit above the tiling. The extension adapts only to problem windows that demonstrably refuse geometry.

Six non-negotiable requirements:

1. **Business logic fidelity** — §7–§25 are the spec.
2. **Testable core** — decision logic runs in plain Node, no `gi://`, no Mutter, no Shell imports.
3. **GNOME-only today, KDE-ready architecture** — the platform interface is designed so a KWin adapter can be added later without touching `core/`. No KDE code ships today.
4. **Performant** — no redundant classification, no repeated Mutter queries, no hot-path allocations.
5. **Laptop-native** — touchpad gestures are first-class inputs. See §44.
6. **Autonomously testable** — an AI agent plans, executes, and verifies every feature and user input in a nested GNOME Shell, without a human at the machine. See §42–§43.

Project name: `Adrt`. Identifier `adrt`. Display name `Adrt`.

---

## 1. Environment Assumptions

- **GNOME Shell 50+** on **Wayland**. Declare 48, 49, 50 in `metadata.json`.
- **No X11 code paths.** No XWayland detection. XWayland clients are Wayland clients to Mutter.
- **GNOME's built-in auto-tiling assumed disabled.** Edge-tiling remains enabled; its geometry changes are treated as user moves.
- **No overview interaction.** The indicator is chrome-layer and hidden by GNOME during the overview.
- **Lock screen requires pause.** `Main.sessionMode` watched for `user` (full), `unlock-dialog` (paused), `screen-sharing` (running without indicator). One flag, one check.
- **Target hardware includes laptops with touchpads.** Gestures are required.

---

## 2. Architecture

### 2.1 Directory layout

```
adrt/
├── src/
│   ├── core/                    # Pure TypeScript. No gi://, no Mutter, no Shell.
│   │   ├── types.ts             # Rect, Size, Screen, Layer, Placement, enums
│   │   ├── classify.ts          # Tileability and layer derivation
│   │   ├── tiler.ts             # Layout computation
│   │   ├── rules.ts             # Glob matching, rule validation
│   │   ├── config.ts            # Bundle format, merge logic
│   │   ├── border.ts            # Border visibility state machine
│   │   ├── scheduler.ts         # Retile coalescing, signature-based skip
│   │   ├── gestures.ts          # Gesture state machine (pure)
│   │   ├── session.ts           # Session-mode state machine (pure)
│   │   ├── profiles.ts          # Hardcoded app families
│   │   └── invariants.ts        # Post-conditions a plan must satisfy
│   │
│   ├── platform/                # Interfaces only. No implementation.
│   │   ├── host.ts              # PlatformHost, Surface, SurfaceFlags
│   │   ├── events.ts            # PlatformEvent union
│   │   ├── settings.ts          # SettingsStore interface
│   │   ├── gestures.ts          # GestureRecognizer, GestureEvent
│   │   ├── indicator.ts         # IndicatorBackend interface
│   │   └── dbus.ts              # DbusBackend interface
│   │
│   └── adapters/
│       └── gnome/               # GNOME Shell 50+ adapter (GJS, St, Meta)
│           ├── extension.ts     # Entry point
│           ├── prefs.ts         # Preferences window
│           ├── host.ts          # GnomeHost implements PlatformHost
│           ├── surface.ts       # GnomeSurface implements Surface
│           ├── compat.ts        # Version-specific API normalization
│           ├── tracked-window.ts # Per-window state owner
│           ├── session.ts       # Window lifecycle
│           ├── tiling.ts        # Applies plans via Mutter
│           ├── indicator.ts     # Border rendering
│           ├── adapt.ts         # Problem-window adaptation
│           ├── version.ts       # App version detection
│           ├── settings.ts      # GSettings bridge
│           ├── dbus.ts          # D-Bus interface
│           ├── history.ts       # Event log
│           ├── frame-clock.ts   # Animation timing
│           └── gesture-input.ts # Touchpad gesture wiring
│
├── tests/
│   ├── core/                    # Unit tests (Node, no compositor)
│   ├── agent/                   # Autonomous integration scenarios
│   └── nested/gnome/            # Nested GNOME Shell harness
│
├── scripts/
│   ├── build.sh
│   ├── install.sh
│   ├── uninstall.sh
│   ├── dev.sh                   # Nested Shell dev loop
│   ├── agent-test.sh
│   ├── nested-shell.sh          # Nested compositor controller
│   ├── gesture-sim.sh
│   └── package.sh
│
├── packages/gnome/              # GNOME extension layout
│   ├── metadata.json
│   └── schemas/
│
├── package.json
├── tsconfig.json
├── eslint.config.js
├── Makefile
├── README.md
└── CHANGELOG.md
```

### 2.2 Layer rule

`core/` imports nothing from `platform/` or `adapters/`. No file in `core/` may contain the strings `gi://`, `Meta.`, `Shell.`, `St.`, `Clutter.`, `global.`, or `Main.`.

`platform/` contains only interface declarations and pure types. It may import from `core/`. It must not import from any adapter.

`adapters/gnome/` imports from `core/` and `platform/`. No other adapter exists today. When KDE is added later, `adapters/kwin/` will import from `core/` and `platform/` and nothing from `adapters/gnome/`.

### 2.3 Why this split matters today

Even though only GNOME ships, the discipline of keeping `core/` free of Mutter means:

- `core/` runs in plain Node. Tests take milliseconds. No nested Shell needed for layout, classification, rules, config, gestures, or session logic.
- When KDE is added later, the layout algorithm, classification, rules, config format, gestures state machine, and session state machine are reused as-is. The KWin adapter implements the interfaces and nothing else.
- The AI can write `core/` in isolation and test it in a headless container.

### 2.4 Identifiers

| Thing                | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| Project              | `Adrt`                                                 |
| GNOME UUID           | `adrt@adrt.dev`                                        |
| GNOME schema         | `org.gnome.shell.extensions.adrt`                      |
| GNOME data dir       | `$XDG_DATA_HOME/adrt/`                                 |
| D-Bus name           | `org.adrt.Adrt`                                        |
| D-Bus path           | `/org/adrt/Adrt`                                       |
| Config bundle format | `adrt.config`                                          |
| CSS class prefix     | `adrt-`                                                |
| Log prefix           | `[adrt]`                                               |
| Install target       | `~/.local/share/gnome-shell/extensions/adrt@adrt.dev/` |

The D-Bus name and data directory are chosen to be platform-neutral so that when KDE is added later, a user switching sessions keeps their configuration. No KDE code exists today.

### 2.5 Core types

```typescript
// core/types.ts

export interface Rect {
  x: number; // top-left in logical pixels
  y: number; // top-left in logical pixels
  width: number; // logical pixels
  height: number; // logical pixels
}

export interface Size {
  width: number;
  height: number;
}

export interface Screen {
  index: number;
  connector: string;
  geometry: Rect;
  scale: number;
  refreshRate: number;
  isPrimary: boolean;
}

export enum SurfaceKind {
  NORMAL = "normal",
  DIALOG = "dialog",
  MODAL = "modal",
  UTILITY = "utility",
  TOOLBAR = "toolbar",
  SKIP = "skip",
}

export interface SurfaceFlags {
  transient: boolean;
  modal: boolean;
  attachedDialog: boolean;
  fullscreen: boolean;
  above: boolean;
  minimized: boolean;
  maximized: boolean;
  floating: boolean;
  skipTaskbar: boolean;
  overrideRedirect: boolean;
  onAllWorkspaces: boolean;
}

export enum Layer {
  BACKGROUND = 0,
  TILED = 1,
  FLOATING = 2,
  MODAL = 3,
  INDICATOR = 4,
}

export interface Placement {
  surfaceId: number;
  rect: Rect;
  layer: Layer;
  order: number; // within layer; lower sits behind higher
}

export interface TilePlan {
  placements: Placement[];
}
```

### 2.6 The Platform interface

```typescript
// platform/host.ts

import type {
  Rect,
  Size,
  Screen,
  SurfaceKind,
  SurfaceFlags,
  Layer,
} from "../core/types.js";

export interface Surface {
  readonly id: number;
  readonly kind: SurfaceKind;
  readonly appId: string; // wmClass on GNOME
  readonly appVersion: string; // opaque; adapter computes it
  readonly title: string;
  readonly min: Size;
  readonly max: Size;
  /** Position and size in logical pixels. x and y are the top-left corner. */
  readonly frame: Rect;
  readonly screenId: number;
  readonly workspaceId: number;
  readonly flags: SurfaceFlags;
  readonly parentId: number | null;
  readonly layer: Layer; // derived via layerFor(surface)
  readonly zPosition: number; // compositor's current stacking order
}

export interface PlatformHost {
  readonly platform: "gnome"; // 'kwin' will be added later
  surfaces(): Surface[];
  screens(): Screen[];
  activeWorkspaceId(): number;

  applyFrame(id: number, rect: Rect): void;
  applyLayer(id: number, layer: Layer, order: number): void;
  applyWorkspace(id: number, workspaceId: number): void;
  unmaximize(id: number): void;
  maximize(id: number): void;

  on(event: PlatformEvent, cb: (payload: unknown) => void): () => void;
}
```

```typescript
// platform/events.ts

import type { Surface, SurfaceFlags } from "./host.js";
import type { Rect } from "../core/types.js";

export type SessionMode = "user" | "unlock-dialog" | "screen-sharing";

export type PlatformEvent =
  | { type: "surface-created"; surface: Surface }
  | { type: "surface-closed"; id: number }
  | { type: "surface-frame-changed"; id: number; frame: Rect; byUser: boolean }
  | { type: "surface-flags-changed"; id: number; flags: Partial<SurfaceFlags> }
  | {
      type: "surface-workspace-changed";
      id: number;
      workspaceId: number;
      byUser: boolean;
    }
  | { type: "surface-screen-changed"; id: number; screenId: number }
  | { type: "focus-changed"; id: number | null }
  | {
      type: "workspace-switched";
      from: number;
      to: number;
      phase: "begin" | "active" | "end";
    }
  | { type: "screens-changed" }
  | { type: "session-mode-changed"; mode: SessionMode };
```

```typescript
// platform/settings.ts

export type SettingValue = number | boolean | string | string[];

export interface SettingsStore {
  keys(): string[];
  read(key: string): SettingValue | undefined;
  write(key: string, value: unknown): boolean;
  onChanged(key: string, cb: (value: SettingValue) => void): () => void;
}
```

```typescript
// platform/gestures.ts

export type GestureKind =
  | "swipe-3-horizontal"
  | "swipe-3-vertical"
  | "swipe-4-horizontal"
  | "swipe-4-vertical"
  | "pinch-in"
  | "pinch-out"
  | "hold-3-swipe";

export type GesturePhase = "begin" | "update" | "end" | "cancel";

export interface GestureEvent {
  kind: GestureKind;
  phase: GesturePhase;
  progress: number;
  deltaX: number;
  deltaY: number;
  direction: "left" | "right" | "up" | "down" | null;
  touchPoints: number;
  timestampUs: number;
}

export interface GestureRecognizer {
  enable(): void;
  disable(): void;
  onGesture(cb: (event: GestureEvent) => void): () => void;
}
```

```typescript
// platform/indicator.ts

import type { Rect } from "../core/types.js";

export interface IndicatorBackend {
  show(rect: Rect): void;
  hide(): void;
  showPreview(rect: Rect): void;
  hidePreview(): void;
  ghostClose(rect: Rect, durationMs: number): void;
  destroy(): void;
}
```

```typescript
// platform/dbus.ts

export interface DbusHandlers {
  // ... method signatures from §24 ...
}

export interface DbusBackend {
  expose(handlers: DbusHandlers): void;
  unexpose(): void;
}
```

### 2.7 Future KDE adapter (documented, not built)

When KDE is added later, `adapters/kwin/` will implement the same interfaces:

- `KwinHost implements PlatformHost` with `platform: 'kwin'`.
- `KwinSurface implements Surface`, backed by `KWin::Window` (`client`).
- `KwinSettings implements SettingsStore`, backed by KConfig.
- `KwinIndicator implements IndicatorBackend`, backed by QML overlay.
- `KwinGestureRecognizer implements GestureRecognizer`, backed by KWin's gesture tracking.

`core/`, `platform/`, all tests in `tests/core/`, and all gesture/session/border/config logic are reused without change. The only new code is the adapter directory and its QML/C++ helper.

No KDE code exists today. No KDE-specific settings, no KDE tests, no KDE build target. The interface is designed to allow it; nothing more.

---

## 3. Layer Model

The `Layer` enum and `Placement` / `TilePlan` types are defined in §2.5. `layerFor(surface)` is a pure function in `core/classify.ts`. `Surface.layer` is derived, never stored.

Adapter applies `(layer, order)` on writes:

| Layer     | GNOME implementation                                   |
| --------- | ------------------------------------------------------ |
| FLOATING  | `win.make_above()`                                     |
| TILED     | `win.unmake_above()`                                   |
| MODAL     | `win.raise()`                                          |
| INDICATOR | `Main.layoutManager.addChrome` with the correct parent |

The adapter reads `zPosition` from `global.display.sort_windows_by_stacking` only for `DumpState`, not on every scan tick.

---

## 4. Best Practices (mandatory)

### 4.1 Lifecycle

- Constructor does nothing. `enable()` creates, connects, schedules. `disable()` destroys, disconnects, cancels.
- No `_destroyed` or `_enabled` boolean guards except the one permitted in GLib callback teardown (§28).
- Custom `destroy()` order: remove timeouts and GLib sources → disconnect signals → release children → `super.destroy()`.

### 4.2 Code hygiene

- No `try/catch` around methods that don't throw. `destroy()`, `connect()`, `disconnect()`, `GLib.source_remove()`, `get_frame_rect()` do not throw.
- No optional chaining on guaranteed APIs. Target GNOME 50.
- No `=== 'function'` checks outside `compat.ts`.
- No comments that restate code. Comments explain why.
- No TODO comments in the output.
- No safety code for features assumed off.
- No defensive defaults that hide bugs.
- No logging on hot paths.

### 4.3 AI-generated code notice

Every generated source file begins with:

```javascript
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.
```

### 4.4 Forbidden AI patterns

- Factory functions for single implementations.
- Interfaces without a second implementation. (The `platform/` interfaces are the exception — they exist for the future KDE adapter, and this is documented.)
- Optional chaining on guaranteed APIs.
- `try/catch` on non-throwing calls.
- Comments restating code.
- TODOs in output.
- Spec "improvements" — ask first.
- Defensive defaults hiding bugs.
- Logging in signal handlers.
- KDE-specific code of any kind today.

---

## 5. Classification

A window is **tileable** if all of:

- Not skip-taskbar, not override-redirect, not on-all-workspaces, not fullscreen, not above.
- `appId` not in the exception list.
- Not floating.
- `kind` not in the non-tileable set (desktop, dock, popup menu, dropdown, tooltip, notification, splash, dialog, modal-dialog, attached-dialog).
- `min ≠ max` on both axes.
- Not transient, not modal, not attached-dialog.
- No rule matched `float: true`.
- Heuristic modal detection: title doesn't match `<title> — <parent>` where `<parent>` is another live window.

Fail → modal (if transient/modal/attached/heuristic) or ignored.

Classification is a pure function of the surface's state and the current configuration. Cached on `TrackedWindow`, invalidated on:

- `notify::wm-class`
- `notify::skip-taskbar`
- `notify::transient-for`
- `notify::above`
- `notify::fullscreen`
- `notify::window-type`
- Changes to `exception-apps`, `rules-json`, `heuristic-modal-detect`

Nothing else can flip classification.

---

## 6. Layout

Per workspace, per monitor:

- **One window**: fills the monitor minus gap on all sides. Size ≥ min size.
- **Two windows**: split the monitor along the shorter axis (portrait → vertical, landscape → horizontal), separated by gaps. Split ratio:
  1. User's saved ratio for this app-class pair and axis, if any.
  2. Else if exactly one app is in the "primary apps" list: primary gets the configured primary ratio (default 50%, clamped 20–80%).
  3. Else 50%.
     Ratio clamped to 5–95%, then further clamped so neither window is below its min size.
- **Pair-swap flag set**: the two windows swap sides.
- **If the pair doesn't fit with both minimums respected**:
  - `respect` (default): try horizontal, then vertical. If neither fits, **stack layout**: both at minimum sizes, side by side if that fits, otherwise pinned to left/right edges at minimum widths.
  - `ignore`: lay out at the requested split regardless of minimums.
  - `stack`: use stack layout directly.
- **Rule override** runs first: the first window (id order) whose matching rule has a `tile` action wins. `full` → that window fills the monitor. `left-half` / `right-half` → that window takes that half; the other takes the other half.

Gaps: base gap + optional portrait/landscape overrides. Negative = inherit from base. Targets snapped to monitor scale if > 1.

Layout returns a `TilePlan` (list of `Placement`), never a list of bare rects. Today every placement has `layer: TILED` and `order: 0` or `1`.

---

## 7. Lifecycle and Workspace Policy

### 7.1 Window creation

- Not tileable, not modal → ignore.
- Not mapped → wait first frame + configured delay.
- Register: capture version, original geometry, connect signals, classify.
- Fully maximized + no other tileable windows → leave.
- Fully maximized + other tileable windows → move to new workspace.
- Not maximized + workspace already has two tileable windows → schedule move to new workspace appended right.
- Otherwise → schedule retile + evaluate lone-maximize.

### 7.2 Lone-maximize policy

- Exactly one non-transient window, exactly one tileable, not maximized → maximize it.
- More than one non-transient window, the tileable window is maximized → unmaximize and tile.

### 7.3 Maximize changes

- User maximizes a window with tileable siblings → move to new workspace.
- User unmaximizes:
  - Previous workspace exists → move there. If that workspace has ≥ 2 tileable windows, the incoming window floats instead of tiling.
  - No previous workspace:
    - Only tileable window on its workspace → re-maximize.
    - Otherwise → leave unmaximized, let it tile with the existing pair.
  - Current workspace removed if dynamic and empty.

### 7.4 Minimize

Minimized window is the only tileable on its workspace, workspace index > 0 → move to previous workspace.

### 7.5 Close

Clean up all per-window state. Empty workspace → switch away (next with windows, else previous, else first). Dynamic + empty → remove. Re-evaluate lone-maximize. Retile.

### 7.6 Workspace removal / reorder

- User removes: drop from dynamic set, cancel pending retiles.
- User reorders: update `lastWorkspaceIdx` for every window, clear signature cache, retile every workspace.

---

## 8. App Version Detection

Adapter-layer. For a window's process:

1. Invalid pid → semver from title.
2. Cached result for this pid with matching process start time → return it.
3. Snap markers (`SNAP_NAME`, mountinfo, exe path, snap.info) → `sn:<name>:<revision>`.
4. Flatpak markers (`FLATPAK_ID`, `.flatpak-info`) → `fp:<app-id>:<commit>`.
5. AppImage markers (`APPIMAGE`, `/tmp/.mount_*`) → `ai:<basename>:<hash>`.
6. Exe path → stat-hash (`mtime * 31 XOR size`, base-36, last 8 chars).
7. `argv[0]` → stat-hash.
8. `--version` args → semver.
9. Title → semver.
10. `*` (unknown).

Binary hashes: if file mtime within last 10 minutes, reuse previous hash for that path (stability window for just-updated binaries).

Cache by pid + process start time. Pruned on scan tick for dead pids.

---

## 9. Problem-Window Adaptation

Deliberate scope restriction. The extension does not learn general per-app behavior. It adapts only to windows that demonstrably refuse geometry or need extra time.

### 9.1 Trigger

A window enters adaptation only when:

1. A geometry change is refused (verify step fails after all retries), AND
2. The same `appId` has refused at least once before (or the user explicitly enables adaptation for that app).

### 9.2 What is learned

Keyed by `appId` only, NOT `appId@version`.

| Signal                   | Threshold            | Use                                  |
| ------------------------ | -------------------- | ------------------------------------ |
| Refused min size         | 1 refusal            | Override declared min size next tile |
| Unmaximize delay         | 2 observations       | Add to profile delay                 |
| Settle time              | 2 successful settles | Extend verify wait                   |
| Repeated refusal (3+)    | 3 refusals           | Skip animation for this app          |
| Stubborn (3 consecutive) | 3 failures           | 60s cooldown, apply without verify   |

### 9.3 What is NOT learned

- Workspace affinities.
- Monitor affinities.
- General float preferences. Floats are user-driven only; persistence is opt-in per window via a keybinding.
- Per-version quirks. Adaptation is keyed by `appId` alone.

### 9.4 Record

```typescript
interface AdaptationRecord {
  appId: string;
  firstSeen: number;
  lastSeen: number;
  observations: number;
  unmaximizeDelayEma?: number;
  settleTimeEma?: number;
  refusedMinW?: number;
  refusedMinH?: number;
  acceptedW?: number;
  acceptedH?: number;
  skipAnimation?: boolean;
}
```

Trusted at ≥ 2 observations. Pruned after 30 days of inactivity.

### 9.5 User control

- Preference toggle to enable/disable adaptation (default: on).
- Per-app reset: D-Bus `ForgetAdaptation(appId)`.
- List: D-Bus `GetAdaptations()`.
- Prefs shows records under "Problem windows" with delete per app.

### 9.6 Rationale

The per-version quirks system was the largest source of complexity in the original codebase. Per-app adaptation, triggered only by refusal, removes ~60% of the learning code while preserving the behavior that matters.

---

## 10. Window Profiles

Shared, in `core/profiles.ts`:

- **chrome-family** (Chrome, Chromium, Brave, Vivaldi, Edge, Opera): unmaximize delay 48ms, retries [80, 200, 500].
- **electron** (VS Code, Slack, Discord, Signal, Element, Obsidian, Notion, Figma, Postman, Insomnia, Spotify, 1Password, Bitwarden, Joplin, Logseq, Todoist, Zulip, Mattermost, Teams, WhatsApp, Standard Notes, Thunderbird Beta): 48ms, [80, 200, 500].
- **gtk-terminal** (GNOME Terminal, kgx, kitty, alacritty, foot, wezterm, konsole): 0ms, [50].
- **java-swing** (JetBrains IDEs): 48ms, [80, 200, 500], no animation.
- **default**: 16ms, [50, 150].

---

## 11. Animation and Retry

### 11.1 Applying geometry

When target differs from current:

1. If maximized: unmaximize, record time, wait `max(profile.delay, learned delay)`.
2. Compute effective target: apply effectiveMin, snap to profile increments, clamp to monitor.
3. Animate or apply instantly:
   - Animations enabled + profile allows → interpolate over `animation-duration` ms, ease-out cubic, snapped to monitor scale.
   - Else → instant.

### 11.2 Verification

- Wait `max(100, learned settle)` ms.
- Within 2px of target on all axes → success. Record.
- Else if retries remain → wait next backoff, re-unmaximize if needed, re-apply, retry.
- Else → record refusal, mark stubborn. After 3 consecutive stubborn events → 60s cooldown (apply without verification). Add app class to session-wide stubborn set.
- 3+ refusals in adaptation history → `skipAnimation` for the app.

### 11.3 Animation implementation

- Use `Clutter.Timeline` tied to the actor's `frame_clock`, not `GLib.timeout_add`.
- Preallocate the interpolated rect per window; write into it each frame.
- Snap to exact target on completion.
- Cancel cleanly when a new animation starts on the same window.
- Respect `org.gnome.desktop.interface.enable-animations`, `St.Settings.get().enable_animations`, and the extension's `disable-animations` setting.
- Skip animation when a workspace switch is in flight or when the user is dragging.

### 11.4 Easing and duration

- Ease-out cubic for most movements.
- Ease-out quad for short moves (< 150ms).
- Linear only for opacity.
- Never ease-in-out for tiling.
- 100–150ms for focus changes.
- 150–200ms for a single window moving.
- 200–250ms for two windows swapping.

---

## 12. Inner-Edge Resize

User drags shared edge between a pair (inner edge only, one axis, outer edges fixed):

- Detect axis, which window's inner edge moved.
- Compute new ratio, clamped to minimums.
- Apply instantly to both. Save under `appA|appB|axis`.

Keyboard nudge: same, by configured step %, clamped, saved under same key.

---

## 13. Pair Swap

- **Keyboard**: focus one, move toward sibling → toggle swap flag.
- **Drag**: pick up one, drag center past sibling's center along split axis, no resize, exactly one sibling → toggle swap.
- Swap flag stored as set of pair keys (`min(idA,idB)|max(idA,idB)`).
- Live preview during drag: highlighted rect over the sibling.

---

## 14. Focus and Navigation

- **Focus direction**: closest window by center, same workspace. If none on monitor → closest on adjacent monitor in that direction. Modal windows focusable after tileables. Fullscreen/minimized/skip-taskbar/override-redirect not.
- **Focus cycle**: next tileable on same monitor/workspace, wrapping.
- **Move direction**: if exactly one sibling in that direction and it's the only other window → swap. Else → move to adjacent monitor (mark as user-moved for grace period).
- **Modal centering**: re-center when parent moves/resizes.

---

## 15. Undo

Every retile that actually moves ≥ 1 window pushes a snapshot of all tileable windows' frame rects before the move. Undo pops and re-applies. Stack size configurable. Persisted across restarts.

- **Undoable**: a retile that moved at least one tileable window.
- **Not undoable**: focus changes, workspace switches, modal centering, indicator movement, float toggles, settings changes.
- **After a workspace switch**: applies to the currently focused workspace. If the entry references windows on a different workspace, activate that workspace first.
- **Closed windows**: entry is a no-op for that window; the rest are restored.

---

## 16. Workspace Dynamics

Set of dynamic workspaces created by the third-window or maximized-window policies. Empty dynamic → remove (unless only one). User removes dynamic → drop from set. Pending retiles for removed workspaces → cancel. Scan tick periodically re-checks.

---

## 17. Monitor Changes

Snapshot live connectors. Removed connector: remember geometry, move windows to `targetWorkspaceForRemovedMonitor`:

- Left of primary → ws − 1. Right → ws + 1. Overlapping/unknown → ws + 1. Clamp [0, count − 1].
- Track orphans by connector, persisted. On reconnect → move back.
- Re-center every modal. Retile every workspace. Cancel in-flight drag.

---

## 18. Session Modes

Watched via `Main.sessionMode`:

- **user** (normal): full functionality.
- **unlock-dialog** (lock screen or unlock prompt): extension is paused. No tiling, no retiles, no scan tick, no animations. Indicator hidden. Existing window positions left as-is. On return to user, resume and retile the active workspace once.
- **screen-sharing**: tiling continues. Indicator hidden (it would appear in the shared stream). Scan tick continues.

The transition is handled in a single `_onSessionModeChanged()` handler. It sets a `_paused` flag, hides or shows the indicator, cancels or reschedules the scan tick. Nothing else checks `Main.sessionMode.currentMode`.

**Invariant**: when paused, the extension does not call `move_resize_frame`, does not schedule retiles, does not run the scan tick, does not show the indicator. On unpause, it retiles the active workspace exactly once.

---

## 19. Configuration

### 19.1 Settings (GSettings)

gaps (base, portrait, landscape), min-size-policy, reflow-keeps-edges, heuristic-modal-detect, animation-duration, disable-animations, gnome-animation-delay, scan-interval, max-frame-interval-ms, nudge-step, undo-stack-size, workspace-auto-name, respect-user-workspace-move, workspace-move-grace-seconds, log-workspace-reorder, exception-apps, primary-apps, primary-app-ratio, rules-enabled, rules-json, dry-run-mode, debug-enabled, trace-enabled, history-enabled, history-retention-days, history-daily-folders, dbus-enabled, adaptation-enabled, float-persistence, active-window-indicator, indicator-color, indicator-opacity, indicator-width, indicator-animated-pulse, indicator-corner-radius, close-animation-enabled, close-animation-duration, escape-fullscreen-only-fullscreen, gesture-enabled, gesture-3-swipe-action, gesture-3-vertical-action, gesture-4-swipe-action, gesture-4-vertical-action, gesture-pinch-action, gesture-sensitivity, keybindings.

The schema file `packages/gnome/schemas/org.gnome.shell.extensions.adrt.gschema.xml` is authoritative. Every key the code reads is declared. `metadata.json` includes `"settings-schema": "org.gnome.shell.extensions.adrt"`.

### 19.2 Config bundle

```json
{
  "format": "adrt.config",
  "version": 3,
  "exportedAt": "...",
  "settings": { "...": "flat map" },
  "tracked": {
    "adaptations": { "...": "..." },
    "behavior": { "...": "..." }
  }
}
```

Version 2 files put adaptations and behavior at the top level. Normalize both shapes.

Import modes:

- **merge** — per-app records merge one level deep for `classes` and `floats`; everything else replaces.
- **replace** — overwrite.

Count applied vs skipped keys; report.

### 19.3 Settings migration

Every schema change bumps the extension version. Migration runs in `enable()`, once, gated on a `settings-version` key. Reads old key, writes new, marks complete. On failure: log error, continue with defaults.

---

## 20. Persistence

Files under `$XDG_DATA_HOME/adrt/`:

- `adaptation.json` (v1) — adaptation records.
- `behavior.json` (v1) — floats.
- `state.json` (v1) — original geometries, orphans, stubborn, split ratios, undo.
- `history/YYYY-MM-DD.jsonl` — daily rotation, retention, async append.

All writes: temp file + rename. All blob writes: 2s debounce. Flush on disable.

Crash recovery: on enable(), reconcile persisted state. Drop records whose window id is not live. Keep adaptation records, floats, split ratios. Drop stale original geometries. Drop undo entries with no live windows.

---

## 21. History and Diagnostics

Every meaningful event → JSON line with `t` (timestamp), `ev` (event type), `trace` (per-operation sequence number), plus event-specific fields. Events: register, close, tile, resize_retry, stubborn, swap, split_resize, new_ws, spawn_ws, ws_removed, ws_switch_empty, monitors_changed, snapshot, session_mode, config_imported, float_toggle, above_changed, dry_run, disable, undo, lookup, frame_timing, perf, gesture.

Lookup-by-window-id: scans the last N days, newest first.

Log tail: watches today's file, seeks to end, polls, emits parsed events.

Performance telemetry: every 60 scan ticks, log a `perf` event. Gated on `debug-enabled`.

Memory leak detection: scan tick asserts that `windows.size`, `pendingRetiles.size`, connected signals, and GLib sources are bounded. On 3 consecutive violations, disable the extension and log details.

---

## 22. D-Bus Interface

`org.adrt.Adrt`, path `/org/adrt/Adrt`. Methods:

- `DumpState` → JSON snapshot.
- `LookupWindow(id)` → JSON of one window.
- `ListWindows` → JSON array of `{id, cls, title}`.
- `ListMonitors` → JSON array of connector names.
- `GetSplitRatio(ws, monitor, axis)` / `SetSplitRatio(...)`.
- `Undo`.
- `NudgeSplit(direction, step)`.
- `ReloadRules`.
- `ResetPerApp`.
- `GetAdaptations`, `ForgetAdaptation(appId)`.
- `GetFloats`, `ForgetFloat(appId)`.
- `ExportConfig`, `ImportConfig(json, merge)`.
- `ListHistoryDays`.
- `SimulateGesture(kind, deltaX, deltaY, touchPoints)` (§41).
- `InjectSignal(type, payload)` (dev only, §40).
- `SimulateSessionMode(mode)` (dev only).

`DumpState` returns a stable JSON schema. Adding fields is fine; removing or renaming requires a version bump.

---

## 23. Active Window Indicator

Border around the focused window. Preferences: enabled, color ("accent" or hex), opacity 0–100, width 1–20px, radius 0–32px, pulse, disable-animations.

Shown when: focus is a tracked tileable window, on the active workspace, not paused, not during drag, not fullscreen, not suppressed.

Hidden otherwise. Follows focused window's frame rect via `position-changed` and `size-changed`, not polling.

Used as **drop preview** during swap drag, and **close ghost** (fading copy at the closing window's rect).

Renders via `Main.layoutManager.addChrome(w, { affectsStruts: false, trackFullscreen: false })`. Respects high-contrast setting. CSS class `adrt-indicator`.

### 23.1 The one-owner rule

Exactly one owner for "should the border be visible and where." It accepts suppression reasons (`workspace-switch`, `drag`, `fullscreen`, `pause`) and a focused window. When the suppression set is empty and there's a focused window, it shows at that window's current frame rect. Otherwise it hides.

**Every code path that shows the border routes through the single owner.** Adding a new suppression is one line.

### 23.2 Workspace-switch suppression

For workspace switches, suppression lasts until the **actual** slide is over, not a fixed timeout. The signal is the focused window's compositor actor position stable for ~3 consecutive frames. Hard ceiling 2s.

The workspace-switch-end poll runs at 32ms intervals (`GLib.PRIORITY_DEFAULT`). If the focused window has no compositor actor (unmapping), the poll settles immediately.

---

## 24. Performance Requirements

1. Cache classification on `TrackedWindow`. Invalidate on the five relevant signals only.
2. Cache frame / minSize / monitor on `TrackedWindow`.
3. One `TrackedWindow` per window, one `Map<number, TrackedWindow>`.
4. Signature-based retile skip.
5. One frame clock. Not one timer per animation.
6. Allocation-free animation loop.
7. Cache monitor snapshots. One `Monitor[]`, updated on `monitors-changed`.
8. Scan tick is a safety net + adaptive back-off (5s → 10s → 30s → 60s when idle; reset on external-mutation signals).
9. No `gdbus` shell commands in prefs. Use `Gio.DBusProxy`.
10. Delete dead code.

---

## 25. Unit and Coordinate Discipline

- `_us` suffix for microseconds (`GLib.get_monotonic_time()`), `_ms` for milliseconds. Never mix.
- `GLib.get_monotonic_time()` for durations and timeouts. `Date.now()` only for log timestamps. Never compare.
- `Rect` is always in logical pixels (matching `get_frame_rect()`). Stage-pixel values from `get_transformed_position()` carry a `stageX` / `stageY` name. Never assign one to the other without scale conversion.
- `safeScale(idx)` returns the monitor's scale factor (1, 1.25, 2). All snapping uses this. Never hardcode 1.
- `Size` is `{ width, height }`; `Rect` is `{ x, y, width, height }`. Never pass a `Size` where a `Rect` is expected.

---

## 26. Error Handling

- Every signal handler body is wrapped in one `try/catch` that logs and returns. Not the handler — the work.
- Every external call that can fail has an explicit failure path, logged at `warn` or `error`. No silent failures. No `catch (_) {}`.
- A GLib callback firing after teardown is handled by checking a `_destroyed` flag at the top of the callback. This is the only lifecycle flag permitted.
- `get_compositor_private()` returning null during unmap is guarded at every access.
- If a window closes mid-animation, the frame callback checks `this.windows.has(id)` before every access. If not, remove the animation and return `SOURCE_REMOVE`.

---

## 27. Logging Discipline

- `error`: state corruption, invariant violations, extension failure.
- `warn`: recoverable failures.
- `info`: lifecycle events.
- `debug`: per-operation detail. Gated on `debug-enabled`.
- `trace`: per-frame detail. Gated on `trace-enabled`.

Every log call includes a `trace` field. No logging in per-frame loops. No logging in the scan tick unless something changed. Prefix `[adrt]`.

Notifications: at most one per event type per session. All gated on `debug-enabled` except first-run and permanent-failure.

---

## 28. First Run

On the first `enable()` after install (tracked via `first-run-complete`), send a single `Main.notify` explaining the extension. Never again unless the user resets the flag from the About tab.

---

## 29. Internationalization

All user-facing strings use `_()` from the Shell's gettext import. No string concatenation with `+`; use `.format()` or template strings that gettext can handle. `.pot` generated at build time. Prefs window respects `LANG`.

---

## 30. Unit Tests (core/)

`core/` has no `gi://` imports. It runs in plain Node. Tests use Vitest.

Required tests:

- `computePlans` — non-overlapping rects that fit inside the monitor for all input shapes: stack fallback, `minSizePolicy: 'ignore'`, pair-swap path, rule override path.
- `classify` — every skip reason, every tileable case, heuristic modal detection.
- `matchesRule` / `firstMatch` — glob patterns, type filters, transient filter.
- `mergeRecords` — merge vs replace, `classes`/`floats` special-casing.
- `parseBundle` — v2 and v3 shapes, malformed input.
- `BorderState` — suppression set, focus, show/hide transitions.
- `layerFor` — every flag combination maps to the correct layer.
- `invariants` — post-conditions hold for synthetic plans.
- `gestures` — full swipe sequence → correct action; below threshold → none; cancelled → none, state reset; overlapping → second ignored; every configured action → correct `GestureAction`; sensitivity respected.
- `session` — mode transitions, effects emitted correctly.

Run: `vitest run tests/core`.

---

## 31. Integration Testing (GNOME)

### 31.1 Tools

- `gnome-shell-test-tool --extension <zip>` — installs and enables the extension before starting a nested Shell.
- `gnext dev` — nested Shell with hot reload.
- `gnext logs` — streams the extension's journal output.
- `ydotool` — synthesizes keyboard and mouse events on Wayland. `ydotoold` must be running.
- Mutter Devkit (GNOME 49+) — `--devkit --wayland` on `gnome-shell`. Provides `--sdk` and a D-Bus API at `org.gnome.Mutter.Sdk`.
- Mutter Frame Monitor extension — live FPS and stutter detection.
- MangoHud — ground-truth compositor smoothness.
- Sysprof — profiling. Run the nested Shell with `GJS_ENABLE_PROFILER=1`.

### 31.2 Programmatic interaction

D-Bus `Eval` — execute JavaScript directly in the Shell process:

```
gdbus call --session --dest org.gnome.Shell \
  --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval \
  "global.get_extension('adrt@adrt.dev').commands.undo()"
```

Requires unsafe-mode in the nested Shell.

`ydotool` — for end-to-end keybinding tests.

### 31.3 Manual scenarios (TESTING.md)

1. **Basic pair tiling.** Two normal windows on an empty workspace. They tile side by side (or stacked on portrait). Neither overlaps. Gap correct.
2. **Third window.** Open a third. It moves to a new workspace to the right. The pair is unchanged.
3. **Lone maximize.** Close one of the pair. The remaining window maximizes. Open a new window on the same workspace. The maximized window unmaximizes and the two tile.
4. **Maximized window.** Maximize a window with a sibling. It moves to its own workspace. Unmaximize it. It returns to the previous workspace.
5. **Workspace switch (keyboard).** Switch away and back. The border does not appear during the transition and appears at the correct place once the switch completes.
6. **Workspace switch (gesture).** Hold the gesture mid-switch. The border stays hidden for as long as the gesture is held, and appears after release.
7. **Focus follows.** Move the mouse between the two tiled windows. The border follows immediately, no flicker.
8. **Inner-edge drag.** Drag the shared edge. Both windows resize smoothly, the ratio is saved, and reopening the same app pair uses the saved ratio.
9. **Problem window.** Launch a known misbehaving app. The verify fails, the app enters the adaptation record, and after a few launches the delays grow.
10. **Suspend/resume.** Suspend the machine, resume. All windows still tiled, border on the focused window.
11. **Shell restart.** `Alt+F2`, `r`. The extension restores state, tiling is correct, no windows left in a bad position.
12. **Disable/enable.** Disable the extension, move windows around, re-enable. The extension picks up the new layout and tiles it.
13. **Multi-monitor hot-plug.** Unplug a monitor. Windows on it move to a workspace on the remaining monitor. Plug it back in. Windows return.
14. **Fractional scaling.** Set a monitor to 125% or 150%. Tiles do not overflow the monitor and gaps are visually consistent.
15. **Lock screen.** Lock the session. Confirm no tiling, no indicator, no retiles. Unlock. The active workspace retiles once.
16. **Screen sharing.** Start a screen share. Confirm the indicator is hidden and tiling continues. Stop the share. Indicator returns.
17. **Frame timing.** Enable `trace-frame-timing`. Perform a retile. Inspect the history log for `frame_timing` events. No frame should exceed the expected interval by more than 2ms.
18. **Overview.** Open the overview, confirm no indicator is visible over the thumbnails. Close the overview, confirm the indicator reappears on the focused window.
19. **3-finger horizontal swipe** — switches workspace, border suppressed during, appears after.
20. **3-finger vertical swipe** — toggles overview, per config.
21. **4-finger swipe** — custom action per config.
22. **Pinch in/out** — per config (show desktop).
23. **Gesture + drag** — gesture during window drag does not conflict.
24. **Gesture sensitivity** — configurable threshold changes trigger point.

### 31.4 Automated integration script

`scripts/agent-test.sh` runs the 30 scenarios from §40.4 in a nested Shell.

### 31.5 Failure injection

`debug-inject-verify-failure` — makes the verify step fail N times. Exercises the stubborn/adaptation path. Plus `debug-inject-gesture-failure`.

### 31.6 Smoothness measurement

- Instrument the frame clock directly. With `trace-frame-timing` enabled, log the delta between consecutive frame callbacks. Log a `warn` if a frame exceeds the expected interval by 2ms.
- Mutter Frame Monitor for visual verification.
- MangoHud inside the nested Shell with a GPU workload (`vkcube`) to detect main-loop blocking.
- Sysprof for deep analysis.

---

## 32. Build and Installation

### 32.1 Development

```
npm run build              # tsc, readable output
npm run build:install      # build + install locally
npm run dev                # nested GNOME Shell with hot reload
npm run logs               # stream journal
```

### 32.2 Packaging

```
npm run pack
```

The zip contains: `metadata.json`, `extension.js`, `prefs.js`, `stylesheet.css`, `schemas/`, and all compiled JS files. EGO reviewers require readable, unbundled output.

### 32.3 User installation

```
gnome-extensions install adrt@adrt.dev.zip
gnome-extensions enable adrt@adrt.dev
```

Or from source: `make install`.

### 32.4 Metadata

```json
{
  "uuid": "adrt@adrt.dev",
  "name": "Adrt",
  "description": "Tiles windows into pairs per monitor with learned split ratios.",
  "shell-version": ["48", "49", "50"],
  "settings-schema": "org.gnome.shell.extensions.adrt",
  "version-name": "0.1.0"
}
```

---

## 33. Versioning

Semver: MAJOR (Shell bump requiring code changes), MINOR (features), PATCH (fixes). `CHANGELOG.md` with an initial 0.1.0 entry.

---

## 34. Forbidden

- `gi://`, `Meta.`, `Shell.`, `St.`, `Clutter.`, `global.`, `Main.` anywhere in `core/`.
- A `WindowState` struct with 20 fields. Use `TrackedWindow`.
- Four call sites deciding whether to show the border. One owner.
- Querying Mutter for a value a signal already delivered.
- Classifying a window more than once per relevant signal.
- esbuild / bundlers for the extension itself.
- `gdbus` shell commands in prefs. Use `Gio.DBusProxy`.
- Per-version quirks.
- Behavior heuristics.
- Feature creep beyond this spec.
- Any reference to `adr-auto-pos`, `AutoPos`, or old identifiers.
- **Any KDE-specific code, setting, test, or build target today.** The `platform/` interfaces exist for the future; the KDE adapter does not.

---

## 35. Design Rationale

- **Pairs only**: the layout algorithm, split-ratio learning, and workspace policy all assume two windows per monitor.
- **Per-app not per-version**: removes ~60% of learning code.
- **Adaptation only on refusal**: invisible for well-behaved windows.
- **No heuristics**: user-authored rules.
- **One border owner**: fixes the flicker bug class.
- **Cached classification**: every signal that could change classification invalidates the cache. Safe, must not be bypassed.
- **Scan tick safety net**: signals unreliable across Shell versions, hot-plug scenarios, external manipulation.
- **Wayland-only**: GNOME 50 is Wayland-only.
- **No overview handling**: indicator is chrome-layer, hidden by GNOME.
- **Lock screen pauses**: authentication boundary. One flag, one place.
- **No auto-tiling interaction**: assumed off. Edge-tiling is the exception.
- **Gestures first-class**: laptop target.
- **GNOME today, KDE-ready**: the `platform/` interfaces are the only concession to a future platform. No KDE code ships. The discipline pays off now via testability — `core/` runs in plain Node.

---

## 36. Acceptance Criteria

1. `tsc` builds without errors.
2. Lint passes with zero errors.
3. `vitest run tests/core` passes.
4. No `gi://`, `Meta.`, `Shell.`, `St.`, `Clutter.`, `global.`, `Main.` in `core/`.
5. Every settings key declared in the schema.
6. Every signal connected in `enable()` disconnected in `disable()`.
7. Every GLib source added removed in `destroy()` or `disable()`.
8. Loads in a nested Shell via `npm run dev` with no errors in the journal.
9. `TESTING.md` describes all 24 scenarios.
10. `README.md` complete.
11. AI notice in every source file.
12. Manual scenarios 1, 2, 3, 5, 6, 7, 8, 15, 18, 19 pass.
13. `DumpState` returns well-formed JSON.
14. A single retile on a 2-window workspace completes in under 10ms.
15. Scan tick with adaptive back-off does not log a `perf` event with `last_reconcile_ms > 5` on an idle desktop.
16. No file, comment, string, or identifier refers to `adr-auto-pos`, `AutoPos`, or old identifiers.
17. The test execution protocol in §38 is followed and results reported.
18. The one-command install in §39 works on a clean GNOME 50 machine.
19. `SimulateGesture` works via D-Bus.
20. Agent test harness runs green without human presence.
21. **No KDE-specific code exists** — grep for `kwin`, `KWin`, `KPlugin`, `QML` returns nothing in `src/` except the documented `platform/host.ts` comment that names it as a future value of `platform`.

---

## 37. Final Note to the Implementer

This is a specification, not a starting point. Do not add features, do not remove features, do not change the architecture. If something in the spec seems wrong or incomplete, ask before proceeding — do not fill the gap yourself.

The code runs inside the GNOME Shell's main thread, on a Wayland session, alongside the compositor. Less is better. Cached is better. Deferred is better. Cleanup is not optional.

The project is **Adrt**. GNOME today. KDE is a slot the architecture leaves open, and nothing more.

---

## 38. Test Execution Protocol

The implementer must **write the tests, wire them, execute them, and report results**. Delivering code without executed test evidence is incomplete.

### 38.1 Required tooling

Add to `package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "lint": "eslint src tests",
    "test:core": "vitest run tests/core",
    "test:core:watch": "vitest tests/core",
    "test:agent": "bash scripts/agent-test.sh",
    "test:all": "npm run lint && npm run build && npm run test:core && npm run test:agent",
    "install:local": "bash scripts/install.sh",
    "uninstall:local": "bash scripts/uninstall.sh",
    "dev": "bash scripts/dev.sh",
    "pack": "bash scripts/package.sh"
  }
}
```

Provide a `Makefile` that mirrors the scripts.

### 38.2 Execution order

Run these in sequence and paste the full output of each:

1. `npm install`. Must complete without errors.
2. `npm run lint`. Must exit 0 with no warnings.
3. `npm run build`. `tsc` produces readable JS. Must exit 0. Every expected output file must exist under `dist/`.
4. `npm run test:core`. Vitest runs all `core/` tests. Every test must pass. Fix and re-run until green.
5. `bash scripts/agent-test.sh`. Starts a nested GNOME Shell, installs the extension, runs the 30 scenarios from §40.4, captures the journal, reports pass/fail. Must exit 0.
6. `bash scripts/install.sh`. Installs on the host session. Must complete and print next steps.
7. Manual smoke test. Confirm scenarios 1, 2, 3, 5, 6, 7, 8, 15, 18, 19 by running them in the nested Shell or documenting the exact commands and reporting the observed behavior.

### 38.3 Reporting

Produce `TEST_RESULTS.md` at the repo root with:

- The exact commands run, in order.
- The full stdout/stderr of each.
- Exit codes.
- For integration tests: the journal excerpt from the nested Shell showing the extension loaded, registered windows, tiled them, and produced no errors.
- For any failure: the fix applied and the re-run output.
- A final "green" summary: one line per required test, with pass/fail.

If a test cannot be run (missing tool, no display), document the missing dependency, provide the exact command that would be run, provide a fallback (D-Bus `Eval`), and never mark it passed.

### 38.4 Nested Shell integration

`scripts/agent-test.sh` must:

1. Detect whether `gnext dev` or `gnome-shell --devkit --wayland` is available.
2. Start the nested Shell in the background.
3. Wait for `org.gnome.Shell` to appear on the session bus (with timeout).
4. Copy the built extension to the nested Shell's extension directory, or install via `gnome-extensions install`.
5. Enable the extension.
6. Open two test windows.
7. Wait 2 seconds.
8. Query `DumpState` via D-Bus and assert both windows are tiled.
9. Close one, wait 2 seconds, assert the other is maximized.
10. Kill the nested Shell.
11. Grep the captured journal for `[adrt] ERROR` or `[adrt] WARN`. Fail if any ERROR is found.
12. Exit 0 on success, 1 on any failure.

The script is idempotent and cleans up.

### 38.5 Continuous verification

`npm run test:all` must be re-runnable after any change and produce a green result.

---

## 39. Easy Installation

### 39.1 Install script

`scripts/install.sh` must:

1. Verify environment: Linux with GNOME session; `gnome-shell --version` reports 48, 49, or 50; `glib-compile-schemas` available (install if not, re-check).
2. Determine extension dir: `$XDG_DATA_HOME/gnome-shell/extensions/adrt@adrt.dev/`.
3. Remove any previous install of the same UUID.
4. Build if compiled output is missing or older than source. Run `npm install && npm run build` if needed.
5. Copy built files into install dir.
6. Compile the GSettings schema.
7. Detect session type: Wayland → cannot restart Shell in place; print instructions to log out and back in, or use `npm run dev`.
8. Enable the extension if possible.
9. Print next steps.

Exit 0 on success, 1 on failure with reason.

### 39.2 Uninstall script

`scripts/uninstall.sh` must:

1. Disable the extension.
2. Remove the install directory.
3. Leave `$XDG_DATA_HOME/adrt/` in place unless `--purge`.
4. Print confirmation.

### 39.3 Dev shell script

`scripts/dev.sh` must:

1. Build if needed.
2. Launch a nested GNOME Shell via `dbus-run-session gnome-shell --devkit --wayland` or `gnext dev`.
3. Install and enable the extension inside it.
4. Stream journal output filtered for `[adrt]`.
5. Kill the nested Shell on Ctrl+C and clean up.

This is the primary development loop.

### 39.4 One-liner (optional)

```bash
curl -fsSL https://raw.githubusercontent.com/<user>/adrt/main/scripts/install.sh | bash
```

Safe to pipe to bash: no `sudo`, no writes outside home, no network beyond `git clone` or `curl` of the tarball.

### 39.5 Post-install verification

```
gnome-extensions info adrt@adrt.dev
```

must show `State: ENABLED`. If not, install failed. Print this check as the final step.

---

## 40. Autonomous Agent Testing Protocol

The agent must not require human presence. Every feature and user input must be triggerable and verifiable programmatically.

### 40.1 Principle

If a feature cannot be triggered by a D-Bus call, a synthetic input event, or a scripted compositor action, it is not autonomously testable. Every feature must have such a trigger.

### 40.2 Trigger surfaces

1. D-Bus method — commands, state queries, config changes.
2. Synthetic input — `ydotool` for keyboard and mouse.
3. Gesture simulation — `SimulateGesture` D-Bus (§41).
4. Signal injection — `InjectSignal` D-Bus (dev only).
5. Session mode simulation — `SimulateSessionMode` D-Bus (dev only).

### 40.3 Agent test harness

`scripts/agent-test.sh`:

1. Starts a nested GNOME Shell (Mutter Devkit headless or `gnext dev`).
2. Installs and enables the extension.
3. Runs `tests/agent/*.sh` — one script per scenario.
4. Each script sets up state, triggers, waits, asserts, cleans up.
5. Captures journal filtered for `[adrt]`.
6. Reports pass/fail per scenario in `TEST_RESULTS.md`.
7. Exits 0 if all pass.

### 40.4 Required agent-executable scenarios

| #   | Area             | Trigger                                            | Assertion                    |
| --- | ---------------- | -------------------------------------------------- | ---------------------------- |
| A1  | Pair tiling      | Open 2 windows via D-Bus                           | Both tiled, non-overlapping  |
| A2  | Third window     | Open 3 windows                                     | Third on new workspace       |
| A3  | Lone maximize    | Close one of pair                                  | Remaining maximized          |
| A4  | Maximized window | Maximize with sibling                              | New workspace                |
| A5  | Unmaximize       | Unmaximize                                         | Returns to previous ws       |
| A6  | Focus follows    | `ActivateWindow(id)`                               | Border at new rect           |
| A7  | Inner-edge drag  | `SimulateResize(a, b, ratio)`                      | Both resize, ratio saved     |
| A8  | Pair swap        | `SwapPair(a, b)`                                   | Swap flag toggled, retiled   |
| A9  | Undo             | `Undo()` after retile                              | Previous rects restored      |
| A10 | Nudge split      | `NudgeSplit('right', 5)`                           | Ratio changed, saved         |
| A11 | Float toggle     | `ToggleFloat(id)`                                  | Floating layer, above        |
| A12 | Workspace switch | `ActivateWorkspace(idx)`                           | No border mid-switch         |
| A13 | Lock screen      | `SimulateSessionMode('unlock-dialog')`             | Paused, indicator hidden     |
| A14 | Monitor change   | `InjectSignal('screens-changed')`                  | Retile, orphans tracked      |
| A15 | Adaptation       | `InjectVerifyFailure(id, 3)`                       | Record created, delays grow  |
| A16 | Config export    | `ExportConfig()`                                   | Valid JSON bundle            |
| A17 | Config import    | `ImportConfig(json, false)`                        | Settings applied             |
| A18 | Gesture 3-horiz  | `SimulateGesture('swipe-3-horizontal', 300, 0, 3)` | Workspace switched           |
| A19 | Gesture 3-vert   | `SimulateGesture('swipe-3-vertical', 0, 300, 3)`   | Overview toggled             |
| A20 | Gesture pinch    | `SimulateGesture('pinch-in', -100, 0, 2)`          | Configured action fired      |
| A21 | Gesture disabled | Disable gestures, `SimulateGesture`                | Returns false                |
| A22 | Keybinding undo  | `ydotool` key sequence                             | Undo applied                 |
| A23 | Keybinding focus | `ydotool` key sequence                             | Focus moved                  |
| A24 | Keybinding float | `ydotool` key sequence                             | Float toggled                |
| A25 | Settings change  | `gsettings set ...`                                | Extension reacts             |
| A26 | Shell restart    | Kill and restart nested Shell                      | State reconciled, tiles      |
| A27 | Session unlock   | `SimulateSessionMode('user')`                      | Retile once                  |
| A28 | Screen sharing   | `SimulateSessionMode('screen-sharing')`            | Indicator hidden, tiling on  |
| A29 | Frame timing     | `trace-frame-timing` on, retile                    | No frame > 2ms over interval |
| A30 | Memory bounds    | Long run with open/close                           | `windows.size` bounded       |

Each scenario is independent, self-contained, idempotent.

### 40.5 Reporting

`TEST_RESULTS.md` contains commands, stdout/stderr, exit codes, journal excerpts, pass/fail table for all 30 scenarios, fixes applied. Never marks unexecuted tests as passed.

---

## 41. Gesture Simulation

### 41.1 D-Bus `SimulateGesture`

Constructs a `GestureEvent` sequence (begin → update → end) and feeds the pure state machine in `core/gestures.ts`. Returns `true` if handled.

This makes gesture logic fully testable without a real touchpad.

### 41.2 Gesture state machine (pure)

```typescript
// core/gestures.ts

export interface GestureState {
  activeKind: GestureKind | null;
  startX: number;
  startY: number;
  accumulatedX: number;
  accumulatedY: number;
  touchPoints: number;
  phase: GesturePhase;
  startedAtUs: number;
}

export interface GestureConfig {
  enabled: boolean;
  swipe3Horizontal: GestureActionType;
  swipe3Vertical: GestureActionType;
  swipe4Horizontal: GestureActionType;
  swipe4Vertical: GestureActionType;
  pinchAction: GestureActionType;
  sensitivity: number; // 0–100
}

export type GestureActionType =
  | "switch-workspace"
  | "toggle-overview"
  | "show-desktop"
  | "swap-pair"
  | "none"
  | `custom:${string}`;

export type GestureAction =
  | { type: "switch-workspace"; direction: "left" | "right" | "up" | "down" }
  | { type: "toggle-overview" }
  | { type: "show-desktop" }
  | { type: "swap-pair"; direction: "left" | "right" }
  | { type: "custom"; action: string }
  | { type: "none" };

export function feedGesture(
  state: GestureState,
  event: GestureEvent,
  config: GestureConfig,
): GestureAction | null;
```

Pure. Unit-testable in Node.

### 41.3 Gesture configuration

| Setting                     | Default            | Meaning             |
| --------------------------- | ------------------ | ------------------- |
| `gesture-enabled`           | `true`             | Master toggle       |
| `gesture-3-swipe-action`    | `switch-workspace` | 3-finger horizontal |
| `gesture-3-vertical-action` | `toggle-overview`  | 3-finger vertical   |
| `gesture-4-swipe-action`    | `switch-workspace` | 4-finger horizontal |
| `gesture-4-vertical-action` | `none`             | 4-finger vertical   |
| `gesture-pinch-action`      | `show-desktop`     | Pinch in/out        |
| `gesture-sensitivity`       | `50`               | Threshold 0–100     |

### 41.4 Real touchpad wiring

GNOME 50 uses the Mutter gesture recognizer API. GNOME 48/49 use `Clutter.GestureAction`. `compat.ts` normalizes:

- GNOME 48/49: `Clutter.GestureAction` with `gesture-begin` / `gesture-end` signals.
- GNOME 50: the new recognizer API.

Both produce the same `GestureEvent` shape. The adapter is thin — all decisions in `core/gestures.ts`.

### 41.5 Interaction with GNOME's built-in gestures

GNOME has built-in 3-finger workspace switching and 4-finger overview. Policy:

- If the extension's action matches GNOME's built-in, defer to GNOME.
- If the extension's action differs, override via `GestureAction`.
- If gestures disabled in the extension, GNOME's built-ins run unchanged.

### 41.6 Gesture unit tests

`core/gestures.ts` fully tested in Node:

- Complete swipe-3-horizontal → `switch-workspace`, correct direction.
- Below threshold → `none`.
- Cancelled → `none`, state reset.
- Overlapping → second ignored.
- Every configured action → correct `GestureAction`.
- Sensitivity respected.

### 41.7 Gesture integration tests

Via `SimulateGesture`:

- `SimulateGesture('swipe-3-horizontal', 300, 0, 3)` → workspace switched.
- `SimulateGesture('swipe-3-vertical', 0, 300, 3)` → overview toggled.
- `SimulateGesture('pinch-in', -100, 0, 2)` → configured action fired.
- Gesture disabled → returns `false`.

### 41.8 Gesture acceptance criteria

- Extension loads on a laptop with a touchpad without errors.
- 3-finger horizontal swipe switches workspace.
- Border hidden during swipe, appears after.
- Sensitivity config takes effect immediately.
- Disabling gestures stops interception; GNOME's built-ins resume.

---

## 42. Zero-Human Development Loop

### 42.1 Principle

The user is never required to log out, log back in, restart GNOME Shell, touch the laptop, or confirm any prompt. All development and testing happens inside a nested GNOME Shell the agent controls.

### 42.2 Nested environment

```bash
dbus-run-session -- gnome-shell --devkit --wayland --headless \
  --virtual-monitor 1920x1080
```

- Runs in the agent's process tree with its own session D-Bus.
- Virtual monitor, no physical display.
- Accepts `gnome-extensions install` and `enable`.
- Kill and restart in seconds.
- Exposes `org.gnome.Shell.Eval`.

### 42.3 Nested Shell controller

`scripts/nested-shell.sh` with commands:

```
nested-shell.sh start | stop | restart | install | enable | disable | status | logs [--follow] | dbus <method> [args...] | eval <js> | gesture <kind> <dx> <dy> <points> | reset
```

Each command is idempotent and returns a clear exit code.

### 42.4 The agent's test loop

1. `nested-shell.sh reset` — clean environment, fresh install, extension enabled.
2. `npm run test:core` — fast, no Shell needed.
3. `scripts/agent-test.sh` — 30 scenarios.
4. Parse results. If any fail, apply a fix.
5. Rebuild. Reinstall into the running nested Shell (`nested-shell.sh install && disable && enable`).
6. Re-run the failing scenario.
7. Repeat until all pass.
8. `nested-shell.sh restart`, re-run the full suite to prove the extension survives a Shell restart.
9. Report in `TEST_RESULTS.md`.

The agent runs this unattended.

### 42.5 No real-session operations

- No `Alt+F2 r`.
- No `systemctl restart gdm`.
- No `gnome-shell --replace`.
- No log out / log in.

The nested Shell is the only environment the agent interacts with.

### 42.6 Handling real-session-only behaviours

| Behaviour               | Nested solution                                                   |
| ----------------------- | ----------------------------------------------------------------- |
| Real touchpad gestures  | `SimulateGesture`                                                 |
| Frame timing (no vsync) | Frame-delta instrumentation + unit tests                          |
| Monitor hot-plug        | Restart nested with different `--virtual-monitor`                 |
| Lock screen             | `SimulateSessionMode`                                             |
| Suspend/resume          | Manual-verification-only; skipped in agent loop with a clear note |

### 42.7 Acceptance criteria addition

- Agent completes the full loop three times consecutively without human intervention.
- `nested-shell.sh reset` brings the environment to known-good in under 60 seconds.
- All 30 agent scenarios run without human input.
- `TEST_RESULTS.md` contains evidence of at least three full green runs.
- No script prompts for input, asks for confirmation, or requires a TTY.

---

## 43. Estimated Cost

### 43.1 Assumptions

- Model: DeepSeek V3.2 or comparable ($0.28 input / $0.42 output per 1M tokens).
- Spec size: ~40,000 tokens.
- Iterations: 60–100 round-trips for a working first version.
- Each round-trip: 40K input + 2K output.
- Fix iterations: 30–50.
- Agent test runs: 30 scenarios × 5 iterations = 150 API calls.

### 43.2 Token budget

| Phase                    | Calls   | Input/call | Output/call | Total input   | Total output |
| ------------------------ | ------- | ---------- | ----------- | ------------- | ------------ |
| Initial generation       | 60      | 40,000     | 3,000       | 2,400,000     | 180,000      |
| Bug fixing               | 60      | 45,000     | 2,000       | 2,700,000     | 120,000      |
| Test generation          | 60      | 30,000     | 2,000       | 1,800,000     | 120,000      |
| Agent test runs          | 150     | 15,000     | 1,000       | 2,250,000     | 150,000      |
| Install / scripts / docs | 25      | 10,000     | 1,500       | 250,000       | 37,500       |
| **Total**                | **355** | —          | —           | **9,400,000** | **607,500**  |

### 43.3 Cost calculation (DeepSeek V3.2)

- Input: 9.4M × $0.28 / 1M = $2.63
- Output: 0.608M × $0.42 / 1M = $0.26
- **Base: ~$2.89**

### 43.4 Realistic multiplier

- Retries: ×1.5
- Context growth: ×1.3
- Test debugging: ×1.5
- Agent self-correction: ×1.4

Combined: **~4×**.

### 43.5 Realistic totals

| Model             | Base   | With 4×   |
| ----------------- | ------ | --------- |
| DeepSeek V3.2     | $2.89  | **~$12**  |
| Claude Sonnet 4.5 | $35.70 | **~$143** |
| Claude Opus 4.5   | $59.50 | **~$238** |
| GPT-4.1           | $22.70 | **~$91**  |

### 43.6 Summary

| Metric                   | Estimate     |
| ------------------------ | ------------ |
| API cost (DeepSeek)      | **$10–15**   |
| API cost (Claude Sonnet) | **$120–160** |
| API cost (Claude Opus)   | **$200–280** |
| Human presence required  | **None**     |

The API cost is the only external cost. All testing runs locally on the development machine via the nested Shell.

---

## 44. Final Deliverable Checklist

- `spec.md` (this document)
- `README.md` — install one-liner, dev setup, testing, uninstall
- `CONTRIBUTING.md`
- `CHANGELOG.md` (0.1.0)
- `TESTING.md` (all 24 scenarios including gestures)
- `TEST_RESULTS.md` (agent-executed, all green)
- `package.json` with scripts
- `Makefile`
- `tsconfig.json`
- `eslint.config.js`
- `.editorconfig`, `.gitignore`
- `packages/gnome/metadata.json`
- `packages/gnome/schemas/org.gnome.shell.extensions.adrt.gschema.xml`
- `src/core/` including `gestures.ts` and `session.ts`
- `src/platform/` all interfaces
- `src/adapters/gnome/` all files
- `tests/core/` including gesture and session tests
- `tests/agent/` — 30 scenarios
- `scripts/install.sh`, `uninstall.sh`, `dev.sh`, `agent-test.sh`, `nested-shell.sh`, `gesture-sim.sh`, `package.sh`
- `stylesheet.css`
- Compiled output in install layout

Complete when §36 acceptance criteria pass **and** `TEST_RESULTS.md` shows green for all 30 agent scenarios on a clean checkout.

---

## 45. Final Note

This is a specification, not a starting point. No features added or removed. Ask before filling gaps. Runs inside the GNOME Shell on the main thread, on Wayland laptops. Less is better. Cached is better. Deferred is better. Cleanup is not optional.

The project is **Adrt**. GNOME today. The `platform/` interfaces are the only thing that keeps the door open for KDE later, and they earn their place today by making `core/` runnable in plain Node.

---

# Adrt

GNOME 50+ tiling window manager extension for Wayland laptops. Windows tile
into pairs per monitor with learned split ratios. See `spec.md` for the
authoritative specification.

## Install

```bash
# From a checkout
make install          # or: npm run install:local

# Verify
gnome-extensions info adrt@adrt.dev
# State: ENABLED
```

On Wayland the Shell cannot be restarted in place. Log out and back in, or use
the nested development Shell (`npm run dev`).

## Development

```bash
npm install
npm run build           # tsc -> dist/
npm run test:core       # Vitest, plain Node, no compositor
npm run dev             # nested GNOME Shell with the extension enabled
npm run logs            # (inside dev) stream the [adrt] journal
```

The core decision logic in `src/core/` is pure TypeScript: no `gi://`, no
Mutter, no Shell imports. It runs in plain Node in milliseconds. The GNOME
adapter lives in `src/adapters/gnome/`; the interfaces a future KDE adapter
would implement live in `src/platform/`.

## Testing

```bash
npm run lint            # eslint src tests
npm run test:core       # core unit tests
npm run test:agent      # 35 scenarios in a nested GNOME Shell
npm run test:all        # lint + build + core + agent
```

The agent harness (`scripts/agent-test.sh`) starts headless nested GNOME
Shells (`gnome-shell --devkit --wayland --headless`), installs the extension,
drives it over D-Bus and reports a per-scenario pass/fail table. It never
requires a human at the machine.

Scenarios are sharded round-robin across isolated nested Shells, each with its
own state directory and Wayland display. By default it uses ~80% of the
machine's cores; set `ADRT_WORKERS=N` to override, or `ADRT_SCENARIOS='A0[12]'`
to run a subset. Geometry assertions poll until the layout settles, so the
suite is safe to run at high parallelism.

## Uninstall

```bash
make uninstall          # keeps $XDG_DATA_HOME/adrt
bash scripts/uninstall.sh --purge   # also removes user data
```

## Layout

```
src/core/         pure decision logic (testable in Node)
src/platform/     compositor-agnostic interfaces
src/adapters/gnome/ GNOME Shell 50+ adapter (GJS, St, Meta)
tests/core/       Vitest unit tests
tests/agent/      35 autonomous scenarios
scripts/          build, install, dev, nested-shell, agent-test, package
packages/gnome/   metadata.json, gschema, stylesheet
```
