# Adrt — Quality Plan (`master`)

> **Status: proposed, 2026-10-08.** Baseline commit `b2e46d7` (`master`).
> **Execution:** all work lands on branch `perf-gnome` (created from
> `refactor/clean-arch-v3`, so P1–P5 of the backlog are already the base).
> `master` receives the branch once it is green; P0 below is executed there.
> **Behaviour authority:** `docs/V2_MODEL.md`. This plan changes structure,
> performance and type safety — not behaviour. If a step would change a
> user-visible behaviour, stop and route it through the model first.
> **Scope:** `src/`, repo tooling, and tests. No runtime dependencies (EGO), no
> bundler, `core/` stays pure and deterministic.

## Goals

1. **Less complexity / easier maintenance** — no god files, no duplicated
   policy, one owner per state.
2. **Less bug surface** — no silent failure paths, no untracked GLib sources,
   no races fixed by sleeps; invariants enforced or deleted.
3. **Minimal allocations** — the hot set (drain, retile, per-frame, per-signal)
   allocates only what it must; every cache names its invalidation event.
4. **Smooth compositor loop** — no synchronous I/O in signal or frame
   handlers; bounded work per event; frame-time budget respected.
5. **Full type safety, zero `any`** — including the hand-written `gi.d.ts`;
   tests typechecked; lint prevents regressions.

## Progress

| Phase | Content | State |
| --- | --- | --- |
| P0 | Land ready refactor + repair the green gate | **done** (gate fixes on `perf-gnome`; nested smoke pending) |
| P1 | Correctness sweep | **done** — 1.1–1.9, 1.11–1.14 committed; 1.10 done for session.ts; live-verified: smoke 52/52, full suite 156/0 (21 multi-monitor skips), two real regressions found and fixed (A90/A152 workspace echo, A159 maximize echo) |
| P2 | Main-loop & allocation diet | **done** — 2.7 resolved by live measurement: idle 12 s with a window shows `sweeps` +18 at ~0.15 ms each, `classifyMisses` 0, `plansComputed` 0, `sweepFrameReads` 0, `configBuilds` 0, `drains` 0; gating would save ~0.2 ms/s and weaken the §35 guarantee, so the 700 ms sweep stays. 2.9 profiler verified by nested A165 |
| P3 | Zero `any` | **done** — zero explicit `any` in `src` including `gi.d.ts`, tests type-checked, `no-explicit-any` and type-aware `no-floating-promises` enforced; no `as unknown as` remains (handler maps are type aliases, so reflective dispatch is assignable without one) |
| P4 | Decomposition & deletion | **done** — session split and extension extraction (`session.ts` 4,083 → 1,891; `extension.ts` 3,102 → 1,827), trigger table, JSONL unification, helper dedupe, settings descriptor with drift gate, dead files/exports cleared under knip. Kept deliberately: test-only core exports, `topology.ts` |
| P5 | Guardrails (CI/tests/docs) | **done** — check:types, coverage guard, shellcheck, knip, ARCHITECTURE.md, docs hygiene; the generated fuzz cases are prose expectations (the generator documents them as a design catalogue); a new nested A165 verifies the section profiler |

---

## 1. Ground truth (measured 2026-10-08, `master`)

