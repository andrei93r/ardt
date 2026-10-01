# Adrt v2 — stage checklist

**Behaviour** lives in `docs/V2_MODEL.md` (decisions 1–89, closed). **The core tests
come from** `docs/V2_TEST_MATRIX.md` (generated: 137 seeds → about 9 000 cases).
**This file is the order of work** — the thing to follow.

**Maintenance.** Tick the boxes as items land. Add or remove items as the work teaches
us; a removal gets one line saying why. `scripts/plan-status.py` refreshes every counter
from the boxes (run it after each edit). A stage is done only when every box under it is
ticked and its target runs pass.

## Progress

<!-- plan-status -->
| Stage | State | Done | Commit |
| --- | --- | --- | --- |
| 0 Grounding and event-confirmed triggers | done | 17/17 | — |
| 1 Queue mechanism and records | done | 7/7 | — |
| 2 The model: slots, routing, maximise, emptiness | not started | 0/18 | — |
| 3 User-driven interactions | not started | 0/8 | — |
| 4 App registry, prefs, migration | not started | 0/11 | — |
| 5 Displays and hotplug | not started | 0/7 | — |
| 6 Undo, flags, replay | not started | 0/6 | — |
| 7 Monitor matrix and vertical | not started | 0/5 | — |
| 8 Docs, dead code, perf re-scope | not started | 0/5 | — |
<!-- /plan-status -->

## Tonight on the laptop (no server yet) (4/7)

- [x] `npm run build` and `npm run lint` clean
- [x] `npm run test:core` green
- [x] nested smoke: one nested Shell, one scenario (`A01`)
- [x] the full agent suite on the nested harness — record passes and skips
- [ ] Stage 0 failing tests in place (`A80`–`A83`, and `A22`–`A24` un-skipped)
- [ ] Stage 0 implementation landed
- [ ] every suite green again, the plan ticked, and a short report written

Notes (baseline green 2026-10-01: build, lint, 151 core tests, 71 scenarios, 3 skips, no journal errors). Nested harness only tonight; the live session stays yours. No reloads, no logout,
and the laptop stays awake while a run is in flight.

## Stage 0 — Grounding and event-confirmed triggers (no behaviour change) (17/17)

**Failing tests first**

- [x] `A80-platform-probe` — fails today: no `ProbePlatform` call exists
- [x] `A81-four-monitors` — fails today on the hard-coded `1281x801`/`monitors[0]`
- [x] `A82-event-journal` — fails today: no `DumpEvents`
- [x] `A83-injected-drag-is-event-confirmed` — fails today: no injection
- [x] `A22`/`A23`/`A24` un-skipped by injection (they skip today for lack of a seat)

**Implementation**

- [x] `docs/platform-notes.md`: public/private/never API table (GNOME 48–50) plus the
      documented exception list (`animateSwitch`, `_swipeTracker`, accept-client-rect)
- [x] `ProbePlatform` D-Bus: capability JSON (laters, monitor matrix size, `layout_rows`,
      virtual input, RemoteDesktop/EIS)
- [x] **Event journal**: ring buffer `{seq, source, event, at}` from the two signal
      wrappers and the history funnel; one monotonic sequence shared with decisions;
      `DumpEvents(n, filter?)`
- [x] **Journal format**: append-only, one file per day, 30-day retention, numbered parts
      rotated by size, in-memory tail
- [x] **Input injection** behind `debug-input` (default off): in-process
      `Clutter.Seat.create_virtual_device()`; a long-lived `RemoteDesktop` client for
      `session-like`
- [x] **Trigger hygiene**: verified — `platform/dbus.ts` declares the whole surface and
      the names follow the three-kind rule (`Inject*` real input, `Simulate*` extension
      state, a plain name for a real Mutter action), so no aliases are needed
- [~] `scripts/server-test.sh` — **struck**: the headless server is not set up yet; the
      laptop runs `scripts/agent-test.sh`. It returns with the server (see §Targets).
- [x] **Debug notification catalogue** (model §21): one checkbox per decision, phrased as
      the decision, deduplicated and rate-limited
