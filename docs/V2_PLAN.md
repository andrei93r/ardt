# Adrt v2 — implementation plan (staged)

Companion to `docs/V2_MODEL.md`, which is the authority for *behaviour*. This file
is the authority for *order of work* and for what each stage must prove.

Status: **awaiting the user's go/no-go.** Nothing in this plan has been started
beyond the two completed infrastructure items noted in Stage 0.

Branch: `perf/reduce-work` (rename to `v2` when the work starts).

## Ground rules (every stage)

1. One stage = one commit series. A stage is done only when its tests pass.
2. **Existing suites are the no-difference proof** for refactors and the regression
   set for behaviour changes. A scenario that must change is rewritten *in the same
   commit* as the behaviour, with the reason in the message.
3. `DumpState` is **add-only per commit**: a key is removed or repurposed only by the
   commit that updates every scenario reading it. `src/platform/dbus.ts` declares the
   full trigger surface (this is repaired once, in Stage 0).
4. Triggers are honest and **event-confirmed**: `Inject*` = real input through Mutter;
   a plain command = a real Mutter API; `Simulate*` = extension state only. Every
   Mutter signal handler writes to the **event journal**, and tests assert the event
   fired, not just that our function ran.
5. Core stays pure (`scripts/check-core-purity.sh`): all new planners, the queue, the
   registry and the display memory are `core/` modules with unit tests.
6. No policy ever runs inside a Mutter signal handler.
7. Removals are announced in the CHANGELOG (settings keys, features, scenarios).

## What retires (and what replaces it)

| Retires | Because | Replaced by |
| --- | --- | --- |
| `A15`, `A52` (adaptation correctness) | adaptation no longer touches geometry | A15 rewritten: a refusing client is accepted and **no minimum is learned** |
| `A35`, `A43`, `A46`, `A51`, `A53`, `A59`, `A60`, `A62`, `A76` | they test eviction, the old reaping rules, the motion-watch/coherence timers and the spawn budget | A85–A93 (routing, maximise, unmaximise, emptiness, single-workspace) |
| `A40`, `A45`, `A50` (maximise right / return left / float over a pair) | the machinery is deleted | A88–A91 |
| `A48`, `S09` (periodic retile) | the timers are replaced by the queue | A84 (burst → one drain), queue perf assertions |
| `A56`, A66's `sweeps`/`sweepFrameReads` counters | the coherence sweep is gone | A66 re-scoped to the surviving counters |
| `S05`, `S11` | old minimise/reap and unmaximise-float behaviour | S02/S04/S05/S14 rewritten |
| `core/budget.ts` + tests, `RetileScheduler`, `FloatStore` | deleted by v2 | the queue, the registry |
| `adaptation.json`, `behavior.json` | merged into the registry | `state.json` registry with a real migration |

## Stage 0 — Grounding and event-confirmed triggers (no behaviour change)

Deliverables:

- `docs/platform-notes.md`: the public/private/never table for GNOME 48–50 (laters,
  geometry, predicates, workspaces, `override_constraints` = Ubuntu-only,
  `Meta.WindowConfig` = useless for tiles, virtual monitors), plus the documented
  exception list (the `animateSwitch` override, reading `_swipeTracker`, accepting a
  client's rect after one retry).
- `ProbePlatform` D-Bus call: JSON capability report (laters + `BEFORE_REDRAW`,
  monitor matrix, `layout_rows`, virtual input, RemoteDesktop/EIS), asserted by a
  scenario.
- Harness (partly done): `ADRT_MONITORS` matrix with mixed resolutions and portrait,
  `ADRT_SOFTWARE_GL`, `ADRT_DEVKIT=0`, per-state Wayland socket, stale-lock cleanup,
  `ADRT_START_TIMEOUT_S`; four virtual monitors verified.
- Server prep (done): `scripts/setup-headless-server.sh` with its 15-point self-check;
  add `scripts/server-test.sh` wrapping preflight + nested suite under the printed
  environment.
- **Event journal**: a ring buffer `{ seq, source, event, at }` written from the two
  signal wrappers (`host.connect`, the per-window `on()` helper) and the history
  funnel; one monotonic sequence, shared with the decision log (the dead `trace`
  field finally means something); `DumpEvents(n, filter?)`.
- **Real input injection**: `InjectKey`/`InjectPointerButton`/`InjectPointerMotion`
  behind `debug-input` (default off, harness-only), in-process via
  `Clutter.Seat.create_virtual_device()`; the RemoteDesktop path documented as the
  external alternative (single long-lived client, peer-checked).
- **Trigger hygiene**: `platform/dbus.ts` repaired to declare the full surface;
  triggers named per rule 4 above, with old names kept as aliases for one commit.
- Keybinding scenarios A22/A23/A24 un-skipped using injection; `ydotool` demoted to a
  live-session fallback.

Tests: `A80-platform-probe`, `A81-four-monitors`, `A82-event-journal` (every trigger
leaves its expected entry), `A83-injected-drag-is-event-confirmed` (a real grab appears
in the journal as `grab-op-begin` *and* the window moves), A22/A23/A24 un-skipped.

Risk: low. Injection is debug-gated; nothing in the tiler changes.

## Stage 1 — Queue mechanism and records (behaviour identical)

Deliverables:

- `core/queue.ts`: `Map<lane, Map<key, event>>` — lanes 1 feedback, 2 layout,
  3 maintenance; per-key coalescing; `push/drain/pending/depth`; the clock is a
  parameter, so it is deterministic and unit-testable.
- Adapter: one drain scheduled by `global.compositor.get_laters().add(BEFORE_REDRAW,
  cb)`; later ids tracked and removed on `disable()`; a `mutatingWorkspaces` guard so
  a workspace mutation can never re-enter the policy.
- Convert the policy paths to pushes: `scheduleReconcile`, `scheduleRetile`,
  `addTimeout` users, the motion watch, the coherence sweep, the drag watchdog. The
  sweep survives only as a lane-3 periodic event with the same effect.
- `core/record.ts`: `WindowRecord` as a plain object plus predicates
  (`isTileable`, `isFloating`, `isMinimized`, `isMaximized`, `isSticky`,
  `isUserMoving`); `TrackedWindow` deleted by strangler.
- Decision records begin: every layout decision is a value (`{ lane, key, event,
  input, decision, reason }`), even before the flags exist.

Tests: 12+ pure queue tests (per-lane FIFO, coalescing, push-during-drain is queued,
starvation bound, budget, determinism); predicate tests; `A84-burst-single-drain`; the
entire existing suite green with only the timers replaced.

Risk: medium (touches every path) but mechanical; one commit to revert.

## Stage 2 — The model, part 1: slots, routing, maximise, emptiness

Deliverables:

- `core/placement.ts`: `routeNewWindow(state, rec, env) → { workspace, slot }` (right
  slot; else create-to-right with the window maximized) and
  `canHostWorkspaces(env)`.
- `core/workspaces.ts`: `workspaceOps(state, env) → { create, reap }` implementing the
  single-trailing-spare invariant per screen.
- Adapter: routing and reaping run **only** from the lane-2 drain.
- Delete: the `>2` extra branch, `floatOverPair` as eviction, `unmaximizeStaleLone`,
  `returnFromMaximize`, `previousWorkspaceIdx`, the minimise-slide, the old
  `pruneEmptyWorkspaces` rules, `EXILE_COOLDOWN_MS`, the spawn budget and
  `core/budget.ts`, `workspaceOpDepth` (replaced by the queue's guard).
- Implement §4 (maximise on capable vs single-workspace screens with
  `maximize-minimizes-others`; unmaximise joins the left slot, deletes the emptied
  workspace, or minimises-and-moves if the left workspace is full).
- Implement §7 (single-workspace screens: split while a slot is free, float when
  full; persistent pair per screen).
- Floats per §6: keybinding (session-scoped per app), modals/dialogs/popups, overflow.
- Settings: add `maximize-new-workspace`, `maximize-minimizes-others`; remove
  `workspace-auto-name`, `workspace-move-grace-seconds`, `respect-user-workspace-move`
  (announced).
- Spec/README sections rewritten in the same commits (§7, §9, §16, §35, §21 events).

Tests: pure placement/workspaces (~28: 1/2/3 windows, capable vs single-workspace,
landscape/portrait/vertical, per-screen emptiness, invariant violations logged not
enforced); nested A85 right-slot-and-split, A86 create-right-and-maximize, A87
nothing-is-evicted, A88 maximise-owns-a-workspace, A89 maximise-in-place-minimises-
others (single-workspace via `dynamic-workspaces=false` + `num-workspaces=1`), A90
unmaximise-joins-left-and-deletes, A91 unmaximise-full-left-minimises, A92
single-workspace-split-then-float, A93 empty-workspace-reaped; the rewritten/retired
set from the table above; live S02/S04/S05/S14 rewritten, S15 extended.

Risk: highest stage. Mitigation: Stage 1 landed the safety property; the pure planners
are testable before the adapter is wired; the suites gate every commit.

## Stage 3 — User-driven interactions

Deliverables: the real grab path for drags (from Stage 0 injection) driving the
swap-on-perimeter-crossing rule; overview drop semantics (§6: split onto a
single maximized window, float onto a full pair); a window restored onto a full
workspace floats; the trailing spare cannot be reordered (revert + `Main.notify`
toast).

Tests: A32/A74/A77 extended to use real grabs; A94 overview-drop-onto-full-floats,
A95 restore-onto-full-floats, A96 spare-reorder-refused-toast, A97 drop-onto-single-
maximised-splits; live S13 rewritten.

Risk: medium — reuses the existing swap-intent code with slot awareness.

## Stage 4 — App registry, prefs, migration

Deliverables: `core/identity.ts` (the fallback chain as a pure decision given the raw
inputs: desktop id → sandboxed id → gtk id → AppImage ancestor → wm_class →
session-only, with `.desktop`/suffix normalisation) and `core/appregistry.ts` (entry
shape, neverTile precedence, ordinal assignment, migration from `adaptation.json` +
`behavior.json` + `exception-apps`, TTL/pruning rules). Adapter: populate on every
window; resolve at first frame; re-key on `tracked-windows-changed`/`notify::wm-class`;
`neverTile` honoured by classification; adaptation kept but **timing-only** (no learned
minimum ever reaches the tiler); placements recorded per instance id with the durable
per-app ordinal roll-up; prefs page for the registry replacing the problem-windows
page; settings migration with a real version bump and `EXTENSION_VERSION` bump.

Tests: pure identity/registry (~20: each packaging format incl. AppImage ancestor
walk, provisional-key re-keying, precedence, migration, ordinals); A15 rewritten (a
refusing client is accepted, no minimum learned), A98-registry-lists-every-app,
A99-neverTile-floats, A100-placements-survive-recreation; A63 (text clipping) unchanged.

Risk: medium — the identity chain is fiddly, but the facts are already gathered.

## Stage 5 — Displays and hotplug

Deliverables: `core/displays.ts` (`displayPlan(prev, next, memory, env) → { moves,
remember, forget }`); per-connector memory in the registry; disconnect routes windows
to free slots on remaining screens; reconnect **replays the monitor's previous state**
(slots, minimized, floats; clamped; never floats, never creates); TTL
(`display-memory-minutes`); `SimulateScreens` hook; `startup-complete` gating so
enable-time layout waits for settled geometry; primary changes handled, never set.

Tests: pure `displayPlan` (12+: disconnect, reconnect, connector swap, resolution
change, portrait↔landscape, two externals, primary change, expired memory,
user-moved-meantime, single-workspace screen); nested A88–A91 of the display set
(decisions asserted from the journal) plus work-area-change and primary-change
scenarios; live S17-dock-drill (assisted, `ADRT_DOCK_TEST=1`) and S15 extended.

Risk: medium; the live drill is manual, the policy is pure-tested.

## Stage 6 — Undo, flags, replay

Deliverables: undo holds **one** in-memory change, per instance and configuration
(workspace, slot, rect, maximized, floating) plus ratios; all instances validated
before anything moves; a toast when it cannot be reverted; `undo-stack-size` and the
persisted stack dropped. Flags completed: `debug.*` per subsystem, `record` (journal
+ decisions into a replayable trace), `perf.*` (queue depth, drain time, apply latency,
p50/p95), `DumpDecisions`, `DumpEvents`.

Tests: pure replay determinism (a recorded trace replayed through the planners gives
identical decisions); A101-undo-restores-instance-and-config, A102-undo-toasts-when-
impossible, A103-record-trace-shape, A104-queue-depth-returns-to-zero; live S03 revised.

Risk: low-medium — replay is the only subtle part.

## Stage 7 — Monitor matrix and vertical hardening

Deliverables: run everything across the matrix — 1 monitor (landscape, portrait), 2–4
monitors with mixed resolutions/orientations/order, each monitor primary in turn,
vertical workspaces (`layout_rows === -1`) combined with portrait, work-area changes
(panel toggle), hotplug fixtures. Fix what the audit listed: geometry-based
`moveToAdjacentMonitor`, per-screen split axis, no hard-coded `fallbackScreen`/
`dummyScreen`, full surface refresh + classification invalidation on `screens-changed`,
host connector/primary keying by real index, and the scenarios that assume
`monitors[0]` or `1281x801`.

Tests: the matrix as a CI matrix over `ADRT_MONITORS`; A01/A14/A64 made matrix-clean;
A105-per-screen-axis (portrait and landscape together); work-area and hotplug suites on
two and four monitors.

Risk: medium — this is where deferred bugs surface, which is the point.

## Stage 8 — Docs, dead code, perf re-scope

Deliverables: `spec.md` + `README.md` superseded sections deleted (§0, §7, §9, §16,
§17, §21, §22, §24, §31.3, §32.4, §35, §36) with a pointer to `V2_MODEL.md`; metadata
description and version updated; CHANGELOG/TESTING/TEST_MATRIX; the inventory's dead
code and dead settings removed; the float representation unification finished. Then
**re-scope the performance plan**: carry forward Stage 1 (stop rebuilding configs per
call) and Stage 2 (O(1) host window lookup) onto the new code, delete Stage 3 (sweep
gating) and the sweep back-off, re-measure with the existing counters, and rewrite
`PERFORMANCE_PLAN.md` to match.

Tests: full suite on nested, live and matrix; a long mixed run asserting no
`invariant_violated` entries in the journal.

## Test surface summary

| Stage | Pure core (new) | Nested (new) | Live |
| --- | --- | --- | --- |
| 0 | probe helpers | A80–A83, A22/A23/A24 un-skipped | — |
| 1 | queue 12+, predicates 10+ | A84 | S01–S14 |
| 2 | placement/workspaces 28+ | A85–A93 + rewritten set | S02/S04/S05/S14, S15 |
| 3 | — | A94–A97, A32/A74/A77 | S13 |
| 4 | identity/registry 20+ | A98–A100, A15 | S03 |
| 5 | displays 12+ | display set + hotplug fixtures | S15, S17 dock drill |
| 6 | replay 6+ | A101–A104 | S03 |
| 7 | — | matrix runs, A105 | matrix live |
| 8 | — | full suite | full suite |

Never mark a test passed without running it. Skips are recorded and justified.

## Standing risks

- **Stage 2 is the one that can go wrong.** The empty-workspace invariant is enforced
  by deletion, which is a workspace mutation — so it must only ever run in the lane-2
  drain, and the journal must show the create/delete ordering. A regression test
  (A93) plus the log-only invariant assertion are the tripwire.
- **The identity chain can never be perfect** for portable apps (an unintegrated
  AppImage that zeroes its environment degrades to `wmclass:`). It is documented, and
  the registry shows the source of each key so the user can see what happened.
- **Hotplug cannot be truly simulated nested** (runtime monitor add/remove is private
  API); the policy is pure-tested, the decisions are journal-asserted, and the physical
  behaviour is verified by the opt-in live dock drill.