| Fact | Evidence |
| --- | --- |
| ~20k TS lines: `core/` 5,797 · `platform/` 189 · `adapters/gnome/` 13,978 | `wc -l` |
| God files: `session.ts` **3,876**, `extension.ts` **3,032**; next: `prefs.ts` 865, `host.ts` 656, `tiling.ts` 557 | `wc -l` |
| **202** type-level `any` in adapters (`compat.ts` 38, `gi.d.ts` 27, `prefs.ts` 25, `host.ts` 20, `extension.ts` 16, `session.ts` 15, …); **0** in `core/` + `platform/` | `grep ":\s*any\b\|as any\|<any>"` |
| `no-explicit-any` is **off**; tests are **never typechecked** (`tsconfig.json` includes only `src`); 6 `as unknown as`; 3 `!` (all `core/topology.ts`) | `eslint.config.js:25`, `tsconfig.json:20` |
| **`master` fails its own purity gate today**: `Shell.` matches the prose “without a Shell.” in `src/core/recording.ts:65`. CI runs it (`.github/workflows/ci.yml`, core job) ⇒ master CI is red | `npm run check:core` → exit 1 |
| `refactor/clean-arch-v3` = `master` + 6 commits (P1–P5), rebased (strict descendant). Build, lint and **485/485** core tests green in a scratch worktree; only the same pre-existing purity false positive fails. It does **not** touch `session.ts`, P6/P7, and adds 5 new `any` in `lifecycle.ts`/`shell-tracker.ts` | `git rev-list --left-right --count master...refactor/clean-arch-v3` = `0 6`; run recorded 2026-10-08 |
| `perf/reduce-work` is the same content plus a merge commit | `git log master..perf/reduce-work` |
| `dist/` ships stale modules with no `src/` counterpart (`dist/adapters/gnome/shell-tracker.js`, `lifecycle.js`); `tsc` never cleans `outDir`, packaging copies the tree | `tsconfig.json:8`, `scripts/package.sh` |

**The cheapest win:** P1–P5 of `docs/DESIGN_BACKLOG.md` §2 already exist on
`refactor/clean-arch-v3` and are green. Land them before doing anything else.

---

## 2. Ground rules

1. Behaviour-preserving unless the change is a numbered model amendment.
2. `core/` stays pure (`scripts/check-core-purity.sh`) and deterministic (no
   wall clock, randomness, or I/O).
3. One named smell → one commit. Green gate before each commit: `lint`, `tsc`,
   `vitest run tests/core`, purity, build; nested smoke for adapter changes
   (under the `flock`).
4. **No perf claim without a counter.** `DumpState` counters and `A66` already
   exist — they are the acceptance evidence for P1/P2.
5. Revert rather than debug a broken step.
6. Keep `DumpState` add-only; keep trigger names honest (`Inject*` = real input,
   `Simulate*` = state-only).

---

## 3. Phase 0 — collect the ready wins, repair the gate (S–M)

### 0.1 Land `refactor/clean-arch-v3` (S)

The branch is `master` + 6 commits and a strict descendant, so it is a
fast-forward-quality merge. It brings:

- `src/adapters/gnome/lifecycle.ts` — signal and timer registries; every
  connection/timer owned and drained in one pass (P1).
- `src/adapters/gnome/shell-tracker.ts` — session mode, overview, workspace
  actors/animation and system workspace-mode settings live in an event emitter;
  no policy in handlers (P2).
- `frame-clock.ts` — `tweenRect` + `createAnimationLedger` (functional
  animation, live-transition accounting) (P3).
- `extension.ts` / `host.ts` / `indicator.ts` / `tiling.ts` — dead wiring and
  helpers removed; host/indicator own their registries (P4/P5).

Landing checklist (executed 2026-10-08 on `perf-gnome`):

- [x] Review the three semantic moves (tracker owns
      `workspace-added`/`removed`; host/indicator own their wiring; the
      animation ledger).
- [x] Branch base created from `refactor/clean-arch-v3`.
- [ ] One nested smoke run (the core suite does not exercise `host`/`indicator`)
      — needs a GNOME Shell; pending.
- [ ] The 5 new `any` in `lifecycle.ts`/`shell-tracker.ts` are carried into P3.
- [ ] `master` receives the branch when green (user review); retire
      `perf/reduce-work` then.

If review rejects a piece, the six commits are individually cherry-pickable.

### 0.2 Fix the purity gate (S)

`scripts/check-core-purity.sh` greps raw text, so a sentence ending in “Shell.”
trips `Shell\.`. Match imports/member access instead (e.g. `from 'gi://` and
`\b(Meta|Shell|St|Clutter|global|Main)\.` on non-comment lines), or move the
rule to eslint `no-restricted-imports`/`no-restricted-syntax` so prose cannot
fail it. CI must be green again.

