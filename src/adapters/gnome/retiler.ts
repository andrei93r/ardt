// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §3/§4/§6/§10/§16: the tiling retiler and placement applier.
 *
 * Owns the workspace tiling pass (`retile`), the pure placement computation
 * inputs (`buildPlacementState`, `placementEnv`, `toTilerWindow`, `doesNotFit`)
 * and the apply paths that turn a placement into Mutter state (`applyPlacement`
 * and the maximize/unmaximize/fullscreen/escape ladder, `routeWindow`,
 * `floatWindow`). The live window map, the classification cache, the screen
 * lookup and every signal/journalling hook stay in the session and are reached
 * through `RetilerDeps`, so no signal policy lives here. Counters are noted on
 * the same events as before (`notePlanComputed`, `noteApply`).
 */

import GLib from 'gi://GLib';

import { checkPlan } from '../../core/invariants.js';
import {
  escapeSize, impossibleSplit, maximizeWindow, refusalLadder, routeNewWindow, unmaximizeWindow,
} from '../../core/placement.js';
import type { Env, Placement, ScreenClass, State, Win, Ws } from '../../core/placement.js';
import { planSignature, shouldApplyPlan } from '../../core/scheduler.js';
import type { SignatureCache } from '../../core/scheduler.js';
import { computePlans, resolveGaps, screenArea } from '../../core/tiler.js';
import type { TilerConfig, TilerWindow } from '../../core/tiler.js';
import { Layer, rectEquals } from '../../core/types.js';
import type { Rect, Screen, Size, TilePlan } from '../../core/types.js';
import * as compat from './compat.js';
import type { SessionDiagnostics } from './diagnostics.js';
import type { GnomeHost } from './host.js';
import type { History } from './history.js';
import type { GnomeSettings } from './settings.js';
import type { Tiling } from './tiling.js';
import type { TrackedWindow } from './tracked-window.js';
import type { WorkspaceController } from './workspace.js';
import type { PerfProbe } from './perf.js';

/** The slice of session state the retiler needs. */
export interface RetilerDeps {
  readonly tiling: Tiling;
  readonly host: GnomeHost;
  readonly settings: GnomeSettings;
  readonly history: History;
  readonly diagnostics: SessionDiagnostics;
  readonly workspaces: WorkspaceController;
  readonly signatures: SignatureCache;
  readonly windows: Map<number, TrackedWindow>;
  /** P6e: the dev-gated section profiler (disabled ⇒ never reached). */
  readonly probe: PerfProbe;
  /** §22: journal one model-level event (optional; the session owns the gate). */
  readonly onModelEvent?: (event: string, fields: Record<string, unknown>) => void;
  /** The split axis of a screen (§1). */
  axisFor(screenId: number): Env['axis'];
  /** §1/§6: one tiler config per pass (settings + live ratios/swap pairs). */
  tilerConfig(): TilerConfig;
  /** Resolve a screen by index. */
  screenFor(index: number): Screen | null;
  /** §1: the screen class of a screen index. */
  screenClass(screenId: number): ScreenClass;
  /** The tiled windows on a workspace, in id order. */
  tileables(workspaceId: number): TrackedWindow[];
  /** The window's classification (only `tileable` is read). */
  classify(tracked: TrackedWindow): { tileable: boolean };
  /** §13: snapshot the current configuration as the single undo change. */
  capturePlane(workspaceIds: readonly number[], screenId: number): void;
  /** §4/§11: record and run one of our own unmaximizes. */
  withSelfUnmaximize(tracked: TrackedWindow, fn: () => void): void;
  /** §12: record the window's placement under its app entry. */
  recordPlacement(tracked: TrackedWindow, connectorOverride?: string, slotOverride?: number): void;
  /** Debounced reconcile, never synchronous from a signal handler. */
  scheduleReconcile(reason: string): void;
  /** Queue another retile for a workspace. */
  scheduleRetile(workspaceId: number, reason: string): void;
  /** Run a programmatic workspace change with the switch animation suppressed. */
  instantSwitch(fn: () => void): void;
  /** Activate a workspace by index. */
  activateWorkspace(index: number): void;
  onStateChanged(): void;
  isPaused(): boolean;
  isSuspended(): boolean;
  /** A drag is in flight: reflow is frozen. */
  isDragging(): boolean;
  /** §13: plan-mismatch suppression deadline (ms epoch). */
  ignoreMismatchUntilMs(): number;
}

