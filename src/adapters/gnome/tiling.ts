// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Applies `TilePlan`s through the host, with animation, unmaximize delay and
 * bounded verification/retry (§11, §12, §13, §15).
 */

import GLib from 'gi://GLib';

import { migrateLegacyRatioKeys, ratioKey, remapRatiosAfterReap, sanitizeRatios, screenArea } from '../../core/tiler.js';
import type { SplitAxis } from '../../core/tiler.js';
import { clamp, rectEquals } from '../../core/types.js';
import type { Placement, Rect, Screen, TilePlan } from '../../core/types.js';
import * as compat from './compat.js';
import type { RegistryStore } from './registry.js';
import type { Animator } from './frame-clock.js';
import type { GnomeHost } from './host.js';
import type { History } from './history.js';
import type { GnomeSettings } from './settings.js';
import type { GnomeTiming } from './timing.js';
import type { TrackedWindow } from './tracked-window.js';
import type { ChangeLog, InstanceConfig } from '../../core/undo.js';

const VERIFY_TOLERANCE = 2;
/** Internal safety: the shortest wait before verifying a frame. A surface the
 * compositor has configured but not drawn can read back its old geometry, and
 * the retry ladder exists precisely for slow apps. Not a frame cadence. */
const MIN_SETTLE_MS = 100;

export interface TilingDeps {
  host: GnomeHost;
  settings: GnomeSettings;
  /** §11.3/§18: the OS animation state and per-screen frame interval. */
  timing: GnomeTiming;
  history: History;
  /** §12: the app registry; `adapt` is timing-only. */
  registry: RegistryStore;
  animator: Animator;
  changes: ChangeLog;
  windows(): Map<number, TrackedWindow>;
  isPaused(): boolean;
  onRatiosChanged(): void;
  onStubborn(appId: string): void;
  /** §4/§11: record on the session that an unmaximize we are about to make is
   * ours, so the asynchronous Mutter signal does not drive the user ladder. */
  noteSelfUnmaximize(id: number): void;
}

export class Tiling {
  private readonly ratios = new Map<string, number>();
  /** §15: ratios as they were before the last user ratio change, consumed by
   * the retile's undo entry. */
  private ratiosBeforeChange: Record<string, number> | null = null;
  private readonly swapPairs = new Set<string>();
  private readonly sources = new Set<number>();
  private destroyed = false;
  private verifyFailuresRemaining = 0;
  /** When set, only this window's applies are failed (null = any window). */
  private verifyFailuresFor: number | null = null;
  /**
   * The last refusal per window: a minimum is only learned when the same target
   * was refused twice with the window's size unchanged, so a stale size under
   * load cannot teach a bogus minimum (A52).
   */
  private lastAppliedAtMs = 0;
  /** When the last policy maximize went out (see `noteSelfMaximize`). */
  private lastSelfMaximizeAtMs = 0;
  /** Diagnostics: plans that actually moved at least one window. */
  private appliedPlans = 0;

  constructor(private readonly deps: TilingDeps) {}

  get plansApplied(): number {
    return this.appliedPlans;
  }

  /** When the tiler last moved a window, so callers can ignore their own frames. */
  get lastApplyAtMs(): number {
    return this.lastAppliedAtMs;
  }

  /** Mark a state change we are about to make (maximize/unmaximize/workspace). */
  noteSelfApply(): void {
    this.lastAppliedAtMs = Date.now();
  }

  /**
   * Mark a maximize *we* are about to make. The signal handler suppresses a
   * maximize only within this window — a tile apply (`noteSelfApply`) must never
   * swallow a real user maximize (A04/S04).
   */
  noteSelfMaximize(): void {
    this.lastSelfMaximizeAtMs = Date.now();
  }

  /** When the last policy maximize was applied. */
  get selfMaximizeAtMs(): number {
    return this.lastSelfMaximizeAtMs;
  }

  /**
   * Drop swap entries whose windows no longer exist. They are keyed by window
   * id, which does not survive a restart, so a saved state otherwise keeps
   * dead pairs forever.
   */
  pruneSwapPairs(alive: ReadonlySet<number>): void {
    let changed = false;
    for (const key of [...this.swapPairs]) {
      const [a, b] = key.split('|').map((part) => Number.parseInt(part, 10));
      if (!alive.has(a) || !alive.has(b)) {
        this.swapPairs.delete(key);
        changed = true;
      }
    }
    if (changed) this.deps.onRatiosChanged();
  }

