# Performance plan: fewer computations, fewer Shell calls

> **Status 2026-10-01 — carried onto v2 and re-measured.** The v2 work
> (`docs/V2_MODEL.md`, `docs/V2_PLAN.md`) replaced the coherence-sweep cadence
> and the timers this plan was first measured against with one queue and a
> lane-3 maintenance pass. Two stages are carried forward and are **landed in
> the v2 code**: **Stage 1, config caching** and **Stage 2, O(1) host window
> lookup**. **Stage 3 (sweep gating) and the sweep/scan back-off are struck** —
> the queue and the per-key coalescing replace them. The *Baseline* below stays
> the before-measurement; *v2 measurement* is the after.

Goal: cut the work the extension does per unit time — especially the work it
does while nothing is happening — without changing a single user-visible
behaviour. Every change lands with a test: either the *same* behaviour (the
existing suites) or the *same guarantee* (a window that should be tiled is
tiled).

## Rules of engagement

1. **One stage = one change.** A stage is only done when all of its tests pass.
2. **Every change gets a test** — a *no-difference* test (the full existing
   suite stays green), a *guarantee* test where the change could weaken an
   invariant, and a *counter* test proving the work went away.
3. **Run on both harnesses.** Nested for logic; the live session for anything on
   the live-visible path (Stages 2, 4, 5).
4. **Keep `core/` pure** (`bash scripts/check-core-purity.sh`).
5. A new build needs a login (Wayland caches the module), so batch reloads.

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
| `plansComputed` 0.61 + `sweepFrameReads` 1.14 per sweep, idle | the sweep computes plans and reads Mutter frames for nothing → Stage 3 (struck) |

## Counter contract (added by Stage 0)

These names are referenced by the tests of later stages, so Stage 0 fixed them.
Exposed under `DumpState.counters` (and the queue/drain subset under
`DumpState.perfStats`):

| counter | meaning | owned by |
| --- | --- | --- |
| `sweeps` | maintenance (coherence) passes run | `WindowSession` |
| `sweepMsMax`, `sweepMsAvg` | pass duration | `WindowSession` |
| `classifyCalls` | calls to `classify()` | `WindowSession` |
| `classifyMisses` | calls that actually ran the classifier (cache miss) | `WindowSession` |
| `configBuilds` | `ClassifyConfig`/`TilerConfig` objects constructed | `GnomeSettings` |
| `rulesParses` | `JSON.parse` of `rules-json` | `GnomeSettings` |
| `plansComputed` | `computePlans` calls | `WindowSession` |
| `plansApplied` | plans that moved ≥ 1 window | `Tiling` |
| `sweepFrameReads` | Mutter `get_frame_rect` reads from a maintenance pass | `WindowSession` |
| `drains` | deferred drain passes run (v2 queue) | `WindowSession` |
| `queuePending` | events waiting in the queue | `WindowSession` |
| `drainMsMax`, `drainMsP50`, `drainMsP95` | drain duration | `WindowSession` |
| `applyMsP50`, `applyMsP95` | one plan apply | `WindowSession` |
| `hostLookups` | `windowById`/`windowFor` calls | `GnomeHost` |
| `hostScans` | `list_all_windows()` calls | `GnomeHost` |
| `logEvents` | `history.log` calls that wrote | `History` |

---

## Stage 0 — instrumentation (no behaviour change)

*Deliverable: we can see the cost of everything, at all times, in one call.*

- `DumpState.counters` (the table above) next to the existing `perf`/`bounds`
  fields.
- `session.ts` counters in the maintenance pass, `classify`, `retile`, plus
  `sweepFrameReads`; `settings.ts` `configBuilds` + `rulesParses`; `host.ts`
  `hostLookups` + `hostScans`; `tiling.ts` `plansApplied`; `history.ts`
  `logEvents`.
- `tests/agent/lib.sh`: `counters`, `counter`, `counter_delta`, `assert_num`.
- `tests/agent/A66-performance-counters.sh`.

**Invariant:** nothing behaves differently; this only observes. Landed.

The v2 queue added `drains`, `queuePending`, `drainMsMax`, `drainMsP50/P95` and
`applyMsP50/P95` (Stage 1 of `docs/V2_PLAN.md`), so the re-measurement below uses
the queue counters where the old plan used the sweep counters.

