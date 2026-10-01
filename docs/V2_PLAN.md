# Adrt v2 — staged checklist

Companion to `docs/V2_MODEL.md` (**authority for behaviour**). This file is the
**authority for order of work**, and it is the thing to follow: tick the boxes.
Mirrored for the UI at `~/.opencode/plan/v2-plan.md`.

Status: **every behaviour question is settled.** The model (§23, decisions 1–89) is
closed and `docs/V2_LAYOUT_QA.md` has no open list. `docs/V2_MODEL.md` is the authority
for behaviour; `docs/V2_TEST_MATRIX.md` (generated) is the source the core tests are
written from; both are derived, not authoritative.

## Progress

| Stage | State | Commit | Evidence |
| --- | --- | --- | --- |
| 0 Grounding | not started | — | harness matrix + server script already landed (`fe0b2eb`) |
| 1 Queue + records | not started | — | — |
| 2 Model: slots/routing/maximise/emptiness | not started | — | — |
| 3 User-driven interactions | not started | — | — |
| 4 App registry + prefs + migration | not started | — | — |
| 5 Displays + hotplug | not started | — | — |
| 6 Undo + flags + replay | not started | — | — |
| 7 Monitor matrix + vertical | not started | — | — |
| 8 Docs, dead code, perf re-scope | not started | — | — |

## Rules of engagement

- [ ] One stage = one commit series. A stage is done only when every box under it is
      ticked, including its target runs.
- [ ] **TDD for behaviour** (stages 2–6): write the failing scenarios **first**, run
      them, confirm they fail *for the intended reason*, then implement. The test
      commit precedes the implementation commit.
- [ ] **Bug fixes always get a regression scenario** that fails before and passes
      after, on both targets.
- [ ] **Refactors** (0, 1, 6–8) prove no difference by leaving the existing suite
      unchanged and green.