  loadRatios(ratios: Record<string, number>, swapPairs: string[]): void {
    this.ratios.clear();
    // §23: an old state file keyed ratios by monitor index (and, before that, by
    // app pair); migrate the index keys to their connector and drop the rest.
    for (const [key, value] of Object.entries(this.migrateRatios(ratios))) this.ratios.set(key, value);
    this.swapPairs.clear();
    for (const key of swapPairs) this.swapPairs.add(key);
  }

  getRatios(): Record<string, number> {
    return Object.fromEntries(this.ratios);
  }

  getSwapPairs(): string[] {
    return [...this.swapPairs];
  }

  getRatio(key: string): number {
    return this.ratios.get(key) ?? 0.5;
  }

  setRatio(key: string, ratio: number): boolean {
    this.rememberRatiosBeforeChange();
    const clamped = clamp(ratio, 0.05, 0.95);
    this.ratios.set(key, clamped);
    this.deps.onRatiosChanged();
    return true;
  }

  toggleSwap(a: number, b: number): boolean {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (this.swapPairs.has(key)) this.swapPairs.delete(key);
    else this.swapPairs.add(key);
    this.deps.onRatiosChanged();
    return this.swapPairs.has(key);
  }

  /** §12 keyboard nudge on the shared edge of the focused pair. */
  nudgeSplit(focusedId: number, direction: string, stepPercent: number): boolean {
    const pair = this.pairFor(focusedId);
    if (pair === null) return false;
    const { first, second, axis } = pair;
    const key = ratioKey(pair.screen.connector, first.surface.workspaceId, axis);
    const current = this.getRatio(key);
    const delta = (stepPercent / 100) * (direction === 'left' || direction === 'up' ? -1 : 1);
    return this.setRatioForPair(first, second, axis, pair.screen.connector, current + delta);
  }

  setSplitRatioFor(workspaceId: number, connector: string, axis: SplitAxis, ratio: number): boolean {
    for (const tracked of this.deps.windows().values()) {
      if (tracked.surface.workspaceId !== workspaceId) continue;
      const pair = this.pairFor(tracked.id);
      if (pair === null || pair.axis !== axis) continue;
      if (pair.screen.connector !== connector) continue;
      return this.setRatioForPair(pair.first, pair.second, axis, pair.screen.connector, ratio);
    }
    return false;
  }

  getSplitRatioFor(workspaceId: number, connector: string, axis: SplitAxis): number {
    for (const tracked of this.deps.windows().values()) {
      if (tracked.surface.workspaceId !== workspaceId) continue;
      const pair = this.pairFor(tracked.id);
      if (pair === null || pair.axis !== axis) continue;
      if (pair.screen.connector !== connector) continue;
      return this.getRatio(ratioKey(pair.screen.connector, workspaceId, axis));
    }
    return 0.5;
  }