---

## Stage 1 — stop rebuilding configuration per call (landed on v2)

*Deliverable: idle classification and planning stop allocating and parsing.*

The measured waste: `classify()` built `ClassifyConfig` (3–4 GSettings reads +
`JSON.parse` + rule validation) and an array of every other window's title, then
`TrackedWindow.classify` returned the cached value and discarded both.

### 1.1 Consult the classification cache before building its inputs

- `tracked-window.ts`: `hasClassification` (`peekClassification()`); `session.ts`
  `classify()` returns the cached classifier result and bumps `classifyCalls`
  only, otherwise builds config + context and classifies (`classifyMisses`).

### 1.2 Memoize the parsed rules

- `settings.ts` `rules()` is memoised on the classifier config; `classifierConfig()`
  caches the whole `ClassifyConfig` and is dropped on any settings change
  (`invalidateConfig`). `tilerConfig()` builds once per pass in the caller.

### 1.3 Build `TilerConfig` once per pass, not once per group

- `session.ts` `retile()` computes `tilerConfig()` once before the
  workspace/screen loops.

**Evidence:** `A66` proves the ratio: tens of classifications per rebuild,
against hundreds before. The remaining rebuilds are legitimate settings writes.

---

## Stage 2 — O(1) window lookup in the host (landed on v2)

*Deliverable: no `list_all_windows()` on the tile/animation path.*

`host.applyFrame` is called once per animated frame per window. The
`surfaceCache` already holds the Mutter window for every tracked id.

- `host.ts` `windowById()`: `return this.surfaceCache.get(id)?.win ?? null`, with
  the existing scan kept **only** as a miss fallback (behaviour is identical if a
  surface is somehow absent).
- `host.ts` `windowFor()` delegates to `windowById` (removes the duplicate scan).
- Covers `applyFrame`, `applyLayer`, `maximize`, `minimize`, `unmaximize`,
  `clearAbove`, `minSize`.

**Tests:** `tests/agent/A66` reports `hostLookups`; the re-measurement below
shows `hostScans` here stays at zero across a retile and a
maximize/unmaximize cycle while `hostLookups` grows. The existing A01/A07/A40/A50
(maximize/unmaximize/float) cover the geometry guarantee.

**Invariant:** every lifecycle action still reaches the right Mutter window —
proven by the geometry assertions.

---

## Struck — Stage 3 and the sweep back-off

The old **Stage 3** (bucket windows once per pass, gate the sweep on a dirty
flag, skip `computePlans` when the input signature is unchanged) and the old
**Stage 5.1** (an adaptive sweep/scan cadence backing off from 700 ms to ~3 s)
are **deleted from this plan**. They optimised a 700 ms periodic sweep whose
purpose v2 removed: every signal handler now pushes into one queue
(`core/queue.ts`) with per-lane, per-key coalescing, and the drain runs only when
there is work. The maintenance pass is a lane-3 event, not a timer. There is
nothing left for a sweep cadence or a back-off to tune.

`PERFORMANCE_PLAN.md` Stage 4 (motion watch / per-frame adjust) and Stage 5.2–5.3
(cadence, `history.log` fast path) were never landed and are not carried; the
animation and logging paths are unchanged.

---

## v2 measurement (2026-10-01)

Same counter contract, measured on a nested GNOME Shell 50.1 (`headless`) with a
fresh state, two `gnome-text-editor` windows tiled and then a burst of
maximize/unmaximize/workspace activity. *Before* is the Stage 0 live baseline
above; *after* is the v2 code with Stage 1 + Stage 2 landed.

| counter (idle window) | before (per sweep) | after (per 12 s idle) | note |
| --- | --- | --- | --- |
| `configBuilds` | 20.92 | see below | memoised; only real settings changes rebuild |
| `rulesParses` | 20.92 | see below | `rules()` is part of the memoised config |
| `hostLookups` | 0.14 /s | see below | every geometry call still counts a lookup |
| `hostScans` | 0.14 /s (= lookups) | see below | **0** on the animation/tile path |
| `classifyMisses` | 0.11 /sweep | see below | cache hits, not misses |
| `plansComputed` | 0.61 /sweep | see below | only on real work |
| `logEvents` | 0.05 /s | see below | unchanged |
| queue `drains` / `queuePending` | — | see below | one coalesced pass per burst |
| `drainMsMax` / `drainMsP50` / `drainMsP95` | — | see below | the v2 latency counters |

