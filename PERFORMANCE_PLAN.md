# Performance plan: fewer computations, fewer Shell calls

Goal: cut the work the extension does per unit time — especially the work it
does while nothing is happening — without changing a single user-visible
behaviour. Every stage is behaviour-preserving by construction, and every change
lands with a test that proves it: either the *same* behaviour (the existing
suites) or the *same guarantee* (a window that should be tiled is tiled).

Branch: `perf/reduce-work` (branched from `master` at `e001980`).

## Rules of engagement

1. **One stage = one commit.** A stage is only done when all of its tests pass.
2. **Every change gets a test.** Two kinds, both required where applicable:
   - *No-difference test*: the full existing suite (core + nested + session)
     must stay green. That is the behaviour-difference test; if a stage needs an
     existing expectation changed, the stage is wrong — stop and re-plan.
   - *Guarantee test*: a new scenario proving the invariant the change could
     weaken still holds (e.g. "a drifted window is still put back", "a normal
     window next to a sibling is still tiled").
   - *Counter test*: a new scenario proving the work actually went away.
3. **Never mark a test passed without running it.** Skips are recorded as skips.
4. **Run on both harnesses.** Nested suite for logic; session suite for anything
   that touches the live-visible path (Stages 2, 4, 5).
5. **Keep `core/` pure.** `bash scripts/check-core-purity.sh` must stay OK.
6. **A new build needs a login** (Wayland caches the module), so each stage is
   one reload — batch accordingly.
7. After each stage, update `TEST_MATRIX.md`, `TESTING.md` and `CHANGELOG.md`.

### Standard stage checklist

```bash
npm run test:core                       # 139 unit tests
bash scripts/check-core-purity.sh       # core stays pure
bash scripts/agent-test.sh              # 65 nested scenarios (A01-A65 + new)
bash scripts/session-test.sh            # S01-S14 where the stage touches live paths
```

## Baseline (measured 2026-09-30, live session)

### Before the counters (two `DumpState` samples 12 s apart)

| metric | delta / 12 s | rate |
| --- | --- | --- |
| `coherenceSweeps` | 17 | one per 700 ms, forever |
| `coherenceFixes` | 0 | the most expensive loop in the extension fixed nothing |
| `motionRetiles` | 0 | — |
| windows / workspaces | 5 / 4 | — |

### With the Stage 0 counters (idle desktop, 3 windows, ~4.7 min since login, 406 sweeps)

| counter | total | per sweep | per second |
| --- | --- | --- | --- |
| `classifyCalls` | 8,248 | 20.32 | 29.02 |
| `classifyMisses` | 45 | 0.11 | 0.16 |
| `configBuilds` | 8,495 | 20.92 | 29.89 |
| `rulesParses` | 8,495 | 20.92 | 29.89 |
| `plansComputed` | 247 | 0.61 | 0.87 |
| `sweepFrameReads` | 464 | 1.14 | 1.63 |
| `hostLookups` | 41 | 0.10 | 0.14 |
| `hostScans` | 41 | 0.10 | 0.14 |
| `logEvents` | 19 | 0.05 | 0.07 |
| `plansApplied` | 1 | 0.00 | 0.00 |

`sweepMsAvg` 0.998 ms, `sweepMsMax` 3.487 ms → ~1.4 ms/s of main-loop time
(cheap on its own), but **~30 config objects and ~30 `JSON.parse` calls per
second** on an idle desktop: allocation and GC pressure rather than CPU burn.

### What the baseline confirms

| Evidence | Confirms |
| --- | --- |
| `configBuilds / classifyCalls` = **1.03** | a config is built even when the cached answer is returned → Stage 1 |
| `rulesParses` = `configBuilds` | the rules JSON is parsed on every one of those calls → Stage 1.2 |
| `classifyMisses` 45 of 8,248 (0.55%) | the classification cache works; the waste is constructing its *inputs* |
| `hostScans / hostLookups` = **1.00** | every window lookup is a full `list_all_windows()` scan → Stage 2 |
| `plansComputed` 0.61 + `sweepFrameReads` 1.14 per sweep, idle | the sweep computes plans and reads Mutter frames for nothing → Stage 3 |

## Counter contract (added by Stage 0)

These names are referenced by the tests of later stages, so Stage 0 fixes them.

Exposed under `DumpState.perf` and `DumpState.counters`:

| counter | meaning | owned by |
| --- | --- | --- |
| `sweeps` | coherence sweeps run | `WindowSession` |
| `sweepMsMax`, `sweepMsAvg` | sweep duration | `WindowSession` |
| `classifyCalls` | calls to `classify()` | `WindowSession` |
| `classifyMisses` | calls that actually ran the classifier (cache miss) | `WindowSession` |
| `configBuilds` | `ClassifyConfig`/`TilerConfig` objects constructed | `GnomeSettings` |
| `rulesParses` | `JSON.parse` of `rules-json` | `GnomeSettings` |
| `plansComputed` | `computePlans` calls | `WindowSession` |
| `plansApplied` | plans that moved ≥ 1 window | `Tiling` |
| `sweepFrameReads` | Mutter `get_frame_rect` reads from sweep gating | `WindowSession` |
| `hostLookups` | `windowById`/`windowFor` calls | `GnomeHost` |
| `hostScans` | `list_all_windows()` calls | `GnomeHost` |
| `logEvents` | `history.log` calls that wrote | `History` |

---

## Stage 0 — Instrumentation (no behaviour change)

*Deliverable: we can see the cost of everything, at all times, in one call.*

**Changes**

- `extension.ts` `DumpState`: add `counters` (the table above) next to the
  existing `perf`/`bounds` fields.
- `session.ts`: counters in `coherenceSweep` (`sweeps`, `sweepMsMax/Avg`),
  `classify`, `retile` (`plansComputed`), plus a `sweepFrameReads` counter around
  the `refreshFrame()` calls in the sweep.
- `settings.ts`: `configBuilds` + `rulesParses` counters in `classifierConfig`,
  `tilerConfig`, `rules`.
- `host.ts`: `hostLookups` + `hostScans`.
- `tiling.ts`: `plansApplied` in `applyPlan`.
- `history.ts`: `logEvents` in `log`.
- `tests/agent/lib.sh`: helpers `counters` (dump the counter block) and
  `counter_delta <name> <seconds>` (sample, sleep, sample, print the difference).

**Tests**

- `tests/agent/A66-performance-counters.sh`
  - every counter in the contract is present and non-negative;
  - two samples 4 s apart show `sweeps` increased (the sweep runs);
  - `sweepMsMax > 0` and `classifyCalls > 0` (the work is being measured).
  - Stable expectations only — later stages tighten their own scenarios, A66
    must keep passing unchanged for the rest of the plan.

**Invariant:** nothing behaves differently; this only observes.

---

## Stage 1 — Stop rebuilding configuration per call

*Deliverable: idle classification and planning stop allocating and parsing.*

Measured waste: `classify()` builds `ClassifyConfig` (3–4 GSettings reads +
`JSON.parse` + rule validation) and an array of every other window's title, then
`TrackedWindow.classify` returns the cached value and discards both. The sweep
does this ~40× per run, ~120×/min.

### 1.1 Consult the classification cache before building its inputs

- `tracked-window.ts`: expose `hasClassification` (and a `peekClassification()`).
- `session.ts` `classify()`: if the cached classification exists, return it and
  bump `classifyCalls` only; otherwise build config + context and classify
  (bump `classifyMisses`).
- Keep the existing invalidation contract (`invalidateClassification` on the
  five relevant signals) — do not add new caches.

**Test:** `tests/agent/A67-config-cache.sh` — with a pair tiled and idle for 3 s,
`configBuilds` and `rulesParses` must not increase, while `classifyCalls` does
(proving classification is still being consulted). Plus A32/A33 and the full
suite unchanged.

### 1.2 Memoize the parsed rules

- `settings.ts` `rules()`: memoize on the `rules-json` string (+
  `rules-enabled`), invalidated by the existing `watchSettings` hooks.

**Test:** covered by A67 (`rulesParses` delta 0 while idle), plus a core test
that `parseRulesJson` is pure (add to `tests/core/rules.test.ts` if not present).

### 1.3 Build `TilerConfig` once per pass, not once per group

- `session.ts`: `retile()` and `coherenceSweep()` compute `tilerConfig()` once
  before the workspace/screen loops; the ratios record and swap-pair set are
  copied once for that pass too.

**Test:** A67 extended — `configBuilds` grows by at most 1 per sweep/retile
(`plansComputed`-proportional), not per group. Full suite unchanged.

### 1.4 Stop rebuilding the heuristic title list

- `heuristicModal` already ignores the window's own title
  (`title !== surface.title`), so one shared, incrementally maintained array of
  all live titles is equivalent to the per-call "everyone except me" array.
- `session.ts`: maintain `titleList` (rebuild lazily when a `titleDirty` flag is
  set by `notify::title`, register, unregister); `heuristicContext` becomes a
  getter for that shared list.

**Tests:**
- core: extend `tests/core/classify.test.ts` — a classification is identical
  when the window's own title is present in `liveTitles`.
- nested: the existing heuristic-modal coverage (A-scenario using the
  `title — parent` form) and the full suite.

**Invariant for the stage:** all 65 existing scenarios and 139 core tests green.

---

## Stage 2 — O(1) window lookup in the host

*Deliverable: no `list_all_windows()` on the tile/animation path.*

`host.applyFrame` is called once per animated frame per window, and each call
scans `global.display.list_all_windows()`. The `surfaceCache` already holds the
Mutter window for every tracked id.

**Changes**

- `host.ts` `windowById()`: `return this.surfaceCache.get(id)?.win ?? null` with
  the existing scan kept **only** as a miss fallback (so behaviour is identical
  if a surface is somehow absent).
- `host.ts` `windowFor()`: delegate to `windowById` (removes the duplicate scan);
  `ensureSurface` is called just before it in the `surface-created` path.
- Cover `applyFrame`, `applyLayer`, `maximize`, `minimize`, `unmaximize`,
  `clearAbove`, `minSize`.

**Tests**

- `tests/agent/A68-host-lookup.sh`
  - `hostScans` does not increase across a retile and across a
    maximize/unmaximize cycle;
  - `hostLookups` increases (proving the calls still happen);
  - the window is still where the plan says after each step (guarantee).
- Existing A01/A07/A40/A50 (maximize/unmaximize/float) unchanged.
- Session suite: S03/S04/S11 cover the same paths live.

**Invariant:** every lifecycle action (`applyFrame`, maximize, minimize, float)
still reaches the right Mutter window — proven by the geometry assertions.

---

## Stage 3 — One pass over the windows, and skip no-op passes

*Deliverable: the sweep and reconcile stop being `O(workspaces × screens × windows)`
and stop computing plans when nothing changed.*

### 3.1 Bucket windows once per pass

- `session.ts`: replace the per-workspace `tileables(ws)` scans in `retile` and
  `coherenceSweep` with one pass over the window map producing
  `Map<workspace, Map<screen, TrackedWindow[]>>` (plus the classification
  results), then iterate the buckets. `autoFloated(ws)` reads the same bucket.
- Keeps `tileables()` public for callers that need it (D-Bus/diagnostics).

**Test:** A67/A69 assert `classifyCalls` per sweep is proportional to *windows*,
not windows × workspaces. Full suite unchanged.

### 3.2 Sweep gating: no plan, no Mutter read, when nothing has changed

- Track a per-window `dirtySinceSweep` flag set by `onFrameSignal`,
  `onFlagSignal`, `onMinimized`, `onWorkspaceSignal`, register/unregister.
- In the sweep: only `refreshFrame()` dirty windows (`sweepFrameReads` counts
  them); compute the plan only when the bucket's inputs changed since the last
  sweep, or the previous sweep left an offender.
- If a workspace has no live windows, skip it entirely.

**Tests**

- `tests/agent/A69-sweep-skip.sh` — idle 5 s with a tiled pair:
  `plansComputed` and `sweepFrameReads` must not increase, while `sweeps` does.
- **Guarantee tests** (the ones that make this safe):
  - `A48` (periodic retile heals a drifted window) unchanged;
  - `A33` (reconcile-all) unchanged;
  - `A53`, `A59`, `A62` (which lean on the sweep) unchanged;
  - new `A70-sweep-heals-stale-cache.sh`: using the test-only hook
    `SimulateCachedFrame(id, rect)` (mirrors `SimulateOverview`), make the cached
    frame disagree with the plan without emitting a signal, and assert the
    safety net restores the window. This is the "missed signal" the sweep exists
    for; without a test the gating would be unjustified.

### 3.3 Skip `computePlans` when the retile inputs are unchanged

- Share the input signature with 3.2; in `retile`, compute the plan only when
  the signature changed, an offender is known, or a settings revision changed.

**Test:** A69 (`plansComputed` delta 0 while idle) + full suite.

**Invariant for the stage:** the §35 guarantee "a normal window on a workspace
with a sibling is tiled" is still enforced — A70 is the explicit proof, and
A48/A53/A59/A62 are the regression set. This stage is the riskiest; run the
session suite (S09/S14 cover drift live) as well.

---

## Stage 4 — The motion watch and the per-frame adjust path

*Deliverable: the 50 ms watch and the drag path stop doing duplicate work.*

### 4.1 One focus lookup per tick

- `extension.ts` `onMotionTick`: fetch `focused` once and pass it to
  `refreshOcclusion(focused)` (currently `focused()` runs twice per tick, and
  `refreshOcclusion` classifies on its own).
- Replace `session.perf()` object allocation with plain getters.

**Test:** A66-style counters plus A47 (border hidden during a switch) unchanged.

### 4.2 One settle source for a drag, not a new one per frame

- `armAdjustEnd` currently removes and re-adds a GLib source on every frame
  signal (~60 Hz). Keep one source and a `lastAdjustFrameMs` stamp; when the
  source fires, re-arm if less than `ADJUST_SETTLE_MS` has elapsed.

**Test:** A-scenario for live resize (`A10`/`A11` class) unchanged; assert the
final split ratio is still learned (the existing split-resize scenario).

### 4.3 Event-driven motion watch (separate commit, revertible)

- Add `motion-watch-mode` (`poll` | `events`, default `poll`). In `events`, drive
  the watch from the focused actor's `notify::x`/`notify::y` (the machinery
  already exists for workspace actors) plus a sparse (250 ms) confirmation poll.
