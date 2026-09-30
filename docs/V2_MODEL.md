# Adrt v2 model (authoritative)

Status: **draft — decisions still being settled.** This document is the authority
for v2 behaviour; `spec.md` (and its byte-identical `README.md` copy) is superseded
section by section as the code lands. Anything not written here is not v2.

Written 2026-09-30. Supersedes the eviction/`>2`-extra model, the spawn budget and
cooldown, and the timers-and-guards scheduling.

## 1. Vocabulary

- **Slot** — one half of a monitor. A workspace on a monitor has exactly two slots:
  left and right. (Vertical layouts stack them: top and bottom.)
- **Pair** — two windows occupying the two slots of one workspace.
- **Maximized workspace** — a workspace whose single window covers its monitor.
- **Solo** — the only window on a workspace-monitor that is *not* maximized. Only
  legal as the last workspace of a screen (§3).
- **Managed window** — tileable and not floated: it owns a slot.
- **Floated window** — unmanaged: no slot, never moved or resized by us.
- **Screen** — a monitor. A given screen either **can host workspaces** (primary
  monitor while `workspaces-only-on-primary` is on, or any monitor when it is off,
  or when more than one workspace exists) or is **single-workspace**.

## 2. The core rule: nothing is ever evicted

No window is ever moved to another workspace *because another window needs its
place*. The only things that change a window's workspace are:

1. **Routing a new window** (§3),
2. **Maximising / unmaximising** the window itself (§4),
3. **A user move** — drag, overview drag, or a drop that swaps (§6).

## 3. Routing a newly opened window (workspace-capable screen)

1. The new window takes the **right slot** of the active workspace. If a single
   maximized window is there, it un-maximizes into the left slot and the two split
   (vertical layouts: top/bottom).
2. If the **right slot is already taken** (the workspace holds a pair), a new
   workspace is created **to the right**, the window is placed there **maximized**,
   and the view shifts to it.
3. Workspace order is never rearranged by us. No scanning for holes, no wrapping,
   no reordering.

## 4. Maximize / unmaximize

- **Maximize on a workspace-capable screen** moves the window to a new workspace
  **to the right** of its current one and maximizes it there; the workspace it left
  keeps its other window (which is then a maximized single). The view follows.
- **Maximize on a single-workspace screen** maximizes **in place** and (with
  `maximize-minimizes-others`, default on) minimizes the other managed windows
  **on that monitor only** — never windows on another monitor. They come back when
  the maximized window is unmaximized, minimized or closed.
- **Unmaximize** looks at the **left** workspace:
  - if it has space (one window), the window moves into that workspace's **right
    slot** and the now-empty workspace is **deleted**;
  - if the left workspace is **full** (a pair), the window is **minimized and moved
    to the left workspace**. Restoring it there later makes that workspace a pair
    naturally — its lone window un-maximizes into the left slot, and the restored
    window takes the right — so the restore path needs no special routing.
  - if there is no left workspace, the window stays where it is and un-maximizes in
    place.

## 5. Emptiness: the workspace invariant

- **Exactly one empty workspace exists** — the trailing spare GNOME's dynamic
  workspaces already create. It is never reaped.
- **Every other empty workspace is a bug.** When a policy action empties a
  workspace (a pair losing both windows, an unmaximize returning left, a window
  moving away), it is deleted, and the view moves to the nearest workspace with
  windows (preferring the left).
- A workspace holding **any** window is not empty, including a window on another
  screen: emptiness is judged per screen, and "exists on another screen" is the one
  legal exception to the single-spare rule.
- A workspace holds **either one maximized window or a full pair**, except:
  - the trailing spare (empty), and
  - the **solo** case of §3/§7 — one un-maximized window waiting for a partner on
    a workspace that is the last one with windows on its screen.

## 6. Floats and drags

- **Floated** (unmanaged, never touched by us): any window the user marks with the
  float keybinding; all modals, dialogs and popups; and any further window on a
  single-workspace screen whose both slots are taken (§7).
- **Everything else is enforced** (tiled). There is no "leave it alone" state for a
  managed window.
- **Drag to swap:** dragging a managed window so its perimeter crosses another
  managed window and dropping swaps the two windows (their slots, and their
  workspaces if it crossed a workspace boundary).