  /**
   * Apply a plan for a workspace. Returns true when at least one window moved.
   */
  applyPlan(plan: TilePlan, screen: Screen, reason: string, animate: boolean, rememberUndo = true): boolean {
    if (this.destroyed || this.deps.isPaused()) return false;

    // §11 determinism: a plan is computed one drain and applied on a later
    // frame, so a window can have become a float, escaped, minimized or
    // fullscreen in between. Re-derive that here and drop it from the plan
    // rather than dragging it back over the state the window now has.
    const placements = plan.placements.filter((placement) => {
      const tracked = this.deps.windows().get(placement.surfaceId);
      if (tracked === undefined) return false;
      if (tracked.escaped) return false;
      const flags = tracked.surface.flags;
      return !flags.floating && !flags.minimized && !flags.fullscreen;
    });

    const before: { id: number; rect: Rect }[] = [];
    let moved = false;
    for (const placement of placements) {
      const tracked = this.deps.windows().get(placement.surfaceId);
      if (tracked === undefined) continue;
      tracked.refreshFrame();
      const current = tracked.surface.frame;
      before.push({ id: tracked.id, rect: { ...current } });
      if (!rectEquals(current, placement.rect)) moved = true;
    }

    if (!moved) return false;

    this.appliedPlans += 1;

    // §13: a user action holds exactly one change — the instances and the ratios
    // that produced the "before" rects. A safety-net pass (scan / periodic
    // retile) is not a user action and must not mask the real change.
    if (rememberUndo) {
      const ratios = this.ratiosBeforeChange ?? this.getRatios();
      this.ratiosBeforeChange = null;
      const instances: InstanceConfig[] = [];
      for (const item of before) {
        const tracked = this.deps.windows().get(item.id);
        if (tracked === undefined) continue;
        instances.push({
          id: item.id,
          workspace: tracked.surface.workspaceId,
          slot: tracked.pendingSlot,
          rect: item.rect,
          maximized: compat.isMaximized(tracked.win),
          floating: tracked.surface.flags.floating,
        });
      }
      this.deps.changes.set({ instances, ratios });
    }

    // §25: the plan is exact in logical pixels, but the compositor stores
    // integers. Convert once for the whole plan so a pair's shared boundary is
    // rounded a single time and both frames derive from it (see
    // `compositorFrames`); applying each tile independently would let GI
    // truncation reintroduce the seam the plan reconciled.
    const frames = compositorFrames(placements, screen);
    for (let i = 0; i < placements.length; i += 1) {
      const placement = placements[i];
      const tracked = this.deps.windows().get(placement.surfaceId);
      if (tracked === undefined) continue;
      this.applyFrame(tracked, frames[i], screen, animate, reason, 0);
    }
    return true;
  }

  /** Apply a single frame with the §11 pipeline. */
  applyFrame(tracked: TrackedWindow, target: Rect, screen: Screen, animate: boolean, reason: string, attempt: number): void {
    if (this.destroyed || this.deps.isPaused()) return;
    const win = tracked.win;

    let delay = 0;
    if (compat.isMaximized(win)) {
      const started = GLib.get_monotonic_time();
      // §4: this is our own unmaximize to fit a tile, not the user's. Record the
      // echo on the session (Mutter emits the signal asynchronously) so
      // `onMaximizeSignal` does not run the unmaximize policy for it, and mark
      // the apply time so a stale maximize read is still covered by the global
      // self-apply window.
      this.noteSelfApply();
      this.deps.noteSelfUnmaximize(tracked.id);
      this.deps.host.unmaximize(tracked.id);
      const observed = Math.round((GLib.get_monotonic_time() - started) / 1000);
      this.deps.registry.observeUnmaximizeDelay(tracked.appKey, observed);
      delay = this.deps.registry.delayFor(tracked.appKey, tracked.profile.unmaximizeDelayMs);
    }

    if (delay > 0) {
      this.addTimeout(delay, () => this.performApply(tracked, target, screen, animate, reason, attempt));
    } else {
      this.performApply(tracked, target, screen, animate, reason, attempt);
    }
  }

  cancel(id: number): void {
    this.deps.animator.cancel(id);
  }

  /** §31.5 failure injection: `id` limits it to one window's applies. */
  injectVerifyFailures(count: number, id: number | null = null): void {
    this.verifyFailuresRemaining = Math.max(0, count);
    this.verifyFailuresFor = id;
  }

  get activeAnimations(): number {
    return this.deps.animator.activeCount;
  }

  isAnimating(id: number): boolean {
    return this.deps.animator.isAnimating(id);
  }

  destroy(): void {
    this.destroyed = true;
    for (const id of this.sources) GLib.source_remove(id);
    this.sources.clear();
    this.deps.animator.cancelAll();
  }

