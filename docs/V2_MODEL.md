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
  the two split. If both slots are occupied, a workspace is created **immediately to
  the right of the active workspace** (the spare is pushed further right), the window
  is placed there **maximized**, and the view follows.
- **Single-workspace-capable screen**: a free slot → the pair splits; both slots
  taken → the window **floats** (§7).
- **Fixed-workspace screen**: route to the nearest existing workspace (right first,
  then left) that has a free slot; if every fixed workspace is full, **float**.
  Nothing is created.
- Routing is decided **per arrival**: a second window always finds the first (a
  maximized single to split with), never a simultaneous evaluation of both.
- **Slot order when a pair forms**: the window the change is *about* — routed, moved,
  dragged, restored from minimized, or unmaximized into a pair — takes the **right**
  slot when it is free, else the left. The window it joins keeps its side, and so do
  minimized windows returning from the same unmaximize (they take the left). `A | B`
  maximized and then unmaximized comes back as `B | A`; restoring A onto a lone B
  gives `B | A` too. **A cross-screen arrival is the exception**: the direction it came
  from is known, so it takes the slot on **that** side — from the left or above, slot
  0; from the right or below, slot 1 — landing against the edge it just crossed.
  If it ends up alone, it maximizes like any lone window.
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
1. the **left** workspace, if it holds **exactly one** window — the result is a pair,
   with the unmaximized window in the right slot;
2. otherwise the **right** workspace, if it holds exactly one window;
3. otherwise the window is **minimized and moved**: into the left workspace if it
   holds any window, else into the right one if it does, else it stays where it is.

An **empty** neighbouring workspace is not a target for unmaximize: joining it would
leave the window alone and therefore maximized again, a move that changes nothing.
Moving a minimized window into an already full workspace is not a problem, because a
minimized window holds no slot (§5), and the workspace it left is reaped (§5).

Any workspace emptied by the move is reaped (§5).

**Minimize** never navigates the view and never moves another window. The window
**releases its slot while it is minimized**, so the visible partner fills the monitor
and a window opening on that workspace takes the free slot. If a workspace would be
left holding **only minimized windows**, its occupant is relocated in this order: the
**left** workspace if it holds any window at all, otherwise the **right** workspace
if it holds any, and otherwise the window **stays where it is** and the workspace is
allowed to persist holding only minimized windows. A minimized window is never a
problem for a full workspace, because it holds no slot. That last branch is the one
case where a workspace that looks empty is legal (no neighbour holds windows to take
its own), and it is the normal case on a single-workspace-capable screen, which has
no neighbours at all.

**A lone managed window is always maximized** — there is no un-maximized lone window
anywhere except §7's single-workspace-capable pair rule.

## 5. Emptiness and packing

- Every workspace holds a **maximized single** or a **full pair** of *visible*
  windows. **A slot is held only while its window is visible**: minimizing releases
  the slot, so a window opening on that workspace takes it and splits with the
  visible partner; the minimized window takes a free slot again — or floats — when it
  is restored. The only *empty* workspace is the **spare**; the only workspace that
  may *look* empty is one whose single window is minimized with no neighbour holding
  windows to take it (§4).
- **Reaping is a property, not an event**: at every drain, any empty workspace other
  than the spare is reaped, whoever emptied it — a close, a move, a drop, a routing,
  a reconnect. A workspace holding any window, including one on another screen, is not
  empty.
- When a reaped workspace was the one the view was on, the view moves to the nearest
  non-empty workspace with windows (left first). Otherwise the view does not move.
- The **spare is GNOME's**: opening a window while viewing it simply occupies it (the
  window is alone there, so it maximizes) and GNOME appends a fresh spare after it.
  adrt neither creates nor removes it.
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
- a **user placement with no room**: an overview drop onto a full pair, **a window
  the user moves by keyboard or menu onto a workspace whose slots are taken**, a
  window restored from minimized onto a full workspace, and overflow on a
  single-workspace-capable screen;