export class Retiler {
  constructor(private readonly deps: RetilerDeps) {}

  toTilerWindow(tracked: TrackedWindow): TilerWindow {
    const surface = tracked.surface;
    // §12: `adapt` is timing-only. No learned minimum ever reaches the tiler;
    // the window's own size hints are the only minimum.
    return {
      id: tracked.id,
      appId: surface.appId,
      title: surface.title,
      kind: surface.kind,
      rect: surface.frame,
      min: tracked.minSize,
      max: tracked.maxSize,
      screenId: surface.screenId,
      workspaceId: surface.workspaceId,
      slot: tracked.pendingSlot ?? undefined,
    };
  }

  placementEnv(screenId: number): Env {
    return { screen: this.deps.screenClass(screenId), axis: this.deps.axisFor(screenId) };
  }

  /**
   * §3: per workspace, the two visible slot occupants plus hidden windows.
   *
   * `screenId` limits the view to the windows on one screen: the tiler tiles
   * per screen, so a window on another screen must not occupy a slot that
   * belongs to this screen's pair. Reaping still asks for the global view (no
   * `screenId`), because a workspace is empty only when no screen holds a
   * window in it.
   */
  buildPlacementState(excludeId: number | null = null, screenId: number | null = null): State {
    const manager = global.workspace_manager;
    const count = manager.get_n_workspaces();
    const workspaces: Ws[] = [];
    for (let index = 0; index < count; index++) workspaces.push({ id: index, slots: [null, null], minimized: [], floats: [] });
    for (const tracked of [...this.deps.windows.values()].sort((a, b) => a.id - b.id)) {
      if (tracked.id === excludeId) continue;
      if (screenId !== null && tracked.surface.screenId !== screenId) continue;
      // A newcomer whose placement is still pending holds no slot yet: its
      // routing is derived from live state in the drain (§3/§11).
      if (tracked.routePending) continue;
      const ws = workspaces[tracked.surface.workspaceId];
      if (ws === undefined) continue;
      const rec: Win = {
        id: tracked.id,
        minimized: tracked.surface.flags.minimized,
        floating: tracked.surface.flags.floating || !this.deps.classify(tracked).tileable,
        maximized: tracked.surface.flags.maximized,
        fullscreen: tracked.surface.flags.fullscreen,
      };
      if (rec.minimized === true) { ws.minimized.push(rec); continue; }
      if (rec.floating === true) { ws.floats ??= []; ws.floats.push(rec); continue; }
      if (ws.slots[0] === null) ws.slots[0] = rec;
      else if (ws.slots[1] === null) ws.slots[1] = rec;
      else { ws.floats ??= []; ws.floats.push(rec); }
    }
    return { workspaces, viewed: manager.get_active_workspace_index() };
  }

  /** §16: a managed window that obviously cannot fit its share. */
  doesNotFit(tracked: TrackedWindow, env: Env): boolean {
    // When the user has asked us to ignore minimum sizes, nothing is too big to
    // share; the escape is only for a client that insists on its size.
    if (this.deps.settings.string('min-size-policy', 'respect') !== 'respect') return false;
    const screen = this.deps.screenFor(tracked.surface.screenId);
    if (screen === null) return false;
    // Size hints can arrive after the first frame; re-read them while they are
    // still unknown so a client that insists on a large minimum is recognised.
    if (tracked.minSize.width === 0 || tracked.minSize.height === 0) tracked.refreshSizeHints();
    const tilerWindow = this.toTilerWindow(tracked);
    const min = tilerWindow.min;
    const max = tilerWindow.max;
    if (min.width > 0 && min.height > 0 && max.width > 0 && max.height > 0 &&
        min.width >= max.width - 1 && min.height >= max.height - 1) {
      return true; // fixed size: min == max
    }
    const area = screenArea(screen);
    const half = (env.axis === 'vertical' ? area.height : area.width) / 2;
    const span = env.axis === 'vertical' ? min.height : min.width;
    return half > 0 && span > half;
  }

  shouldLoneMaximize(tileables: readonly TrackedWindow[], nonTransient: readonly TrackedWindow[]): boolean {
    if (tileables.length !== 1) return false;
    // §4: a lone *visible managed* window is maximized. Floats (an always-on-top
    // window, a dialog) do not count, or the window left behind when one floats
    // would stay at half size (A61).
    const managed = nonTransient.filter((t) => this.deps.classify(t).tileable && !t.surface.flags.minimized);
    return managed.length === 1;
  }