- **Overview drop / user-driven placement** is honoured, never routed:
  - onto a workspace with a single maximized window → the pair **splits** as usual
    (the maximized window takes the left slot, the dropped window the right);
  - onto a workspace whose **two slots are taken → the dropped window floats**
    (it is the user's own placement, so it is not given a workspace of its own);
  - onto the trailing empty spare → it lands there and is maximized.
- **The rule that separates the two:** a *policy* placement (a window **opens**
  while the right slot is taken) routes right and creates a workspace; a
  *user-driven* placement with no slot available floats. A window **restored from
  minimized** onto a workspace whose two slots are then occupied counts as
  user-driven: it floats.
- **"Newly active" means newly opened.** Focus changes never move, place or
  re-slot a window — which is what keeps the keyboard system's promise of never
  navigating to another workspace.

## 7. Single-workspace screens

A screen that cannot host workspaces (with `workspaces-only-on-primary`, a
non-primary monitor; or any monitor when dynamic workspaces are off with one
workspace) never creates, deletes or navigates workspaces:

- one window → **maximized**;
- a new window while a slot is free → the pair **splits** (the maximized window
  takes the left slot);
- both slots taken → any further window **floats**;
- the two slots are a **persistent pair on that screen** (the screen always shows
  the same content, so its slots do not move when the primary switches workspace).

## 8. User-driven layout changes

- **Overview window moves and window drags are honoured** (§6).
- **Workspace reordering is honoured verbatim, with one prohibition:** the trailing
  **empty spare may not be dragged elsewhere**. Mutter applies a reorder before we
  are told, so the rejection is a correction: reorder the spare back to last
  (guarded against re-entry) and raise a toast (`Main.notify`) saying the action is
  not possible.
- Because the spare cannot be moved, **"only the trailing workspace is empty" can
  never be broken by a user**, and policy never repacks by moving windows. Non-empty
  workspaces may be reordered freely.

## 9. Displays (docking)

Monitors appear and disappear at any moment; up to four, mixed resolutions and
orientations, and the primary can change.

- Memory is keyed by **connector**, never by index: `connector → [ { appId, title,
  slot, maximized, fullscreen, rect } ]`.
- **Disconnect**: windows on the vanished connector are routed to free slots on a
  remaining screen (a new workspace only when none is free); the view stays put.
- **Reconnect replays the monitor's previous state**, it does not choose among
  windows: the slot occupants return to their own slots (split), windows that were
  minimized come back minimized, floats come back floating at their rects, clamped
  into the new work area. Instance ids make this exact within a session; the durable
  per-app ordinal roll-up covers windows recreated after a restart. Nothing is
  floated and no workspace is created by a reconnect.
- A window is not moved if the user touched it since, or if the memory expired
  (`display-memory-minutes`, default 30).
- Mutter already moves windows proportionally on unplug/replug; our job is to
  correct the **slot** and state afterwards.
- We never change the primary monitor ourselves.

## 10. Scheduling, observability, exceptions

- **One scheduling path**: every signal handler pushes an event; a single deferred
  pass (one `global.compositor.get_laters()` later, ids tracked and removed on
  disable) applies work. Lane 1 = feedback, lane 2 = layout, lane 3 = maintenance.
  No policy runs inside a Mutter signal handler.
- **Plain records and predicates** (`isTileable(record)`, …), no classes extending
  Mutter objects.
- **Flags**: `debug.*` (queue, placement, slots, workspaces, geometry), `record`
  (replayable decision traces), `perf.*` (queue depth/drain time, apply latency,
  counters), all surfaced in `DumpState`, plus `DumpDecisions(n)`.
- **Event journal.** Every signal handler writes one line into a ring buffer —
  `{ seq, source: 'mutter' | 'shell' | 'settings' | 'internal', event, at }` — so an
  injected input can be *confirmed* against the real Mutter event that followed it.
  It has one monotonic sequence shared with the decision log (the dead `trace` field
  finally gets a meaning). Exposed as `DumpEvents(n, filter?)`.
- **Test triggers are honest and event-confirmed**, in three kinds:
  - `Inject*` — **real input through Mutter**: pointer motion/buttons and keycodes
    from a virtual input device, so `grab-op-begin`/`grab-op-end`, real keybinding
    activation and real touchpad gestures fire. Available in a headless shell with
    no seat and no `/dev/uinput`, either in-process
    (`Clutter.Seat.create_virtual_device()`, behind a `debug-input` setting that is
    off by default) or externally (`org.gnome.Mutter.RemoteDesktop`, whose session
    must be driven by a single long-lived client because it is peer-checked);
  - plain commands that **call a real Mutter API** (`MoveWindow`, `MinimizeWindow`,
    `SpawnWindow`, `MoveToWorkspace`, …);
  - `Simulate*` — **extension state only**, for situations input cannot express
    (a synthetic signal), used sparingly, never pretending to exercise Mutter.
  This is what allows the keybinding scenarios that are currently skipped for lack of
  a seat — and the live suite's `ydotool` dependency — to run in CI.
- **Exceptions** (each documented with owner and reason): the
  `WorkspaceAnimationController.animateSwitch` override for clone-free slides;
  reading `_swipeTracker` for gesture suppression; accepting a client's geometry
  after one retry instead of looping.
- **Invariant assertion, log-only**: at most one empty workspace per screen, and
  each workspace at most one maximized window or two managed windows. Violations
  are logged with state, never enforced by rationing.

## 11. App registry (profiles and exceptions merged)

One durable record per app, keyed by `appId`, **auto-populated**: every app whose
window we ever see gets an entry, so the list in prefs is the log of apps that have
opened. Shape:

```
appId → {
  firstSeen, lastSeen, windowsSeen, lastTitle,   // the log
  neverTile: boolean,                            // the "exception" flag
  profile: { …timing/behaviour overrides… },     // today's profiles.ts hints
  adapt:   { unmaximizeDelayMs?, settleMs?, skipAnimation?, retries? },
  placements: { <instanceId>: { connector, slot, maximized, fullscreen, rect } },
}
```

- **`adapt` is the learning, and it is only about performance and smoothness**:
  delays before resizing a just-unmaximized window, how long to wait before
  verifying a geometry, whether to skip the frame animation for an app that
  animates badly, and retry backoff. It is visible and resettable per app in prefs,
  in the same entry as everything else about that app.
- **The boundary is hard: adaptation never influences placement or geometry
  policy.** No learned minimum is ever fed to the tiler (the "bogus minimum" that
  pinned windows is exactly what goes away), and "stubborn" as a *suppression* of
  tiling is removed — a client that refuses a rect is simply accepted at its own
  rect after one retry, and the next plan treats it normally.

- The **exception flag** replaces both `exception-apps` and the `float: true` rule:
  one concept, "this app is never managed — always floating". A window of such an
  app is floated on sight and the tiler never touches it.
- **Profiles keep being respected**: an app's timing hints (retry delays, animation,
  settle) still apply, now visible and editable **under the same entry** rather than
  in a separate concept.