- a window the user resized beyond its slot when the sibling cannot adapt (§10).
- **A float adrt places is offset, never perfectly aligned with what is under it**: the
  initial placement is the centre shifted by an offset (a cascade), so a float over a
  pair is visibly distinct and immediately grabbable instead of exactly covering the
  window beneath. A float the *user* positioned is left exactly where they put it.

**Drags and drops.**
- Dragging the **inner** edge of a pair changes the ratio; the tiler resizes the
  sibling so the pair stays flush (§10).
- Dragging a managed window so its perimeter **crosses another managed window** and
  dropping **swaps** the two.
- **Cross-screen drags** follow the target screen's rules: a free slot takes the
  window (its pair splits as usual), **on the side it came from** — from the left or
  above, slot 0; from the right or below, slot 1; a window whose perimeter was crossed
  is swapped with; no room at all → the dropped window floats. A maximized window dragged across
  screens is un-maximized at the drop (Mutter freezes a maximized window's horizontal
  drag and shakes it loose vertically) and then treated by the same rules.
- **Overview drops**: onto a maximized single → the pair splits; onto a full pair →
  the dropped window floats; onto the spare → it lands there and is maximized.
- A window **restored from minimized** onto a workspace whose two slots are taken
  floats.

### Focus and move directions

- The four directions act **on the current plane first**: on a pair, `left` selects
  slot 0 and `right` slot 1 along the pair's own axis — so on a portrait screen, or
  with a vertical workspace layout, `up`/`down` are the pair axis and `left`/`right`
  reach the other screen.
- With no window in that direction on this screen, the direction crosses to the
  **next physical screen** in that direction, chosen by geometry (never by index), and
  lands on the window whose position matches the one you came from — "the correct
  orientation": moving left out of a landscape screen onto a portrait one picks the
  window nearest your current vertical position, and the reverse likewise.
- **Focus never switches workspace.** A keyboard **move** reaches another workspace
  only through the dedicated move shortcuts (§17); crossing a screen edge only
  re-slots the window on the target screen, it never changes its workspace.
- A keyboard **move** follows the same plane rule — into a free slot, a swap when the
  plane is joined — and the target screen's own rules (§6, §7) when it crosses an edge.

### Behaviour shifts at screen edges

Crossing an edge changes more than the coordinates, and it is explicit rather than
emergent:

- **Axis**: each screen's split axis follows that screen (landscape → left/right,
  portrait or vertical workspaces → top/bottom), so a window crossing the edge is
  re-slotted on the target's axis, chosen from where it was dropped mapped onto it.
- **Work area**: each screen has its own, and the top bar's strut exists **only on the
  primary**, so the same slot is a different size on two screens. A window crossing an
  edge is re-clamped to the target's fresh work area (§10).
- **Gaps** are per orientation, so the spacing shifts with the target.
- **Occupancy** is decided by the target screen's own rules: a free slot, a swap by
  perimeter crossing, or a float when there is no room (and always a float on a
  single-workspace-capable screen).
- None of this creates, removes or navigates a workspace.

## 7. Single-workspace-capable and fixed-workspace screens

Never create, reap or navigate workspaces there.

- **Single-workspace-capable**: the first *visible* window is maximized; a second
  splits it; a third **floats** (a minimized window holds no slot, so it never forces
  the float). The two slots are a persistent pair on that screen — they do not move
  when the primary switches workspace. Maximize is in place with
  `maximize-minimizes-others`.
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

