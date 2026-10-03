# Adrt — Design Backlog (GNOME Shell extension)

**Scope: the GNOME Shell extension only.** KDE and Windows ports are deliberately *not*
in this file.

This file holds the **designs and backlog for work not yet in the model**. It is not
authoritative: `docs/V2_MODEL.md` is. Anything here that changes behaviour must, when it
lands, become a **numbered decision in `V2_MODEL.md`** (and the four defects in §4 are
already overdue there).

Status legend: **shipped** · **in flight** · **planned** · **candidate** (needs evidence)
· **parked**.

---

## 1. Shell stability — **in flight** (`v2/shell-stability`)

Evidence (previous boot, 2026-10-02): on session end the Shell logged
`Object Gjs_ui_layout_UiActor … has been already disposed` /
`Object St.Widget … has already been disposed` with the stack pointing into
`adrt@adrt.dev/adapters/gnome/indicator.js:107/108/114`, then
`clutter_actor_remove_child: assertion 'child->priv->parent != NULL' failed`; shortly
before the session became unusable, `g_closure_unref: assertion 'old_flags.flags.ref_count > 0' failed`
and Mutter monitor assertions (`meta_display_get_monitor_in_fullscreen`,
`meta_monitor_manager_get_logical_monitor_from_number`,
`meta_workspace_get_work_area_for_monitor`).

### 1.1 Dispose-safe teardown
- **Problem.** `disable()`/teardown touches chrome actors the Shell has already
  destroyed (session end, reload, shutdown) and disconnects from dead emitters.
- **Fix.** One registry owns every connection and timer; teardown is idempotent and
  checks `is_destroyed`/parentage; signals disconnect before destroy; `disable()` is
  safe when called twice or mid-shutdown; no queued ease/timeout callback touches a
  destroyed actor.
- **Tests.** Nested stress: repeated enable/disable with the indicator + drop preview
  visible ⇒ no `already been disposed`, no `[adrt] ERROR`, no `clutter_actor_remove_child`.

### 1.2 No stale monitor index
- **Problem.** After a topology change, index-based Mutter calls assert and windows
  bounce between two screen plans.
- **Fix.** Bound every index against the **live** monitor list and re-read the topology
  at use (`host.refreshScreens`, `screenAt`, `workAreaOf`, `screenFor`, display replay);
  never call with an out-of-range index.
- **Tests.** Shrink the monitor list under a window (`SimulateScreens` /
  `ADRT_MONITORS`) ⇒ no Mutter assertion, no `[adrt] ERROR`.

### 1.3 Self-heal — **"do not crash GNOME; restart the extension"**
- **Boundary to state in code:** a JS `try/catch` cannot catch the C-level failures that
  actually take the Shell down (disposed-actor and monitor assertions). §1.1/§1.2 are the
  *prevent* half; this is the *recover* half, for what JS can catch.
- **Contain.** Every entry point (signal handler, drain/tick, D-Bus trigger, settings
  watcher, timer) goes through the existing error boundary — nothing escapes.
- **Recover in-process.** `restart()` = full internal teardown + re-init **inside the
  same loaded extension**, scheduled on an **idle/timeout**, never inline and never via
  `Main.extensionManager` reload from inside a signal handler.
- **Policy.** 3 caught errors in 60 s ⇒ one restart; still failing ⇒ **self-disable
  cleanly** + `Main.notify` toast; cap 3 restarts / 10 min with backoff. Never restart
  while a drag/transition is live (defer to its end).
- **Instrumented (add-only).** Journal `extension_restart` / `extension_self_disable`
  with the triggering error; `DumpState` counters `restarts`, `lastErrorAt`.
- **Tests.** Use the existing `InjectFault` / `debug-inject-verify-failure`: Shell stays
  alive, one restart journalled, repeated faults ⇒ clean self-disable + toast, no
  uncaught `[adrt] ERROR`, no new Shell assertion; restart does not fire mid-gesture.

---

## 2. Clean architecture — **in flight** (`refactor/clean-arch`)

**Hard rules.** Behaviour-preserving only (no feature, no fix); `core/` logic untouched;
one named smell → one refactoring per commit; **green gate before every commit**
(`tsc`, `lint`, `vitest run tests/core`, targeted nested, one smoke under the lock);
revert rather than debug a broken step; `DumpState` add-only; `core/` stays free of
`gi://`.

### 2.1 Target rules
1. **Strict 1-layer inheritance** — classes extend only native GJS bases
   (`Extension`, `ExtensionPreferences`, `St.*`, `Clutter.*`). No custom base classes.