- Keep `poll` as the default until the event mode is validated on the live
  session, then flip the default in its own commit.

**Tests:** A47 and a new `A71-motion-events.sh` that asserts suppression starts
within the switch and clears once stable, run for **both** modes; session S07
(border during switch) covers the live case.

---

## Stage 5 — Cadence and logging (only if the measurements still justify it)

*Deliverable: idle cost trends to zero and log growth stays bounded.*

### 5.1 Adaptive sweep cadence

After Stage 3 the idle sweep is cheap; make the cadence adaptive anyway
(700 ms as the maximum while anything is dirty, backing off to ~3 s when idle),
mirroring the scan back-off. §35 requires the guarantee, not the frequency.

**Test:** A69 (unchanged), plus `sweeps` per unit time drops while idle and A48
still heals a drift promptly under activity.

### 5.2 `periodicRetile` review

Re-measure `motionRetiles`; fold it into the dirty-based check so it does not
duplicate the sweep. A48 is the regression test.

### 5.3 `history.log` fast path

Skip the deep `clipPayload` clone when every field is a primitive/short string;
optionally buffer writes with a short flush timer. The shell-crash fix and the
rotation must be untouched.

**Tests:** A65 (rotation + bounds) and A63 (clipped titles) unchanged; core test
asserting the fast path returns byte-identical output to the slow path for
primitive payloads.