### 0.3 Clean the build output (S)

`rm -rf dist && tsc` (or a stamp file) in `build`; make `package.sh` and
`install.sh` rebuild whenever any source is newer **or any source was deleted**.
Stale modules must not be shippable.

### 0.4 Start a progress log (S)

Append a short, dated entry per merged phase to `CHANGELOG.md`; keep the P0–P5
table above current.

**Exit criteria:** `master` passes `lint`, `tsc`, core tests, purity and a
nested smoke; `dist/` contains exactly the current `src/` graph.

---

## 4. Phase 1 — correctness sweep (M–L per item, ~1–2 weeks)

One commit + one regression test each. Ranked by blast radius.

1. **Async self-apply suppression races (L).** `suppress`/`selfUnmaximize` are
   added and deleted synchronously around calls
   (`session.ts:600, 911, 1034, 1751, 2171, 2562, 2983`) while the Mutter
   signals arrive later; `SELF_APPLY_MS` exists to paper over that. Replace with
   echo cancellation keyed to the signal payload, behind one
   `withSelfUnmaximize(tracked, fn)` helper (6 duplicated blocks).
2. **Untracked GLib sources in `armDrain` (M).** The lane-3 timeout and the
   no-laters fallback (`session.ts:1430-1457`) are not registered, so `destroy`
   cannot cancel them; if `laters.add` throws after `drainArmed[lane] = true`
   the lane stays armed forever. Register every source (P0's `TimeoutRegistry`
   helps) and add a torn-down drain test.
3. **Synchronous disk I/O on the compositor thread (L).** Every platform event
   is journaled — including `surface-frame-changed`, which fires on every
   `notify::frame-rect` (`host.ts:185-187`, `extension.ts:928-931`) — and
   `journal.writeLine` opens/queries/appends/closes per line
   (`journal.ts:186-212`). Border focus writes another line per animated frame
   (`extension.ts:1370-1379`). Fix: keep the in-memory ring always; buffer file
   writes and flush on a ~1 s idle timer / `DumpEvents` / disable; skip
   frame-changed file lines unless a recorder or trace is armed. One shared
   writer for `History`/`EventJournal`/`Recorder`.
4. **`History.prune` is never called (S).** `history-retention-days` is a
   no-op and day files grow forever. Wire it (like `journal.prune`) or delete
   the setting.
5. **Unguarded `registry.save()` (S).** `writeAtomic` can throw inside the
   GLib timeout (`registry.ts:313-325`) and propagate into the main loop. Add
   the boundary `journal`/`history` already use.
6. **`FrameClockAnimator.cancel` drops `onComplete` (S).** `frame-clock.ts:124`
   never invokes it, so a cancelled animation skips the verify ladder
   (`tiling.ts:311-312`). Decide: cancel should still verify; add a test.
7. **Ratio keys are monitor-index based (M).** Persisted keys use
   `screen.index`/`screenId` (`tiler.ts:97`, `tiling.ts:143, 394`) while the
   D-Bus API selects by connector (`tiling.ts:149-166`); a replug or reorder can
   bind a ratio to the wrong screen. Prefer connector-keyed storage with a
   one-time migration.
8. **Caches returned by reference (S).** `host.screens()` returns
   `screensCache` (`host.ts:329-331`) and `session.getDisplayMemory()` returns
   the internal array; callers can mutate state. Return copies or freeze —
   these are not hot paths.
9. **`checkPlan` notices but does not enforce (S).** Violations are logged, the
   plan is applied anyway, and `mins` is never passed (`session.ts:1764`), so
   the below-min invariant (`invariants.ts:67-70`) never runs in production.
   Pass `mins` or delete the check; do not keep the half-measure.
10. **Silent catches that hide failures (M).** `screenClass`
    (`session.ts:709-720`), `move_to_monitor`, `recenterModal`, `parseSpawnEnv`,
    and the injection paths swallow errors with fallbacks and no diagnostic.
    Convert to report-with-context through the existing boundary.
