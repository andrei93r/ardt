# Adrt v2 model (authoritative)

Status: **frozen for implementation.** `spec.md` (and `README.md`, which is a separate
file — it omits a §12 clause and adds install prose) is superseded section by section
as the code lands. Anything not written here is not v2.

Companion: `docs/V2_PLAN.md` (order of work, tests per stage).

## 1. Vocabulary

- **Screen** — a monitor. It is in exactly one of three states:
  - **workspace-capable**: GNOME's dynamic workspaces are on, so adrt may create and
    remove workspaces there;
  - **single-workspace-capable**: it has one workspace (a non-primary monitor while
    `workspaces-only-on-primary` is on, or dynamic workspaces off with one workspace);
  - **fixed-workspace**: several workspaces exist but GNOME cannot create more
    (dynamic off, two or more workspaces).
- **Slot** — one of the screen's two tiling halves: `0`/`1` along the screen's split
  axis. Landscape → left/right; portrait, or a vertical workspace layout
  (`layout_rows === -1`) → top/bottom. In this document "left" means slot 0 and
  "right" means slot 1.
- **Pair** — two managed windows, one per slot.
- **Maximized single** — a workspace whose one managed window is maximized.
- **Managed** — tiled: it owns a slot.
- **Floated** — unmanaged: no slot, never moved or resized by adrt. Floated windows
  still belong to a workspace for the emptiness rule (§5).
- **Occupancy** — a slot is occupied by a window that *exists*, not by what is
  visible: a minimized managed window still occupies its slot.
- **Spare** — the single empty workspace GNOME keeps at the end of the list. Global,
  not per screen. adrt never creates it and never removes it.
- **Instance id** — a window's identity within the session (its stable sequence);
  admissions also carry a durable per-app ordinal (§12).
- **Lane** — the priority of queued work: 1 feedback, 2 layout, 3 maintenance (§11).
- **View** — the active workspace.
- **Reap** — delete an empty workspace.

## 2. Nothing is ever evicted

No window is moved to another workspace because another window needs its place. The
only things that change a window's workspace are:

1. **routing a newly opened window** (§3),
2. **maximize / unmaximize / fullscreen of that window itself** (§4),
3. **a user move** — a drag or an overview drop (§6),
4. **a disconnect** — a vanished screen's windows move to the primary (§9).

A reconnect never moves a window *because* of another window either; it replays a
screen's previous state (§9).

## 3. Routing a newly opened window

Auto-routing applies to windows **opening**, per **screen** — a window is placed on
the screen it opens on, never yanked to another screen's active workspace. Focus
changes never move a window.

- **Workspace-capable screen**: the window takes the **right slot** of the active
  workspace. If a maximized single is there, it un-maximizes into the left slot and
  the two split. If both slots are occupied, a workspace is created **to the right**,
  the window is placed there **maximized**, and the view follows.
- **Single-workspace-capable screen**: a free slot → the pair splits; both slots
  taken → the window **floats** (§7).
- **Fixed-workspace screen**: route to the nearest existing workspace (right first,
  then left) that has a free slot; if every fixed workspace is full, **float**.
  Nothing is created.
- Routing does not apply to hotplug, which has its own rule (§9).

## 4. Maximize, unmaximize, fullscreen, minimize

**Maximize.**
- On a workspace-capable screen the window moves to a workspace created **to the
  right** and is maximized there. The workspace it left keeps its other window (a
  maximized single) or, if it had none, is reaped. The view follows.
- On a single-workspace-capable screen it maximizes **in place** and, with
  `maximize-minimizes-others` (default on), minimizes the other managed windows **on
  that monitor only**. They return when it is unmaximized, minimized or closed.

**Fullscreen** behaves like maximize: on a workspace-capable screen it gets a
workspace **to the right**; on a single-workspace-capable screen it stays in place.
It **is** recorded and restored by display memory when the window still exists (§9).

**Unmaximize** tries, in order:
1. the **left** workspace's right slot, if that workspace has a free slot;
2. otherwise the **right** workspace's free slot;
3. otherwise the window is **minimized and moved to the left** workspace.

Any workspace emptied by the move is reaped (§5).

**Minimize** never navigates the view and never moves another window. The window
keeps its slot, and while its partner is minimized the visible window fills the
monitor; restoring re-splits. If a workspace would be left holding only minimized
windows, that window is moved to the **left** workspace, or, if it cannot go left, to
the **right** one, so the workspace can be reaped.

**A lone managed window is always maximized** — there is no un-maximized lone window
anywhere except §7's single-workspace-capable pair rule.

## 5. Emptiness and packing