- [x] **Harness**: one shared `tests/lib/common.sh` plus a **manifest** of every scenario
      with its per-target capabilities and recorded skips — no silent skips
- [x] **`DumpState` instrumentation**: per window `slot`, `screenAxis`, `gaps`, the
      suppression set and `focusedReason`; `SimulateScreens` + `SimulateWorkArea`;
      `DumpDecisions`
- [x] A tiny PyGObject **refusing test client** plus notification capture (so the toast
      policy is testable)
- [x] Spec/CHANGELOG notes for the trigger rename

**Target runs**

- [x] `headless` (A80–A83, A22–A24) · `session-like` (A22–A24 + injection smoke) ·
      `session` (A22–A24 via real input)
      — done: 75 scenarios green twice on one monitor (the only skip is `A81`, which
      needs four screens by design) and **75/0/0 on the four-monitor matrix**. The
      `session-like` target cannot run on this laptop (`gnome-settings-daemon`,
      `xdg-desktop-portal`, `polkitd`, `gnome-remote-desktop` are not installed) — it is
      recorded in `tests/MANIFEST.md`; the live `session` run is the user's.

Notes: a refactor stage — the existing suite must stay green throughout.

## Stage 1 — Queue mechanism and records (behaviour identical) (7/7)

**Failing test first**

- [x] `A84-burst-single-drain` — a burst of frame signals produces exactly one drain and
      the same final geometry

**Implementation**

- [x] `core/queue.ts`: `Map<lane, Map<key, event>>` — lanes 1 feedback / 2 layout /
      3 maintenance; per-key coalescing; `push/drain/pending/depth`; injected clock
- [~] `core/record.ts` — **moved to Stage 2, with a reason**: the policy that would own
      the plain records is `session.ts`, which Stage 2 rewrites; adding the module now would
      ship an abstraction with no consumer, and the predicates already live in
      `core/classify.ts`. `core/record.test.ts` arrives with it.
- [x] Adapter: one deferred drain, **armed on demand and removed when empty** — lane 1 on
      `BEFORE_REDRAW`, lane 2 on `META_LATER_RESIZE`, lane 3 on `IDLE`; ids tracked and
      removed on `disable()`; `mutatingWorkspaces` guard
- [x] Convert `scheduleReconcile`, `scheduleRetile`, the `addTimeout` users, the motion
      watch, the coherence sweep and the drag watchdog to pushes and drains
      — done for the policy paths; the timers that remain only *gate* (the motion tick's
      periodic pass, the post-close sweep), and the drain waits out a running animation
- [x] `core/queue.test.ts` (13 tests). `core/record.test.ts` arrives with the module.
- [x] **Config caching**: the classifier config is memoised and invalidated on any change
      (A66 proves the ratio: tens of classifications per rebuild, against hundreds before).
      The remaining rebuilds are legitimate writes; the sweep of what writes at runtime goes
      to the Stage 8 re-measure

**Target runs**

- [x] `headless` (the whole existing suite + A84) · `session-like`/`session` (S01–S14
      unchanged)
      — done: 76 scenarios, 0 failures, 3 recorded skips on one monitor, and 75/0/0 on the
      four-monitor matrix. Two skips are v1 rules **retired with a reason** because the v2
      model deletes them (float-over-pair: A50, A59 → replaced by A90/A113); the third is
      A81 needing four screens. The harness now defaults to half the cores, because this
      laptop also runs a live session and the timing-sensitive scenarios starve at full load

## Stage 2 — The model: slots, routing, maximise, emptiness (0/18)

**Failing scenarios first**

- [ ] `A85-right-slot-and-split` · `A86-create-right-and-maximise` ·
      `A87-nothing-is-evicted` · `A88-maximise-owns-a-workspace` ·
      `A89-maximise-in-place-minimises-others` (single workspace via
      `dynamic-workspaces=false` + `num-workspaces=1`) ·
      `A90-unmaximise-joins-pair-forming-left` ·
      `A91-unmaximise-parks-when-no-neighbour-can-pair` ·
      `A92-single-workspace-split-then-float` · `A93-empty-workspace-reaped`