11. **`enable()` swallows its own throw (M).** `extension.ts:288-293` logs and
    returns normally, leaving a half-built extension “enabled” (self-heal needs
    3 errors/60 s). Either rethrow after logging (GNOME then calls `disable()`)
    or force an immediate self-restart on enable failure. Add a fault-injection
    test.
12. **Core contract nits (M).** `queue.drainAge` returns the *oldest* age while
    documented “newest” (`queue.ts:100-105`); `gestures.ts` hands out a shared
    mutable `NONE_ACTION` singleton; `core/session.ts` has two different
    `paused` answers and allocates a `state` object per getter;
    `appregistry.fromJSON` has no version guard and trusts persisted ordinals
    (duplicates possible); `mergeBundles` silently drops `registry`
    (`config.ts:230-258`); `clampRectToArea` returns the *input object* when
    already inside (`types.ts:157-174`).
13. **`appregistry` integrity (M).** `fromJSON` should refuse newer versions and
    re-derive ordinals; `rekey` is O(n²). Registry data is user-persisted state
    — corruption here is silent.
14. **`host.applyLayer` ignores `order` (S).** Either implement the z-order or
    delete the parameter from the platform interface — currently the interface
    promises something the adapter drops.

**Exit criteria:** every item has a test; nested smoke passes; no new
`catch { /* ignored */ }` without a reason.

---

## 5. Phase 2 — main-loop & allocation diet (M–L per item, measured)

The cost here is GC pressure and main-loop stalls, not CPU. Measure each item
with `DumpState` counters and `drainMs*`/`applyMs*`, and keep `A66` green.
Idle targets: `configBuilds` 0, `classifyMisses` 0, `hostScans` 0;
`drainMsMax` < 5 ms with a handful of windows; retile < 10 ms (§36.14).

1. **Per-frame allocations in the animator (M).** `frame-clock.ts:118/129/160`
   (and the v3 ledger) build an `AnimRecord` + three rect copies **before** the
   `recording` check; `extension.ts:354-355` allocates a `guard()` closure per
   frame. Guard before constructing; bake the try/catch into the ledger so the
   hooks are bound once.
2. **`classify` allocates its inputs on cache hits (M).**
   `session.ts:2472-2484` builds a `liveTitles` array of every window title even
   when `TrackedWindow` has the cached answer; `refreshOcclusion` then calls it
   per window per motion tick ⇒ O(n²) strings. Only build the context on a
   miss, and only when `heuristicModalDetect` is on.
3. **Config/rules rebuild per screen per retile (M).**
   `session.ts:2486-2494` rebuilds `TilerConfig` + `new Set(swapPairs)` inside
   the per-workspace/per-screen loop, and `rules()` re-parses JSON;
   `PERFORMANCE_PLAN.md` Stage 1.3 claims “once per pass” — make that true.
   Compile rule globs once (`rules.ts:54-67`).
4. **Timing resolution per frame (L).** `GnomeTiming.resolve()`
   (`timing.ts:155-163`) re-reads St props, GSettings and OS values and
   copies+sorts up to 48 samples on every call; `effectiveDuration` calls it
   twice. Cache the resolved value, invalidate on the notify signals already
   wired, and keep `summary()` out of the per-frame path. This is the main
   steady allocation source.
5. **Per-pass reuse in `session.ts` (L).** `tileables()` filters+sorts+
   classifies per call and is called 2–3× per pass (`session.ts:1848-1865`,
   `retile`/`nonTransient`/`doesNotFit`); `reconcileAll` copies the window map
   three times and retiles every workspace×screen. Build once per pass; use
   generation counters instead of repeated Maps/Sets.
6. **O(1) screen lookup (M).** `screenFor` is a linear scan
   (`session.ts:2515-2520`) called ~30× across the file. Have `GnomeHost`
   maintain `Map<screenIndex, Screen>` and pass it down.
