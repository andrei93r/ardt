// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Window lifecycle and workspace policy (§7, §9.4, §14, §16, §17).
 * Owns the one `Map<number, TrackedWindow>` and every per-window signal.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import type { HeuristicContext } from '../../core/classify.js';
import { checkPlan } from '../../core/invariants.js';
import { SignatureCache, planSignature } from '../../core/scheduler.js';
import type { TilerConfig, TilerWindow } from '../../core/tiler.js';
import { computePlans, pairKey, ratioKey, screenArea } from '../../core/tiler.js';
import { Layer } from '../../core/types.js';
import type { Rect, Screen, TilePlan } from '../../core/types.js';
import type { AdaptationStore, FloatStore } from './adapt.js';
import * as compat from './compat.js';
import type { GnomeHost } from './host.js';
import type { History, UndoStack } from './history.js';
import type { GnomeSettings } from './settings.js';
import type { Tiling } from './tiling.js';
import { TrackedWindow } from './tracked-window.js';

export interface SessionDeps {
  host: GnomeHost;
  settings: GnomeSettings;
  tiling: Tiling;
  history: History;
  adaptation: AdaptationStore;
  floats: FloatStore;
  undo: UndoStack;
  isPaused(): boolean;
  onStateChanged(): void;
  onStubborn(appId: string): void;
  onClosed(id: number, rect: Rect): void;
  onDragChanged(dragging: boolean): void;
  /** The window is being moved to another workspace: hide the border now. */
  onWindowMoving(): void;
}

interface WindowSignal {
  id: number;
}

/** Quiet period after the last user frame change before a drop is interpreted. */
const ADJUST_SETTLE_MS = 150;
/** Debounce before a global reconcile pass. */
const RECONCILE_DEBOUNCE_MS = 60;

export class WindowSession {
  readonly windows = new Map<number, TrackedWindow>();
  private readonly signals = new Map<number, WindowSignal[]>();
  private readonly signatures = new SignatureCache();
  private readonly suppress = new Set<number>();
  private reconcileSource: number | null = null;
  private readonly timeoutSources = new Set<number>();
  /** Workspaces this extension created; empty ones are removed again (§16). */
  private readonly dynamicWorkspaces = new Set<number>();
  private reorderSignal = 0;
  private displaySignals: number[] = [];
  private managerSignals: number[] = [];
  private grabBeginSignal = 0;
  private grabEndSignal = 0;
  private dragging = false;
  private dragStartRect: Rect | null = null;
  /** True while a compositor state makes tiling pointless (the overview). */
  private suspended = false;
  private adjustId: number | null = null;
  private adjustSource: number | null = null;
  /** While set, plan-mismatch re-applies are suppressed (e.g. right after Undo). */
  private ignoreMismatchUntilMs = 0;
  private scanPerfCounter = 0;
  private lastReconcileMs = 0;
  private lastApplyMs = 0;
  private lastApplyAtMs = 0;

  constructor(private readonly deps: SessionDeps) {}

  /** §24 item 8: adaptive back-off scan tick. */
  private scanSource: number | null = null;
  private scanIntervalMs = 5000;
  private idleScans = 0;

  startScan(): void {
    if (this.scanSource !== null) return;
    this.scanIntervalMs = this.scanBaseMs();
    this.scheduleScan();
    // §7.6: user reorders shift every window's workspace index.
    this.reorderSignal = global.workspace_manager.connect('workspaces-reordered', () => this.onWorkspacesReordered());
    // §11.3 / §23.1: never retile or show the border while the user is dragging.
    this.grabBeginSignal = global.display.connect('grab-op-begin', (_display: any, win: any, op: number) =>
      this.onGrabBegin(win, op),
    );
    this.grabEndSignal = global.display.connect('grab-op-end', (_display: any, win: any, op: number) =>
      this.onGrabEnd(win, op),
    );
    // Anything that can move, restack or re-parent a window triggers a
    // debounced global reconcile pass.
    this.displaySignals.push(
      global.display.connect('window-entered-monitor', () => this.scheduleReconcile('window-monitor')),
      global.display.connect('window-left-monitor', () => this.scheduleReconcile('window-monitor')),
      global.display.connect('notify::focus-window', () => this.scheduleReconcile('focus')),
    );
    this.managerSignals.push(
      global.workspace_manager.connect('active-workspace-changed', () => this.scheduleReconcile('workspace-active')),
      global.workspace_manager.connect('workspace-added', () => this.scheduleReconcile('workspace-added')),
      global.workspace_manager.connect('workspace-removed', () => this.scheduleReconcile('workspace-removed')),
      global.workspace_manager.connect('notify::n-workspaces', () => this.scheduleReconcile('workspace-count')),
    );
  }

  private scanBaseMs(): number {
    return Math.max(1000, this.deps.settings.int('scan-interval', 5000));
  }

  stopScan(): void {
    if (this.scanSource !== null) {
      GLib.source_remove(this.scanSource);
      this.scanSource = null;
    }
    if (this.reorderSignal !== 0) {
      global.workspace_manager.disconnect(this.reorderSignal);
      this.reorderSignal = 0;
    }
    if (this.grabBeginSignal !== 0) {
      global.display.disconnect(this.grabBeginSignal);
      this.grabBeginSignal = 0;
    }
    if (this.grabEndSignal !== 0) {
      global.display.disconnect(this.grabEndSignal);
      this.grabEndSignal = 0;
    }
    for (const id of this.displaySignals) global.display.disconnect(id);
    this.displaySignals = [];
    for (const id of this.managerSignals) global.workspace_manager.disconnect(id);
    this.managerSignals = [];
  }

  get isDragging(): boolean {
    return this.dragging || this.adjustId !== null;
  }

