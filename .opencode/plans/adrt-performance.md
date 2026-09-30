# Adrt performance plan (staged checklist)

Branch: `perf/reduce-work` (from `master` at `e001980`)
Canonical detail: `PERFORMANCE_PLAN.md` (repo root, committed as `4d5ed64`).
Single source of truth for this checklist: this file. `~/.opencode/plan/` and
`~/.local/share/opencode/plans/` point here.

Tick a box as each item lands. A stage is done only when its tests pass.

## Ground rules

- [ ] One stage = one commit on `perf/reduce-work`
- [ ] Every change gets three tests: counter (the work went away), no-difference (existing suites unchanged), guarantee (a window that must be tiled is tiled)
- [ ] Never mark a test passed without running it
- [ ] Run core + nested always; run the session suite for Stages 2, 4, 5
- [ ] `bash scripts/check-core-purity.sh` stays OK
- [ ] Update `TEST_MATRIX.md`, `TESTING.md`, `CHANGELOG.md` per stage

## Baseline (2026-09-30, live: 5 windows / 4 workspaces)

| metric | delta / 12 s | note |
| --- | --- | --- |
| coherenceSweeps | 17 | 700 ms cadence, forever |
| coherenceFixes | 0 | the most expensive loop fixed nothing |
| motionRetiles | 0 | — |

## Stage 0 — instrumentation (no behaviour change)

- [x] Counters in `DumpState.counters`: `sweeps`, `sweepMsMax/Avg`, `classifyCalls`, `classifyMisses`, `configBuilds`, `rulesParses`, `plansComputed`, `plansApplied`, `sweepFrameReads`, `hostLookups`, `hostScans`, `logEvents`
- [x] Wire them: `session.ts` (sweep/classify/plan), `settings.ts` (config builds, rules parses), `host.ts` (lookups/scans), `tiling.ts` (plans applied), `history.ts` (log events)
- [x] Test helpers in `tests/agent/lib.sh`: `counters`, `counter`, `counter_delta`, `assert_num`
- [x] New test `tests/agent/A66-performance-counters.sh` (counters present, sweep advancing, work measured) — 6/6
- [x] Run core + nested; commit — 139 core, 65 scenarios, 0 failures, 3 skips

## Stage 1 — stop rebuilding configuration per call

- [ ] 1.1 Consult the classification cache before building its inputs (`tracked-window.ts` `hasClassification`; `session.ts` `classify()`)
- [ ] 1.2 Memoize parsed rules on the `rules-json` string (`settings.ts` `rules()`)
- [ ] 1.3 Build `TilerConfig` once per pass, not per workspace×screen group
- [ ] 1.4 Share one incrementally maintained title list (`heuristicModal` already excludes self)
- [ ] New test `tests/agent/A67-config-cache.sh`: idle 3 s → `configBuilds`/`rulesParses` delta 0, `classifyCalls` delta > 0
- [ ] Core: extend `tests/core/classify.test.ts` (own title in `liveTitles` does not change the result)
- [ ] Run core + nested; commit

## Stage 2 — O(1) window lookup in the host

- [ ] `host.ts` `windowById()` resolves via `surfaceCache`, scan kept only as a miss fallback
- [ ] `host.ts` `windowFor()` delegates to `windowById`
- [ ] New test `tests/agent/A68-host-lookup.sh`: `hostScans` unchanged across a retile and a maximize cycle; the window still lands where the plan says
- [ ] Regression: A01/A07/A40/A50; session S03/S04/S11
- [ ] Run core + nested + session; commit

## Stage 3 — one pass over windows, skip no-op passes

- [ ] 3.1 Bucket windows once per pass: `Map<workspace, Map<screen, TrackedWindow[]>>`; `autoFloated` reads the same bucket
- [ ] 3.2 Sweep gating: per-window `dirtySinceSweep`; only `refreshFrame()` dirty windows; skip the plan unless inputs changed or an offender remains; skip empty workspaces
- [ ] 3.3 Skip `computePlans` when the retile input signature is unchanged
- [ ] New test `tests/agent/A69-sweep-skip.sh`: idle 5 s → `plansComputed`/`sweepFrameReads` delta 0, `sweeps` advancing
- [ ] New test `tests/agent/A70-sweep-heals-stale-cache.sh` (add test-only `SimulateCachedFrame(id, rect)`)
- [ ] Guarantee regressions: A48, A33, A53, A59, A62; session S09/S14
- [ ] Run core + nested + session; commit

## Stage 4 — motion watch and per-frame adjust path

- [ ] 4.1 One `focused()` per motion tick; pass it to `refreshOcclusion`; drop the `perf()` allocation
- [ ] 4.2 One settle source per drag (`lastAdjustFrameMs`), not remove+add per frame
- [ ] 4.3 Event-driven motion watch behind `motion-watch-mode` (`poll` default), flip the default later in its own commit
- [ ] New test `tests/agent/A71-motion-events.sh` run for both modes; regression A47; session S07
- [ ] Run core + nested + session; commit

## Stage 5 — cadence and logging (only if still justified)

- [ ] 5.1 Adaptive sweep cadence (700 ms maximum while dirty, ~3 s when idle)
- [ ] 5.2 Fold `periodicRetile` into the dirty-based check (A48 as regression)
- [ ] 5.3 `history.log` fast path for primitive payloads (A63/A65 unchanged; core test for identical output)
- [ ] Run core + nested + session; commit

## Budgets to assert

- [ ] `classifyMisses` per idle sweep: 0
- [ ] `configBuilds` while idle: 0
- [ ] `plansComputed` while idle: 0
- [ ] `sweepFrameReads` while idle: 0
- [ ] `hostScans` during a retile/animation: 0
- [ ] `sweepMsMax` with 5 windows: < 5 ms
- [ ] One 2-window retile: < 10 ms (§36.14)
- [ ] Idle scan tick: no `perf` with `last_reconcile_ms > 5` (§36.15)

## Progress

- [x] Branch `perf/reduce-work` created from `e001980`
- [x] Full plan written (`PERFORMANCE_PLAN.md`, commit `4d5ed64`)
- [x] Checklist available at `~/.opencode/plan/adrt-performance.md` and `~/.local/share/opencode/plans/adrt-performance.md`
- [x] Stage 0 — counters + `A66` (6/6); core 139/139; nested 65 scenarios, 0 failures, 3 skips (commit `3b7103f`)
- [ ] Stage 1
- [ ] Stage 2
- [ ] Stage 3
- [ ] Stage 4
- [ ] Stage 5