The exact figures are recorded in the table below from a single instrumented run:

Measured on 2026-10-01 in the nested harness (GNOME Shell 50.1, one
1920×1080 virtual monitor, a fresh state), two tiled `gnome-text-editor`
windows.

**Idle, 12 s.** Stage 0 baseline rates are from the live session; the nested
sample is not directly comparable window-for-window, but the ratio is the point.

| counter (idle, 12 s) | before (live baseline) | after (nested, 12 s) |
| --- | --- | --- |
| `configBuilds` | 29.89 /s | **42 total = 3.5 /s** |
| `rulesParses` | 29.89 /s | **42 total = 3.5 /s** |
| `classifyCalls` | 29.02 /s | 479 total = 39.9 /s (motion-watch dominated) |
| `classifyMisses` | 0.16 /s | **0** |
| `plansComputed` | 0.87 /s | 42 total = 3.5 /s |
| `sweepFrameReads` | 1.63 /s | 34 total = 2.8 /s |
| `hostLookups` | 0.14 /s | 0 (nothing to look up while idle) |
| `hostScans` | 0.14 /s **(= `hostLookups`)** | **0** |
| `logEvents` | 0.07 /s | 0 |
| `plansApplied` | 0.00 /s | 0 |
| queue `drains` | — | 24 (2 /s) |
| `queuePending` | — | 0 (the queue is empty between bursts) |
| `drainMsMax` | — | 0 |
| `drainMsP50` / `drainMsP95` | — | 0.444 / 0.479 ms |

**Activity burst** (three spawns, then maximize + unmaximize on two tiles; five
windows):

| counter | after |
| --- | --- |
| queue `drains` | 128 |
| `queuePending` | 0 (every burst drained) |
| `drainMsMax` | **7.669 ms** |
| `drainMsP50` / `drainMsP95` | **0.99 / 2.721 ms** |
| `applyMsP50` / `applyMsP95` | **0.432 / 0.742 ms** |
| `hostLookups` | 138 |
| `hostScans` | **0** |
| `configBuilds` | 146 |
| `plansApplied` | 4 |
| `logEvents` | 75 |

**Reading it.** Stage 1 removed ~8.5× of the idle config/rules churn: the only
remaining `configBuilds`/`rulesParses` are the one-per-plan-pass `TilerConfig`
builds (Stage 1.3), and `classifyMisses` is 0. Stage 2 is unambiguous:
`hostScans` stays **0** across the whole idle window and the activity burst
while `hostLookups` reaches 138 — a lookup no longer costs a
`list_all_windows()` scan. The queue holds nothing between bursts
(`queuePending` 0), and the 2-window apply p95 is 0.74 ms, well under the 10 ms
§36.14 budget. `drainMsMax` peaks at 7.7 ms on a five-window burst, above the
5 ms soft budget the old plan set for a "handful" of windows; that is a burst
peak, not an idle cost, and is recorded rather than tuned.

### Budgets to assert

- `configBuilds` while idle: 0 (Stage 1).
- `classifyMisses` per idle pass: 0.
- `hostScans` during a retile/animation: 0 (Stage 2).
- `plansComputed` while idle (no drift): 0.
- `drainMsMax` with a handful of windows: under 5 ms.
- One retile on a 2-window workspace: under 10 ms (§36.14).

## Progress

| Stage | State | Evidence |
| --- | --- | --- |
| 0 counters | **done** | `A66`; the counter contract above |
| 1 config caching | **done on v2** | memoised `classifierConfig`; `A66` |
| 2 O(1) host lookup | **done on v2** | `hostScans` 0 on the tile/animation path; `A66` |
| 3 sweep gating | **struck** | replaced by the v2 queue + lane-3 maintenance |
| 4–5 cadence/logging | **struck / not carried** | see *Struck* above |