adrt never changes the primary monitor; a primary change is followed, not caused. The
primary is always **read from GNOME** — the current one, re-read whenever it changes —
and never assumed or remembered.

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
- **The active-window highlight is instrumented**, because it has its own bug classes
  (stuck on a workspace that is gone, drawn at a stale rect, flicker, a suppression
  that never lifts): every highlight change is journalled with its **reason** — focus
  changed, suppression added or removed (`drag`, `switch`, `pause`, `sharing`,
  `overview`, `occluded`), rect update, close ghost, animation tick — together with its
  rect and the active suppression set, under `debug.indicator`. `DumpState` reports the
  same values, so "why is the border there / not there" is answerable from one
  snapshot.

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
- **A routed new window is not the change**: it was never on another workspace, so
  undo leaves it exactly where it is and acts on the previous change — or reports
  that there is nothing to undo.
- If the revert is impossible — an instance is gone, or a slot it needs has since been
  taken — **nothing** is applied and a toast (`Main.notify`) says so. Partial restores
  never happen.

## 14. Preserved subsystems (out of scope for v2)

Unchanged by this model, and to be maintained: the active-window border and its
animation, all keybindings, gesture control, the prefs UI, session modes, history
rotation and retention, the D-Bus observability surface, profiles (as part of §12),
and the pure-core/`platform` split.

## 16. Classification: what is tiled, and the escape rule

Two categories, and one rule.

**Never managed** (no slot, never moved or resized by adrt):

| Window | Why |
| --- | --- |
| override-redirect (menus, tooltips, popups) | never even tracked |
| desktop, dock, notification, splash, popup-menu, dropdown, tooltip | non-tileable kinds |
| skip-taskbar (a drop-down terminal) | not part of the workspace layout |
| genuinely sticky (pinned to every workspace) | belongs everywhere, not to one workspace |
| a manual float: the float keybinding, or `neverTile` in the registry | the user's own decision |
| **always-on-top (`above`)** — a picture-in-picture video, a widget | it asked to float above; we no longer tile it and no longer clear the flag (this reverses the old A61 behaviour) |
| a **dialog, transient or attached dialog** | floats, is **centred on its parent** and raised |

**Managed** (tiles): everything else, including a window on a non-primary monitor
(monitor-implied `on-all-workspaces` is *not* stickiness), a window with no `wm_class`,
and an XWayland window, which has no special path.

**The escape rule**: a managed window that **does not fit its slot** — oversized,
fixed-size (`min == max`), or refusing the geometry — is given **its own workspace to
the right**, sized to itself and clamped between one sixth of the screen and the full
screen (§10). Floats are therefore not the escape for "doesn't fit"; they are only
the categories above. On a single-workspace-capable screen there is no workspace to
give it, so it keeps its clamped size there (§10, §7).

Two clarifications that follow from this:

- An **app that opens maximized** (Files, Nautilus) is *not* a user maximise: it is
  unmaximized and tiled with its sibling, and only a window left alone is maximized.
- **Fullscreen** is the "does not fit" case: the *transition* moves the window to its
  own workspace on a workspace-capable screen (in place otherwise), it is untouched
  while fullscreen, it is recorded and restored by display memory, and leaving
  fullscreen returns it to a slot like unmaximize.