- The `tile: full|left-half|right-half` rule modes are **dropped**: they fight the
  two-slot invariant (`full` is what routing already does; a slot claim can conflict
  with another window's).
- The per-window history log already records every `register` with its `appId`; the
  registry is the durable per-app roll-up of that.
- Prefs exposes the list with a per-app toggle and a "forget this app" action.
- **App identity must work for distro packages, Flatpak and Snap alike.** The
  registry key is a resolved, normalised app identity (preferring the desktop-app
  id, falling back to the window class), recorded alongside the raw values so
  prefs and diagnostics can show what was matched. Two windows of the same app
  packaging format must resolve to one entry; the same app installed two ways may
  legitimately be two entries.
- **Placements are keyed by instance id.** Within a session the instance id is the
  window's stable sequence (exact — a live window goes back to its own slot); the
  durable roll-up is per app plus a creation ordinal (`#1`, `#2`, …) so windows
  recreated after a restart can be matched in order. Each placement records
  connector, slot, maximized/fullscreen state and rect.
- **Identity resolution** happens at the window's **first frame** (at
  `window-created` it is racy), by this chain, and the resolved key, its source and
  the raw values are all stored:
  1. `Shell.WindowTracker.get_window_app(win).get_id()` — GNOME's canonical
     desktop id (`org.gnome.Calculator.desktop`), ignored while it is still the
     provisional `window:<seq>`;
  2. `Meta.Window.get_sandboxed_app_id()` (public in 50) — `org.mozilla.firefox`
     for Flatpak, `firefox_firefox` for Snap, null for distro packages;
  3. `Meta.Window.get_gtk_application_id()`;
  4. for portable apps: walk the window's process **ancestors** for an AppImage —
     the `APPIMAGE` variable or an ancestor `cmdline[0]`/`/proc/<pid>/exe` ending in
     `.AppImage` — keyed by its **basename** (the runtime's mount path is random per
     run, and Chromium/Electron zero their own environment, so the window's pid
     alone is unreliable);
  5. `wm_class` (+ instance);
  6. a session-only `window:<stable-sequence>` key (never persisted).
  Normalisation: strip `.desktop` and an `AppImage`/`.appimage` suffix, never
  casefold a path, never `realpath`. An unintegrated AppImage that only reports
  `wm_class` is the documented worst case and gets a `wmclass:` key.
  A provisional key is **re-keyed** when the real identity arrives, carrying its
  registry entry and placements with it; re-resolution listens on
  `tracked-windows-changed` and the window's own `notify::wm-class`.
- **Deb, Flatpak and Snap installs of the same app are different identities** and
  get separate entries (that is what their desktop ids are). A conservative
  "family" normaliser exists only for user-facing grouping, never as a key.