  private performApply(tracked: TrackedWindow, target: Rect, screen: Screen, animate: boolean, reason: string, attempt: number): void {
    if (this.destroyed || this.deps.isPaused()) return;
    // 1.6: every apply supersedes an in-flight tween for this window. Cancel it
    // up front — otherwise the non-animated branch below is immediately
    // overwritten by the stale tween, and that tween's dropped `onComplete`
    // cannot verify the abandoned target. The animated branch re-cancels (a
    // no-op) before it starts the new tween.
    this.deps.animator.cancel(tracked.id);
    this.lastAppliedAtMs = Date.now();
    // Record the intended geometry immediately: a window counts as tiled from
    // the moment we aim a plan at it, not only once verification succeeds.
    tracked.lastTarget = { ...target };
    const actor = compat.compositorActor(tracked.win);
    // Predictable: never animate a window that is (or is about to be)
    // maximized, or one that is minimized — that transition is Mutter's, and
    // running our own frame animation alongside it is what reads as rough.
    const animationsEnabled =
      animate && actor !== null && this.animationsAllowed(tracked) &&
      !compat.isMaximized(tracked.win) && !tracked.surface.flags.minimized;

    if (animationsEnabled) {
      const from = { ...tracked.surface.frame };
      const duration = this.durationFor(screen);
      this.deps.animator.animate(actor, tracked.id, from, target, duration, () =>
        this.scheduleVerify(tracked, target, reason, attempt), screenArea(screen),
      );
    } else {
      this.deps.host.applyFrame(tracked.id, target);
      tracked.refreshFrame();
      this.scheduleVerify(tracked, target, reason, attempt);
    }
  }

  private scheduleVerify(tracked: TrackedWindow, target: Rect, reason: string, attempt: number): void {
    const settle = Math.max(MIN_SETTLE_MS, this.deps.registry.settleFor(tracked.appKey, MIN_SETTLE_MS));
    this.addTimeout(settle, () => this.verify(tracked, target, reason, attempt));
  }

  private verify(tracked: TrackedWindow, target: Rect, reason: string, attempt: number): void {
    if (this.destroyed || this.deps.isPaused()) return;
    tracked.refreshFrame();
    const current = tracked.surface.frame;

    if (this.verifyFailuresRemaining > 0 && (this.verifyFailuresFor === null || this.verifyFailuresFor === tracked.id)) {
      this.verifyFailuresRemaining -= 1;
      this.retryOrRecord(tracked, target, reason, attempt, current);
      return;
    }

    if (this.within(current, target)) {
      this.deps.registry.noteSuccess(tracked.appKey);
      this.deps.registry.observeSettle(tracked.appKey, settleFor(tracked));
      tracked.refusals = 0;
      tracked.lastTarget = { ...target };
      this.deps.history.log('tile', { id: tracked.id, reason, attempt, rect: target });
      return;
    }

    this.retryOrRecord(tracked, target, reason, attempt, current);
  }

  private retryOrRecord(tracked: TrackedWindow, target: Rect, reason: string, attempt: number, current: Rect): void {
    const retries = tracked.profile.retriesMs;
    if (attempt < retries.length) {
      this.deps.history.log('resize_retry', { id: tracked.id, reason, attempt, rect: current });
      this.addTimeout(retries[attempt], () => {
        // §10: the retry re-reads the window's real screen; a hard-coded dummy
        // geometry would animate against the wrong area (or none at all).
        const screen = this.screenFor(tracked.surface.screenId);
        if (screen === null) return;
        this.applyFrame(tracked, target, screen, false, reason, attempt + 1);
      });
      return;
    }
    tracked.refusals += 1;
    // §12: no learned minimum. A refusal may make the app stubborn for the
    // session (skip animation, back off retries), but it never records a size
    // and never reaches the tiler as geometry.
    const stubborn = this.deps.registry.noteRefusal(tracked.appKey);
    this.deps.history.log('stubborn', { id: tracked.id, appId: tracked.appKey, refusals: tracked.refusals });
    if (stubborn) {
      tracked.stubborn = true;
      this.deps.onStubborn(tracked.surface.appId);
    }
  }

  private pairFor(id: number): { first: TrackedWindow; second: TrackedWindow; axis: SplitAxis; screen: Screen } | null {
    const tracked = this.deps.windows().get(id);
    if (tracked === undefined) return null;
    const siblings: TrackedWindow[] = [];
    for (const other of this.deps.windows().values()) {
      if (other.id !== id && other.surface.workspaceId === tracked.surface.workspaceId && other.surface.screenId === tracked.surface.screenId) {
        siblings.push(other);
      }
    }
    if (siblings.length !== 1) return null;
    const screen = this.screenFor(tracked.surface.screenId);
    if (screen === null) return null;
    const portrait = screen.geometry.height > screen.geometry.width;
    const first = tracked.id < siblings[0].id ? tracked : siblings[0];
    const second = tracked.id < siblings[0].id ? siblings[0] : tracked;
    return { first, second, axis: portrait ? 'vertical' : 'horizontal', screen };
  }