7. **Gate the 700 ms coherence sweep (M–L) — resolved by measurement
   (2026-10-08), kept as-is.** Idle 12 s in a nested Shell with a window:
   `sweeps` +18 (~0.15 ms each ≈ 0.2 ms/s), `classifyMisses` 0,
   `plansComputed` 0, `sweepFrameReads` 0, `configBuilds` 0, `drains` 0. The
   earlier stages removed the churn this item targeted; gating would add state
   and weaken the §35 guarantee for noise. Revisit only if a future workload
   makes `sweepMsAvg` visible.
8. **Allocation hygiene in core (M).** `computePlans` copies/sorts up to 4× and
   re-snaps rects at scale 1 (`tiler.ts:426-494`; `snapRect` can return its
   input); `profiles.profileFor` re-normalizes every family per call
   (`profiles.ts:90-102`); `normalize.ts:82-107` does 3 sorts + 5 copies;
   `timing.summary()` copies+sorts per call; `appregistry.placements()` sorts
   per call. Fix only sites reachable from the hot set; skip the rest.
9. **Dev-gated section profiler + budget test (M).** Implement backlog item
   P6e (`docs/DESIGN_BACKLOG.md:107`): named sections → count/ms in
   `DumpState.perfStats`, zero cost when off; one churn-workload test asserting
   bounded counters.
10. **Rule:** every cache names the event that invalidates it, or it does not
    land. A stale cache is a bug.
11. **Data structures & OS mechanisms (added 2026-10-08).** A frequency-weighted
    structure review, applied only where it wins: keep the three-lane queue
    (O(1) per-key coalescing beats a heap below ~64 pending events; a heap loses
    the coalescing invariant), but make `has()` O(1) with a key→lane index and
    reuse the drain output buffer; replace `Array.shift()` overflow in the
    journal/decision rings with a fixed circular buffer (O(1) instead of O(n));
    back linear scans with indexes (`screenFor` → host-owned Map, registry
    ordinals → secondary index); keep signals-first wiring (the 700 ms sweep is
    the only periodic guarantee and gets gated, not tuned); keep GLib scheduling
    as-is (drains on `LaterType` at default priority, IO flush at low priority,
    every source owned by a registry); replace-on-write for shared arrays;
    buffered append-only JSONL + atomic replace for state files. Rejected on
    purpose: runtime deps (EGO), heap-based global queue, worker threads (not
    available in the Shell), mmap/journald. Every change here lands with a
    measured counter delta or it is reverted.

**Exit criteria:** the idle/retile targets above, each with a before/after
counter sample recorded in the PR/commit message. Revert any item with no
measurable win.

---

## 6. Phase 3 — zero `any` (L–XL, parallelizable by file)

Root cause: `gi.d.ts` declares whole GJS namespaces as `any`
(`gi.d.ts:14-109`), so every call site leaks. `core/` and `platform/` are
already clean. Type-only: if a fix would force a behaviour change, stop and
report.

1. **Expand `gi.d.ts`** into accurate declarations for the surface actually
   used: `Meta.Window/Display/Workspace/WorkspaceManager`,
   `Clutter.Actor/Timeline`, `St.Widget`, `Gio.Settings/File/DBus*`, `GLib`,
   `Main`, `Shell.Extension`, `global`. Start from `compat.ts` + `host.ts`
   usage. Use `unknown` + narrowing where a binding is genuinely dynamic —
   never `any`. This one file removes most casts across the adapters.
2. **Typed registries/emitters.** Make `SignalRegistry.add` generic over
   callback args; type the platform-event handler map so
   `(payload ?? {}) as Record<string, unknown>` (`extension.ts:930`) can use
   the `PlatformEvent` discriminated union that already exists.
3. **One feature-detection boundary.** `compat.ts` has 38 `any` and claims to
   be the only place with `typeof === 'function'` probes, but `host.ts`,
   `timing.ts` and `version.ts` still probe inline. Keep one `unknown`-based
   narrowing helper per API in `compat.ts`, delete the rest.