- **The float keybinding is session-scoped per app**: it floats the focused window
  and remembers the app as floating **until that app is closed**, so its other
  windows float too while it runs. It is *not* persisted; the registry's
  `neverTile` flag is the permanent path.

## 12. Undo

- `Super+Z` reverts **the change**: the specific window **instances** and their
  configuration — workspace, slot, rect, maximized/floating state — plus the split
  ratios that produced them. A change that moved a window between workspaces or
  maximised it is reverted by restoring that instance, never skipped.
- Entries are pushed for changes to **existing managed windows** as a result of a
  user action. A window's *first* placement (it just opened) is not an entry: there
  is no previous state to restore.
- **Undo holds exactly one change.** There is no stack: `Super+Z` reverts the most
  recent change or nothing. It is kept in memory only — a restart clears it, since
  the window instances it refers to are gone with the session. This is deliberate:
  one entry is cheap to keep and impossible to mis-target.
- **If the revert is not possible** — the window has closed, the monitor is gone,
  the workspace no longer exists — **nothing is applied** and a toast
  (`Main.notify`, the same mechanism as the reorder rejection) says undo is not
  possible and why. A partial restore that leaves the layout inconsistent never
  happens.
- Each instance is validated (still exists, still reachable) before anything moves.
- `undo-stack-size` is dropped (there is nothing to size); any stored stack from the
  old version is discarded by the settings migration.

## 13. Decisions log

Everything the model above rests on, in the order it was settled (each was an
explicit choice, not an inference):

1. **No eviction.** Nothing is moved to another workspace because another window
   needs its place; a new window is routed, a maximise moves only its own window,
   a drag floats.
2. **Routing is right-only**: right slot, else a workspace created to the right with
   the window maximized there. No scanning for holes, no wrap, no reorder.
3. **Workspaces are packed**: one maximized window or a full pair; the trailing
   spare is the only empty one; every other empty workspace is a bug and is
   reaped (per screen; a workspace holding a window on another screen is not empty).
4. **Maximise** moves the window to its own workspace on a workspace-capable screen;
   on a single-workspace screen it maximises in place and minimises the other
   managed windows **on that monitor only** (`maximize-minimizes-others`, default
   on).
5. **Unmaximise** joins the left workspace's right slot and deletes the emptied
   workspace; if the left workspace is full, the window is minimized and moved
   there.
6. **Single-workspace screens**: one window maximized; a new window splits while a
   slot is free; both slots taken → further windows float.
7. **Floats**: the float keybinding (session-scoped per app — it lasts until the app
   closes, and is never persisted); modals, dialogs and popups; a user-driven
   placement with no room (an overview drop onto a full pair, a window restored from
   minimized onto a full workspace). Everything else is enforced.
8. **Drag onto another window's perimeter swaps** the two.
9. **Overview drops**: onto a single maximized window → split; onto a full pair →
   float.
10. **Workspace reordering is honoured**, except that the trailing empty spare may
    not be moved — that attempt is reverted and answered with a toast.
11. **"Newly active" means newly opened**; focus changes never move a window.
12. **The app registry** merges exceptions and profiles into one auto-populated
    per-app log, with `neverTile`, profile hints, adaptation and placements in one
    entry; identity is resolved at first frame by the documented chain (deb, Flatpak,
    Snap and AppImage alike).
13. **Adaptation is kept but scoped**: performance and smoothness only (delays,
    settle, animation skip, retries). It never influences placement or geometry —
    no learned minimum ever reaches the tiler, and "stubborn" as suppression is gone.
14. **Hotplug replays the monitor's previous state** per connector; a reconnect never
    floats a window and never creates a workspace; we never change the primary.
15. **Undo holds exactly one change**, in memory, per instance and configuration;
    if it cannot be reverted, nothing is applied and a toast says why.
16. **Test discipline**: `DumpState` is add-only per commit, the D-Bus trigger
    surface is declared in one place, and triggers are honest and event-confirmed
    (`Inject*` real input, plain commands for real APIs, `Simulate*` for state only).
17. **Queue first, model second**: lanes + per-key coalescing + one deferred drain +
    the re-entrancy guard land before the model; budgets, fairness and flags follow.
18. **v2 before the performance plan**, which is re-scoped afterwards.
19. **Cleanup appetite is high**: dead settings/branches removed, the two float
    representations unified into the registry, a real settings migration with a
    version bump, and the trigger names corrected.

## Deliberate non-goals

- Per-app *geometry* learning (only timing adaptation survives).
- Repacking workspaces after a user reorder.
- Changing the primary monitor, or restoring a fullscreen state on reconnect.
- A long undo history.
- Any policy that runs inside a Mutter signal handler.