- Every workspace holds a **maximized single** or a **full pair** — counting
  occupancy, so a minimized window still counts. The only empty workspace is the
  **spare**.
- **Reaping is a property, not an event**: at every drain, any empty workspace other
  than the spare is reaped, whoever emptied it — a close, a move, a drop, a routing,
  a reconnect. A workspace holding any window, including one on another screen, is not
  empty.
- When a reaped workspace was the one the view was on, the view moves to the nearest
  non-empty workspace with windows (left first). Otherwise the view does not move.
- Workspaces emptied **by our own reorder work** are exempt only for the duration of
  that work (they are the adjacency placement of §9); they are reaped on the next
  drain if still empty.
- The invariant is **asserted, not enforced**: a violation is logged with its
  identifier and the state. There is no rationing, no budget and no cooldown.

## 6. Floats and user-driven changes

**Floated** (unmanaged, never touched by adrt):
- a window marked with the float keybinding — **session-scoped per app**: the mark
  lasts until that app is closed, and is never persisted (the registry's `neverTile`
  flag is the durable path, §12);
- an app with `neverTile`;
- modals, dialogs and popups;
- a **user placement with no room**: an overview drop onto a full pair, a window
  restored from minimized onto a full workspace, and overflow on a
  single-workspace-capable screen;
- a window the user resized beyond its slot when the sibling cannot adapt (§10).

**Drags and drops.**
- Dragging the **inner** edge of a pair changes the ratio; the tiler resizes the
  sibling so the pair stays flush (§10).
- Dragging a managed window so its perimeter **crosses another managed window** and
  dropping **swaps** the two.
- **Cross-screen drags** follow the target screen's rules: a free slot takes the
  window (its pair splits as usual); a window whose perimeter was crossed is swapped
  with; no room at all → the dropped window floats. A maximized window dragged across
  screens is un-maximized at the drop (Mutter freezes a maximized window's horizontal
  drag and shakes it loose vertically) and then treated by the same rules.
- **Overview drops**: onto a maximized single → the pair splits; onto a full pair →
  the dropped window floats; onto the spare → it lands there and is maximized.
- A window **restored from minimized** onto a workspace whose two slots are taken
  floats.

## 7. Single-workspace-capable and fixed-workspace screens

Never create, reap or navigate workspaces there.

- **Single-workspace-capable**: the first window is maximized; a second splits it; the
  third and later windows **float**. The two slots are a persistent pair on that
  screen — they do not move when the primary switches workspace. Maximize is in place
  with `maximize-minimizes-others`.
- **Fixed-workspace**: routing fills existing workspaces (right, then left); a window
  with no free slot floats. Maximize behaves as on a workspace-capable screen, except
  that it may only use existing workspaces; if none is free it maximizes in place.

## 8. User workspace reordering

Reordering is **honoured exactly**, with no correction, no tagging, no toast, no
per-gesture state: you keep the ability to move workspaces, including with an
extension. Because reaping is a property (§5), an empty workspace — including the
spare — is pruned wherever it sits, so dragging the spare has no lasting effect while
a reorder of loaded workspaces is preserved. GNOME recreates a spare when it needs
one, and adrt never removes the spare.

## 9. Displays and docking

Memory is keyed by **connector** (never by index): for each remembered window, its
connector, slot, maximized, fullscreen and rect; matched in-session by instance id,
and by per-app ordinal for windows recreated after a restart.

**Disconnect.** Windows on a vanished screen move to the **primary** screen. As many
workspaces are created as those windows need (two per workspace), placed **adjacent
to the current workspace on the physical side the vanished screen was on**: a screen
to the right → the new workspaces go to the right of the current one; to the left →
to the left, and if there were already screens to the left, at the leftmost position;
above or below → treated as left. Then §5 reaps whatever is left empty. Mutter
migrates windows on its own; adrt only routes windows that a surviving
workspace-capable screen is not already displaying.

**Reconnect** **replays the screen's previous state** — slot occupants to their slots,
minimized windows minimized, floats floating at their rects, fullscreen restored when
the window still exists — clamped into the fresh work area. It never floats a window
and never creates a workspace. A window the user has touched since, or whose memory
has expired (`display-memory-minutes`, default 30), is left alone; replay is partial
in that case, and §5 reaps afterwards.

adrt never changes the primary monitor; a primary change is followed, not caused.

## 10. Sizing: ratios, refusals, gaps, and the work area

**Ratios** are per workspace (per pair), default 50/50. The user adjusts them by
dragging the inner edge, and the tiler resizes the sibling to match, so the pair stays
flush. The ratios that produced a layout are captured by undo.