---

## Verification matrix

| Stage | Core | Nested | Session | New tests |
| --- | --- | --- | --- | --- |
| 0 | all | all | — | A66 |
| 1 | all + classify/rules | all | — | A67 |
| 2 | all | all | S03/S04/S11 | A68 |
| 3 | all | all | S09/S14 | A69, A70 |
| 4 | all | all | S07 | A71 |
| 5 | all + text | all | S01 | — (extends A63/A65) |

## Budgets to assert once the counters exist

- `classifyMisses` per sweep while idle: 0.
- `configBuilds` while idle: 0.
- `plansComputed` while idle (no drift): 0.
- `sweepFrameReads` while idle: 0.
- `hostScans` during a retile/animation: 0.
- `sweepMsMax` with 5 windows: under 5 ms.
- One retile on a 2-window workspace: under 10 ms (§36.14) — already required by
  the spec, now measured.
- Scan tick on an idle desktop: no `perf` event with `last_reconcile_ms > 5`
  (§36.15).

## Stop / rollback conditions

- Any existing scenario that must change to pass → the stage is wrong: revert the
  stage, keep the measurement, re-plan.
- Stage 3 or 4 causing a border/animation regression on the live session →
  revert that stage's commit only (each stage is one commit, so `git revert` is
  clean).
- Stages are ordered by (impact ÷ risk); Stages 0–2 are behaviour-preserving and
  carry nearly all of the measured win, so they land first.

## Progress

| Stage | State | Commit | Evidence |
| --- | --- | --- | --- |
| 0 | **done** | `3b7103f` | counters live; A66 6/6; 139 core tests; 65 nested scenarios, 0 failures, 3 skips (keybindings need the live session) |
| 1 | not started | — | — |
| 2 | not started | — | — |
| 3 | not started | — | — |
| 4 | not started | — | — |
| 5 | not started | — | — |
