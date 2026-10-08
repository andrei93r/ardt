// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §24/§35: the self-heal safety net.
 *
 * Owns the adaptive back-off scan tick (the periodic reconcile that adopts and
 * removes windows the signals missed), the clamp-to-screen pass and the
 * periodic coherence sweep, including their cadence/backoff state and the
 * per-window sweep throttle. The live window state and every apply path stay in
 * the session and are reached through `SelfHealHost`.
 */

import GLib from 'gi://GLib';
import type { MetaWindow } from 'gi://Meta';

import { shouldClampWindow } from '../../core/clamp.js';
import { computePlans, screenArea } from '../../core/tiler.js';
import type { TilerConfig, TilerWindow } from '../../core/tiler.js';
import { clampRectToArea, rectEquals } from '../../core/types.js';
import type { Screen } from '../../core/types.js';
import * as compat from './compat.js';
import type { SessionDiagnostics } from './diagnostics.js';
import type { GnomeHost } from './host.js';
import type { History } from './history.js';
import type { RegistryStore } from './registry.js';
import type { Tiling } from './tiling.js';
import type { TrackedWindow } from './tracked-window.js';

/** §11/§35: the clamp pass treats an apply this recent as in flight. Matches the
 * window `planMismatch` already uses to leave a landing apply alone, so the
 * clamp and the tiler agree on when a transition has finished. Internal timing,
 * not a frame cadence. */
const CLAMP_DEFER_MS = 500;
/** Backoff before re-trying a lone-window maximize the same window refused. */
const COHERENCE_RETRY_MS = 3000;

/**
 * The slice of session state the self-heal pass needs. The live window map, the
 * reconcile entry points and the classification/plan inputs stay in the session.
 */
export interface SelfHealHost {
  readonly tiling: Tiling;
  readonly history: History;
  readonly registry: RegistryStore;
  readonly host: GnomeHost;
  readonly diagnostics: SessionDiagnostics;
  /** Every tracked window. */
  windows(): Iterable<TrackedWindow>;
  /** How many windows are tracked. */
  windowCount(): number;
  /** The tracked window with this id, if any. */
  window(id: number): TrackedWindow | undefined;
  /** Adopt a live Mutter window the signals missed. */
  register(win: MetaWindow): void;
  /** Drop a tracked window that no longer exists. */
  unregister(id: number): void;
  /** §5: reap empty workspaces (the scan tick's reaping pass). */
  reapEmptyWorkspaces(): void;
  /** Full reconcile pass (the scan tick's layout pass). */
  retileAll(reason: string): void;
  isPaused(): boolean;
  isSuspended(): boolean;
  /** A drag or resize gesture is in flight. */
  gestureActive(): boolean;
  /** Abandon a drag whose release never arrived; true when one was abandoned. */
  recoverStaleDrag(): boolean;
  /** An application DnD holds the pointer button with no window grab. */
  clientInteractionActive(): boolean;
  /** Lift the DnD freeze once the button is released. */
  endClientInteraction(): void;
  /** Debounced reconcile, never synchronous from a signal handler. */
  scheduleReconcile(reason: string): void;
  /** Run a scan-tick callback inside the session's error boundary. */
  runGuarded(cb: () => void): void;
  /** §21: whether the `debug-enabled` perf event is wanted. */
  debugEnabled(): boolean;
  /** The configured safety-net scan base, already floored. */
  scanBaseMs(): number;
  /** §11/§35: whether the clamp-to-screen pass is enabled. */
  clampEnabled(): boolean;
  /** Resolve a screen by index. */
  screenFor(index: number): Screen | null;
  /** The tiled windows on a workspace. */
  tileables(workspaceId: number): TrackedWindow[];
  /** The tiler input for one window. */
  toTilerWindow(tracked: TrackedWindow): TilerWindow;
  /** One config per pass. */
  tilerConfig(): TilerConfig;
  /** Drop cached plan signatures. */
  clearSignatures(): void;
  /** Clear the plan-mismatch suppression window. */
  resetIgnoreMismatch(): void;
  onStateChanged(): void;
}