2. **Decoupled window tracking** — window/workspace/display/focus signals live in a
   tracker module that **only emits events**; consumers subscribe. No policy in handlers.
3. **Functional animations** — helpers `(actor, properties, duration) → handle`; keep the
   **"a transition is live"** accounting the tiler/clamp read.
4. **Lifecycle safety** — one registry owns connections/timers; explicit teardown.

### 2.2 Phases
- **P0 audit + baseline** — custom bases; every `connect`/timer and its disconnect; the
  animation wrapper(s); oversized files and their responsibilities.
- **P1** lifecycle registry + dispose-safe `disable()` (§1.1).
- **P2** window tracker (P2 also delivers the **seam**: `collectInputs → compute → applyPlan`).
- **P3** functional animation + minimal live-transition bookkeeping.
- **P4** simplify: inline thin wrappers, remove dead code, split only the oversized files
  **by responsibility**. Do not fragment the decision logic.
- **P5 (deferred)** `indicator.ts`/`host.ts` internals — only after `v2/shell-stability`
  merges (avoid two writers).

### 2.3 Maintainability surfaces (P6)
- **P6a trigger registry** — one table (`name`, `signature`, handler, description,
  taxonomy) driving the D-Bus XML + dispatch map (today: TS interface + XML + `handlers()`
  must agree). Encode `Inject*` = real input / plain = real Mutter API / `Simulate*` =
  state-only, and assert it. Preserve names/signatures verbatim.
- **P6b settings descriptor** — one source for gschema + `PREFERENCES_LAYOUT` + typed
  accessors; `A140-prefs-options` validates against it instead of **statically parsing
  `prefs.ts`**. XML stays byte-compatible (no key/type/default drift).
- **P6c typed `DumpState` schema** — one exported type shared by Shell and harness;
  add-only.
- **P6d core determinism lint** — extend `check-core-purity.sh` to reject `Date.now`,
  `new Date`, `Math.random` and IO in `src/core/` (time/randomness are inputs).
- **P6e perf budget test** — churn workload asserting bounded counters.
- **P6f dead-hook sweep** — remove only what the audit proved dead (e.g. the dead
  `Layer.MODAL` `applyLayer` branch, unused internal keys). **Keep `Placement.order`**
  — reserved as the explicit carrier for window order; do not sweep it as dead.
- **P6g `docs/ARCHITECTURE.md`** — layer map + invariants (no policy in handlers; core
  purity/determinism; add-only `DumpState`; trigger taxonomy; one owner per state).
- **P6h recent-errors ring** in `DumpState` (add-only) — the last N boundary errors, so a
  bug report carries its own evidence.

### 2.4 P7 — no `any`
Measured: **204** `: any`/`<any>`/`as any` in `src/` (`compat.ts` 38, `gi.d.ts` 31,
`prefs.ts` 21, `host.ts` 19, `extension.ts` 15, `session.ts` 14…). `core/` is already
**0**. `eslint.config.js` has `no-explicit-any: 'off'`.
- Expand `gi.d.ts` into accurate interfaces for the used GJS surface (`Meta.*`,
  `Clutter.*`, `St.*`, `Gio.*`, `Shell.*`, `Main.*`, `global.*`) — the root cause.
- Then real types, or `unknown` + narrowing; no `as any`; `@ts-expect-error` only with a
  reason, preferring a declaration fix.
- Flip the rule to `error` + a guard so `any` cannot return (tiny reasoned allowlist).
- Type-only: behaviour identical; if typing would force a behaviour change, stop and report.

### 2.5 Performance addenda
- **No new runtime dependency is possible.** `scripts/package.sh`: *"EGO requires readable,
  unbundled output"*; build is `tsc`; zero runtime deps. ⇒ **neverthrow cannot be a
  dependency**; if Result-style handling is justified, use a ~30-line local `Result<T,E>`
  at **one** boundary, keeping the `[adrt] ERROR` behaviour.
- **Priority queue** — only if measured (the drain queue is already prioritised and tiny).
- **Signals** — a small local typed emitter (overlaps P2); no library.
- **Allocation audit (highest value, frequency-weighted, hot set only).** Hot set: the
  50 ms drain/tick + `computePlans`, `buildPlacementState`, `tileables`, `layout`
  construction, `signatures`/`ratioKey`/pair-key builders, drag/preview, classify.
  Audit: `[...this.windows.values()]` spreads in drain loops; per-pass `State`/`Win`/plan
  objects; per-call `new Map()`/`new Set()`; **per-call string keys**; `.map/.filter/.sort/
  .reduce` chains and comparator closures; per-tick closures; `Object.keys/values/entries`;
  `slice/concat`/spreads.