  /** Compute and apply the plan for every monitor of one workspace (§6). */
  retile(workspaceId: number, reason: string, animate = true, rememberUndo = true): void {
    // P6e: guard before constructing anything; disabled ⇒ no closure allocated
    // and no clock read, just the one boolean test.
    if (this.deps.probe.enabled) {
      this.deps.probe.section('retile', () => this.retileInner(workspaceId, reason, animate, rememberUndo));
      return;
    }
    this.retileInner(workspaceId, reason, animate, rememberUndo);
  }

  private retileInner(workspaceId: number, reason: string, animate: boolean, rememberUndo: boolean): void {
    if (this.deps.isPaused() || this.deps.isSuspended()) return;
    // §11.3: no reflow while the user is dragging.
    if (this.deps.isDragging()) return;
    // Every policy below is per monitor, matching the tiler (§9: a pair shares
    // a monitor). Counting a workspace's windows across screens would make a
    // pair on one monitor an "extra" — or a lone window — on another.
    // One config per pass, not per screen: the settings half is memoised and the
    // live ratios/swap-pair set are identical for every screen, so the `new Set`
    // and the assembly were rebuilt per screen for no reason
    // (PERFORMANCE_PLAN stage 1.3 — "once per pass").
    const config = this.deps.tilerConfig();
    // §24/P2.5: one filter+classify+sort for the workspace, reused for every
    // screen instead of rebuilt per screen. It is re-derived when a branch
    // below changes the model (an escape or a maximize can move a window to its
    // own workspace); every other branch only reads. The tiled view and the
    // non-transient view the lone law needs derive from the same list and cannot
    // drift between their two uses: the only field written before them is
    // `maximizeRequested`, which no filter reads.
    let workspaceTiles: TrackedWindow[] | null = null;
    for (const screen of this.deps.host.screens()) {
      const onScreen = (t: TrackedWindow): boolean => t.surface.screenId === screen.index;
      workspaceTiles ??= this.deps.tileables(workspaceId);
      const onScreenTiles = workspaceTiles.filter(onScreen);
      const tileables = onScreenTiles.filter((t) => !t.surface.flags.fullscreen);
      if (tileables.length === 0) continue;
      // §4 maximize, as a property: a window the user maximized that still
      // shares its workspace is given its own workspace to the right, and the
      // view follows. Re-asserting it here means a signal that was missed or
      // raced can not leave the window sharing the pair.
      if (tileables.length > 1) {
        const requested = tileables.find((t) => t.maximizeRequested && compat.isMaximized(t.win));
        if (requested !== undefined) {
          this.maximizeTracked(requested);
          // It may have moved to its own workspace: drop the cached list.
          workspaceTiles = null;
          continue;
        }
      } else if (tileables[0].maximizeRequested) {
        // Settled: a lone window on its own workspace is maximized; the
        // maximize property no longer needs to be enforced for it.
        tileables[0].maximizeRequested = false;
      }
      // §10 steps 2-3: a client that insists on a minimum wider than its share
      // is refused a split. The sibling adapts first (the tiler's ratio is
      // clamped to its own minimum); only when the sibling cannot adapt either
      // does the pair cease to exist — the trigger keeps the screen and the
      // reactor gives way (own workspace, or minimized on a single screen).
      if (tileables.length > 1) {
        const refusing = tileables.find((t) => this.doesNotFit(t, this.placementEnv(t.surface.screenId)));
        if (refusing !== undefined) {
          const sibling = tileables.find((t) => t.id !== refusing.id);
          const screen = this.deps.screenFor(refusing.surface.screenId);
          if (
            sibling !== undefined &&
            screen !== null &&
            this.refusalEscapes(refusing, sibling, screen, this.placementEnv(refusing.surface.screenId), config)
          ) {
            this.escapeRefusal(refusing, sibling);
            // The refusal moved/minimized a window on this workspace.
            workspaceTiles = null;
            this.deps.scheduleRetile(workspaceId, 'escape-refusal');
            continue;
          }
          // Step 2: the sibling adapts, so the pair stays. The tiler's clamp
          // below gives the refusing window its minimum and the sibling the
          // remainder; nothing is created, floated or minimized.
        }
      }
      // §4: a lone visible managed window is always maximized.
      if (this.shouldLoneMaximize(tileables, onScreenTiles.filter((t) => !t.surface.flags.transient))) {
        const only = tileables[0];
        if (!compat.isMaximized(only.win)) {
          this.deps.tiling.noteSelfApply();
          this.deps.host.maximize(only.id);
        }
        continue;
      }
      // §5: two visible managed windows are a pair, so a maximized window that
      // still shares its workspace (a user maximize the property branch above
      // did not move, or two windows that raced into being) must unmaximize.
      const maximized = tileables.filter((t) => compat.isMaximized(t.win));
      if (maximized.length > 0) {
        for (const stale of maximized) {
          this.deps.tiling.noteSelfApply();
          this.deps.withSelfUnmaximize(stale, () => this.deps.host.unmaximize(stale.id));
        }
        this.deps.scheduleRetile(workspaceId, 'unmaximize-stale');
        continue;
      }
      const startedUs = GLib.get_monotonic_time();
      this.deps.diagnostics.notePlanComputed();
      const plan = computePlans(tileables.map((t) => this.toTilerWindow(t)), screen, config);
      // §36: pass the per-window minimum so the below-min invariant actually
      // runs in production, not just in the tests; a violation is still logged,
      // never enforced.
      const mins = new Map<number, Size>(tileables.map((t) => [t.id, t.minSize]));
      const violations = checkPlan(plan, screen.workArea ?? screen.geometry, mins);
      if (violations.length > 0) {
        // §5: the packing invariant is asserted, not enforced — a violation is
        // logged with its identifier and the state so the long mixed run can
        // assert that the journal never carries one.
        this.deps.history.log('invariant_violated', { reason, workspaceId, violations });
      }
      if (Date.now() < this.deps.ignoreMismatchUntilMs()) continue;
    const key = `ws:${workspaceId}:${screen.index}`;
      // A signal (a title or frame change, most often) can clear the plan
      // cache mid-transition. Re-applying the identical plan then restarts the
      // frame animation from wherever Mutter's own maximise/unmaximise
      // transition happens to have the window, which reads as an overshoot
      // followed by a correction. See `shouldApplyPlan`.
      const mismatch = this.planMismatch(plan);
      const changed = this.deps.signatures.changed(key, planSignature(plan.placements));
      if (!shouldApplyPlan({ mismatch, changed, alreadyTargeted: this.planIsCurrentTarget(plan) })) continue;
      this.deps.history.log('tile', {
        reason,
        workspaceId,
        screen: screen.index,
        tileables: tileables.length,
        placements: plan.placements.length,
      });
      // P6e: measure the apply call as its own section; the disabled path is a
      // single boolean test and never allocates the callback.
      if (this.deps.probe.enabled) {
        this.deps.probe.section('applyPlan', () => this.deps.tiling.applyPlan(plan, screen, reason, animate, rememberUndo));
      } else {
        this.deps.tiling.applyPlan(plan, screen, reason, animate, rememberUndo);
      }
      // §36.14: one retile must complete well under 10ms.
      const applyMs = (GLib.get_monotonic_time() - startedUs) / 1000;
      this.deps.diagnostics.noteApply(applyMs);
      if (applyMs > 5 && this.deps.settings.boolean('debug-enabled', false)) {
        this.deps.history.log('perf', { workspaceId, screen: screen.index, apply_ms: applyMs });
      }
    }
    this.deps.onStateChanged();
  }