export class SelfHeal {
  /** §24 item 8: adaptive back-off scan tick. */
  private scanSource: number | null = null;
  private scanIntervalMs = 5000;
  private idleScans = 0;
  private idleWindows = 0;

  /** Per-window throttle for re-maximizing a lone window (ms epoch). */
  private readonly coherenceRetryAt = new Map<number, number>();

  constructor(private readonly host: SelfHealHost) {}

  /** Whether the periodic scan tick is currently armed. */
  scanning(): boolean {
    return this.scanSource !== null;
  }

  /** Drop the per-window sweep throttle when a window goes away. */
  forgetWindow(id: number): void {
    this.coherenceRetryAt.delete(id);
  }

  /** Arm the adaptive scan tick. The caller decides whether it should start. */
  startScan(): void {
    if (this.scanSource !== null) return;
    this.scanIntervalMs = this.host.scanBaseMs();
    this.scheduleScan();
  }

  stopScan(): void {
    if (this.scanSource !== null) {
      GLib.source_remove(this.scanSource);
      this.scanSource = null;
    }
  }

  private scheduleScan(): void {
    this.scanSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.scanIntervalMs, () => {
      this.scanSource = null;
      if (this.host.isPaused()) return GLib.SOURCE_REMOVE;
      // §Self-heal containment: never escape the source dispatch uncaught.
      this.host.runGuarded(() => this.scanTick());
      this.backoff();
      this.scheduleScan();
      return GLib.SOURCE_REMOVE;
    });
  }

  private backoff(): void {
    const before = this.host.windowCount();
    if (before === this.idleWindows) {
      this.idleScans += 1;
    } else {
      this.idleScans = 0;
      this.idleWindows = before;
    }
    const base = this.host.scanBaseMs();
    const steps = [base, base * 2, base * 6, base * 12];
    const target = steps[Math.min(this.idleScans, steps.length - 1)];
    if (target !== this.scanIntervalMs) this.scanIntervalMs = target;
  }

  /** Safety net (§35): reconcile state that signals may have missed. */
  private scanTick(): void {
    const startedUs = GLib.get_monotonic_time();
    const live = new Set<number>();
    for (const win of global.display.list_all_windows()) {
      const id: number = win.get_id();
      live.add(id);
      if (this.host.window(id) === undefined) this.host.register(win);
    }
    // Snapshot the ids: `unregister` mutates the window map, and iterating it
    // while removing would skip entries.
    const trackedIds: number[] = [];
    for (const tracked of this.host.windows()) trackedIds.push(tracked.id);
    for (const id of trackedIds) {
      if (!live.has(id)) this.host.unregister(id);
    }
    this.host.registry.prune();
    this.host.registry.save();
    this.host.reapEmptyWorkspaces();
    this.host.retileAll('scan');
    const reconcileMs = (GLib.get_monotonic_time() - startedUs) / 1000;
    const perfDue = this.host.diagnostics.noteReconcile(reconcileMs);
    // §21: one perf event every 60 scans, gated on debug-enabled.
    if (perfDue && this.host.debugEnabled()) {
      this.host.history.log('perf', {
        last_reconcile_ms: reconcileMs,
        last_apply_ms: this.host.diagnostics.lastApplyDurationMs(),
        windows: this.host.windowCount(),
      });
    }
  }

  /**
   * Keep every tracked window inside its own monitor's **work area** (the
   * surface minus struts), the same reference the tiler plans against. Using
   * the full geometry instead pulled a window under the top bar — `y=679` where
   * the tiler wanted the work-area top `y=711` — so the clamp and the tiler
   * wrote two different rects forever. A property re-derived by the lane-2 drain
   * and the periodic coherence sweep, never a one-shot reaction to a move, so a
   * window dragged out of bounds is clamped on the next pass after the drag ends
   * and dragging still feels free.
   *
   * Fullscreen windows (they own the screen) and minimized windows (Mutter
   * manages their frame) are skipped. A tiled/maximized window is already inside
   * the work area, so in practice the clamp only ever fires for a manual float.
   * It is idempotent — a window already inside is untouched — and it reuses the
   * tiler's bounded retry/refusal path for a window that refuses the geometry,
   * so it can never loop or fight a stubborn client.
   */
  clampToScreen(): void {
    if (!this.host.clampEnabled()) return;
    // No clamping mid-drag: the user owns the geometry until the gesture ends.
    if (this.host.gestureActive()) return;
    // §11/§35: an apply the tiler has in flight is an intermediate frame, not an
    // off-screen float. Clamping it writes a rect derived from that frame and
    // races the animation; worse, its own apply resets the "recently moved"
    // clock, so `planMismatch` keeps returning false and the next drain clamps
    // again — an unbounded loop. Defer until the transition has landed. A
    // skipping app (Chrome/VS Code) never animates, so the recent-apply window
    // is what catches it there.
    const settling = this.host.tiling.activeAnimations > 0 || Date.now() - this.host.tiling.lastApplyAtMs < CLAMP_DEFER_MS;
    for (const tracked of this.host.windows()) {
      const flags = tracked.surface.flags;
      // A window that has not been adopted or routed yet, that reports a
      // degenerate frame, or that the tiler is mid-transition for is not an
      // off-screen float. See `shouldClampWindow`.
      if (
        !shouldClampWindow({
          ready: tracked.ready,
          routePending: tracked.routePending,
          fullscreen: flags.fullscreen,
          minimized: flags.minimized,
          stubborn: tracked.stubborn,
          settling,
          frame: tracked.surface.frame,
        })
      ) {
        tracked.clamped = false;
        continue;
      }
      const screen = this.host.screenFor(tracked.surface.screenId);
      if (screen === null) continue;
      tracked.refreshFrame();
      const current = tracked.surface.frame;
      const clamped = clampRectToArea(current, screenArea(screen));
      if (rectEquals(current, clamped)) {
        tracked.clamped = false;
        continue;
      }
      tracked.clamped = true;
      this.host.diagnostics.noteClamp();
      this.host.history.log('clamp_to_screen', { id: tracked.id, from: current, to: clamped });
      this.host.tiling.noteSelfApply();
      this.host.tiling.applyFrame(tracked, clamped, screen, false, 'clamp-to-screen', 0);
    }
  }

  /**
   * §35: periodic coherence guarantee. A normal (non-floating, non-modal)
   * window on a workspace with a sibling must be tiled. If one was left untiled
   * — a refused apply, a missed signal, a `stubborn` record — push the plan
   * through, clearing the refusal bookkeeping so it is retried.
   */
  coherenceSweep(): void {
    if (this.host.isPaused() || this.host.isSuspended()) return;
    // A drag whose release never arrived must not disable the guarantee below:
    // clear it first, then run the pass.
    if (this.host.recoverStaleDrag()) return;
    // §6: an application DnD froze reflow; once the button is released the
    // sweep lifts the freeze and reflows exactly once, so the newcomer is
    // routed and the layout settles even if no frame signal arrives after the
    // drop.
    if (this.host.clientInteractionActive()) {
      if (compat.button1Pressed()) return;
      this.host.endClientInteraction();
      this.host.scheduleReconcile('client-interaction-end');
    }
    if (this.host.gestureActive()) return;
    // The backstop for a clamp the lane-2 drain missed: an off-screen window is
    // pulled back here even if no frame signal scheduled a reconcile.
    this.clampToScreen();
    this.host.diagnostics.noteCoherenceRun();
    const sweepStartedUs = GLib.get_monotonic_time();
    // One config per sweep, not per workspace×screen: the settings half is
    // memoised and the live ratios/swap-pair set do not vary within the sweep
    // (PERFORMANCE_PLAN stage 1.3 — "once per pass").
    const config = this.host.tilerConfig();
    const count = global.workspace_manager.get_n_workspaces();
    for (let index = 0; index < count; index++) {
      // §24/P2.5: a workspace's tileables cannot change inside the sweep. The
      // corrections below only maximize/unmaximize/apply frames or clear the
      // stubborn/refusal bookkeeping; Mutter signals are queued, never run
      // inline, and `onStateChanged` only reads. Build once per workspace and
      // filter the same list for each screen.
      let workspaceTiles: TrackedWindow[] | null = null;
      for (const screen of this.host.host.screens()) {
        const onScreen = (t: TrackedWindow) => t.surface.screenId === screen.index;
        const busy = (t: TrackedWindow) => this.host.tiling.isAnimating(t.id);

        workspaceTiles ??= this.host.tileables(index);
        const tileables = workspaceTiles.filter(onScreen);

        // A placement is in flight: leave the workspace alone until it settles.
        // Dropping the animating window from the count instead made a pair that
        // is still forming look like a lone window, which the lone law then
        // maximized and the §4 property exiled (S05).
        if (tileables.some(busy)) continue;

        // §6: a float pins its workspace and is never pulled back; the sweep
        // leaves a workspace that holds only floats exactly as it is.
        if (tileables.length === 0) continue;

        // A lone window is maximized (§4): there is no such thing as a single
        // window left untiled. Retry at most every 3 s per window so a window
        // that genuinely refuses cannot be hammered every sweep.
        if (tileables.length === 1) {
          const only = tileables[0];
          const due = Date.now() >= (this.coherenceRetryAt.get(only.id) ?? 0);
          if (!compat.isMaximized(only.win) && !only.surface.flags.floating && due) {
            this.coherenceRetryAt.set(only.id, Date.now() + COHERENCE_RETRY_MS);
            only.stubborn = false;
            this.host.tiling.noteSelfApply();
            this.host.host.maximize(only.id);
            this.host.diagnostics.noteCoherenceFix();
            this.host.history.log('tile', { reason: 'coherence-maximize', id: only.id, workspaceId: index });
          }
          continue;
        }

        // A pair is the most a workspace holds in v2; extra visible windows are
        // a routing bug, not something to evict — leave them alone and let the
        // next reconcile resolve them.
        if (tileables.length > 2) continue;

        this.host.diagnostics.notePlanComputed();
        const plan = computePlans(tileables.map((t) => this.host.toTilerWindow(t)), screen, config);
        let offender = false;
        for (const placement of plan.placements) {
          const tracked = this.host.window(placement.surfaceId);
          if (tracked === undefined) continue;
          this.host.diagnostics.noteSweepFrameRead();
          tracked.refreshFrame();
          const r = tracked.surface.frame;
          const off =
            Math.abs(r.x - placement.rect.x) > 2 ||
            Math.abs(r.y - placement.rect.y) > 2 ||
            Math.abs(r.width - placement.rect.width) > 2 ||
            Math.abs(r.height - placement.rect.height) > 2;
          if (off) {
            offender = true;
            // A refused geometry must not exempt the window forever.
            tracked.stubborn = false;
            tracked.refusals = 0;
          }
        }
        if (!offender) continue;
        this.host.clearSignatures();
        this.host.resetIgnoreMismatch();
        this.host.tiling.applyPlan(plan, screen, 'coherence', false, false);
        this.host.diagnostics.noteCoherenceFix();
        this.host.history.log('tile', { reason: 'coherence', workspaceId: index, screen: screen.index });
        this.host.onStateChanged();
      }
    }
    const sweepMs = (GLib.get_monotonic_time() - sweepStartedUs) / 1000;
    this.host.diagnostics.noteSweep(sweepMs);
  }
}