- **Heuristic modal detection** stays (title suffix after the last `" — "` matching
  another live window's title), gated by `heuristic-modal-detect`, default on, and now
  with an integration test.

## 17. Keybindings (frozen surface)

- `undo`, `focus cycle`, the four **focus** directions, the four **move** directions,
  `move window to workspace` (next, previous, and by index), `float toggle`,
  `nudge resize` (**both axes**), `fullscreen toggle`, `close focused`.
- **Focus never crosses a workspace.** A **move** may: it is the only keyboard way a
  window changes workspace, and `follow-moved-window` (default **on**) decides whether
  the view follows it.
- Nudge is a no-op on a lone maximized window (nothing to split) and on a
  single-workspace screen with no free slot.
- **An impossible request is announced, never silent**: moving a window to the next
  workspace while its screen has only one raises a plain-language notification, as
  does an undo with nothing to revert. Notifications follow the catalogue's
  deduplication and rate limits (§21).
- View switching (Super+1..9, Super+arrows) stays GNOME's.

## 18. Animation policy

- `disable-animations` turns off **everything**, including GNOME's own animations
  (the Shell-wide `St.Settings.enable_animations`) as well as adrt's frame animations
  and workspace slides.
- With animations enabled: every model-driven geometry change animates using
  `animation-duration`; our own workspace slides are **clone-free** (the
  `animateSwitch` exception) so no window is ever drawn twice; the close ghost keeps
  its settings.
- The previous **maximise → workspace-switch** behaviour is the reference: the view
  changes without clones and the window's own geometry animates. No jumps, no doubles,
  no overshoot.

## 19. Session modes

- **Lock/unlock** pauses *new* work, hides the highlight, and **lets the queue finish
  what is already in it** — nothing is dropped — then retiles once on resume.
- **Screen sharing** keeps tiling and hides the highlight.
- **Suspend** is treated as lock.

## 20. Startup, adoption and enable-time normalisation

- **On every enable, including mid-session**, each existing workspace is normalised
  from the **visible surface** of its managed windows (a rect minus whatever is
  stacked above it). Three branches, in order:
  - one managed window: it is **maximized** (the lone law);
  - one window **dominates** — it covers at least **three quarters of the work
    area** — it is **maximized** and **every other managed window on that workspace
    is minimized**;
  - otherwise the **two** windows with the most visible surface become the **pair**
    (the leftmost one takes the left slot) and the rest are **minimized**.
  Floats and dialogs are not normalised, and a **fullscreen** window is left
  untouched at enable: it is the "does not fit" case and moves only on its own
  transition (§16). The three-quarter threshold is a named constant so the tests can
  vary it.
- Otherwise, existing windows are **adopted without being moved** until the first
  drain, and the first lane-2 drain waits for `startup-complete`.
- A window that opens on a workspace the user is **not** viewing is routed **in that
  workspace** (tiled there, silently); only a window that opens on the workspace being
  viewed can move the view, and only by creating a workspace to the right (§3).
- Display memory may additionally put a window back on the **connector** it was on when
  that connector is present at enable time (§9). There is no other session restore.
- The first-run notification is kept, with `first-run-complete`.

## 21. Debug notifications (the decision catalogue)

Each entry is a checkbox in the debug settings; when ticked, that decision raises a
live notification phrased as the decision itself, so the logic can be followed as it
happens. All default off, deduplicated and rate-limited per event.

| Notification | When |
| --- | --- |
| *"Workspace full → created one to the right"* | routing overflow |
| *"Window did not fit → maximizing on the next workspace"* | the escape rule (§16) |
| *"A client refused the split → the sibling adapted"* | §10 step 2 |
| *"The sibling could not adapt → own workspace"* | §10 step 3 |
| *"No room on this screen → floating"* | single-workspace / fixed-workspace overflow |
| *"Maximizing → moving it to its own workspace"* | §4 |
| *"Minimizing the other windows on this screen"* | §4, single-workspace maximise |
| *"Only a minimized window left → moved to the left workspace"* (or *… to the right one*, or *… nowhere to move it, the workspace stays*) | §4 |
| *"Empty workspace reaped"* | §5 |
| *"Undo is no longer possible: the window is gone"* | §13 (also a user-facing toast) |
| *"Highlight suppressed: <reason>"* / *"Highlight released"* | §11 |
| *"Screen changed: <connector> <appeared|vanished>"* | §9 |
| *"Normalised <n> workspaces"* (one summary, not one per workspace) | §20 |
| *"No room next to it → parking it minimized on the neighbouring workspace"* | §4 |
| *"Cannot move: this screen has only one workspace"* | §17, the impossible request |
| *"Nothing to undo"* | §13 |

## 22. Journal and instrumentation

- The journal is **append-only, one file per day, kept for at most 30 days**, rotated
  by size into numbered parts exactly like the event history, with an in-memory tail
  for `DumpEvents`.
- Every entry carries a **monotonic sequence shared with the decision log**, so a
  decision can be followed across the file.
- Instrumentation is placed where it matters for later optimisation: the queue (depth,
  drain time, items per drain), planning (plans computed), application (latency,
  retries, refusals), host lookups, identity resolution, and journal writes. The Stage
  0 counters remain the base.

## 23. Decisions log

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
6. **Unmaximize** joins the left workspace when it holds exactly one window (the
   result is a pair), else the right when it does; failing that the window is
   minimized and moved into the left workspace if it holds windows, else the right,
   else it stays.
7. **Minimize releases the slot** while the window is hidden; a workspace left
   holding only minimized windows has that window moved into a neighbour that holds
   windows (left, else right, else it stays).
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

24. **Classification** is ported as §16: never-managed categories stay untouched,
    always-on-top floats (reversing A61), dialogs float/centre/raise, and the escape
    for a window that does not fit is **its own workspace**, not a float.
25. **Keybindings** are frozen with a workspace-move shortcut (the only keyboard
    workspace change), `follow-moved-window` default on, and nudge on both axes.
26. **`disable-animations` disables everything**, GNOME's animations included.
27. **The queue finishes what is in it** when the session pauses; nothing is dropped.
28. **Enable-time normalisation** runs on every enable with §20's two-branch rule: a
    dominating window (at least three quarters of the work area) maximized, else the
    top two by visible surface paired; the rest minimized.
29. **Debug notifications** are per-decision checkboxes phrased as the decision (§21),
    and the journal is append-only per day with 30-day retention (§22).
30. **A minimized window left alone** is relocated left, else right, else left where it
    is — and the workspace is then allowed to persist holding only minimized windows,
    because there is nowhere to put it. This is the second exception to §5's packing
    rule (the first being the spare).
31. **Scenario review confirmed** (§3, §4, §5): a workspace created by routing is
    inserted **immediately right of the active one**, pushing the spare right;
    unmaximize accepts only a neighbour holding **exactly one** window (joining an
    empty one would re-maximize the window and change nothing), and failing that
    parks the window minimized left, else right, else in place; and a workspace
    emptied by the last close is reaped with the view moving to the nearest
    workspace that holds windows.
32. **Enable-time normalisation is two-branch** (§20): a dominating window (at least
    three quarters of the work area) is maximized with every other managed window on
    its workspace minimized; otherwise the **two** largest by visible surface become
    the pair and the rest are minimized. A single window is maximized, and fullscreen
    windows and floats are left untouched at enable.
33. **Slots are held only while a window is visible** (§5): minimizing releases the
    slot, a new window takes it and splits with the visible partner, and restoring
    with no free slot floats. This replaces the earlier "a minimized window still
    counts" reading and removes the invented "park" concept — a minimized window
    never holds a slot anywhere.
34. **A user move onto a full workspace floats the moved window there** (§6, §17):
    the destination is the user's choice, and a float honours it without evicting
    anyone. The minimized park survives only inside our own unmaximize.
35. **Both the unmaximize park and the alone-minimized relocation target a
    neighbour that holds windows** (§4) — a free slot is not required, and an empty
    neighbour is never a target, since the window would be alone there.

36. **A disconnect rescue preserves the vanished screen's arrangement** (the test
    scenario confirmed it): its windows come back as workspaces inserted immediately
    right of the current one, keeping their order and pairing, and never scavenge free
    slots on workspaces that were not theirs; the view does not move.