- **Dev-gated hot-path profiler** (`perf-enabled` only): named sections → call count +
  total ms, surfaced add-only in `DumpState.perfStats`. Makes the audit data-driven and
  gives P6e something to assert. No cost when off.
- **Correct caching**: memoise only behind the existing `signatures` invalidation; every
  cache names the event that invalidates it (a stale cache is a bug, not a slow path).
- Report per item: *site → frequency → allocation → fix → measured delta*; **revert
  no-wins**.

---

## 3. Open GNOME bugs (from the recorder)

- **3.1 `screens-changed` bounce — planned (next after §1).** On a monitor change the window
  bounces between two screen plans (`resize_retry reason=clamp-to-screen` targeting
  `{1440,711,…}` and `{0,0,1440,2560}`, `self-unmaximize`, `stubborn`). Fix: **one owner per
  window** across a replan; no clamp/tiler fight. User-visible: "closing a screen → reaction
  on the other screen".
- **3.2 Coherence/stubborn storm + top flip — planned (re-measure after §1.2).**
  `resize_retry reason=coherence` on a refused rect, and the tiler's top flipping between
  `y=32` and `y=711` for the same window.
- **3.3 Modal highlight — candidate.** A modal (`{2508,647,424,179}`) gets `border focus`
  while `occluded`, i.e. highlighted behind another window. Needs a fresh capture.
- **3.4 Early focus / window not visible — candidate.** `focus` recorded before the window
  is mapped/visible. Needs a fresh capture.
- **Not ours** (ruled out from the same captures): Dash-to-Dock's own *"widget not in the
  stage"* errors; the AMD **DMCUB** GPU failure that made the session unusable (524
  `amdgpu`/`drm` errors, `Error queueing DMUB command`).

## 4. Model defects to fix regardless — **planned**

1. **Gap rule contradiction**: decision 43 ("gaps follow the axis") vs decisions 15/74
   ("per orientation"); the code follows orientation, so a forced axis is unspecified.
2. **Undocumented other-axis fallback**: the tiler already tries the other axis under
   min-size pressure (`tiler.ts` `chosen`-axis fallback, `min-size-policy stack`) with no
   decision covering it.
3. **`left-half`/`right-half` rule override hardcodes a horizontal split**
   (`applyRuleOverride`), contradicting decision 43 on portrait screens — a real bug.
4. **"Portrait" is undefined in the rules**; the code uses `geometry.height > geometry.width`.

---

## 5. Shipped (reference; no work listed)

Recorder (start/stop, hot-switch `Super+Shift+R`, observation prompt with modal grab + key
focus, note in the file, backups outside the extensions dir) · app-compatibility matrix
(`tests/lib/appcheck.sh`, `SpawnWindow(argvJson, envJson)`, GTK/Electron/Qt/flatpak/snap/
AppImage rows, `A158–A160`, `S26`/`S27`) · per-workspace+screen ratio scoping (`A156`) ·
per-screen slot counting (`A157`) · unmanaged-drag landing (§6/decision 90, `A153`) · tab
tear-off / unplaced-window grab (`A155`) · clamp work-area target + settling · integer split
boundaries · highlight trace events (`border focus`, `preview show/hide`) · drag-managed-only ·
recorder/hot-config.

---

## 6. Process constraints (learned — apply to all future work)

- **EGO distribution bars bundling**: no runtime deps, no bundler; ship readable JS.
- **`/tmp` is a 14 G tmpfs**; nested state dirs fill it and produce `write() failed: Disk
  quota exceeded` → prune between runs; it *looks* like flakiness, it's the disk.
- **Nested worker tuning**: 8 workers is the sweet spot here (12 flaked under load); always
  `flock /tmp/opencode/adrt-test.lock`, own `ADRT_BASE_STATE`, `timeout`.
- **AppImageLauncher** registers `binfmt` handlers → launching an AppImage opens a dialog;
  tests must skip it (already done).
- **Triggers must be honest** (`Inject*` / real API / `Simulate*`) and event-confirmed.
- **Determinism**: no wall-clock/randomness in `core/`; the drain re-derives raceable state.
- **A wait is not a fix** — no policy inside Mutter signal handlers.
