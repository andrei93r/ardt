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
import type { AdaptationStore } from './adapt.js';
import * as compat from './compat.js';
import type { FrameClockAnimator } from './frame-clock.js';
import type { GnomeHost } from './host.js';
import type { History, UndoStack } from './history.js';
import type { GnomeSettings } from './settings.js';
import type { TrackedWindow } from './tracked-window.js';

const VERIFY_TOLERANCE = 2;
const MIN_SETTLE_MS = 100;
const MAX_FRAME_INTERVAL_MS = 100;

export interface TilingDeps {
  host: GnomeHost;
  settings: GnomeSettings;
  history: History;
  adaptation: AdaptationStore;
  animator: FrameClockAnimator;
  undo: UndoStack;
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
  private lastAppliedAtMs = 0;

  constructor(private readonly deps: TilingDeps) {}

  /** When the tiler last moved a window, so callers can ignore their own frames. */
  get lastApplyAtMs(): number {
    return this.lastAppliedAtMs;
  }

  /** Mark a state change we are about to make (maximize/unmaximize/workspace). */
  noteSelfApply(): void {
    this.lastAppliedAtMs = Date.now();
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

  isSwapped(a: number, b: number): boolean {
    return this.swapPairs.has(a < b ? `${a}|${b}` : `${b}|${a}`);
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

    const before: { id: number; rect: Rect }[] = [];
    let moved = false;
    for (const placement of plan.placements) {
      const tracked = this.deps.windows().get(placement.surfaceId);
      if (tracked === undefined) continue;
      tracked.surface.refreshFrame();
      const current = tracked.surface.frame;
      before.push({ id: tracked.id, rect: { ...current } });
      if (!rectEquals(current, placement.rect)) moved = true;
    }

    if (!moved) return false;

    const workspaceId = plan.placements.length > 0 ? this.deps.windows().get(plan.placements[0].surfaceId)?.surface.workspaceId ?? 0 : 0;
    // §15: capture the ratios the "before" rects came from, so undo restores a
    // self-consistent layout. A safety-net pass (scan / periodic retile) is not
    // a user action and must not push a masking entry over the real one.
    if (rememberUndo) {
      const ratios = this.ratiosBeforeChange ?? this.getRatios();
      this.ratiosBeforeChange = null;
      this.deps.undo.push(workspaceId, before, moved, ratios);
    }

    for (const placement of plan.placements) {
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
      this.deps.host.unmaximize(tracked.id);
      const observed = Math.round((GLib.get_monotonic_time() - started) / 1000);
      this.deps.adaptation.observeUnmaximizeDelay(tracked.surface.appId, observed);
      delay = this.deps.adaptation.delayFor(tracked.surface.appId, tracked.profile.unmaximizeDelayMs);
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

  /** §31.5 failure injection. */
  injectVerifyFailures(count: number): void {
    this.verifyFailuresRemaining = Math.max(0, count);
  }

  get activeAnimations(): number {
    return this.deps.animator.activeCount;
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
    const animationsEnabled = animate && actor !== null && this.animationsAllowed(tracked);

    if (animationsEnabled) {
      const from = { ...tracked.surface.frame };
      const duration = this.durationFor(from, target);
      this.deps.animator.animate(actor, tracked.id, from, target, duration, () =>
        this.scheduleVerify(tracked, target, reason, attempt), screenArea(screen),
      );
    } else {
      this.deps.host.applyFrame(tracked.id, target);
      tracked.surface.refreshFrame();
      this.scheduleVerify(tracked, target, reason, attempt);
    }
  }

  private scheduleVerify(tracked: TrackedWindow, target: Rect, reason: string, attempt: number): void {
    const settle = Math.max(MIN_SETTLE_MS, this.deps.adaptation.settleFor(tracked.surface.appId));
    this.addTimeout(settle, () => this.verify(tracked, target, reason, attempt));
  }

  private verify(tracked: TrackedWindow, target: Rect, reason: string, attempt: number): void {
    if (this.destroyed || this.deps.isPaused()) return;
    tracked.surface.refreshFrame();
    const current = tracked.surface.frame;

    if (this.verifyFailuresRemaining > 0) {
      this.verifyFailuresRemaining -= 1;
      this.retryOrRecord(tracked, target, reason, attempt, current);
      return;
    }

    if (this.within(current, target)) {
      this.deps.adaptation.noteSuccess(tracked.surface.appId);
      this.deps.adaptation.observeSettle(tracked.surface.appId, settleFor(tracked));
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
      this.addTimeout(retries[attempt], () => this.applyFrame(tracked, target, dummyScreen(), false, reason, attempt + 1));
      return;
    }
    tracked.refusals += 1;
    // Only a window that refused to *shrink* has a minimum: it ended up larger
    // than the rect we asked for. A window that stayed smaller than the target
    // (a max-size app) must not teach us a minimum — doing so pinned, e.g.,
    // Chrome to its current width and made a 50/50 split impossible.
    if (current.width > target.width + VERIFY_TOLERANCE || current.height > target.height + VERIFY_TOLERANCE) {
      this.deps.adaptation.observeRefusedMin(tracked.surface.appId, current.width, current.height);
    }
    const stubborn = this.deps.adaptation.noteRefusal(tracked.surface.appId);
    this.deps.history.log('stubborn', { id: tracked.id, appId: tracked.surface.appId, refusals: tracked.refusals });
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
    if (this.deps.adaptation.skipAnimation(tracked.surface.appId)) return false;
    return true;
  }

  private durationFor(from: Rect, to: Rect): number {
    const base = this.deps.settings.int('animation-duration', 180);
    const delta = Math.abs(from.x - to.x) + Math.abs(from.y - to.y) + Math.abs(from.width - to.width) + Math.abs(from.height - to.height);
    return delta > 400 ? Math.min(160, base) : Math.max(70, Math.min(120, base));
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

function dummyScreen(): Screen {
  return { index: 0, connector: '', geometry: { x: 0, y: 0, width: 0, height: 0 }, scale: 1, refreshRate: 60, isPrimary: true };
}

export const FRAME_INTERVAL_BUDGET_MS = MAX_FRAME_INTERVAL_MS;