  private setRatioForPair(first: TrackedWindow, _second: TrackedWindow, axis: SplitAxis, connector: string, ratio: number): boolean {
    this.rememberRatiosBeforeChange();
    const key = ratioKey(connector, first.surface.workspaceId, axis);
    const clamped = clamp(ratio, 0.05, 0.95);
    this.ratios.set(key, clamped);
    this.deps.onRatiosChanged();
    this.deps.history.log('split_resize', { axis, ratio: clamped, pair: key });
    return true;
  }

  /**
   * §10/§5: a reaped workspace drops its ratio, and every workspace to its
   * right shifts down one index, so their ratios move with them. Without this a
   * stale key would be misapplied to whatever workspace later reuses the
   * vacated index (and a shift could point a ratio at the wrong workspace).
   */
  reindexRatiosAfterReap(reaped: readonly number[]): void {
    if (reaped.length === 0) return;
    const next = remapRatiosAfterReap(this.getRatios(), reaped);
    this.ratios.clear();
    for (const [key, value] of Object.entries(next)) this.ratios.set(key, value);
    this.deps.onRatiosChanged();
  }

  /**
   * §15: a ratio change is not itself an undo entry — the retile it triggers
   * is. Remember the ratios as they were so that entry can restore them along
   * with the rects.
   */
  private rememberRatiosBeforeChange(): void {
    if (this.ratiosBeforeChange === null) this.ratiosBeforeChange = this.getRatios();
  }

  /** §15: restore the split ratios an undo entry was captured with. */
  restoreRatios(ratios: Record<string, number>): void {
    this.ratios.clear();
    for (const [key, value] of Object.entries(this.migrateRatios(ratios))) this.ratios.set(key, value);
    this.deps.onRatiosChanged();
  }

  /**
   * §23: rewrite a persisted ratio map to connector keys and drop what can never
   * be applied. A key whose first segment is a monitor index is looked up in the
   * live screen table (and dropped when that monitor is gone); a key that
   * already names a connector passes through. Legacy app-pair keys are dropped
   * by the sanitize pass.
   */
  private migrateRatios(ratios: Readonly<Record<string, number>>): Record<string, number> {
    const connectorByIndex = new Map<number, string>();
    for (const screen of this.deps.host.screens()) connectorByIndex.set(screen.index, screen.connector);
    return sanitizeRatios(migrateLegacyRatioKeys(ratios, connectorByIndex));
  }

  private screenFor(index: number): Screen | null {
    for (const screen of this.deps.host.screens()) {
      if (screen.index === index) return screen;
    }
    return null;
  }

  private animationsAllowed(tracked: TrackedWindow): boolean {
    // §18: one source of truth — the OS animation state (mirrored adrt
    // `disable-animations` included), read through the timing resolver.
    if (!this.deps.timing.animationsEnabled()) return false;
    if (!tracked.profile.animate) return false;
    if (this.deps.registry.skipAnimation(tracked.appKey)) return false;
    return true;
  }

  /**
   * The user's base duration resolved to whole compositor frames on the
   * window's own screen, scaled by the OS slow-down factor and zero when
   * animations are off. The previous fixed 130/190/240 ms branches were dead
   * (they all resolved to the setting) and assumed 60 Hz.
   */
  private durationFor(screen: Screen): number {
    return this.deps.timing.effectiveDuration(this.deps.settings.int('animation-duration', 180), screen.index);
  }

  private within(a: Rect, b: Rect): boolean {
    return (
      Math.abs(a.x - b.x) <= VERIFY_TOLERANCE &&
      Math.abs(a.y - b.y) <= VERIFY_TOLERANCE &&
      Math.abs(a.width - b.width) <= VERIFY_TOLERANCE &&
      Math.abs(a.height - b.height) <= VERIFY_TOLERANCE
    );
  }

  private addTimeout(ms: number, cb: () => void): void {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, ms), () => {
      this.sources.delete(id);
      if (this.destroyed) return GLib.SOURCE_REMOVE;
      cb();
      return GLib.SOURCE_REMOVE;
    });
    this.sources.add(id);
  }
}

function settleFor(tracked: TrackedWindow): number {
  return Math.max(MIN_SETTLE_MS, tracked.profile.retriesMs[0] ?? MIN_SETTLE_MS);
}