**The resize/refusal ladder**, in order:
1. the user resizes a window → the sibling follows so the pair stays flush;
2. if a client refuses the requested split, the **sibling adapts** — the refusing
   window keeps the size it insists on and the sibling takes the remainder, clamped to
   the sibling's own limits;
3. if the sibling cannot adapt either, the refusing window takes **its own workspace
   to the right**, sized to itself, clamped between **one sixth of the screen and the
   full screen**;
4. on a single-workspace-capable screen there is no workspace to give it: it keeps its
   clamped size over the sibling, which remains reachable because focusing it raises
   it.

**Gaps** are adjustable per side (left, right, top, bottom) and between windows, per
orientation: new settings beside the existing `gaps-base`/`gaps-portrait`/
`gaps-landscape`, defaulting to zero for the outer edges and to the base gap for the
split between two windows.

**The work area** is the available surface, and it is never assumed:
- read `Main.layoutManager.getWorkAreaForMonitor(index)` — workspace-independent
  (workspace 0), and the only authority (`Meta.Display` exposes no work-area method in
  GNOME 50);
- a non-autohiding top bar and a non-autohiding dock are already excluded from it:
  the shell's panel reserves a top strut on the **primary only**, and a dock reserves
  one only when it is fixed (`dash-to-dock` with `dock-fixed=false`, i.e. autohide or
  intellihide, reserves nothing);
- re-read it on `monitors-changed`, on `workareas-changed`, and after
  `startup-complete`; never cache it across a screen change;
- validate every reading: the index in range, a positive size, and the rect inside the
  monitor's geometry. On an invalid or transient reading, keep the last good value —
  Mutter can report `-1 × -1` mid-transition, and querying a stale index raises
  `logical_monitor != NULL` assertions in the journal;
- defer the replan (a lane-3 event, coalesced, a few hundred milliseconds): the first
  `workareas-changed` can arrive before the shell has set the new struts.

## 11. Scheduling, observability, exceptions

- **One scheduling path**: every signal handler only pushes an event; a single
  deferred pass drains it. No policy runs inside a Mutter signal handler. Workspace
  mutations happen only in the drain's layout lane.
- **Lanes**: 1 feedback (focus, border, marker), 2 layout (route, plan, apply,
  workspace create/reap, view shift), 3 maintenance (reap, persist, work-area
  refresh, sweep). Per-key coalescing inside a lane.
- **Plain records and predicates** (`isTileable(record)`, …), no classes extending
  Mutter objects.
- **Event journal**: every signal handler writes `{ seq, source, event, at }` into a
  ring buffer with one monotonic sequence, shared with the decision log; `DumpEvents`,
  `DumpDecisions`, plus `debug.*`, `record` and `perf.*` flags in `DumpState`.
- **Triggers are honest and event-confirmed**: `Inject*` = real input through Mutter
  (virtual input devices); a plain command = a real Mutter API; `Simulate*` =
  extension state only.
- **Exceptions** (documented, each with its reason): replacing
  `WorkspaceAnimationController.animateSwitch` for clone-free slides; reading
  `_swipeTracker` for gesture suppression; accepting a client's own rect through the
  §10 ladder.
- **Invariants are asserted, never enforced** (§5).

## 12. App registry (profiles, exceptions and adaptation in one entry)

```
appId → {
  firstSeen, lastSeen, windowsSeen, lastTitle,   // the log of every app that opened
  neverTile: boolean,                            // never managed, always floating
  profile: { …timing/behaviour hints… },
  adapt:   { unmaximizeDelayMs?, settleMs?, skipAnimation?, retries? },
  placements: { <instanceId>: { connector, slot, maximized, fullscreen, rect } },
}
```

- **Identity** is resolved at the window's first frame by this chain, recording the
  key, its source and the raw values: `Shell.WindowTracker` desktop id (ignored while
  provisional `window:<seq>`) → `get_sandboxed_app_id()` (Flatpak/Snap) →
  `get_gtk_application_id()` → an **AppImage** found by walking the process ancestors
  for `APPIMAGE` (mount paths are random per run, and Chromium zeroes its own
  environment) → `wm_class` → a session-only `window:<seq>`. Normalisation strips
  `.desktop` and an `AppImage` suffix, never casefolds a path, never `realpath`. Deb,
  Flatpak and Snap installs of one app are **different identities**; a conservative
  "family" normaliser exists for grouping only. A provisional key is re-keyed,
  carrying its entry, with the real key winning and `neverTile = old || new`.