37. **The maximize/fullscreen round trip is exact** (test scenario S6): a window
    maximized onto its own workspace and then unmaximized rejoins its former pair,
    the workspace it left is reaped, and the view returns.

38. **Routing is not an undoable change** (S7): a newly opened window was never on
    another workspace, so undo leaves it exactly where it is and acts on the previous
    change, or reports that there is nothing to undo.

39. **The spare is GNOME's, and routing is per arrival** (S8, S9): a window opening
    while viewing the spare occupies it and GNOME appends a fresh spare; two windows
    opening together give a maximized single and then a pair, never a new workspace.

40. **The primary is always GNOME's current primary**, re-read whenever it changes;
    adrt never assumes, stores or sets it (S10).

41. **Slot order when a pair forms** (test scenarios S12, S13): the window the change
    is about — restored from minimized, unmaximized into a pair, moved, dragged or
    routed — takes the **right** slot when it is free, else the left. The window it
    joins keeps its side, and minimized windows returning from the same unmaximize
    take the left first. Restoring A onto a lone B gives `B | A`; maximizing `A | B`
    and then unmaximizing A also comes back as `B | A`.

42. **An overview drag between workspaces** (test scenario S14): the dropped window
    joins the target by the pair rule (`C | B` onto a maximized single), its former
    workspace keeps its survivor maximized and is reaped only if it is now empty, and
    the view stays on the workspace the drag started from; a drop onto a full pair
    floats.