4. **`prefs.ts` (25 `any`)** — type the Adw/Gtk widget surface used by the
   preferences UI.
5. **Remove the 6 `as unknown as` escapes** (`extension.ts:304, 329,
   2001-2002, 2214, 2219`) with typed accessors for the private Shell fields.
6. **Enforce.** `no-explicit-any: 'error'`; type-aware eslint
   (`projectService`; `no-floating-promises`); **typecheck the tests**
   (`tsconfig.test.json` or `vitest --typecheck`); then `noImplicitReturns`,
   `exactOptionalPropertyTypes`, and finally `noUncheckedIndexedAccess` (the
   3 `!` in `core/topology.ts` are the canary). Type declarations for the
   unavoidable GJS corners stay `unknown`, not `any`.

**Finalization method (agreed 2026-10-08, additive-slice pattern proven on
`host.ts`, `prefs.ts` and the small adapters).** Finish in this order:

1. Zero explicit `any` in every consumer file using named interfaces from
   `gi.d.ts`, while the namespace defaults stay broad (tree stays green).
2. Flip one namespace at a time — `const Meta: any` → `const Meta: MetaNamespace`,
   then fix the fallout file-by-file and gate each flip. Order: `Meta`, `Gio`,
   `St`, `Clutter`, `Adw`/`Gtk`, `GLib`, `Shell`/`Main`/`global`.
3. Only then flip `no-explicit-any` to `error`, with `**/*.d.ts` exempt until
   step 2 completes; add type-aware `no-floating-promises` at the same time.
4. The acceptance grep must return 0 across `src` including `gi.d.ts`.

**Acceptance:** `grep -R ": any\|as any\|<any>" src` returns 0 (including
`gi.d.ts`); `tsc --noEmit` covers `src` + `tests`; lint clean.

---

## 7. Phase 4 — decomposition & deletion (XL, behaviour-preserving)

Only start after P1/P2 stop editing the big files. Extract shared helpers
first, split second.

1. **`session.ts` (3,876 lines / ~60 fields)** — split along the seams that
   already exist: `DrainScheduler`, `DragController` (its ~10 state flags
   become one object), `Retiler`/`PlacementApplier`, `DisplayController`,
   `WorkspaceController`, `FocusController`, `UndoCoordinator`, `SelfHeal`,
   `Diagnostics`. Shared helpers to add during the split:
   `withSelfUnmaximize`; `tileablesOnScreen(ws, screen, exclude)` (8 copies);
   one apply-action path used by placement/display/drop/undo (4 copies); one
   nearest-workspace scanner (3 copies); the `GnomeHost` screen index from P2.
   Target: no file over ~1,000 lines.
2. **`extension.ts` (~2,946 after P0)** — keep only the composition root and
   lifecycle; move `DumpState`/diagnostics/harness triggers/persistence/
   config-transfer out. Continue with backlog P6c (typed `DumpState` schema)
   and P6a (one trigger table driving the D-Bus XML + dispatch — today the
   150-line hand-maintained XML in `dbus.ts:17-159` silently drifts from the
   handlers).
3. **Delete proven dead code** (add `knip`/`ts-prune` to CI so it cannot
   regrow):
   - `src/platform/gestures.ts` — zero importers.
   - `adapt.ts` `AdaptationStore` + `FloatStore` — ~85% dead, superseded by
     `RegistryStore`.
   - `compat.ts` dead exports: `stButtonMask`, `stReducedMotion`,
     `closePopupMenu`, `makeProxyWrapper`, `MOVE_OP`.
   - `core/scheduler.ts` `RetileScheduler` — tests-only, superseded by
     `queue.ts`.
   - Tests-only core exports `layoutAll` (`tiler.ts:503`), `contextFor`
     (`rules.ts:16`), `planIsValid` (`invariants.ts:88`); `core/topology.ts`
     harness tooling (used only by `scripts/topology-matrix.sh`).
   - Stale `dist/` (fixed in P0.3).