- **`adapt` is performance and smoothness only**: delays, settle, animation skip,
  retry backoff. It never influences placement or geometry — no learned minimum ever
  reaches the tiler.
- Placements are keyed by instance id, with a durable per-app ordinal (`#1`, `#2`, …)
  so windows recreated after a restart can be matched in order.
- Deleting the old stores (`adaptation.json`, `behavior.json`, `exception-apps`) is a
  real settings/state migration with a version bump.

## 13. Undo

- `Super+Z` reverts **the change**: the specific window instances and their
  configuration — workspace, slot, rect, maximized, floating — plus the ratios that
  produced them.
- **Exactly one change** is held, in memory only; a restart clears it.
- Undoing an unmaximize **recreates** the workspace that unmaximize deleted.
- If the revert is impossible — an instance is gone, or a slot it needs has since been
  taken — **nothing** is applied and a toast (`Main.notify`) says so. Partial restores
  never happen.

## 14. Preserved subsystems (out of scope for v2)

Unchanged by this model, and to be maintained: the active-window border and its
animation, all keybindings, gesture control, the prefs UI, session modes, history
rotation and retention, the D-Bus observability surface, profiles (as part of §12),
and the pure-core/`platform` split.

## 15. Decisions log

1. **No eviction**; the only workspace changes are routing, maximize/unmaximize/
   fullscreen, a user move, and a disconnect (§2).
2. **Routing is right-only, per screen**: right slot, else a workspace created to the
   right with the window maximized there; no scanning, no wrap, no reorder.
3. **Workspaces are packed**: maximized single or full pair; the trailing spare is the
   only empty one and is never removed; every other empty workspace is reaped as a
   property, wherever it sits.
4. **Maximize** moves the window to its own workspace on a workspace-capable screen;
   on a single-workspace-capable screen it maximizes in place and minimizes the other
   windows on that monitor only (`maximize-minimizes-others`, default on).
5. **Fullscreen** behaves as maximize and is recorded and restored when the window
   still exists.
6. **Unmaximize** joins the left workspace's right slot; failing that, the right
   workspace; failing that, it is minimized and moved left.
7. **Minimize** keeps occupancy; a workspace left holding only minimized windows has
   that window moved (left, else right) so the workspace reaps.
8. **Single-workspace-capable screens**: maximize once, split twice, float thereafter;
   the pair is persistent per screen.
9. **Fixed-workspace screens** route to existing workspaces only, else float.
10. **Floats**: the keybinding (session-scoped per app until it closes), `neverTile`,
    modals and popups, and user placements with no room.
11. **Drags**: inner edge changes the ratio and the sibling follows; perimeter crossing
    swaps; cross-screen drags follow the target screen's rules; overview drops split
    onto a maximized single and float onto a full pair; a restored window with no room
    floats.
12. **Workspace reordering is honoured with no correction and no bookkeeping**, and the
    spare is never removed.
13. **The resize/refusal ladder**: adapt the sibling first; give the refusing window
    its own workspace, clamped to [1/6, full screen], only when the sibling cannot
    adapt; on a single-workspace screen it keeps the clamped size.
14. **Ratios** are per workspace, user-adjustable on the inner edge, captured by undo;
    there is no app-pair ratio learning.
15. **Gaps** are adjustable per side and between windows, per orientation.
16. **The work area is never assumed or cached**: `getWorkAreaForMonitor`, validated,
    re-read on monitor and work-area changes and after startup, replanned after a
    settle.
17. **Hotplug**: disconnect moves a vanished screen's windows to the primary and
    creates adjacency-ordered workspaces on the side the screen was on; reconnect
    replays the screen's previous state, never floats or creates; the primary is never
    changed by adrt.
18. **The app registry** merges exceptions, profiles and adaptation into one
    auto-populated per-app entry with the documented identity chain.
19. **Adaptation is timing-only**; no learned geometry, no "stubborn" suppression.
20. **Undo holds exactly one change**, per instance and configuration, recreating a
    deleted workspace, and toasts when it cannot.
21. **Three targets and strict TDD**: every feature and fix lands as failing tests
    with their variations first, and passes on `headless` and on `session-like`; the
    hardware-only classes are checked on the real session.
22. **No policy inside a Mutter signal handler**, ever.
23. **Cleanup appetite is high**: dead code, dead settings and the duplicate float
    representations go; the settings migration is real.

## Deliberate non-goals

- Per-app geometry learning; "stubborn" suppression of tiling.
- Repacking workspaces after a user reorder; removing the spare.
- Changing the primary monitor.
- A multi-entry or persisted undo history.
- Any policy that runs inside a Mutter signal handler.
