// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Applies `TilePlan`s through the host, with animation, unmaximize delay and
 * bounded verification/retry (§11, §12, §13, §15).
 */

import GLib from 'gi://GLib';
import St from 'gi://St';

import { ratioKey, screenArea } from '../../core/tiler.js';
import type { SplitAxis } from '../../core/tiler.js';
import { clamp, rectEquals } from '../../core/types.js';
import type { Rect, Screen, TilePlan } from '../../core/types.js';
import * as compat from './compat.js';
import type { RegistryStore } from './registry.js';
import type { FrameClockAnimator } from './frame-clock.js';
import type { GnomeHost } from './host.js';
import type { History } from './history.js';
import type { GnomeSettings } from './settings.js';
import type { TrackedWindow } from './tracked-window.js';
import type { ChangeLog, InstanceConfig } from '../../core/undo.js';

const VERIFY_TOLERANCE = 2;
const MIN_SETTLE_MS = 100;
const MAX_FRAME_INTERVAL_MS = 100;

export interface TilingDeps {
  host: GnomeHost;
  settings: GnomeSettings;
  history: History;
  /** §12: the app registry; `adapt` is timing-only. */
  registry: RegistryStore;
  animator: FrameClockAnimator;
  changes: ChangeLog;
  windows(): Map<number, TrackedWindow>;
  isPaused(): boolean;
  onRatiosChanged(): void;
  onStubborn(appId: string): void;
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
    for (const [key, value] of Object.entries(ratios)) this.ratios.set(key, value);
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
    const key = ratioKey(first.surface.appId, second.surface.appId, axis);
    const current = this.getRatio(key);
    const delta = (stepPercent / 100) * (direction === 'left' || direction === 'up' ? -1 : 1);
    return this.setRatioForPair(first, second, axis, current + delta);
  }

  setSplitRatioFor(workspaceId: number, connector: string, axis: SplitAxis, ratio: number): boolean {
    for (const tracked of this.deps.windows().values()) {
      if (tracked.surface.workspaceId !== workspaceId) continue;
      const pair = this.pairFor(tracked.id);
      if (pair === null || pair.axis !== axis) continue;
      if (pair.screen.connector !== connector) continue;
      return this.setRatioForPair(pair.first, pair.second, axis, ratio);
    }
    return false;
  }

  getSplitRatioFor(workspaceId: number, connector: string, axis: SplitAxis): number {
    for (const tracked of this.deps.windows().values()) {
      if (tracked.surface.workspaceId !== workspaceId) continue;
      const pair = this.pairFor(tracked.id);
      if (pair === null || pair.axis !== axis) continue;
      if (pair.screen.connector !== connector) continue;
      return this.getRatio(ratioKey(pair.first.surface.appId, pair.second.surface.appId, axis));
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

    for (const placement of placements) {
      const tracked = this.deps.windows().get(placement.surfaceId);
      if (tracked === undefined) continue;
      this.applyFrame(tracked, placement.rect, screen, animate, reason, 0);
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
      // §4: this is our own unmaximize to fit a tile, not the user's. Mark it so
      // `onMaximizeSignal` does not run the unmaximize policy for it.
      tracked.selfUnmaximize = true;
      try {
        this.deps.host.unmaximize(tracked.id);
      } finally {
        tracked.selfUnmaximize = false;
      }
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
      const duration = this.durationFor(from, target);
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

  private setRatioForPair(first: TrackedWindow, second: TrackedWindow, axis: SplitAxis, ratio: number): boolean {
    this.rememberRatiosBeforeChange();
    const key = ratioKey(first.surface.appId, second.surface.appId, axis);
    const clamped = clamp(ratio, 0.05, 0.95);
    this.ratios.set(key, clamped);
    this.deps.onRatiosChanged();
    this.deps.history.log('split_resize', { axis, ratio: clamped, pair: key });
    return true;
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
    for (const [key, value] of Object.entries(ratios)) this.ratios.set(key, value);
    this.deps.onRatiosChanged();
  }

  private screenFor(index: number): Screen | null {
    for (const screen of this.deps.host.screens()) {
      if (screen.index === index) return screen;
    }
    return null;
  }

  private animationsAllowed(tracked: TrackedWindow): boolean {
    if (this.deps.settings.boolean('disable-animations', false)) return false;
    if (!St.Settings.get().enable_animations) return false;
    if (!tracked.profile.animate) return false;
    if (this.deps.registry.skipAnimation(tracked.appKey)) return false;
    return true;
  }

  private durationFor(from: Rect, to: Rect): number {
    const base = this.deps.settings.int('animation-duration', 180);
    const delta = Math.abs(from.x - to.x) + Math.abs(from.y - to.y) + Math.abs(from.width - to.width) + Math.abs(from.height - to.height);
    return delta > 400 ? Math.min(240, base) : Math.max(130, Math.min(190, base));
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

export const FRAME_INTERVAL_BUDGET_MS = MAX_FRAME_INTERVAL_MS;