/**
 * §10/§25: turn a plan's exact logical rects into the integer logical pixels the
 * compositor actually stores.
 *
 * `Meta.Window.move_resize_frame` takes ints and GI truncates each argument on
 * its own. At a fractional scale the plan's shared split boundary can sit
 * between two logical pixels, so truncating each tile's `x` and `width`
 * independently reintroduces the seam the tiler reconciled: one tile ends a
 * pixel short and the other starts a pixel late. Here the shared boundary is
 * rounded *once* and both tiles are measured from the resulting integer edges —
 * the first ends at the boundary, the second starts at `boundary + gap` — so
 * the compositor frames meet exactly. Outer edges are kept inside the work
 * area. At an integer scale the plan is already integral and this returns the
 * rects untouched, so scale 1/2 geometry is byte-identical.
 */
function compositorFrames(placements: readonly Placement[], screen: Screen): Rect[] {
  const rects = placements.map((placement) => ({ ...placement.rect }));
  if (rects.length === 0 || Number.isInteger(screen.scale)) return rects;
  if (rects.length === 2) {
    const [a, b] = rects;
    const splitX = a.y === b.y && a.height === b.height;
    const splitY = a.x === b.x && a.width === b.width;
    if (splitX && !splitY) return reconcileSplitAxis(rects, 'x', screen);
    if (splitY && !splitX) return reconcileSplitAxis(rects, 'y', screen);
  }
  return rects.map((rect) => clampRoundRect(rect, screenArea(screen)));
}

/**
 * Round the two rects of a pair about their shared boundary on `axis`. The
 * first (leading) rect ends at the rounded boundary, the second (trailing) one
 * starts at `boundary + gap`; both perpendicular edges are rounded once and
 * kept inside the work area. The returned order matches the input order.
 */
function reconcileSplitAxis(rects: readonly Rect[], axis: 'x' | 'y', screen: Screen): Rect[] {
  const size = axis === 'x' ? 'width' : 'height';
  const area = screenArea(screen);
  const lo = Math.ceil(area[axis]);
  const hi = Math.floor(area[axis] + area[size]);
  const forward = rects[0][axis] <= rects[1][axis];
  const first = forward ? rects[0] : rects[1];
  const second = forward ? rects[1] : rects[0];
  const gap = Math.max(0, Math.round(second[axis] - (first[axis] + first[size])));
  const boundary = clamp(Math.round(first[axis] + first[size]), lo, hi);
  const start0 = clamp(Math.round(first[axis]), lo, boundary);
  const start1 = clamp(boundary + gap, boundary, hi);
  const end1 = clamp(Math.round(second[axis] + second[size]), start1, hi);
  const lead: Rect = { ...first, [axis]: start0, [size]: Math.max(0, boundary - start0) };
  const trail: Rect = { ...second, [axis]: start1, [size]: Math.max(0, end1 - start1) };
  roundPerpendicular(lead, axis, area);
  roundPerpendicular(trail, axis, area);
  return forward ? [lead, trail] : [trail, lead];
}

/** Round the axis a split does not use, and keep it inside `area`. */
function roundPerpendicular(rect: Rect, axis: 'x' | 'y', area: Rect): void {
  const other = axis === 'x' ? 'y' : 'x';
  const otherSize = axis === 'x' ? 'height' : 'width';
  const lo = Math.ceil(area[other]);
  const hi = Math.floor(area[other] + area[otherSize]);
  const start = clamp(Math.round(rect[other]), lo, hi);
  rect[other] = start;
  rect[otherSize] = clamp(Math.round(rect[otherSize]), 0, hi - start);
}

/** Round every edge of a lone rect to integer logical pixels, inside `area`. */
function clampRoundRect(rect: Rect, area: Rect): Rect {
  const x = clamp(Math.round(rect.x), Math.ceil(area.x), Math.floor(area.x + area.width));
  const y = clamp(Math.round(rect.y), Math.ceil(area.y), Math.floor(area.y + area.height));
  return {
    x,
    y,
    width: clamp(Math.round(rect.width), 0, Math.floor(area.x + area.width) - x),
    height: clamp(Math.round(rect.height), 0, Math.floor(area.y + area.height) - y),
  };
}