- [ ] **Every scenario runs on both targets** through one API: `headless` (VM, fast,
      isolated, matrix, fault injection) and `session` (a real GNOME instance — the
      VM's session-like target and/or the laptop). Capability gaps are explicit skips
      with a recorded reason, never silent.
- [ ] `DumpState` is **add-only per commit**: a key is removed or repurposed only by
      the commit that updates every scenario reading it.
- [ ] Triggers are honest: `Inject*` = real input through Mutter; a plain command =
      a real Mutter API; `Simulate*` = extension state only. Every Mutter signal
      handler writes to the **event journal**, and tests assert the *event*, not just
      our function.
- [ ] `core/` stays pure (`scripts/check-core-purity.sh`); new logic lands there with
      unit tests.
- [ ] No policy runs inside a Mutter signal handler — ever. Workspace mutations only
      from the lane-2 drain.
- [ ] Deletions (settings, features, scenarios) are listed in the CHANGELOG in the
      commit that removes them.

## Test families the model requires (each with its variations)

Every feature and every fix lands with a **family** of tests, not a single case: one
and two screens; workspace-capable, single-workspace-capable and fixed-workspace;
landscape and portrait; `layout_rows === -1`; real apps; the refusal path; and the
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
  direction with nothing stays silent; the cycle walks the current screen and workspace
  — managed windows in slot order, then floats left to right, minimized skipped.
- **view policy**: the view follows the app the action is about, and only on the viewed
  workspace; a reactor never moves it; a fixed screen's routing switches to the window;
  a screen without workspaces ignores the switch.
- **toasts**: a request that changes nothing toasts with its reason (already maximized,
  un-float with no room, move on a one-workspace screen, nothing to undo, nothing to
  nudge); a direction with nothing is silent; the catalogue is deduplicated and
  rate-limited.
- **classification**: always-on-top floats; sticky and skip-taskbar windows are never
  managed; an app that maps itself maximized is unmaximized and tiled; dialogs centre
  and raise; an oversized or fixed-size client takes its own workspace.
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

The model's rules are **business logic and are tested as pure core tests** - fast,
deterministic, no Shell and no compositor. The harness scenarios test only the
**implementation**: that the adapter feeds the core the right inputs, applies the
decisions to the right Mother calls, and produces the right events. A rule that cannot
be expressed as a pure-core test is a rule that belongs further down the stack, so the
split is enforced, not merely encouraged. Behaviour must be identical on `headless` and
on a headful session; the harness proves the same scenarios hold on both.

### Cases the layout round added (each confirmed, each needs tests)

- fullscreen on a single-workspace screen: in place, the other managed windows minimised.
- a split that cannot exist: the trigger keeps the screen (alone, so maximised) and the
  reactor gives way — its own clamped workspace on a workspace-capable screen, minimised
  on a single-workspace screen; the two trade whenever one is restored.
- fixed and static-number screens: nearest workspace with room (right first), the slot
  on the side it came from, the view switching to it; a full screen floats.
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

| Capability | `headless` (VM) | `session-like` (VM) | `session` (real) |
| --- | --- | --- | --- |
| isolated XDG + keyfile settings | yes | yes | no (real state) |
| multi-worker sharding | yes | limited | no |
| monitor matrix (≤4, mixed res/portrait) | yes | yes | real monitors only |
| fault injection (`InjectVerifyFailure`, `SimulateScreens`) | yes | yes | partial |
| perf counters | yes | yes | yes |
| real apps (apt/flatpak/snap) | yes | yes | yes |
| **key + pointer injection** | Stage 0 (in-process Clutter) | Stage 0 (RemoteDesktop) | real input / injection |
| `ydotool` | **impossible** (no libinput/seat) | impossible | yes |
| journal of the shell | `shell.log` grep | `journalctl --user` | `journalctl` |
| hotplug / dock | no (fixtures + `SimulateScreens`) | no | **yes (physical)** |
| real touchpad gestures, suspend, logind lock, GPU/fractional visuals | no | no | **yes** |

`session-like` launcher (VM): isolated XDG tree + `dbus-run-session -- gnome-session`
with `gnome-settings-daemon`, `xdg-desktop-portal{,-gnome}`, `polkitd`,
`gnome-remote-desktop`; input via one long-lived `RemoteDesktop` client (peer-checked;
`gdbus` cannot inject).

## Parallel work policy (conflict minimisation)

- [ ] **Serial backbone.** `src/adapters/gnome/extension.ts` is touched by every stage,
      `host.ts` by seven; stages 1–3 all mutate the tiling/session/record path. Those
      run **serially**, single writer, one worktree.
- [ ] **Parallel-safe by construction**: research/verification (read-only agents);
      **new** `core/` modules with their tests (`queue`, `record`, `placement`,
      `workspaces`, `identity`, `appregistry`, `displays`, `replay`) — additive files,
      no overlap; **new** scenario files (`A85…`, `S17…`); docs and the CHANGELOG.
- [ ] One git worktree per parallel task: `git worktree add /tmp/opencode/wt-<name>
      -b v2/<name>`; each runs with its own `ADRT_BASE_STATE`; each branch lives under
      a day and merges in stage order.
- [ ] Only one branch may touch a hot file at a time; before editing one, check no
      unmerged branch touched it (ownership table below).
- [ ] One committer at a time (shared `.git` index): merges and commits are serialised
      even when work is parallel.
- [ ] After every merge: run the full `headless` suite before starting the next merge.

Hot files needing serialisation: `extension.ts` (all), `host.ts` (0,1,2,3,5,7,8),
`session.ts` (0,1,2,4), `tiling.ts` (1,2,3,6), `settings.ts` (0,2,4,5,6), the
gschema, `dbus.ts` + `platform/dbus.ts` (0,5,6), `core/config.ts` (2,4,6,8),
`core/types.ts` (1,2,5,7), `core/tiler.ts` (2,3,7), `history.ts` (0,4,6),
`surface.ts` (1,4,5,7), `prefs.ts` (4,5,6,8), `tests/agent/lib.sh` (0,4,5,6),
`spec.md`/`README.md` (2,8).

## Stage 0 — Grounding and event-confirmed triggers (no behaviour change)

Failing tests first (test infra, so these are new tests that fail until implemented):

- [ ] `A80-platform-probe` — fails today: no `ProbePlatform` call exists.
- [ ] `A82-event-journal` — fails today: no `DumpEvents`.
- [ ] `A83-injected-drag-is-event-confirmed` — fails today: real input cannot be
      injected headlessly.
- [ ] Un-skip `A22`/`A23`/`A24` by injection — they skip today for lack of a seat.

Implementation:

- [ ] `docs/platform-notes.md`: public/private/never API table (GNOME 48–50) + the
      documented exception list (`animateSwitch` override, `_swipeTracker` read,
      accept-client-rect-after-one-retry).
- [ ] `ProbePlatform` D-Bus: capability JSON (laters + `BEFORE_REDRAW`, monitor
      matrix size, `layout_rows`, virtual input, RemoteDesktop/EIS).
- [ ] **Event journal**: ring buffer `{seq, source, event, at}` written from the two
      signal wrappers (`host.connect`, the per-window `on()` helper) and the history
      funnel; one monotonic sequence shared with decisions (the dead `trace` field
      gets a meaning); `DumpEvents(n, filter?)`.
- [ ] **Input injection** behind `debug-input` (default off, harness only):
      in-process `Clutter.Seat.create_virtual_device()`; plus a long-lived
      `RemoteDesktop` client for the `session-like` target.
- [ ] **Trigger hygiene**: `platform/dbus.ts` declares the whole surface (it is
      missing every test trigger today); triggers named per the three-kind rule, old
      names kept as aliases for one commit.
- [ ] `scripts/server-test.sh`: preflight + suite under the printed server env.
- [ ] **Debug notification catalogue** (§21 of the model): one checkbox per decision,
      phrased as the decision, deduplicated and rate-limited; notifications are a debug
      facility, so they live behind the debug settings, not in the default UI.
- [ ] **Journal format**: append-only, one file per day, 30-day retention, numbered
      parts rotated by size, in-memory tail for `DumpEvents`, monotonic sequence shared
      with the decision log.
- [ ] Spec/CHANGELOG notes for the trigger rename.

Target runs: `headless` (A80–A83, A22–A24) · `session-like` (A22–A24 + injection
smoke) · `session` (A22–A24 unchanged via real input).

## Stage 1 — Queue mechanism and records (behaviour identical)

Failing test first:

- [ ] `A84-burst-single-drain` — a burst of frame signals produces exactly one drain
      and the same final geometry.

Implementation (parallelisable: the pure module by another agent):

- [ ] `core/queue.ts`: `Map<lane, Map<key, event>>` — lanes 1 feedback / 2 layout /
      3 maintenance; per-key coalescing; `push/drain/pending/depth`; injected clock.
- [ ] `core/record.ts`: `WindowRecord` plain object + predicates (`isTileable`,
      `isFloating`, `isMinimized`, `isMaximized`, `isSticky`, `isUserMoving`);
      `TrackedWindow` deleted (strangler).
- [ ] Adapter: one drain on `global.compositor.get_laters().add(BEFORE_REDRAW, cb)`;
      later ids tracked and removed on `disable()`; `mutatingWorkspaces` guard.
- [ ] Convert `scheduleReconcile`, `scheduleRetile`, the `addTimeout` users, the motion
      watch, the coherence sweep and the drag watchdog to pushes/drains.
- [ ] `core/queue.test.ts` (12+), `core/record.test.ts` (10+).

Target runs: `headless` (whole existing suite + A84) · `session-like`/`session`
(S01–S14 unchanged).

## Stage 2 — The model: slots, routing, maximise, emptiness

Failing scenarios first (all fail on today's build for the intended reason):

- [ ] `A85-right-slot-and-split` · `A86-create-right-and-maximise` ·
      `A87-nothing-is-evicted` · `A88-maximise-owns-a-workspace` ·
      `A89-maximise-in-place-minimises-others` (single-workspace via
      `dynamic-workspaces=false` + `num-workspaces=1`) · `A90-unmaximise-joins-pair-forming-left`
      · `A91-unmaximise-parks-when-no-neighbour-can-pair` (both neighbours full or
      empty) · `A92-single-workspace-split-then-float`
      · `A93-empty-workspace-reaped` · `A106-no-cross-monitor-exile` (the observed bug).

Implementation:

- [ ] `core/placement.ts`: `routeNewWindow(state, rec, env) → { workspace, slot }`;
      `canHostWorkspaces(env)`.
- [ ] `core/workspaces.ts`: `workspaceOps(state, env) → { create, reap }` with the
      single-trailing-spare invariant per screen.
- [ ] Adapter: routing/reaping only from the lane-2 drain; windows on a
      non-workspace screen are **not** given a workspace index.
- [ ] Delete: the `>2` extra branch, `floatOverPair`-as-eviction, `unmaximizeStaleLone`,
      `returnFromMaximize`, `previousWorkspaceIdx`, the minimise-slide, the old
      `pruneEmptyWorkspaces` rules, `EXILE_COOLDOWN_MS`, the spawn budget +
      `core/budget.ts`, `workspaceOpDepth`.
- [ ] Maximise rules (§4), unmaximise rules (§4), single-workspace flow (§7), floats
      (§6); remove
      `workspace-auto-name`, `workspace-move-grace-seconds`,
      `respect-user-workspace-move`.
- [ ] Rewrite/retire the scenario set (table in the CHANGELOG) and spec/README
      sections §7, §9, §16, §35, §21 in the same commits.
- [ ] `core/placement.test.ts` + `core/workspaces.test.ts` (~28 cases).
- [ ] **The escape rule**: a managed window that does not fit its slot (oversized,
      `min == max`, or refusing) gets its own workspace to the right, clamped to
      [1/6, full screen]; never floated. Floats are reserved for the never-managed
      categories (always-on-top, dialogs, manual marks, popups, drop-down terminals).
- [ ] **Classification ported from the code inventory**: always-on-top floats
      (reversing A61), dialogs and transients float/centre/raise, an app opening
      maximized is unmaximized and tiled, fullscreen is the "does not fit" case.

Target runs: `headless` (new + rewritten) · `session-like` (S02/S04/S05/S14
rewritten) · `session`.

## Stage 3 — User-driven interactions

Failing scenarios first:

- [ ] `A94-overview-drop-onto-full-floats` · `A95-restore-onto-full-floats` ·
      `A96-spare-reorder-refused-with-toast` · `A97-drop-onto-single-maximised-splits`
      · `A107-cross-monitor-drag-swaps-or-takes-slot` · `A108-maximised-drag-still-maximised-at-drop`.

Implementation:

- [ ] Real-grab drag path (Stage 0 injection) driving swap-on-perimeter-crossing, now
      slot-aware; the slot decision uses the window's rect centre and a re-read frame.
- [ ] Cross-monitor drops: monitor chosen by Mutter (centre rule); free slot → take
      it; occupied slot → swap; the model's rules for a maximized drop and for a
      single-workspace target.
- [ ] Trailing spare cannot be reordered: revert + `Main.notify` toast.
- [ ] Overview drop onto a single maximized window splits; onto a full pair floats.

Target runs: `headless` (real grabs) · `session-like` · `session` (S13, real drags).

## Stage 4 — App registry, prefs, migration

Failing scenarios first:

- [ ] `A98-registry-lists-every-app` · `A99-neverTile-floats` ·
      `A100-placements-survive-recreation` · `A15` rewritten (a refusing client is
      accepted and **no minimum is learned**).

Implementation (pure modules parallelisable):

- [ ] `core/identity.ts`: the fallback chain (desktop id → sandboxed id → gtk id →
      AppImage ancestor → wm_class → session-only) + normalisation.
- [ ] `core/appregistry.ts`: entry shape, `neverTile` precedence, ordinal assignment,
      migration from `adaptation.json` + `behavior.json` + `exception-apps`,
      pruning/TTL.
- [ ] Adapter: populate on every window; resolve at first frame; re-key on
      `tracked-windows-changed`/`notify::wm-class`; adaptation kept **timing-only**;
      placements per instance id (+ ordinal roll-up).
- [ ] Prefs page for the registry (replaces the problem-windows page); settings
      migration + `EXTENSION_VERSION` bump; `tile:` rule modes dropped.
- [ ] **New settings**: `follow-moved-window` (default on), `float-pins-workspace`
      (default on), per-side gaps plus the between-window gap, `disable-animations`
      extended to switch off GNOME's animations too, and the `debug` notification
      checkboxes; `undo-stack-size`, `workspace-auto-name`,
      `workspace-move-grace-seconds` and `respect-user-workspace-move` are removed.
- [ ] **Enable-time normalisation** (§20): per workspace, three branches — a single
      window maximized; a window covering at least three quarters of the work area
      maximized with the rest minimized; otherwise the top two by visible surface
      paired and the rest minimized — on every enable including mid-session, with
      floats and fullscreen windows untouched.
- [ ] Pure tests: identity per packaging format (incl. AppImage ancestors, Chromium's
      zeroed environment), re-keying, precedence, migration, ordinals (~20).

Target runs: `headless` · `session-like` (real apt/flatpak/snap apps) · `session`.

## Stage 5 — Displays and hotplug

Failing scenarios first:

- [ ] `A109-disconnect-routes` · `A110-reconnect-replays-state` ·
      `A111-primary-change-keeps-slots` · `A112-workarea-change-replans-one-monitor`.

Implementation:

- [ ] `core/displays.ts`: `displayPlan(prev, next, memory, env) → { moves, remember,
      forget }`; disconnect routing; reconnect replays the monitor's previous state;
      TTL; never sets the primary.
- [ ] Adapter: `monitors-changed`/`workareas-changed` → lane 2;
      `SimulateScreens` fixture; `startup-complete` gating.
- [ ] Live `S17-dock-drill` (assisted, `ADRT_DOCK_TEST=1`); S15 extended.
- [ ] Pure `displayPlan` tests (12+).

Target runs: `headless` (fixtures) · `session-like` · `session` (**physical** hotplug).

## Stage 6 — Undo, flags, replay

Failing scenarios first:

- [ ] `A101-undo-restores-instance-and-config` · `A102-undo-toasts-when-impossible` ·
      `A103-record-trace-shape` · `A104-queue-depth-returns-to-zero`.

Implementation:

- [ ] Undo: one in-memory entry, per instance + configuration + ratios; validate all
      before applying; toast on impossibility; drop `undo-stack-size` and the
      persisted stack.
- [ ] Flags: `debug.*` per subsystem; `record` (journal + decisions → replayable
      trace); `perf.*` (queue depth, drain time, apply latency, p50/p95);
      `DumpDecisions`.
- [ ] `core/replay.ts` + a determinism test (a recorded trace replayed through the
      planners gives identical decisions).

Target runs: `headless` · `session-like` · `session` (S03).

## Stage 7 — Monitor matrix and vertical hardening

Failing scenarios first:

- [ ] `A105-per-screen-axis` (portrait and landscape in one session) plus the matrix
      runs of A01/A14/A64 rewritten to derive bounds from the actual monitors.

Implementation (fix the audit's list):

- [ ] Geometry-based `moveToAdjacentMonitor`; per-screen split axis; remove the
      hard-coded `fallbackScreen`/`dummyScreen`; full surface refresh +
      classification invalidation on `screens-changed`; host connector/primary keyed
      by real index; `monitors[0]`/`1281x801` literals removed from scenarios.
- [ ] CI matrix over `ADRT_MONITORS` variants (1 landscape, 1 portrait, 2 mixed,
      4 mixed, each primary in turn) plus `layout_rows=-1`.

Target runs: matrix on `headless` · `session-like` · `session` (real monitors).

## Stage 8 — Docs, dead code, perf re-scope

- [ ] `spec.md`/`README.md` superseded sections deleted with a pointer to
      `V2_MODEL.md`; metadata description/version updated.
- [ ] Dead code and dead settings from the inventory removed; float representation
      unification finished.
- [ ] `PERFORMANCE_PLAN.md` re-scoped: carry Stage 1 (config caching) and Stage 2
      (O(1) host lookup) onto the new code; delete Stage 3 and the sweep back-off;
      re-measure with the existing counters.
- [ ] A long mixed run asserting no `invariant_violated` entries in the journal.

## Decisions (all settled — nothing pending)

- **Targets**: `headless`, `session-like` (VM) and `session` (hardware), with capability
  gating. `session-like` is what "a real GNOME instance" means for everything except
  real touchpad gestures, suspend/resume, physical hotplug, logind lock and
  GPU/fractional visuals, which are mandatory-on-hardware checks before a release.
- **TDD**: super strict — failing tests (with variations) first for every feature and
  fix; a stage's tests must pass on `headless` **and** `session-like`; the hardware run
  is a tracked pending line.
- **A drop, in order**: a **free slot wins** (on the side the window came from); only
  with no free slot anywhere does a perimeter crossing **swap**; otherwise the window
  floats where it was dropped. That is the free-slot-first ladder from the Q&A, and it
  is what S3 (a full screen) and S13 (a pair) already did.
- **Parallel work**: research, new `core/` modules and new scenario files only, each in
  its own worktree; hot files single-writer; one committer; the suite runs between
  merges.
- **Checklist home**: this file in the repo, mirrored at `~/.opencode/plan/v2-plan.md`.
- **Reorder prohibition dropped**: user reordering is honoured with no correction, no
  tagging and no toast (model §8); reaping is a property, so an empty workspace is
  pruned wherever it sits and the spare is never removed.