  /**
   * The plan is stale when a window no longer sits where the plan puts it,
   * even if the plan's signature is unchanged. Without this, a window moved by
   * the user (or anything outside our drag handling) is never put back.
   */
  planMismatch(plan: TilePlan): boolean {
    // An explicit Undo restores rects that deliberately are not the plan.
    if (Date.now() < this.deps.ignoreMismatchUntilMs()) return false;
    // Our own applies are still landing: give them a moment.
    if (this.deps.tiling.activeAnimations > 0) return false;
    if (Date.now() - this.deps.tiling.lastApplyAtMs < 500) return false;
    for (const placement of plan.placements) {
      const tracked = this.deps.windows.get(placement.surfaceId);
      if (tracked === undefined) return true;
      // A window that demonstrably refuses geometry is not "stale".
      if (tracked.stubborn) continue;
      tracked.refreshFrame();
      const rect = tracked.surface.frame;
      if (
        Math.abs(rect.x - placement.rect.x) > 2 ||
        Math.abs(rect.y - placement.rect.y) > 2 ||
        Math.abs(rect.width - placement.rect.width) > 2 ||
        Math.abs(rect.height - placement.rect.height) > 2
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * True when every placement in `plan` is already the aim of its window
   * (`tracked.lastTarget`). Used with `planMismatch` to tell a genuine drift
   * (re-apply) from a plan cache cleared mid-transition by an unrelated signal
   * (do not re-apply: a second animation would restart from Mutter's
   * in-flight transition and read as a correction).
   */
  planIsCurrentTarget(plan: TilePlan): boolean {
    if (plan.placements.length === 0) return false;
    for (const placement of plan.placements) {
      const tracked = this.deps.windows.get(placement.surfaceId);
      const target = tracked?.lastTarget;
      if (target === null || target === undefined) return false;
      if (!rectEquals(target, placement.rect)) return false;
    }
    return true;
  }

  /**
   * Apply a placement decision to Mutter. The view follows only the app the
   * action is about, and only when the caller says so (§3).
   */
  applyPlacement(tracked: TrackedWindow, placement: Placement, follow: boolean, reason: string): void {
    const id = tracked.id;
    let workspaceId = placement.workspace;
    if (placement.createRight === true) {
      const created = this.deps.workspaces.createRight(placement.workspace);
      if (created !== null) workspaceId = created;
    }
    const previous = tracked.surface.workspaceId;
    if (workspaceId !== previous) {
      this.deps.workspaces.moveWindow(tracked, workspaceId);
      this.deps.history.log('ws_switch_empty', { id, from: previous, to: workspaceId, reason });
    }
    if (placement.float === true) {
      this.floatWindow(tracked);
      if (follow && workspaceId !== previous) this.deps.instantSwitch(() => this.deps.activateWorkspace(workspaceId));
      return;
    }
    if (placement.minimize !== undefined) {
      for (const mid of placement.minimize) {
        this.deps.tiling.noteSelfApply();
        this.deps.host.minimize(mid);
      }
    }
    if (placement.maximize === true) {
      if (placement.inPlace === true) {
        this.maximizeInPlace(tracked);
      } else {
        this.deps.tiling.noteSelfApply();
        this.deps.host.maximize(id);
      }
    } else if (placement.slot !== undefined) {
      // A pair is forming: the slot the change chose is honoured (§3/§4), and a
      // maximized occupant must unmaximize to share.
      this.pinSlots(workspaceId, tracked, placement.slot);
      this.unmaximizeOccupants(workspaceId, id);
    }
    if (follow && workspaceId !== previous) {
      this.deps.instantSwitch(() => this.deps.activateWorkspace(workspaceId));
    }
    this.deps.signatures.clearAll();
    this.deps.scheduleReconcile(`${reason}-settle`);
    // §12: keep the app's placement current for display memory and restarts.
    this.deps.recordPlacement(tracked);
  }

  /** §4: maximize in place, minimizing the other managed windows on this monitor. */
  maximizeInPlace(tracked: TrackedWindow): void {
    this.deps.tiling.noteSelfApply();
    // Clear the others first, so nothing is left on top of the trigger.
    for (const other of this.deps.tileables(tracked.surface.workspaceId)) {
      if (other.id === tracked.id) continue;
      if (other.surface.screenId !== tracked.surface.screenId) continue;
      this.deps.host.minimize(other.id);
    }
    this.deps.host.maximize(tracked.id);
  }

  /**
   * §3/§4: pin the pair's slots so the tiler honours the side the change chose
   * (a routed arrival's slot, an unmaximize joining slot 1). The other visible
   * window takes the opposite side; stale pins on the workspace are cleared.
   */
  pinSlots(workspaceId: number, tracked: TrackedWindow, slot: 0 | 1): void {
    for (const other of this.deps.windows.values()) {
      if (other.surface.workspaceId !== workspaceId) continue;
      if (other.surface.screenId !== tracked.surface.screenId) continue;
      other.pendingSlot = null;
    }
    tracked.pendingSlot = slot;
    const partner = this.deps.tileables(workspaceId).find(
      (t) => t.id !== tracked.id && t.surface.screenId === tracked.surface.screenId,
    );
    if (partner !== undefined) partner.pendingSlot = slot === 1 ? 0 : 1;
  }

  /** §3/§5: unmaximize a maximized window that must share its workspace. */
  unmaximizeOccupants(workspaceId: number, exceptId: number): void {
    for (const other of this.deps.tileables(workspaceId)) {
      if (other.id === exceptId) continue;
      if (!compat.isMaximized(other.win)) continue;
      this.deps.tiling.noteSelfApply();
      // This is our own unmaximize to let the pair form: the echo keeps the
      // resulting signal from running the user unmaximize ladder (A45).
      this.deps.withSelfUnmaximize(other, () => this.deps.host.unmaximize(other.id));
    }
  }

  /** §4: minimize or close the maximizer brings the others back. */
  restoreMinimizedOn(workspaceId: number, screenId: number): void {
    for (const tracked of this.deps.windows.values()) {
      if (tracked.surface.workspaceId !== workspaceId) continue;
      if (tracked.surface.screenId !== screenId) continue;
      if (!tracked.surface.flags.minimized) continue;
      if (!this.deps.classify(tracked).tileable) continue;
      this.deps.tiling.noteSelfApply();
      this.deps.host.unminimize(tracked.id);
    }
  }

  /** §3: route a newly opened window through the pure model, then apply it. */
  routeWindow(tracked: TrackedWindow): void {
    const own = tracked.surface.workspaceId;
    // Trace (§22): the arrival is the replayable event; the placement decision
    // is derived from the model, never recorded here.
    this.deps.onModelEvent?.('window-opened', {
      id: tracked.id,
      appId: tracked.surface.appId,
      screenId: tracked.surface.screenId,
      workspace: own,
      rect: tracked.surface.frame,
      min: tracked.minSize,
      max: tracked.maxSize,
    });
    const env = this.placementEnv(tracked.surface.screenId);
    const state = this.buildPlacementState(tracked.id, tracked.surface.screenId);
    if (this.doesNotFit(tracked, env)) {
      // §16: the escape rule — its own workspace, sized to itself.
      this.escapeTracked(tracked);
      return;
    }
    const rec: Win = {
      id: tracked.id,
      minimized: false,
      floating: false,
      maximized: tracked.surface.flags.maximized,
      fullscreen: tracked.surface.flags.fullscreen,
    };
    const placement = routeNewWindow(state, env, rec, null, own, false);
    this.applyPlacement(tracked, placement, own === state.viewed, 'route');
  }

  /**
   * §6: float a window adrt places itself — the explicit no-room cases and the
   * escape's single-workspace fallback. The placement is offset and kept inside
   * the work area so it is never exactly on top of what is beneath it. A display
   * rescue/replay passes the remembered `rect`, which is restored verbatim: a
   * float's frame is the user's, never re-centred by a screen change (§9).
   */
  floatWindow(tracked: TrackedWindow, rect?: Rect): void {
    tracked.autoFloated = true;
    tracked.pendingSlot = null;
    tracked.surface.setFloating(true);
    // The cached classification still says tileable; drop it so the next pass
    // treats the window as the float it now is.
    tracked.invalidateClassification();
    this.deps.recordPlacement(tracked);
    this.deps.tiling.noteSelfApply();
    this.deps.host.applyLayer(tracked.id, Layer.FLOATING);
    // Never touch a minimized window's geometry: Mutter un-minimizes it as a
    // side effect, so a window the user minimized would pop back on screen.
    // It gets the float rect when it is restored instead (see onMinimized).
    if (tracked.surface.flags.minimized) return;
    // Keep it on top but do not hide the pair behind it: centre it with a
    // margin so the tiled windows stay visible.
    const screen = this.deps.screenFor(tracked.surface.screenId);
    if (screen === null) return;
    if (rect !== undefined) {
      // A restored float keeps the exact frame it was left at; it stays on top
      // (the layer above the pair) and is never re-centred or re-sized to fit.
      this.deps.tiling.applyFrame(tracked, rect, screen, false, 'float-restore', 0);
      return;
    }
    const area = screenArea(screen);
    const margin = Math.max(24, Math.round(Math.min(area.width, area.height) * 0.12));
    const width = Math.max(1, area.width - 2 * margin);
    const height = Math.max(1, area.height - 2 * margin);
    this.deps.tiling.applyFrame(
      tracked,
      { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height },
      screen,
      false,
      'float-over-pair',
      0,
    );
  }

  /** §7.2 lone-maximize policy, per monitor (a pair on one monitor must not
   * turn a lone window on another into a "non-lone"). */
  evaluateLoneMaximize(workspaceId: number): void {
    for (const screen of this.deps.host.screens()) {
      const onScreen = (t: TrackedWindow): boolean => t.surface.screenId === screen.index;
      // §24/P2.5: one filter+classify+sort per screen; `nonTransient` is the
      // same list minus the transient windows. The two were derived separately.
      const tileables = this.deps.tileables(workspaceId).filter(onScreen);
      const nonTransient = tileables.filter((t) => !t.surface.flags.transient);
      if (nonTransient.length === 1 && tileables.length === 1) {
        const only = tileables[0];
        if (!compat.isMaximized(only.win)) {
          this.deps.tiling.noteSelfApply();
          this.deps.host.maximize(only.id);
          this.deps.history.log('tile', { id: only.id, reason: 'lone-maximize' });
        }
        continue;
      }
      if (nonTransient.length > 1 && tileables.length === 1 && compat.isMaximized(tileables[0].win)) {
        this.deps.tiling.noteSelfApply();
        this.deps.host.unmaximize(tileables[0].id);
        this.deps.scheduleRetile(workspaceId, 'lone-unmaximize');
      }
    }
  }

  /** §4: maximize — its own workspace to the right, or in place on `single`. */
  maximizeTracked(tracked: TrackedWindow): void {
    tracked.maximizeRequested = true;
    // §16: a window that does not fit its slot gets its own workspace instead.
    if (this.doesNotFit(tracked, this.placementEnv(tracked.surface.screenId))) {
      this.escapeTracked(tracked);
      return;
    }
    // §13: the pair it leaves behind reacts (the survivor maximizes); capture
    // the whole plane so undo restores both windows.
    this.deps.capturePlane([tracked.surface.workspaceId], tracked.surface.screenId);
    const own = tracked.surface.workspaceId;
    const env = this.placementEnv(tracked.surface.screenId);
    const state = this.buildPlacementState(null, tracked.surface.screenId);
    this.applyPlacement(tracked, maximizeWindow(state, env, own), own === state.viewed, 'maximize');
    this.deps.onModelEvent?.('window-maximized', { id: tracked.id, workspace: own });
  }

  /** §4: the unmaximize ladder, from the pure model (no origin memory). */
  unmaximizeTracked(tracked: TrackedWindow): void {
    tracked.maximizeRequested = false;
    const own = tracked.surface.workspaceId;
    this.deps.capturePlane([own - 1, own, own + 1], tracked.surface.screenId);
    const env = this.placementEnv(tracked.surface.screenId);
    const state = this.buildPlacementState(null, tracked.surface.screenId);
    const placement = unmaximizeWindow(state, env, own, tracked.id);
    // §4: there is no un-maximized lone window. When the ladder leaves the
    // window where it is (no neighbour holds windows), it is alone and the lone
    // law re-maximizes it rather than parking it minimized.
    if (placement.workspace === own && placement.minimize?.includes(tracked.id) === true) {
      this.deps.tiling.noteSelfApply();
      this.deps.host.maximize(tracked.id);
      this.deps.scheduleReconcile('unmaximize-lone');
      return;
    }
    const follow = own === state.viewed || placement.workspace !== own;
    this.applyPlacement(tracked, placement, follow, 'unmaximize');
    this.deps.onModelEvent?.('window-unmaximized', { id: tracked.id, workspace: placement.workspace });
    if (env.screen === 'single') this.restoreMinimizedOn(placement.workspace, tracked.surface.screenId);
    this.deps.workspaces.schedulePrune();
  }

  /** §4/§16: fullscreen behaves as maximize; leaving it as unmaximize. */
  fullscreenTracked(tracked: TrackedWindow, fullscreen: boolean): void {
    if (fullscreen) {
      const own = tracked.surface.workspaceId;
      const env = this.placementEnv(tracked.surface.screenId);
      const state = this.buildPlacementState(null, tracked.surface.screenId);
      this.applyPlacement(tracked, maximizeWindow(state, env, own), own === state.viewed, 'fullscreen');
      return;
    }
    this.unmaximizeTracked(tracked);
  }

  /**
   * §16/§10 step 3: the escape. A managed window that cannot fit its share is
   * given its own workspace to the right, sized to itself and clamped to
   * [1/6, full screen]; the window it was paired with keeps the screen.
   */
  escapeTracked(tracked: TrackedWindow): void {
    const env = this.placementEnv(tracked.surface.screenId);
    const screen = this.deps.screenFor(tracked.surface.screenId);
    if (screen === null) return;
    // §13: the escape moves the window to a new workspace; it is undoable.
    this.deps.capturePlane([tracked.surface.workspaceId], tracked.surface.screenId);
    const area = screenArea(screen);
    const size = escapeSize(
      env.axis === 'vertical' ? area.height : area.width,
      env.axis === 'vertical' ? tracked.surface.frame.height : tracked.surface.frame.width,
    );
    const rect: Rect = env.axis === 'vertical'
      ? { x: area.x, y: area.y, width: area.width, height: size }
      : { x: area.x, y: area.y, width: size, height: area.height };

    if (env.screen === 'single') {
      // §10 step 4: no workspace to give. The trigger keeps the screen,
      // maximized, and the other managed windows on the monitor minimize.
      this.maximizeInPlace(tracked);
      return;
    }
    if (env.screen === 'fixed') {
      // §7: no new workspace; keep the clamped size where it is.
      this.deps.tiling.applyFrame(tracked, rect, screen, false, 'escape-clamped', 0);
      return;
    }
    const own = tracked.surface.workspaceId;
    const state = this.buildPlacementState(null, tracked.surface.screenId);
    const created = this.deps.workspaces.createRight(own);
    if (created === null) {
      this.deps.tiling.applyFrame(tracked, rect, screen, false, 'escape-clamped', 0);
      return;
    }
    this.deps.workspaces.moveWindow(tracked, created);
    // A float is not our escape: a managed window that does not fit keeps its
    // clamped size, flush at slot 0 and full work-area height (§16).
    tracked.autoFloated = false;
    tracked.escaped = true;
    this.deps.tiling.applyFrame(tracked, rect, screen, false, 'escape', 0);
    if (own === state.viewed) this.deps.instantSwitch(() => this.deps.activateWorkspace(created));
    this.deps.history.log('spawn_ws', { id: tracked.id, workspaceId: created, reason: 'escape' });
    this.deps.signatures.clearAll();
    this.deps.scheduleReconcile('escape');
  }

  /**
   * §10 step 2: whether the refusing window's sibling can adapt to the
   * remainder. `escaped` false means the pair still exists, so the tiler's
   * ratio clamp is left to give the refusing window its minimum and the
   * sibling the rest; true means the pair cannot exist and step 3 applies.
   */
  refusalEscapes(refusing: TrackedWindow, sibling: TrackedWindow, screen: Screen, env: Env, config: TilerConfig): boolean {
    const area = screenArea(screen);
    // §10: the split extent uses the between-window gap, not the base, so an
    // explicit `gaps-between` is honoured by the refusal ladder.
    const gap = resolveGaps(config, screen).between;
    const extent = env.axis === 'vertical' ? area.height : area.width;
    const split = Math.max(0, extent - gap);
    const axis: 'width' | 'height' = env.axis === 'vertical' ? 'height' : 'width';
    const keep = this.toTilerWindow(refusing).min[axis];
    const siblingMinimum = this.toTilerWindow(sibling).min[axis];
    return refusalLadder(keep, siblingMinimum, split).escaped;
  }

  /**
   * §10 steps 3-4: the pair cannot exist, so the trigger keeps the screen and
   * the reactor gives way. The refusing window is the one whose own demand
   * broke the split: on a workspace-capable screen it is the one that escapes
   * to its own workspace; on a single-workspace screen it keeps the screen
   * maximized and the sibling is minimized.
   */
  escapeRefusal(refusing: TrackedWindow, sibling: TrackedWindow): void {
    const env = this.placementEnv(refusing.surface.screenId);
    const single = env.screen === 'single';
    const trigger = single ? refusing : sibling;
    const reactor = single ? sibling : refusing;
    const outcome = impossibleSplit(env, { id: trigger.id }, { id: reactor.id });
    if (outcome.giveWayTo === 'minimized') {
      this.maximizeInPlace(this.deps.windows.get(outcome.keep) ?? trigger);
      return;
    }
    this.escapeTracked(this.deps.windows.get(outcome.giveWay) ?? reactor);
  }
}