43. **The pair axis follows the workspace layout** (test scenario S15): horizontal
    workspaces stack side by side (slot 0 left, slot 1 right); vertical workspaces
    stack top/bottom (slot 0 top, slot 1 bottom) and so do portrait screens. The
    arrival rule puts the newcomer in slot 1 (the bottom, with vertical workspaces);
    directions act on the pair's own axis first; gaps follow the axis.

44. **A window opening on a workspace that is not being viewed is routed there**
    (test scenario S16): tiled into a free slot, or maximized on a workspace created
    immediately right of that one when it is full. The view never moves and the
    window is never pulled onto the viewed workspace; a workspace whose only window
    is minimized counts as free.

45. **Fullscreen in the middle of a pair** (test scenario S17, confirmed with the
    order `A | B` on exit): the fullscreen window gets a workspace immediately right
    of its own, its geometry is untouched while fullscreen, the other half of the
    pair maximizes, and the view follows. On exit it rejoins as slot 1, the workspace
    it left is reaped and the view returns. An app's own fullscreen request and the
    shortcut are identical.

46. **Impossible requests are announced** (test scenario S18): moving a window to
    the next workspace while its screen has only one workspace, and an undo with
    nothing to revert, both raise a plain-language notification rather than failing
    silently. A single-workspace-capable screen has exactly one workspace — there is
    no hidden next one — which is why the move is impossible there while it works
    normally with focus on the workspace-capable screen.

47. **A cross-screen arrival keeps the side it came from** (the user's refinement
    after S19): a window crossing an edge takes the slot on that side — left or above
    → slot 0, right or below → slot 1 — instead of the within-workspace slot-1
    default. The direction is known for a drag and for a directional move; a
    perimeter crossing still swaps; a full target still floats. A window that ends up
    alone on the target still maximizes - the side rule only decides the slot once a
    pair forms. The directional move key follows the same side rule.

48. **Minimizing the only window of a workspace** (test scenario S20): the window is
    minimized into the left neighbour that holds windows, else the right one, else it
    stays where it is. The workspace it left is empty and is removed, and the view
    (which was on it) moves to the workspace the window went to.

49. **Focus crossing screens is positional** (test scenario S21): focus right from the
    bottom half of a stacked pair lands on the window at the same height on the next
    screen, never on the first window there.

50. **Maximizing a float** (test scenario S22): the float maximizes in place, on top of
    the tiling, and stays a float. adrt neither un-floats it nor gives it a workspace.

51. **A resizing client keeps its minimum** (test scenario S23): dragging the inner
    edge past a client's minimum stops at that minimum and the sibling takes the rest;
    nothing is created, nothing floats, and the refusing window is not moved.

## Deliberate non-goals



- Per-app geometry learning; "stubborn" suppression of tiling.
- Repacking workspaces after a user reorder; removing the spare.
- Changing the primary monitor.
- A multi-entry or persisted undo history.
- Any policy that runs inside a Mutter signal handler.