- [ ] `A106-no-cross-monitor-exile` (the observed bug)
- [ ] `A113-trigger-wins-and-trades` · `A114-fullscreen-in-place-minimises` ·
      `A115-look-empty-workspace-is-free` · `A116-escape-clamped-own-workspace` ·
      `A117-arrival-side-rule` · `A118-nothing-happened-toasts`

**Implementation**

- [ ] `core/placement.ts`: `routeNewWindow(state, rec, env) → { workspace, slot }`;
      `canHostWorkspaces(env)` read from GNOME (dynamic / one / static — never from
      internal vs external)
- [ ] The **arrival rules** (§3): slot 1 by default; the slot on the side it came from
      for a screen or workspace move; a lone arrival still maximizes
- [ ] The **view policy** (§3): the view follows the app the action is about, only on the
      viewed workspace; a reactor never moves it
- [ ] The **toast policy** (§21): a request that changes nothing toasts with its reason;
      a direction with nothing stays silent
- [ ] **Adoption** (§20): existing windows adopted without being moved until the first
      drain, which waits for `startup-complete`
- [ ] `core/workspaces.ts`: `workspaceOps(state, env) → { create, reap }` with the single
      trailing spare (global, GNOME's own) and emptying as a property
- [ ] Adapter: routing and reaping only from the lane-2 drain; windows on a screen
      without workspaces are **not** given a workspace index
- [ ] Delete: the `>2` extra branch, `floatOverPair`-as-eviction, `unmaximizeStaleLone`,
      `returnFromMaximize`, `previousWorkspaceIdx`, the minimise-slide, the old
      `pruneEmptyWorkspaces` rules, `EXILE_COOLDOWN_MS`, the spawn budget +
      `core/budget.ts`, `workspaceOpDepth`
- [ ] Maximise (§4), unmaximise (§4), single-workspace flow (§7) and float rules (§6);
      remove `workspace-auto-name`, `workspace-move-grace-seconds`,
      `respect-user-workspace-move`
- [ ] Keybindings (§17) and the gschema they need: the workspace-move shortcuts, the float
      key, nudge on both axes, `follow-moved-window`
- [ ] **The escape rule**: a managed window that does not fit its slot gets its own
      workspace to the right, clamped to [1/6, full screen]; the trigger keeps the screen
- [ ] **Classification ported**: always-on-top floats (reversing A61), dialogs and
      transients float/centre/raise, an app mapping itself maximized is unmaximized and
      tiled, fullscreen is the "does not fit" case
- [ ] `core/placement.test.ts` + `core/workspaces.test.ts` (~28 cases)
- [ ] The scenario set rewritten or retired (table in the CHANGELOG) with spec/README
      §7/§9/§16/§35/§21 in the same commits

**Target runs**

- [ ] `headless` (new + rewritten) · `session-like` (S02/S04/S05/S14 rewritten) ·
      `session`

## Stage 3 — User-driven interactions (0/8)

**Failing scenarios first**

- [ ] `A94-overview-drop-onto-full-floats` · `A95-restore-onto-full-floats` ·
      `A96-reorder-is-honoured-and-an-empty-workspace-is-pruned` ·
      `A97-drop-onto-single-maximised-splits` ·
      `A107-cross-monitor-drag-takes-the-free-slot-or-swaps` ·
      `A108-maximised-drag-still-maximised-at-drop` · `A119-float-key-leaves-in-place` ·
      `A120-dialog-centred-and-raised` · `A121-focus-cycle-order`

**Implementation**

- [ ] Real-grab drag path (Stage 0 injection) driving the swap-on-perimeter-crossing,
      now slot-aware; the slot decision uses the window's rect centre and a re-read frame
- [ ] Cross-monitor drops: monitor chosen by Mutter (centre rule); **a free slot wins**
      (on the side it came from); a crossing swaps only when there is no free slot; no
      room floats it there; a maximized window is un-maximized at the drop
- [ ] A user reorder is **honoured exactly** — no correction, no tagging, no toast;
      reaping is a property, so an empty workspace is pruned wherever it sits and the
      spare is never removed
- [ ] Overview drops: onto a maximized single it splits; onto a full pair it floats; onto
      the empty trailing workspace it maximizes there and GNOME adds a new one
- [ ] The **focus cycle** and the float cycle order (managed in slot order, then floats
      left to right, perfect overlaps by stacking order; minimized skipped)
- [ ] Animation pass (§18): clone-free slides, no doubles, the reference
      maximise → workspace-switch behaviour

**Target runs**

- [ ] `headless` (real grabs) · `session-like` · `session` (S13, real drags)

## Stage 4 — App registry, prefs, migration (0/11)

**Failing scenarios first**

- [ ] `A98-registry-lists-every-app` · `A99-neverTile-floats` ·
      `A100-placements-survive-recreation` · `A15` rewritten (a refusing client is
      accepted and **no minimum is learned**)

**Implementation** (the pure modules are parallelisable)

- [ ] `core/identity.ts`: desktop id → sandboxed id → gtk id → AppImage ancestor →
      `wm_class` → session-only, plus normalisation
- [ ] `core/appregistry.ts`: entry shape, `neverTile` precedence, ordinals, migration from
      `adaptation.json` + `behavior.json` + `exception-apps`, pruning/TTL
- [ ] Adapter: populate on every window; resolve at first frame; re-key on
      `tracked-windows-changed`/`notify::wm-class`; adaptation **timing-only**;
      placements per instance id with the ordinal roll-up
- [ ] Prefs page for the registry (replaces the problem-windows page); settings migration
      + `EXTENSION_VERSION` bump; `tile:` rule modes dropped
- [ ] **State migration**: `BUNDLE_VERSION` 3→4 with a reader for the old bundle,
      copy-verify-delete, no destructive downgrade
- [ ] Disabling leaves every window exactly as it is; enabling normalises
- [ ] **New settings**: `follow-moved-window` (on), `float-pins-workspace` (on), per-side
      gaps plus the between-window gap, `disable-animations` extended to switch off
      GNOME's animations too, and the `debug` checkboxes; remove `undo-stack-size`,
      `workspace-auto-name`, `workspace-move-grace-seconds`,
      `respect-user-workspace-move`
- [ ] **Enable-time normalisation** (§20), three branches: one managed window → maximized;
      a window covering **70% or more** of the work area → maximized with the rest
      minimized; otherwise the top two by visible surface pair up and the rest are
      minimized — on every enable including mid-session, floats and fullscreen untouched
- [ ] Pure tests: identity per packaging format (AppImage ancestors, Chromium's zeroed
      environment), re-keying, precedence, migration, ordinals (~20)

**Target runs**

- [ ] `headless` · `session-like` (real apt/flatpak/snap apps) · `session`

## Stage 5 — Displays and hotplug (0/7)

**Failing scenarios first**

- [ ] `A109-disconnect-routes` · `A110-reconnect-replays-state` ·
      `A111-primary-change-keeps-slots-and-the-extra-window-floats` ·
      `A112-workarea-change-replans-one-monitor` · `A122-rescue-side-and-order`

**Implementation**

- [ ] `core/displays.ts`: `displayPlan(prev, next, memory, env) → { moves, remember,
      forget }`; disconnect routing; reconnect replays the monitor's previous state; TTL;
      never sets the primary
- [ ] Adapter: `monitors-changed`/`workareas-changed` → lane 2; `SimulateScreens`
      fixture; `startup-complete` gating
- [ ] Rescue rules (§9): as many workspaces as needed, inserted on the physical side the
      screen was on; a reconnect replays the arrangement; a screen without workspaces
      ignores a workspace switch, silently; the primary and the screen classes are read
      from GNOME, never inferred from the connector
- [ ] Live `S17-dock-drill` (assisted, `ADRT_DOCK_TEST=1`); `S15` extended
- [ ] Pure `displayPlan` tests (12+)

**Target runs**

- [ ] `headless` (fixtures) · `session-like` · `session` (physical hotplug)

## Stage 6 — Undo, flags, replay (0/6)

**Failing scenarios first**

- [ ] `A101-undo-restores-instance-and-config` · `A102-undo-toasts-when-impossible` ·
      `A103-record-trace-shape` · `A104-queue-depth-returns-to-zero` · `A123-session-modes`

**Implementation**

- [ ] Undo: one in-memory entry, per instance + configuration + ratios — including a
      **swap** (two instances) and an **un-float** (the float flag); validate everything
      before applying; toast on impossibility; drop `undo-stack-size` and the persisted
      stack; a routed new window is not an undoable change
- [ ] Session modes (§19): lock/unlock pauses new work, lets the queue finish, then
      retiles once; sharing keeps tiling and hides the highlight; suspend is lock
- [ ] Flags: `debug.*` per subsystem; `record` (journal + decisions → a replayable
      trace); `perf.*` (queue depth, drain time, apply latency, p50/p95); `DumpDecisions`
- [ ] `core/replay.ts` plus a determinism test (a recorded trace replayed through the
      planners gives identical decisions)

**Target runs**

- [ ] `headless` · `session-like` · `session` (S03)

## Stage 7 — Monitor matrix and vertical hardening (0/5)

**Failing scenarios first**

- [ ] `A105-per-screen-axis` (portrait and landscape in one session) and the matrix runs
      of A01/A14/A64 rewritten to derive their bounds from the actual monitors

**Implementation**

- [ ] Geometry-based `moveToAdjacentMonitor`; per-screen split axis; remove the hard-coded
      `fallbackScreen`/`dummyScreen`; full surface refresh and classification
      invalidation on `screens-changed`; host connector/primary keyed by real index;
      `monitors[0]`/`1281x801` literals removed from scenarios
- [ ] CI matrix over `ADRT_MONITORS` variants (1 landscape, 1 portrait, 2 mixed, 4 mixed,
      each primary in turn) plus `layout_rows=-1`
- [ ] The pair axis under `layout_rows=-1` (stacked), the focus cycle order, the float
      cycle order, and the animation pass on real hardware

**Target runs**

- [ ] the matrix on `headless` · `session-like` · `session` (real monitors)

## Stage 8 — Docs, dead code, perf re-scope (0/5)

- [ ] `spec.md`/`README.md` superseded sections deleted with a pointer to `V2_MODEL.md`;
      metadata description and version updated
- [ ] Dead code and dead settings from the inventory removed; the float representation
      unification finished
- [ ] `PERFORMANCE_PLAN.md` re-scoped: carry its Stage 1 (config caching) and Stage 2
      (O(1) host lookup) onto the new code; delete its Stage 3 and the sweep back-off;
      re-measure with the existing counters
- [ ] A long mixed run asserting no `invariant_violated` entries in the journal

**Target runs**

- [ ] `headless` + `session-like` + `session` full runs, recorded

# Reference (not checkboxes)

## Rules of engagement

- One stage = one commit series. A stage is done only when every box under it is ticked,
  including its target runs.
- **TDD for behaviour** (stages 2–6): write the failing scenarios **first**, run them,
  confirm they fail *for the intended reason*, then implement. The test commit precedes
  the implementation commit.
- **Bug fixes always get a regression scenario** that fails before and passes after, on
  both targets.
- **Refactors** (0, 1, 7, 8) prove no difference by leaving the existing suite unchanged
  and green.
- **Every scenario runs on both targets** through one API: `headless` (the nested Shell,
  fast, isolated, matrix, fault injection) and `session` (a real GNOME instance — the
  VM's session-like target and/or the laptop). Capability gaps are explicit skips with a
  recorded reason, never silent.
- `DumpState` is **add-only per commit**: a key is removed or repurposed only by the
  commit that updates every scenario reading it.
- Triggers are honest: `Inject*` = real input through Mutter; a plain command = a real
  Mutter API; `Simulate*` = extension state only. Every Mutter signal handler writes to
  the **event journal**, and tests assert the *event*, not just our function.
- `core/` stays pure (`scripts/check-core-purity.sh`); new logic lands there with unit
  tests.
- No policy runs inside a Mutter signal handler — ever. Workspace mutations only from the
  lane-2 drain.
- Deletions (settings, features, scenarios) are listed in the CHANGELOG in the commit
  that removes them.

## Test families the model requires (each with its variations)

Every feature and every fix lands with a **family** of tests, not a single case: one and
two screens; workspace-capable, single-workspace-capable and fixed-workspace; landscape
and portrait; `layout_rows === -1`; real apps; the refusal path; and the
misbehaving-client path.

**The generated matrix is the source.** `scripts/core_seeds.py` holds one logical case
per model rule and `scripts/gen-core-cases.py` expands it across screens, geometry
profiles, the pair axis, positions, order and extras — 137 seeds to about 9 000 cases,
catalogued in `docs/V2_TEST_MATRIX.md`. A stage's tests are written from the matching
family there, seeds first, so the variations exist before the implementation does.

- **routing**: right slot; split into a maximized single; create-to-the-right;
  per-screen (never yanked); fixed-workspace routing; no creation on single/fixed
  screens; the escape rule; a window opening beside a fullscreen one.
- **packing and reaping**: pair → close one → survivor maximized; close the last → reap
  and the view moves; a drop that empties a workspace → reap; a reconnect that empties
  one → reap; the spare is GNOME's and is never removed; a reorder of loaded workspaces
  survives; the last workspace may stay empty.
- **minimize law**: the slot is released while the window is hidden, a new window takes
  it and splits with the visible partner, and restoring with no free slot floats; then
  the three branches of the alone-minimized rule — moved into a neighbour that holds
  windows, else into the right one, else left in place with the workspace allowed to
  persist; a workspace that only looks empty is free for a newcomer.
- **maximize / unmaximize / fullscreen**: own workspace to the right; in place with the
  others minimized on a single-workspace screen (fullscreen too); unmaximize joins a
  neighbour only when it holds **exactly one** window (left first, then right), and
  otherwise moves it minimized into a neighbour that holds windows (left, else right,
  else it stays); already maximized → nothing happens and a toast; fullscreen recorded
  and restored.
- **the trigger wins**: a split that cannot exist leaves the app the action was about on
  the screen (alone, so maximized) and the reactor gives way — its own clamped
  workspace, or minimized on a screen that has none; the two trade when one is restored.
- **resize / refusal ladder**: the sibling follows an inner-edge drag; a refusing client
  keeps its size and the sibling adapts; if the sibling cannot adapt either, the trigger
  keeps the screen and the other gives way.
- **drags and drops**: inner edge = ratio; a slight overlap swaps a pair; a **free slot
  wins over a crossing**; a crossing swaps only with no free slot; no room → float where
  it was dropped; a maximized window un-maximized at the drop; the slot on the side it
  came from, across screens and across workspaces.
- **floats**: the float key leaves the window exactly in place; a user move onto a full
  workspace floats there; a restore onto a full workspace floats; overflow floats; a
  float adrt places is offset and kept clickable; a user-placed float is untouched; a
  float pins its workspace; floats are selectable by the cycle but never counted in a
  drop; dialogs float, centred on their parent, raised; `neverTile` always floats.
- **gaps**: per-side and between-window, both orientations; a gap change re-fits by ratio.
- **work area**: top bar; a fixed dock; an autohiding dock (reserves nothing); a
  transient `-1×-1` reading; a stale index (the Mutter assertion class); an out-of-range
  index; the settle after `workareas-changed`; a primary that changes; every surface
  change re-fits the windows by ratio.
- **undo**: instance + configuration + ratios, a **swap** (two instances) and an
  **un-float**; recreating a deleted workspace; the toast when an instance is gone or a
  slot was taken; a routed new window is not an undoable change.
- **directions and focus**: same-plane focus and move; across a screen edge with a
  positional match; onto a portrait screen and back; never a workspace switch; a
  direction with nothing stays silent; the cycle walks the current screen and workspace —
  managed windows in slot order, then floats left to right, minimized skipped.
- **view policy**: the view follows the app the action is about, and only on the viewed
  workspace; a reactor never moves it; a fixed screen's routing switches to the window;
  a screen without workspaces ignores the switch.
- **toasts**: a request that changes nothing toasts with its reason (already maximized,
  un-float with no room, move on a one-workspace screen, nothing to undo, nothing to
  nudge); a direction with nothing is silent; the catalogue is deduplicated and
  rate-limited.
- **classification**: always-on-top floats; sticky and skip-taskbar windows are never
  managed; an app that maps itself maximized is unmaximized and tiled; dialogs centre and
  raise; an oversized or fixed-size client takes its own workspace.
- **highlight diagnostics**: every transition (focus, each suppression, occlusion,
  workspace switch, overview, close ghost) is journalled with its reason and rect; no
  suppression is left stuck after any event class; the rect follows an animation.
- **enable and disable**: disabling leaves every window exactly as it is; enabling
  normalises on every enable — a window covering 70% or more maximized with the rest
  minimized, else the top two by visible surface paired — with floats and fullscreen
  windows untouched.
- **screen-edge shifts**: axis change, work-area change (primary-only panel strut), gap
  change and occupancy rules when a window or focus crosses between two screens.

## Business logic vs implementation tests

The model's rules are **business logic and are tested as pure core tests** — fast,
deterministic, no Shell and no compositor. The harness scenarios test only the
**implementation**: that the adapter feeds the core the right inputs, applies the
decisions to the right Mutter calls, and produces the right events. A rule that cannot be
expressed as a pure-core test is a rule that belongs further down the stack, so the split
is enforced, not merely encouraged. Behaviour must be identical on `headless` and on a
headful session; the harness proves the same scenarios hold on both.

### Cases the layout round added (each confirmed, each needs tests)

- fullscreen on a single-workspace screen: in place, the other managed windows minimised.
- a split that cannot exist: the trigger keeps the screen (alone, so maximised) and the
  reactor gives way — its own clamped workspace on a workspace-capable screen, minimised
  on a single-workspace screen; the two trade whenever one is restored.
- fixed and static-number screens: nearest workspace with room (right first), the slot on
  the side it came from, the view switching to it; a full screen floats.
- reconnect replays a remembered screen's slots; a window opened in the meantime stays put.
- a primary change moves no window; the extra window from the old primary's other
  workspace becomes a float.
- a screen without workspaces silently ignores the switch.
- an overview drop onto the empty workspace maximises there and GNOME adds a new one.
- restore onto a full workspace floats; a workspace that only looks empty is free.
- a slight overlap when dragging one of a pair onto the other swaps them.
- a dialog floats, centred on its parent, raised; placed floats are nudged off-centre.
- every surface change (dock, bar, screen, gaps) re-fits the windows by ratio.

## Targets and capabilities

| Capability | `headless` (nested) | `session-like` | `session` (real) |
| --- | --- | --- | --- |
| isolated XDG + keyfile settings | yes | yes | no (real state) |
| multi-worker sharding | yes | limited | no |
| monitor matrix (≤4, mixed res/portrait) | yes | yes | real monitors only |
| fault injection (`InjectVerifyFailure`, `SimulateScreens`) | yes | yes | partial |
| perf counters | yes | yes | yes |
| real apps (apt/flatpak/snap) | yes | yes | yes |
| **key + pointer injection** | Stage 0 (in-process Clutter) | Stage 0 (RemoteDesktop) | real input / injection |
| `ydotool` | impossible (no libinput/seat) | impossible | yes |
| journal of the shell | `shell.log` grep | `journalctl --user` | `journalctl` |
| hotplug / dock | no (fixtures + `SimulateScreens`) | no | **yes (physical)** |
| real touchpad gestures, suspend, logind lock, GPU/fractional visuals | no | no | **yes** |

`session-like` launcher: isolated XDG tree + `dbus-run-session -- gnome-session` with
`gnome-settings-daemon`, `xdg-desktop-portal{,-gnome}`, `polkitd`,
`gnome-remote-desktop`; input through one long-lived `RemoteDesktop` client
(peer-checked; `gdbus` cannot inject).

On the laptop the nested harness needs nothing else: `gnome-shell` 50.1 with
`--wayland --headless --no-x11` and `--virtual-monitor`, `dbus-run-session`, `gjs`,
`node`, and the test clients (`nautilus`, `gnome-calculator`, `google-chrome`,
`gnome-text-editor`). `weston`, `mutter` and `xvfb` are not needed.

## Parallel work policy (conflict minimisation)

- **Serial backbone.** `src/adapters/gnome/extension.ts` is touched by every stage,
  `host.ts` by seven; stages 1–3 all mutate the tiling/session/record path. Those run
  **serially**, single writer, one worktree.
- **Parallel-safe by construction**: research and verification (read-only agents); **new**
  `core/` modules with their tests (`queue`, `record`, `placement`, `workspaces`,
  `identity`, `appregistry`, `displays`, `replay`) — additive files, no overlap; **new**
  scenario files; docs and the CHANGELOG.
- One git worktree per parallel task: `git worktree add /tmp/opencode/wt-<name> -b
  v2/<name>`; each runs with its own `ADRT_BASE_STATE`; each branch lives under a day and
  merges in stage order.
- Only one branch may touch a hot file at a time; before editing one, check that no
  unmerged branch touched it (ownership table below).
- One committer at a time (shared `.git` index): merges and commits are serialised even
  when the work is parallel.
- After every merge: run the full `headless` suite before starting the next merge.

Hot files needing serialisation: `extension.ts` (all), `host.ts` (0,1,2,3,5,7,8),
`session.ts` (0,1,2,4), `tiling.ts` (1,2,3,6), `settings.ts` (0,2,4,5,6), the gschema,
`dbus.ts` + `platform/dbus.ts` (0,5,6), `core/config.ts` (2,4,6,8), `core/types.ts`
(1,2,5,7), `core/tiler.ts` (2,3,7), `history.ts` (0,4,6), `surface.ts` (1,4,5,7),
`prefs.ts` (4,5,6,8), `tests/agent/lib.sh` (0,4,5,6), `spec.md`/`README.md` (2,8).

## Decisions (plan-level; behaviour is the model's)

- **Targets**: `headless` (the nested Shell), `session-like` (an isolated GNOME session)
  and `session` (a real one), with capability gating. `session-like` is what "a real GNOME
  instance" means for everything except real touchpad gestures, suspend/resume, physical
  hotplug, logind lock and GPU/fractional visuals, which are mandatory-on-hardware checks
  before a release.
- **TDD**: super strict — failing tests with their variations first for every feature and
  fix; a stage's tests must pass on `headless` **and** `session-like`; the hardware run is
  a tracked pending line.
- **A drop, in order**: a **free slot wins** (on the side the window came from); only with
  no free slot anywhere does a perimeter crossing **swap**; otherwise the window floats
  where it was dropped.
- **Parallel work**: research, new `core/` modules and new scenario files only, each in
  its own worktree; hot files single-writer; one committer; the suite runs between merges.
- **Checklist home**: this file, mirrored at `~/.opencode/plan/v2-plan.md` (a symlink).
- **Reorder prohibition dropped**: user reordering is honoured with no correction, no
  tagging and no toast (model §8); reaping is a property, so an empty workspace is pruned
  wherever it sits and the spare is never removed.
- **Behaviour is the model's**, not this file's: the 89 decisions in `docs/V2_MODEL.md`
  §23 settle everything the layout round raised — the trigger wins a split that cannot
  exist, a free slot wins over a perimeter crossing, a request that changes nothing toasts
  (a direction with nothing stays silent), the focus cycle covers managed windows then
  floats left to right, a float is only ever made explicitly, disabling leaves every
  window as it is, and enable-time normalisation uses the 70% threshold.