  /** Suspend tiling (e.g. the overview is open); one pass runs on resume. */
  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    if (!suspended) this.scheduleReconcile('resume');
  }

  private onGrabBegin(win: any, _op: number): void {
    if (win === null) return;
    this.beginDrag(win.get_id());
  }

  private onGrabEnd(win: any, _op: number): void {
    if (win === null) return;
    this.endDrag(win.get_id());
  }

  /** §11.3: while a drag is in flight, freeze reflow and hide the border. */
  beginDrag(id: number): boolean {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return false;
    if (this.dragging) return true;
    this.dragging = true;
    this.dragStartRect = { ...tracked.surface.frame };
    this.deps.onDragChanged(true);
    return true;
  }

  /**
   * Drag released: interpret the gesture before reflowing.
   * - §12 inner-edge resize of a pair saves the new split ratio.
   * - §13 dragging one window past its sibling swaps the pair.
   * - otherwise the workspace simply reflows.
   */
  endDrag(id: number): boolean {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return false;
    const wasDragging = this.dragging;
    this.dragging = false;
    this.deps.onDragChanged(false);
    if (!wasDragging) return true;

    tracked.surface.refreshFrame();
    this.interpretDrop(tracked, this.adjustMode(tracked));
    this.dragStartRect = null;
    this.signatures.clearAll();
    // A drop must take effect at once: the swap flag was just set, so retile
    // immediately rather than waiting out the reconcile debounce.
    this.retile(tracked.surface.workspaceId, 'drag-end');
    return true;
  }

  private pairSibling(tracked: TrackedWindow): TrackedWindow | null {
    const peers = this.tileables(tracked.surface.workspaceId).filter(
      (t) => t.id !== tracked.id && t.surface.screenId === tracked.surface.screenId,
    );
    return peers.length === 1 ? peers[0] : null;
  }

  /**
   * §13: the window was dropped onto its sibling. The trigger is geometric:
   * the drop's centre inside the sibling, or more than half the smaller
   * window's area overlapping it. Crossing the centre is not required.
   */
  private applySwapIntent(tracked: TrackedWindow, sibling: TrackedWindow): void {
    const rect = tracked.surface.frame;
    const other = sibling.surface.frame;
    if (!this.landsOn(rect, other)) return;
    this.deps.tiling.toggleSwap(tracked.id, sibling.id);
    this.deps.history.log('swap', { a: tracked.id, b: sibling.id, reason: 'drag' });
  }

  /** Would a drop at `rect` land on `target`? */
  private landsOn(rect: Rect, target: Rect): boolean {
    const overlapX = Math.max(0, Math.min(rect.x + rect.width, target.x + target.width) - Math.max(rect.x, target.x));
    const overlapY = Math.max(0, Math.min(rect.y + rect.height, target.y + target.height) - Math.max(rect.y, target.y));
    const overlap = overlapX * overlapY;
    const minArea = Math.min(rect.width * rect.height, target.width * target.height);
    const centreX = rect.x + rect.width / 2;
    const centreY = rect.y + rect.height / 2;
    const centreInside =
      centreX >= target.x && centreX <= target.x + target.width && centreY >= target.y && centreY <= target.y + target.height;
    return centreInside || (minArea > 0 && overlap >= minArea * 0.35);
  }

  /** §12: a shared inner edge moved; save the resulting ratio. */
  private applyResizeIntent(tracked: TrackedWindow, sibling: TrackedWindow, screen: Screen): void {
    const start = this.dragStartRect;
    if (start === null) return;
    const horizontal = screenArea(screen).width >= screenArea(screen).height;
    const rect = tracked.surface.frame;
    const other = sibling.surface.frame;

    const leftIsTracked = horizontal ? rect.x <= other.x : rect.y <= other.y;
    const movedStart = horizontal ? start.x : start.y;
    const movedEnd = horizontal ? start.x + start.width : start.y + start.height;
    const nowStart = horizontal ? rect.x : rect.y;
    const nowEnd = horizontal ? rect.x + rect.width : rect.y + rect.height;
    const startMoved = Math.abs(nowStart - movedStart) > Math.abs(nowEnd - movedEnd);
    // Inner edge = the edge shared with the sibling.
    const isInner = leftIsTracked ? !startMoved : startMoved;
    if (!isInner) return;

    const near = horizontal ? Math.min(rect.x, other.x) : Math.min(rect.y, other.y);
    const far = horizontal
      ? Math.max(rect.x + rect.width, other.x + other.width)
      : Math.max(rect.y + rect.height, other.y + other.height);
    const span = far - near;
    if (span <= 0) return;
    const leftExtent = leftIsTracked
      ? horizontal
        ? rect.width
        : rect.height
      : horizontal
        ? other.width
        : other.height;
    const ratioLeft = leftExtent / span;
    const leftAppId = leftIsTracked ? tracked.surface.appId : sibling.surface.appId;
    const rightAppId = leftIsTracked ? sibling.surface.appId : tracked.surface.appId;
    const sortedFirstIsLeft = leftAppId <= rightAppId;
    const axis = horizontal ? 'horizontal' : 'vertical';
    const key = ratioKey(tracked.surface.appId, sibling.surface.appId, axis);
    this.deps.tiling.setRatio(key, sortedFirstIsLeft ? ratioLeft : 1 - ratioLeft);
    this.deps.history.log('split_resize', { pair: key, ratio: ratioLeft, reason: 'drag' });
  }

  /** §18 invariant: paused means no retiles, no scan tick.**/
  setScanning(enabled: boolean): void {
    if (enabled) this.startScan();
    else this.stopScan();
  }

  register(win: any): void {
    const id: number = win.get_id();
    if (this.windows.has(id)) return;
    // Popups, menus and tooltips are override-redirect; they are never tiled
    // and tracking them only creates work and spurious signals.
    if (compat.isOverrideRedirect(win)) return;
    const surface = this.deps.host.ensureSurface(win);
    const tracked = new TrackedWindow(win, surface);
    tracked.originalRect = { ...surface.frame };
    tracked.lastWorkspaceIdx = surface.workspaceId;
    this.windows.set(id, tracked);
    this.connectWindow(tracked);
    this.deps.history.log('register', { id, appId: surface.appId, title: surface.title });
    this.deferReady(tracked, 0);
  }

  /** §7.1: wait for the first frame plus the configured delay. */
  private deferReady(tracked: TrackedWindow, attempt: number): void {
    const delay = Math.max(50, this.deps.settings.int('gnome-animation-delay', 0));
    this.addTimeout(delay, () => this.onReady(tracked, attempt));
  }

  private isMapped(tracked: TrackedWindow): boolean {
    if (compat.compositorActor(tracked.win) === null) return false;
    // Mutter assigns wm-class slightly after window-created; classifying before
    // that caches the wrong app identity and window type.
    if (tracked.surface.appId.length === 0) return false;
    const frame = tracked.surface.frame;
    return frame.width > 0 && frame.height > 0;
  }

  private onReady(tracked: TrackedWindow, attempt: number): void {
    if (!this.windows.has(tracked.id)) return;
    tracked.refresh();
    // Not mapped yet: reschedule rather than classify a half-built window.
    if (!this.isMapped(tracked) && attempt < 100) {
      this.deferReady(tracked, attempt + 1);
      return;
    }
    tracked.ready = true;
    // §9.3 / §19.1: an app the user opted to keep floating stays floating.
    if (this.deps.floats.has(tracked.surface.appId)) {
      tracked.surface.setFloating(true);
      this.deps.host.applyLayer(tracked.id, Layer.FLOATING, 0);
      tracked.invalidateClassification();
      return;
    }
    const classification = this.classify(tracked);
    if (!classification.tileable) {
      if (classification.modal) this.recenterModal(tracked);
      return;
    }

    const workspaceId = tracked.surface.workspaceId;
    const siblings = this.tileables(workspaceId).filter((t) => t.id !== tracked.id);
    // A workspace holds at most one pair. A third tileable always gets its own
    // workspace, however it opened — including an app that opens maximized.
    if (siblings.length >= 2) {
      this.moveToNewWorkspace(tracked, false);
      return;
    }
    if (compat.isFullyMaximized(tracked.win) && siblings.length > 0) {
      // An app that opens maximized (Nautilus, Files, …) is tiled with the
      // siblings instead of being exiled. A user-initiated maximize still gets
      // its own workspace via `onMaximizeSignal`.
      this.deps.tiling.noteSelfApply();
      this.deps.host.unmaximize(tracked.id);
      tracked.surface.refresh();
      this.evaluateLoneMaximize(workspaceId);
      this.scheduleReconcile('register-unmaximize');
      return;
    }
    if (!compat.isMaximized(tracked.win) && siblings.length >= 2) {
      this.moveToNewWorkspace(tracked, false);
      return;
    }
    this.evaluateLoneMaximize(workspaceId);
    this.scheduleRetile(workspaceId, 'register');
  }

  unregister(id: number): void {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return;
    const workspaceId = tracked.surface.workspaceId;
    const closedRect: Rect = { ...tracked.surface.frame };
    // Only windows we actually tiled get a close ghost; popups, menus,
    // tooltips and other transient surfaces must not flash a border.
    const wasTiled = tracked.lastTarget !== null;
    this.disconnectWindow(id);
    this.windows.delete(id);
    this.deps.host.forgetSurface(id);
    if (wasTiled) this.deps.onClosed(id, closedRect);
    this.signatures.clear(`ws:${workspaceId}`);
    this.deps.history.log('close', { id, workspaceId });
    this.deps.onStateChanged();

    this.switchAwayIfEmpty(workspaceId);
    this.evaluateLoneMaximize(workspaceId);
    this.scheduleRetile(workspaceId, 'close');
  }

  /** Re-classify and retile after a settings change. */
  invalidateAll(): void {
    for (const tracked of this.windows.values()) tracked.invalidateClassification();
    this.signatures.clearAll();
    this.retileAll('settings');
  }

  /**
   * Every lifecycle, frame, workspace and screen event funnels through here:
   * a debounced pass that re-checks *all* windows on *all* workspaces and
   * screens against their plans and corrects any that drifted.
   */
  scheduleRetile(_workspaceId: number, reason: string): void {
    this.scheduleReconcile(reason);
  }

  scheduleReconcile(reason: string): void {
    if (this.deps.isPaused() || this.suspended) return;
    if (this.dragging || this.adjustId !== null) return;
    if (this.reconcileSource !== null) return;
    // Only a genuine user adjust is undoable; a signal-driven reconcile is a
    // safety net and must not push an entry that masks the user's own action.
    const rememberUndo = reason === 'user-adjust';
    this.reconcileSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RECONCILE_DEBOUNCE_MS, () => {
      this.reconcileSource = null;
      this.reconcileAll(reason, rememberUndo);
      return GLib.SOURCE_REMOVE;
    });
  }

  /** Check every workspace on every screen and correct anything out of place.
   * Full reconciles are safety nets: by default they do not record undo
   * entries, so they can never mask the entry a user action pushed. */
  reconcileAll(reason: string, rememberUndo = false): void {
    if (this.deps.isPaused() || this.suspended || this.dragging || this.adjustId !== null) return;
    const count = global.workspace_manager.get_n_workspaces();
    const seen = new Set<number>();
    for (let index = 0; index < count; index++) {
      seen.add(index);
      this.retile(index, reason, true, rememberUndo);
    }
    // A window can briefly report a workspace beyond the current count.
    for (const tracked of this.windows.values()) {
      if (!seen.has(tracked.surface.workspaceId)) this.retile(tracked.surface.workspaceId, reason, true, rememberUndo);
    }
    this.deps.onStateChanged();
  }

  retileAll(reason: string, rememberUndo = false): void {
    this.reconcileAll(reason, rememberUndo);
  }

  /** §7.6: the user reordered workspaces; every index moved. */
  private onWorkspacesReordered(): void {
    this.realignWorkspaces();
    this.signatures.clearAll();
    if (this.deps.settings.boolean('log-workspace-reorder', false)) {
      this.deps.history.log('ws_removed', { reason: 'reorder' });
    }
    this.retileAll('workspace-reorder');
  }

  /** Re-derive every tracked window's workspace index from Mutter. */
  private realignWorkspaces(): void {
    for (const tracked of this.windows.values()) {
      const workspace = tracked.win.get_workspace();
      if (workspace === null) continue;
      tracked.surface.workspaceId = workspace.index();
      tracked.lastWorkspaceIdx = workspace.index();
    }
  }

  /** Compute and apply the plan for every monitor of one workspace (§6). */
  retile(workspaceId: number, reason: string, animate = true, rememberUndo = true): void {
    if (this.deps.isPaused() || this.suspended) return;
    // §11.3: no reflow while the user is dragging.
    if (this.dragging) return;
    // §7.2: a window maximized on its own was left maximized when a sibling
    // arrived; unmaximize it and tile the pair.
    if (this.unmaximizeStaleLone(workspaceId)) {
      this.scheduleRetile(workspaceId, 'lone-unmaximize');
      return;
    }
    // §7.2 takes precedence over §6: a lone window stays maximized, not tiled.
    if (this.shouldLoneMaximize(workspaceId)) {
      const only = this.tileables(workspaceId)[0];
      if (only !== undefined && !compat.isMaximized(only.win)) this.deps.host.maximize(only.id);
      return;
    }
    for (const screen of this.deps.host.screens()) {
      const tileables = this.tileables(workspaceId).filter((t) => t.surface.screenId === screen.index);
      if (tileables.length === 0) continue;
      // A maximized tileable is mid-policy: it either lives on its own
      // workspace or is about to move there. Tiling it now would unmaximize it
      // behind the policy's back (§7.3), so leave it to the policy.
      if (tileables.some((t) => compat.isMaximized(t.win))) continue;
      const startedUs = GLib.get_monotonic_time();
      const plan = computePlans(tileables.map((t) => this.toTilerWindow(t)), screen, this.tilerConfig());
      const violations = checkPlan(plan, screen.workArea ?? screen.geometry);
      if (violations.length > 0) {
        this.deps.history.log('error', { reason, workspaceId, violations });
      }
      if (Date.now() < this.ignoreMismatchUntilMs) continue;
    const key = `ws:${workspaceId}:${screen.index}`;
      const mismatch = this.planMismatch(plan);
      const changed = this.signatures.changed(key, planSignature(plan.placements));
      if (!mismatch && !changed) continue;
      this.deps.history.log('tile', {
        reason,
        workspaceId,
        screen: screen.index,
        tileables: tileables.length,
        placements: plan.placements.length,
      });
      this.deps.tiling.applyPlan(plan, screen, reason, animate, rememberUndo);
      // §36.14: one retile must complete well under 10ms.
      this.lastApplyMs = (GLib.get_monotonic_time() - startedUs) / 1000;
      this.lastApplyAtMs = Date.now();
      if (this.lastApplyMs > 5 && this.deps.settings.boolean('debug-enabled', false)) {
        this.deps.history.log('perf', { workspaceId, screen: screen.index, apply_ms: this.lastApplyMs });
      }
    }
    this.deps.onStateChanged();
  }

  /**
   * The plan is stale when a window no longer sits where the plan puts it,
   * even if the plan's signature is unchanged. Without this, a window moved by
   * the user (or anything outside our drag handling) is never put back.
   */
  private planMismatch(plan: TilePlan): boolean {
    // An explicit Undo restores rects that deliberately are not the plan.
    if (Date.now() < this.ignoreMismatchUntilMs) return false;
    // Our own applies are still landing: give them a moment.
    if (this.deps.tiling.activeAnimations > 0) return false;
    if (Date.now() - this.deps.tiling.lastApplyAtMs < 500) return false;
    for (const placement of plan.placements) {
      const tracked = this.windows.get(placement.surfaceId);
      if (tracked === undefined) return true;
      // A window that demonstrably refuses geometry is not "stale".
      if (tracked.stubborn) continue;
      tracked.surface.refreshFrame();
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

  tileables(workspaceId: number): TrackedWindow[] {
    const out: TrackedWindow[] = [];
    for (const tracked of this.windows.values()) {
      if (tracked.surface.workspaceId !== workspaceId) continue;
      if (tracked.surface.flags.minimized) continue;
      if (this.classify(tracked).tileable) out.push(tracked);
    }
    return out.sort((a, b) => a.id - b.id);
  }

  nonTransient(workspaceId: number): TrackedWindow[] {
    return this.tileables(workspaceId).filter((t) => !t.surface.flags.transient);
  }

  private shouldLoneMaximize(workspaceId: number): boolean {
    return this.nonTransient(workspaceId).length === 1 && this.tileables(workspaceId).length === 1;
  }

  /**
   * §7.2: with two or more tileable windows on a workspace, a maximized one
   * must be unmaximized so the pair can tile. This covers apps that open
   * maximized (Files) and windows left maximized side by side.
   */
  private unmaximizeStaleLone(workspaceId: number): boolean {
    const tileables = this.tileables(workspaceId);
    if (tileables.length < 2) return false;
    const maximized = tileables.filter((t) => compat.isMaximized(t.win));
    if (maximized.length === 0) return false;
    this.deps.tiling.noteSelfApply();
    for (const tracked of maximized) this.deps.host.unmaximize(tracked.id);
    this.deps.history.log('tile', { reason: 'lone-unmaximize', workspaceId, count: maximized.length });
    return true;
  }

  focus(id: number | null): void {
    if (id === null) return;
    const tracked = this.windows.get(id);
    if (tracked === undefined) return;
    tracked.win.activate(global.get_current_time());
  }

  focused(): TrackedWindow | null {
    const win = global.display.get_focus_window();
    if (win === null) return null;
    return this.windows.get(win.get_id()) ?? null;
  }

  /** §14 focus cycle: next tileable on the same monitor/workspace, wrapping. */
  focusCycle(): void {
    const current = this.focused();
    if (current === null) return;
    const peers = this.tileables(current.surface.workspaceId).filter((t) => t.surface.screenId === current.surface.screenId);
    if (peers.length < 2) return;
    const index = peers.findIndex((t) => t.id === current.id);
    this.focus(peers[(index + 1) % peers.length].id);
  }

  /** §13: keyboard move toward the sibling toggles the swap flag. */
  moveToward(direction: string): void {
    const current = this.focused();
    if (current === null) return;
    const peers = this.tileables(current.surface.workspaceId).filter((t) => t.surface.screenId === current.surface.screenId);
    if (peers.length === 2) {
      const sibling = peers.find((t) => t.id !== current.id);
      if (sibling === undefined) return;
      const horizontal = direction === 'left' || direction === 'right';
      const screen = this.screenFor(current.surface.screenId);
      const splitHorizontal = screen === null || screen.geometry.width >= screen.geometry.height;
      if (horizontal === splitHorizontal) {
        this.deps.tiling.toggleSwap(current.id, sibling.id);
        this.signatures.clearAll();
        this.deps.history.log('swap', { a: current.id, b: sibling.id });
        this.retile(current.surface.workspaceId, 'swap');
        return;
      }
    }
    this.moveToAdjacentMonitor(current, direction);
  }

  toggleFloat(id: number): boolean {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return false;
    const floating = !tracked.surface.flags.floating;
    tracked.surface.setFloating(floating);
    this.deps.host.applyLayer(id, floating ? Layer.FLOATING : Layer.TILED, 0);
    this.deps.floats.set(tracked.surface.appId, floating);
    tracked.invalidateClassification();
    this.deps.history.log('float_toggle', { id, floating });
    this.signatures.clearAll();
    this.scheduleRetile(tracked.surface.workspaceId, 'float');
    return floating;
  }

  /** §15 Undo: restore the last snapshot, activating its workspace first. */
  undo(): boolean {
    const entry = this.deps.undo.pop();
    if (entry === null) return false;
    // §15: restore the split ratios too, so the plan and the restored rects
    // agree and no later reconcile re-tiles over the undo.
    if (entry.ratios !== undefined) this.deps.tiling.restoreRatios(entry.ratios);
    if (this.deps.host.activeWorkspaceId() !== entry.workspaceId) {
      this.activateWorkspace(entry.workspaceId);
    }
    for (const item of entry.rects) {
      const tracked = this.windows.get(item.id);
      if (tracked === undefined) continue;
      tracked.surface.refreshFrame();
      this.deps.tiling.applyFrame(tracked, item.rect, this.screenFor(tracked.surface.screenId) ?? fallbackScreen(), false, 'undo', 0);
    }
    this.deps.history.log('undo', { workspaceId: entry.workspaceId, windows: entry.rects.length });
    // Do not immediately re-tile over the restored rects.
    this.ignoreMismatchUntilMs = Date.now() + 4000;
    return true;
  }

  activateWorkspace(index: number): void {
    const workspace = global.workspace_manager.get_workspace_by_index(index);
    if (workspace !== null) workspace.activate(global.get_current_time());
  }

  countWorkspaces(): number {
    return global.workspace_manager.get_n_workspaces();
  }

  clearSignatures(): void {
    this.signatures.clearAll();
  }

  destroy(): void {
    for (const id of this.signals.keys()) this.disconnectWindow(id);
    this.signals.clear();
    this.stopScan();
    if (this.reconcileSource !== null) {
      GLib.source_remove(this.reconcileSource);
      this.reconcileSource = null;
    }
    for (const id of this.timeoutSources) GLib.source_remove(id);
    this.timeoutSources.clear();
    if (this.adjustSource !== null) {
      GLib.source_remove(this.adjustSource);
      this.adjustSource = null;
    }
    this.windows.clear();
  }

  private addTimeout(ms: number, cb: () => void): void {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, ms), () => {
      this.timeoutSources.delete(id);
      cb();
      return GLib.SOURCE_REMOVE;
    });
    this.timeoutSources.add(id);
  }

  classify(tracked: TrackedWindow): ReturnType<TrackedWindow['classify']> {
    return tracked.classify(this.deps.settings.classifierConfig(), this.heuristicContext(tracked.id));
  }

  private heuristicContext(excludeId: number): HeuristicContext {
    const liveTitles: string[] = [];
    for (const tracked of this.windows.values()) {
      if (tracked.id !== excludeId) liveTitles.push(tracked.surface.title);
    }
    return { liveTitles };
  }

  private tilerConfig(): TilerConfig {
    return this.deps.settings.tilerConfig(this.deps.tiling.getRatios(), new Set(this.deps.tiling.getSwapPairs()));
  }

  private toTilerWindow(tracked: TrackedWindow): TilerWindow {
    const surface = tracked.surface;
    const effectiveMin = this.deps.adaptation.effectiveMin(surface.appId);
    // §24 item 2: min/max come from the per-window cache, never a Mutter query.
    return {
      id: tracked.id,
      appId: surface.appId,
      title: surface.title,
      kind: surface.kind,
      rect: surface.frame,
      min: effectiveMin ?? tracked.minSize,
      max: tracked.maxSize,
      screenId: surface.screenId,
      workspaceId: surface.workspaceId,
    };
  }

  private screenFor(index: number): Screen | null {
    for (const screen of this.deps.host.screens()) {
      if (screen.index === index) return screen;
    }
    return null;
  }

  /** §7.2 lone-maximize policy. */
  private evaluateLoneMaximize(workspaceId: number): void {
    const nonTransient = this.nonTransient(workspaceId);
    const tileables = this.tileables(workspaceId);
    if (nonTransient.length === 1 && tileables.length === 1) {
      const only = tileables[0];
      if (!compat.isMaximized(only.win)) {
        this.deps.tiling.noteSelfApply();
        this.deps.host.maximize(only.id);
        this.deps.history.log('tile', { id: only.id, reason: 'lone-maximize' });
      }
      return;
    }
    if (nonTransient.length > 1 && tileables.length === 1 && compat.isMaximized(tileables[0].win)) {
      this.deps.tiling.noteSelfApply();
      this.deps.host.unmaximize(tileables[0].id);
      this.scheduleRetile(workspaceId, 'lone-unmaximize');
    }
  }

  /**
   * §7.1 / §7.3: move a window to a new workspace placed **immediately to the
   * right** of its current one, then follow it there.
   */
  private moveToNewWorkspace(tracked: TrackedWindow, rememberPrevious: boolean): void {
    if (this.userMoveProtected(tracked)) return;
    const manager = global.workspace_manager;
    const previous = tracked.surface.workspaceId;
    const target = previous + 1;

    let index: number;
    const existing = target < manager.get_n_workspaces() ? manager.get_workspace_by_index(target) : null;
    if (existing !== null && this.workspaceIsEmpty(existing)) {
      // An empty workspace already sits to the right: use it (no reorder, which
      // would disturb window state).
      index = target;
    } else {
      const appended = manager.get_n_workspaces();
      manager.append_new_workspace(false, global.get_current_time());
      const created = manager.get_workspace_by_index(appended);
      if (created !== null && target < appended) manager.reorder_workspace(created, target);
      index = Math.min(target, manager.get_n_workspaces() - 1);
    }

    this.dynamicWorkspaces.add(index);
    this.maybeNameWorkspace(index);
    this.suppress.add(tracked.id);
    this.deps.tiling.noteSelfApply();
    // Hide the highlight straight away: the window is about to leave this
    // workspace, and our own move would otherwise be ignored by the position
    // watcher, leaving the border drawn at the old spot for a frame or two.
    this.deps.onWindowMoving();
    this.deps.host.applyWorkspace(tracked.id, index);
    this.suppress.delete(tracked.id);
    tracked.surface.workspaceId = index;
    tracked.lastWorkspaceIdx = index;
    if (rememberPrevious) tracked.previousWorkspaceIdx = previous;
    this.deps.history.log('spawn_ws', { id: tracked.id, workspaceId: index, previous });
    // Follow the window to the workspace it was just given. (Delaying this so
    // the window lands first was tried, but Mutter drops the maximise while the
    // window sits on a workspace the view has not reached, so the follow is
    // immediate; the border is hidden by `onWindowMoving` instead.)
    this.activateWorkspace(index);
    this.signatures.clearAll();
  }

  private workspaceIsEmpty(workspace: any): boolean {
    return workspace.list_windows().filter((win: any) => this.windows.has(win.get_id())).length === 0;
  }


  /** §7.6 `workspace-auto-name`: name a spawned workspace. */
  private maybeNameWorkspace(index: number): void {
    if (!this.deps.settings.boolean('workspace-auto-name', false)) return;
    try {
      const preferences = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
      const names: string[] = preferences.get_strv('workspace-names');
      while (names.length <= index) names.push('');
      names[index] = `Adrt ${index + 1}`;
      preferences.set_strv('workspace-names', names);
    } catch (e) {
      console.error(`[adrt] could not name workspace: ${(e as Error).message}`);
    }
  }

  /** §19.1: the user moved this window; leave it where they put it. */
  private userMoveProtected(tracked: TrackedWindow): boolean {
    if (!this.deps.settings.boolean('respect-user-workspace-move', true)) return false;
    const graceSec = Math.max(0, this.deps.settings.int('workspace-move-grace-seconds', 3));
    return Date.now() - tracked.userMovedAtMs < graceSec * 1000;
  }

  /** §7.3: user unmaximized a window that had been sent to its own workspace. */
  private returnFromMaximize(tracked: TrackedWindow): void {
    const manager = global.workspace_manager;
    let previous = tracked.previousWorkspaceIdx;
    // A stale index (workspaces were reaped since the maximize) must not strand
    // the window: fall back to the nearest workspace that still holds windows.
    if (previous !== null && (previous < 0 || previous >= manager.get_n_workspaces() || previous === tracked.surface.workspaceId)) {
      const here = tracked.surface.workspaceId;
      let target = this.nearestWorkspaceWithWindows(here, -1);
      if (target < 0) target = this.nearestExistingWorkspace(here, -1);
      previous = target >= 0 ? target : null;
    }
    if (previous === null) {
      const tileables = this.tileables(tracked.surface.workspaceId);
      if (tileables.length <= 1 && !compat.isMaximized(tracked.win)) {
        this.deps.tiling.noteSelfApply();
        this.deps.host.maximize(tracked.id);
      }
      return;
    }
    this.suppress.add(tracked.id);
    this.deps.tiling.noteSelfApply();
    this.deps.onWindowMoving();
    this.deps.host.applyWorkspace(tracked.id, previous);
    this.suppress.delete(tracked.id);
    const current = tracked.surface.workspaceId;
    tracked.surface.workspaceId = previous;
    tracked.previousWorkspaceIdx = null;
    // The view follows the window back, exactly as it followed it right when
    // it was maximized.
    this.activateWorkspace(previous);
    // §7.3: a workspace that already holds a pair makes the newcomer float.
    // The incoming window is excluded: only two *others* make it a pair.
    if (this.tileables(previous).filter((t) => t.id !== tracked.id).length >= 2) {
      tracked.surface.setFloating(true);
      this.deps.tiling.noteSelfApply();
      this.deps.host.applyLayer(tracked.id, Layer.FLOATING, 0);
      // Keep it on top but do not hide the pair behind it: centre it with a
      // margin so the tiled windows stay visible.
      const screen = this.screenFor(tracked.surface.screenId);
      if (screen !== null) {
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
    }
    this.deps.history.log('ws_removed', { id: tracked.id, from: current, to: previous, reason: 'unmaximize' });
    this.signatures.clearAll();
    this.schedulePrune();
    this.scheduleRetile(previous, 'unmaximize-return');
  }

  /** §7.4 minimize follows to the previous workspace. */
  private onMinimized(tracked: TrackedWindow): void {
    if (!tracked.surface.flags.minimized) {
      this.scheduleRetile(tracked.surface.workspaceId, 'unminimize');
      return;
    }
    if (this.userMoveProtected(tracked)) return;
    const workspaceId = tracked.surface.workspaceId;
    const tileables = this.tileables(workspaceId);
    if (tileables.length === 0 && workspaceId > 0) {
      this.suppress.add(tracked.id);
      this.deps.tiling.noteSelfApply();
      this.deps.host.applyWorkspace(tracked.id, workspaceId - 1);
      this.suppress.delete(tracked.id);
      tracked.surface.workspaceId = workspaceId - 1;
      this.deps.history.log('new_ws', { id: tracked.id, workspaceId: workspaceId - 1, reason: 'minimize' });
      // Follow the window. The empty workspace it left is pruned safely later.
      this.activateWorkspace(workspaceId - 1);
      this.schedulePrune();
    }
    this.scheduleRetile(workspaceId, 'minimize');
  }

  /**
   * §16: reap the workspaces Adrt itself created (third-window and
   * maximize-right policies) once they are empty and the user is not on them,
   * keeping at least one workspace. Workspaces the user or the session created
   * are left alone, and a workspace holding any window at all is kept — reaping
   * a workspace out from under a window is what made one "disappear".
   */
  private pruneEmptyWorkspaces(): void {
    const manager = global.workspace_manager;
    if (manager.get_n_workspaces() <= 1) return;
    let active = manager.get_active_workspace_index();
    let changed = false;
    const candidates = [...this.dynamicWorkspaces].sort((a, b) => b - a);
    for (const index of candidates) {
      if (manager.get_n_workspaces() <= 1) break;
      if (index >= manager.get_n_workspaces()) {
        this.dynamicWorkspaces.delete(index);
        continue;
      }
      if (index === active) continue;
      const workspace = manager.get_workspace_by_index(index);
      if (workspace === null) {
        this.dynamicWorkspaces.delete(index);
        continue;
      }
      // Keep it if it holds any window, tracked or not.
      if (workspace.list_windows().length > 0) continue;

      this.dynamicWorkspaces.delete(index);
      const shifted = new Set<number>();
      for (const i of this.dynamicWorkspaces) shifted.add(i > index ? i - 1 : i);
      this.dynamicWorkspaces.clear();
      for (const i of shifted) this.dynamicWorkspaces.add(i);
      manager.remove_workspace(workspace, global.get_current_time());
      if (index < active) active -= 1;
      changed = true;
      this.deps.history.log('ws_removed', { workspaceId: index, reason: 'pruned' });
    }
    if (changed) {
      this.realignWorkspaces();
      this.signatures.clearAll();
    }
  }

  /** Reap empty workspaces shortly after an action, once state has settled. */
  private schedulePrune(): void {
    this.addTimeout(300, () => this.pruneEmptyWorkspaces());
  }

  /** §7.5 close: leave an empty workspace, then reap it (§16). */
  private switchAwayIfEmpty(workspaceId: number): void {
    const manager = global.workspace_manager;
    if (manager.get_n_workspaces() <= 1) return;
    const workspace = manager.get_workspace_by_index(workspaceId);
    if (workspace === null) return;
    const remaining = workspace.list_windows().filter((win: any) => this.windows.has(win.get_id()));
    if (remaining.length > 0) return;

    if (manager.get_active_workspace_index() === workspaceId) {
      // "Done" takes you back to the left — the nearest left workspace that
      // still exists and holds windows. If the left one was removed (or is
      // empty), fall forward to the right instead.
      let target = this.nearestWorkspaceWithWindows(workspaceId, -1);
      if (target < 0) target = this.nearestWorkspaceWithWindows(workspaceId, 1);
      if (target < 0) target = this.nearestExistingWorkspace(workspaceId, -1);
      if (target < 0) target = this.nearestExistingWorkspace(workspaceId, 1);
      if (target >= 0 && target !== workspaceId) {
        this.deps.history.log('ws_switch_empty', { from: workspaceId, to: target });
        this.activateWorkspace(target);
      }
    }
    this.schedulePrune();
    // The workspace switch is asynchronous; by the time the first prune runs
    // the emptied workspace can still be the active one, so it is skipped.
    // Prune again once the switch has certainly landed.
    this.addTimeout(900, () => this.pruneEmptyWorkspaces());
  }

  /** §16: reap empty workspaces now. Used by the periodic safety pass so a
   * workspace that was just emptied does not linger until the scan backs off. */
  pruneEmptyNow(): void {
    this.pruneEmptyWorkspaces();
  }

  /** Nearest workspace in `step` direction that holds one of our windows. */
  private nearestWorkspaceWithWindows(from: number, step: number): number {
    const manager = global.workspace_manager;
    for (let index = from + step; index >= 0 && index < manager.get_n_workspaces(); index += step) {
      const workspace = manager.get_workspace_by_index(index);
      if (workspace === null) continue;
      if (workspace.list_windows().some((win: any) => this.windows.has(win.get_id()))) return index;
    }
    return -1;
  }

  /** Nearest workspace in `step` direction that exists at all. */
  private nearestExistingWorkspace(from: number, step: number): number {
    const manager = global.workspace_manager;
    for (let index = from + step; index >= 0 && index < manager.get_n_workspaces(); index += step) {
      if (manager.get_workspace_by_index(index) !== null) return index;
    }
    return -1;
  }

  /** §14 move to an adjacent monitor when there is no sibling in that direction. */
  private moveToAdjacentMonitor(tracked: TrackedWindow, direction: string): void {
    const screens = this.deps.host.screens();
    if (screens.length < 2) return;
    const current = screens.findIndex((s) => s.index === tracked.surface.screenId);
    if (current < 0) return;
    const adjacent = direction === 'left' || direction === 'up' ? current - 1 : current + 1;
    if (adjacent < 0 || adjacent >= screens.length) return;
    tracked.win.move_to_monitor(screens[adjacent].index);
    tracked.userMovedAtMs = Date.now();
    this.signatures.clearAll();
    this.scheduleRetile(tracked.surface.workspaceId, 'move-monitor');
  }

  private recenterModal(tracked: TrackedWindow): void {
    const parentId = tracked.surface.parentId;
    if (parentId === null) return;
    const parent = this.windows.get(parentId);
    if (parent === undefined) return;
    const parentRect = parent.surface.frame;
    const rect: Rect = {
      x: Math.round(parentRect.x + (parentRect.width - tracked.surface.frame.width) / 2),
      y: Math.round(parentRect.y + (parentRect.height - tracked.surface.frame.height) / 2),
      width: tracked.surface.frame.width,
      height: tracked.surface.frame.height,
    };
    this.deps.tiling.applyFrame(tracked, rect, this.screenFor(tracked.surface.screenId) ?? fallbackScreen(), false, 'modal-center', 0);
  }

  private connectWindow(tracked: TrackedWindow): void {
    const win = tracked.win;
    const handlers: WindowSignal[] = [];
    const on = (signal: string, cb: (...args: any[]) => void) => {
      handlers.push({ id: win.connect(signal, cb) });
    };

    on('notify::title', () => this.onFlagSignal(tracked, true));
    on('notify::wm-class', () => this.onFlagSignal(tracked, true));
    on('notify::skip-taskbar', () => this.onFlagSignal(tracked, true));
    on('notify::transient-for', () => this.onFlagSignal(tracked, true));
    on('notify::above', () => this.onFlagSignal(tracked, true));
    on('notify::fullscreen', () => this.onFlagSignal(tracked, true));
    on('notify::window-type', () => this.onFlagSignal(tracked, true));
    on('notify::minimized', () => {
      tracked.surface.refresh();
      this.onMinimized(tracked);
    });
    on('notify::mapped', () => this.onFlagSignal(tracked, true));
    on('notify::maximized-vertically', () => this.onMaximizeSignal(tracked));
    on('notify::maximized-horizontally', () => this.onMaximizeSignal(tracked));
    on('position-changed', () => this.onFrameSignal(tracked));
    on('size-changed', () => this.onFrameSignal(tracked));
    on('workspace-changed', () => this.onWorkspaceSignal(tracked));
    on('unmanaged', () => this.unregister(tracked.id));
    this.signals.set(tracked.id, handlers);
  }

  private disconnectWindow(id: number): void {
    const handlers = this.signals.get(id);
    if (handlers === undefined) return;
    const tracked = this.windows.get(id);
    if (tracked !== undefined) {
      for (const handler of handlers) tracked.win.disconnect(handler.id);
    }
    this.signals.delete(id);
  }

  private onFlagSignal(tracked: TrackedWindow, classification: boolean): void {
    tracked.surface.refresh();
    if (classification) tracked.invalidateClassification();
    this.signatures.clear(`ws:${tracked.surface.workspaceId}`);
    this.scheduleRetile(tracked.surface.workspaceId, 'flags');
  }

  private onFrameSignal(tracked: TrackedWindow): void {
    tracked.surface.refreshFrame();

    // A server-side grab is in flight (Super+drag): follow, do not reflow.
    if (this.dragging) {
      this.deps.onStateChanged();
      return;
    }
    // A change we caused ourselves while following the user's resize.
    if (this.adjustId !== null && this.adjustId !== tracked.id) {
      this.deps.onStateChanged();
      return;
    }
    // The user is adjusting this window. Client-side/CSD resizes never emit a
    // grab op, so this is the only signal we get.
    if (this.adjustId === tracked.id) {
      if (this.adjustMode(tracked) === 'resize') this.followSibling(tracked);
      this.armAdjustEnd(tracked);
      this.deps.onStateChanged();
      return;
    }

    // Size hints usually arrive just after the first frame. Until they do, the
    // window reports max 0 and a plan built against it will be refused. This is
    // the only path that re-queries Mutter for hints (§24 item 2).
    if (!tracked.sizeHintsKnown) {
      if (tracked.refreshSizeHints()) {
        tracked.invalidateClassification();
        this.signatures.clear(`ws:${tracked.surface.workspaceId}`);
        this.scheduleRetile(tracked.surface.workspaceId, 'size-hints');
      }
    }

    if (this.isUserChange(tracked)) {
      this.beginUserAdjust(tracked);
      if (this.adjustMode(tracked) === 'resize') this.followSibling(tracked);
      this.armAdjustEnd(tracked);
      this.deps.onStateChanged();
      return;
    }

    this.deps.onStateChanged();
    this.scheduleRetile(tracked.surface.workspaceId, 'frame');
  }

  /** A geometry change that did not come from us is the user moving a window. */
  private isUserChange(tracked: TrackedWindow): boolean {
    const target = tracked.lastTarget;
    if (target === null) return false;
    // State changes (maximize, fullscreen, minimize) move the frame away from
    // the tile plan but are not the user dragging; they have their own signals.
    if (compat.isMaximized(tracked.win)) return false;
    if (tracked.surface.flags.fullscreen || tracked.surface.flags.minimized) return false;
    // A user move/resize holds the button; our own applies do not.
    if (!compat.button1Pressed()) return false;
    // Our own applies set `lastTarget`, so a frame that differs from it and is
    // not an animation or a stubborn refusal is the user moving the window.
    if (this.deps.tiling.activeAnimations > 0) return false;
    if (Date.now() - this.deps.tiling.lastApplyAtMs < 200) return false;
    const frame = tracked.surface.frame;
    return (
      Math.abs(frame.x - target.x) > 3 ||
      Math.abs(frame.y - target.y) > 3 ||
      Math.abs(frame.width - target.width) > 3 ||
      Math.abs(frame.height - target.height) > 3
    );
  }

  private beginUserAdjust(tracked: TrackedWindow): void {
    this.adjustId = tracked.id;
    // Anchor to the last geometry we planned: `surface.frame` is already the
    // user's new rect by the time this signal arrives.
    this.dragStartRect = { ...(tracked.lastTarget ?? tracked.surface.frame) };
    this.deps.onDragChanged(true);
  }

  private armAdjustEnd(tracked: TrackedWindow): void {
    if (this.adjustSource !== null) {
      GLib.source_remove(this.adjustSource);
      this.adjustSource = null;
    }
    this.adjustSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ADJUST_SETTLE_MS, () => {
      this.adjustSource = null;
      this.endUserAdjust(tracked);
      return GLib.SOURCE_REMOVE;
    });
  }

  private endUserAdjust(tracked: TrackedWindow): void {
    if (this.adjustId !== tracked.id) return;
    const mode = this.adjustMode(tracked);
    this.adjustId = null;
    this.deps.onDragChanged(false);
    this.interpretDrop(tracked, mode);
    this.dragStartRect = null;
    this.signatures.clearAll();
    this.scheduleRetile(tracked.surface.workspaceId, 'user-adjust');
  }

  private adjustMode(tracked: TrackedWindow): 'move' | 'resize' {
    const start = this.dragStartRect;
    if (start === null) return 'move';
    const rect = tracked.surface.frame;
    return Math.abs(rect.width - start.width) > 8 || Math.abs(rect.height - start.height) > 8 ? 'resize' : 'move';
  }

  /** Keep the sibling in step with the user's live resize. */
  private followSibling(tracked: TrackedWindow): void {
    const sibling = this.pairSibling(tracked);
    const screen = this.screenFor(tracked.surface.screenId);
    if (sibling === null || screen === null) return;
    const area = screenArea(screen);
    const horizontal = area.width >= area.height;
    const gap = this.effectiveGap(area);
    // Stay inside the tiled (inset) area so gaps are preserved.
    const inset: Rect = {
      x: area.x + gap,
      y: area.y + gap,
      width: Math.max(0, area.width - 2 * gap),
      height: Math.max(0, area.height - 2 * gap),
    };
    const a = tracked.surface.frame;
    const b = sibling.surface.frame;
    let rect: Rect;
    if (horizontal) {
      if (a.x <= b.x) {
        const x = a.x + a.width + gap;
        rect = { x, y: inset.y, width: Math.max(0, inset.x + inset.width - x), height: inset.height };
      } else {
        rect = { x: inset.x, y: inset.y, width: Math.max(0, a.x - gap - inset.x), height: inset.height };
      }
    } else if (a.y <= b.y) {
      const y = a.y + a.height + gap;
      rect = { x: inset.x, y, width: inset.width, height: Math.max(0, inset.y + inset.height - y) };
    } else {
      rect = { x: inset.x, y: inset.y, width: inset.width, height: Math.max(0, a.y - gap - inset.y) };
    }
    if (rect.width <= 0 || rect.height <= 0) return;
    // Skip redundant applies when the sibling is already where it should be.
    sibling.surface.refreshFrame();
    const current = sibling.surface.frame;
    if (
      Math.abs(current.x - rect.x) <= 2 &&
      Math.abs(current.y - rect.y) <= 2 &&
      Math.abs(current.width - rect.width) <= 2 &&
      Math.abs(current.height - rect.height) <= 2
    ) {
      return;
    }
    this.deps.tiling.applyFrame(sibling, rect, screen, false, 'follow', 0);
  }

  private effectiveGap(area: Rect): number {
    const base = this.deps.settings.int('gaps-base', 8);
    const override = area.height > area.width
      ? this.deps.settings.int('gaps-portrait', -1)
      : this.deps.settings.int('gaps-landscape', -1);
    return override >= 0 ? override : base;
  }

  private interpretDrop(tracked: TrackedWindow, mode: 'move' | 'resize'): void {
    const sibling = this.pairSibling(tracked);
    const screen = this.screenFor(tracked.surface.screenId);
    if (sibling === null || screen === null) return;
    if (mode === 'move') this.applySwapIntent(tracked, sibling);
    else this.applyResizeIntent(tracked, sibling, screen);
  }

  private onMaximizeSignal(tracked: TrackedWindow): void {
    if (!tracked.ready) return;
    if (this.suppress.has(tracked.id)) return;
    tracked.surface.refresh();
    const maximized = compat.isMaximized(tracked.win);
    if (maximized) {
      const siblings = this.tileables(tracked.surface.workspaceId).filter((t) => t.id !== tracked.id);
      if (siblings.length > 0) this.moveToNewWorkspace(tracked, true);
      else this.signatures.clearAll();
      return;
    }
    if (tracked.previousWorkspaceIdx !== null) {
      this.returnFromMaximize(tracked);
      return;
    }
    // Not sent right by the maximize policy (e.g. a lone window that was
    // maximized on its own workspace). If the workspace to the *left* already
    // holds a pair, "finish" by returning there — floating on top, not tiled.
    const left = tracked.surface.workspaceId - 1;
    if (left >= 0 && this.tileables(left).length >= 2) {
      tracked.previousWorkspaceIdx = left;
      this.returnFromMaximize(tracked);
      return;
    }
    this.scheduleRetile(tracked.surface.workspaceId, 'unmaximize');
  }

  private onWorkspaceSignal(tracked: TrackedWindow): void {
    if (!tracked.ready) return;
    if (this.suppress.has(tracked.id)) return;
    const workspace = tracked.win.get_workspace();
    if (workspace === null) return;
    const index = workspace.index();
    if (index === tracked.surface.workspaceId) return;
    const from = tracked.surface.workspaceId;
    tracked.surface.workspaceId = index;
    tracked.lastWorkspaceIdx = index;
    // §19.1: remember the user's move so policies leave the window alone.
    tracked.userMovedAtMs = Date.now();
    this.deps.history.log('ws_switch_empty', { id: tracked.id, from, to: index, byUser: true });
    this.signatures.clearAll();
    this.scheduleRetile(from, 'workspace-changed');
    this.scheduleRetile(index, 'workspace-changed');
  }

  private scheduleScan(): void {
    this.scanSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.scanIntervalMs, () => {
      this.scanSource = null;
      if (this.deps.isPaused()) return GLib.SOURCE_REMOVE;
      this.scanTick();
      this.backoff();
      this.scheduleScan();
      return GLib.SOURCE_REMOVE;
    });
  }

  private backoff(): void {
    const before = this.windows.size;
    if (before === this.idleWindows) {
      this.idleScans += 1;
    } else {
      this.idleScans = 0;
      this.idleWindows = before;
    }
    const base = this.scanBaseMs();
    const steps = [base, base * 2, base * 6, base * 12];
    const target = steps[Math.min(this.idleScans, steps.length - 1)];
    if (target !== this.scanIntervalMs) this.scanIntervalMs = target;
  }

  private idleWindows = 0;

  /** Safety net (§35): reconcile state that signals may have missed. */
  scanTick(): void {
    const startedUs = GLib.get_monotonic_time();
    const live = new Set<number>();
    for (const win of global.display.list_all_windows()) {
      const id: number = win.get_id();
      live.add(id);
      if (!this.windows.has(id)) this.register(win);
    }
    for (const id of [...this.windows.keys()]) {
      if (!live.has(id)) this.unregister(id);
    }
    this.deps.adaptation.prune();
    this.deps.adaptation.save();
    this.pruneEmptyWorkspaces();
    this.retileAll('scan');
    this.lastReconcileMs = (GLib.get_monotonic_time() - startedUs) / 1000;
    this.scanPerfCounter += 1;
    // §21: one perf event every 60 scans, gated on debug-enabled.
    if (this.scanPerfCounter >= 60) {
      this.scanPerfCounter = 0;
      if (this.deps.settings.boolean('debug-enabled', false)) {
        this.deps.history.log('perf', {
          last_reconcile_ms: this.lastReconcileMs,
          last_apply_ms: this.lastApplyMs,
          windows: this.windows.size,
        });
      }
    }
  }

  /** §21: bounded state assertion. */
  memoryBounds(): { windows: number; sources: number; signals: number } {
    let signalCount = 0;
    for (const handlers of this.signals.values()) signalCount += handlers.length;
    return { windows: this.windows.size, sources: this.reconcileSource !== null ? 1 : 0, signals: signalCount };
  }

  /** §21: retile timings for the perf event. */
  perf(): { lastReconcileMs: number; lastApplyMs: number; lastApplyAtMs: number } {
    return { lastReconcileMs: this.lastReconcileMs, lastApplyMs: this.lastApplyMs, lastApplyAtMs: this.lastApplyAtMs };
  }

  layerOf(id: number): Layer | null {
    return this.windows.get(id)?.surface.layer ?? null;
  }

  pairKeyFor(a: number, b: number): string {
    return pairKey(a, b);
  }

  /** §14 focus by direction, closest by centre; falls back to the other axis side. */
  focusDirection(direction: string): void {
    const current = this.focused();
    if (current === null) return;
    if (this.focusClosest(current, direction)) return;
    // Nothing in that direction: try the opposite one, otherwise do nothing.
    const opposite = direction === 'left' ? 'right' : direction === 'right' ? 'left' : direction === 'up' ? 'down' : 'up';
    this.focusClosest(current, opposite);
  }

  /** Focus the closest tile in `direction`; returns whether one was found. */
  private focusClosest(current: TrackedWindow, direction: string): boolean {
    const peers = this.tileables(current.surface.workspaceId).filter((t) => t.id !== current.id);
    const originX = current.surface.frame.x + current.surface.frame.width / 2;
    const originY = current.surface.frame.y + current.surface.frame.height / 2;
    let best: TrackedWindow | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const peer of peers) {
      const cx = peer.surface.frame.x + peer.surface.frame.width / 2;
      const cy = peer.surface.frame.y + peer.surface.frame.height / 2;
      const inDirection =
        (direction === 'left' && cx < originX) ||
        (direction === 'right' && cx > originX) ||
        (direction === 'up' && cy < originY) ||
        (direction === 'down' && cy > originY);
      if (!inDirection) continue;
      const distance = Math.hypot(cx - originX, cy - originY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = peer;
      }
    }
    if (best === null) return false;
    this.focus(best.id);
    return true;
  }
}

function fallbackScreen(): Screen {
  return { index: 0, connector: '', geometry: { x: 0, y: 0, width: 1920, height: 1080 }, scale: 1, refreshRate: 60, isPrimary: true };
}