4. **Unify the three JSONL stores** (`history`, `journal`, `recorder`
   duplicate `dayString`, `encodeText`, rotation, chunked writes) behind one
   helper; one smoke-list parser shared by `agent-test.sh`,
   `session-test.sh`, `check-test-coverage.py`; stop redefining the same
   helpers in `tests/agent/lib.sh` and `tests/session/lib.sh`.
5. **Settings descriptor (backlog P6b)** — one source for the gschema, prefs
   layout and typed accessors; today a test statically parses `prefs.ts`.
6. **Write `docs/ARCHITECTURE.md`** — layer map + invariants (no policy in
   handlers; core purity/determinism; add-only `DumpState`; one owner per
   state; trigger taxonomy).

---

## 8. Phase 5 — guardrails (S–M)

1. CI (`.github/workflows/ci.yml`): keep the fixed purity gate, add
   `npm run test:coverage`, `knip`, and the zero-any lint rule; dedupe the
   double `tsc` (`--noEmit` then `build`); typecheck the tests.
2. **Wire the unwired fuzz pipeline**: `tests/generated/core-cases.json` +
   `gen-core-cases.py` exist but nothing consumes them. Run the generated
   cases in vitest — the cheapest available bug-catcher.
3. Add a `shellcheck` job for `scripts/` (30 min) and dedupe the smoke-list
   parsing.
4. Docs hygiene: stop committing `TEST_RESULTS_SESSION.md` in RED; fix
   `TEST_MATRIX.md` referencing a non-existent `core/budget.ts`; align the
   `install.sh:30-33` Shell gate (48–50) with `metadata.json:5` (48–51);
   date-stamp or generate `tests/MANIFEST.md`.

---

## 9. Order and dependencies

| Order | Work | Why now |
| --- | --- | --- |
| 1 | **P0** (land `clean-arch-v3`, fix purity, clean dist) | Ready and green; unblocks and makes CI honest |
| 2 | **P1.1–1.5** (races, untracked sources, sync I/O) | Real bugs; touches `session.ts` before the split |
| 3 | **P3.1–3.4** (`gi.d.ts`, `compat.ts`, `prefs.ts`) | No overlap with P1; visible “no any” progress |
| 4 | **P2** (measured hot-path diet) | Needs P1.3's journal fix to measure honestly |
| 5 | **P4** (`session.ts`/`extension.ts` split, dead code) | Only after writers stop touching those files |
| 6 | **P3.5–3.6 + P1 rest + P5** | On stable files; then lock the gate |

Parallel work is fine when file sets do not overlap (P1 touches
`session.ts`/`journal.ts`/`registry.ts`; P3 starts in `gi.d.ts`/`compat.ts`/
`prefs.ts`).

## 10. Definition of done

- `npm run test:all` green on `master`; nested smoke green for adapter changes.
- Idle counters: `configBuilds` 0, `classifyMisses` 0, `hostScans` 0;
  `drainMsMax` < 5 ms; retile < 10 ms.
- No synchronous file I/O in a signal handler; every GLib source owned by a
  registry; no `catch { /* ignored */ }` without a stated reason.
- `grep -R ": any\|as any\|<any>" src` → 0; `tsc --noEmit` covers `src` and
  `tests`.
- No file over ~1,000 lines; one owner per state; dead code gate (knip) green.

## 11. Risks and anti-goals

- **Do not fragment decision logic.** Split `session.ts` by responsibility,
  never into micro-modules; keep the pure model in `core/`.
- **Do not change behaviour to win a metric.** Gate the coherence sweep only
  after the counter proves it is safe.
- **No runtime dependencies, no bundler** — EGO requires readable, unbundled
  output. Type declarations are hand-written; that is the cost of zero `any`.
- **`gi.d.ts` is the long pole.** If expanding it stalls, land the typed
  consumers file-by-file behind local interfaces rather than waiting for the
  whole namespace.
- **The purity gate must not be weakened** to fix 0.2 — only made
  comment-proof.
