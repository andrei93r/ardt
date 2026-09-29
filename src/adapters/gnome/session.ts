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
import { RetileScheduler, SignatureCache, planSignature } from '../../core/scheduler.js';
import type { TilerConfig, TilerWindow } from '../../core/tiler.js';
import { computePlans, pairKey } from '../../core/tiler.js';
import { Layer } from '../../core/types.js';
import type { Rect, Screen } from '../../core/types.js';
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
}

interface WindowSignal {
  id: number;
}

export class WindowSession {
  readonly windows = new Map<number, TrackedWindow>();
  private readonly signals = new Map<number, WindowSignal[]>();
  private readonly scheduler = new RetileScheduler();
  private readonly signatures = new SignatureCache();
  private readonly suppress = new Set<number>();
  private retileSource: number | null = null;
  private readonly timeoutSources = new Set<number>();
  /** Workspaces this extension created; empty ones are removed again (§16). */
  private readonly dynamicWorkspaces = new Set<number>();
  private reorderSignal = 0;
  private grabBeginSignal = 0;
  private grabEndSignal = 0;
  private dragging = false;
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
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  private onGrabBegin(win: any, op: number): void {
    if (!compat.isDragOp(op)) return;
    if (win === null) return;
    this.beginDrag(win.get_id());
  }

  private onGrabEnd(win: any, op: number): void {
    if (!compat.isDragOp(op)) return;
    if (win === null) return;
    this.endDrag(win.get_id());
  }

  /** §11.3: while a drag is in flight, freeze reflow and hide the border. */
  beginDrag(id: number): boolean {
    if (!this.windows.has(id)) return false;
    if (this.dragging) return true;
    this.dragging = true;
    this.deps.onDragChanged(true);
    return true;
  }

  /** Drag released: reflow the workspace into a valid plan. */
  endDrag(id: number): boolean {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return false;
    const wasDragging = this.dragging;
    this.dragging = false;
    this.deps.onDragChanged(false);
    if (wasDragging) {
      this.signatures.clearAll();
      this.scheduleRetile(tracked.surface.workspaceId, 'drag-end');
    }
    return true;
  }

  /** §18 invariant: paused means no retiles, no scan tick.**/
  setScanning(enabled: boolean): void {
    if (enabled) this.startScan();
    else this.stopScan();
  }

  register(win: any): void {
    const id: number = win.get_id();
    if (this.windows.has(id)) return;
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
    if (compat.isFullyMaximized(tracked.win) && siblings.length > 0) {
      this.moveToNewWorkspace(tracked, true);
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
    this.disconnectWindow(id);
    this.windows.delete(id);
    this.deps.host.forgetSurface(id);
    this.deps.onClosed(id, closedRect);
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

  scheduleRetile(workspaceId: number, reason: string): void {
    if (this.deps.isPaused()) return;
    // Never reflow under the user's finger; grab-op-end re-tiles instead.
    if (this.dragging) return;
    if (!this.scheduler.schedule(`ws:${workspaceId}`)) return;
    if (this.retileSource !== null) return;
    this.retileSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.retileSource = null;
      for (const key of this.scheduler.take()) {
        this.retile(Number(key.slice(3)), reason);
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  retileAll(reason: string): void {
    if (this.deps.isPaused()) return;
    const workspaces = new Set<number>();
    for (const tracked of this.windows.values()) workspaces.add(tracked.surface.workspaceId);
    workspaces.add(this.deps.host.activeWorkspaceId());
    for (const workspaceId of workspaces) this.retile(workspaceId, reason);
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
  retile(workspaceId: number, reason: string, animate = true): void {
    if (this.deps.isPaused()) return;
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
      const key = `ws:${workspaceId}:${screen.index}`;
      if (!this.signatures.changed(key, planSignature(plan.placements))) continue;
      this.deps.history.log('tile', {
        reason,
        workspaceId,
        screen: screen.index,
        tileables: tileables.length,
        placements: plan.placements.length,
      });
      this.deps.tiling.applyPlan(plan, screen, reason, animate);
      // §36.14: one retile must complete well under 10ms.
      this.lastApplyMs = (GLib.get_monotonic_time() - startedUs) / 1000;
      this.lastApplyAtMs = Date.now();
      if (this.lastApplyMs > 5 && this.deps.settings.boolean('debug-enabled', false)) {
        this.deps.history.log('perf', { workspaceId, screen: screen.index, apply_ms: this.lastApplyMs });
      }
    }
    this.deps.onStateChanged();
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
   * §7.2: when a second window joins a workspace whose window was maximized by
   * the lone-maximize policy (never moved to its own workspace), unmaximize it
   * so the pair can tile.
   */
  private unmaximizeStaleLone(workspaceId: number): boolean {
    const tileables = this.tileables(workspaceId);
    if (tileables.length < 2) return false;
    const stale = tileables.filter((t) => compat.isMaximized(t.win) && t.previousWorkspaceIdx === null);
    if (stale.length === 0) return false;
    for (const tracked of stale) this.deps.host.unmaximize(tracked.id);
    this.deps.history.log('tile', { reason: 'lone-unmaximize', workspaceId });
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
    if (this.retileSource !== null) {
      GLib.source_remove(this.retileSource);
      this.retileSource = null;
    }
    for (const id of this.timeoutSources) GLib.source_remove(id);
    this.timeoutSources.clear();
    this.scheduler.clearAll();
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
        this.deps.host.maximize(only.id);
        this.deps.history.log('tile', { id: only.id, reason: 'lone-maximize' });
      }
      return;
    }
    if (nonTransient.length > 1 && tileables.length === 1 && compat.isMaximized(tileables[0].win)) {
      this.deps.host.unmaximize(tileables[0].id);
      this.scheduleRetile(workspaceId, 'lone-unmaximize');
    }
  }

  /** §7.1 / §7.3: move a window to a brand-new workspace appended to the right. */
  private moveToNewWorkspace(tracked: TrackedWindow, rememberPrevious: boolean): void {
    if (this.userMoveProtected(tracked)) return;
    const manager = global.workspace_manager;
    const index = manager.get_n_workspaces();
    manager.append_new_workspace(false, global.get_current_time());
    this.dynamicWorkspaces.add(index);
    this.maybeNameWorkspace(index);
    const previous = tracked.surface.workspaceId;
    this.suppress.add(tracked.id);
    this.deps.host.applyWorkspace(tracked.id, index);
    this.suppress.delete(tracked.id);
    tracked.surface.workspaceId = index;
    tracked.lastWorkspaceIdx = index;
    if (rememberPrevious) tracked.previousWorkspaceIdx = previous;
    this.deps.history.log('spawn_ws', { id: tracked.id, workspaceId: index, previous });
    this.signatures.clearAll();
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
    const previous = tracked.previousWorkspaceIdx;
    if (previous === null) {
      const tileables = this.tileables(tracked.surface.workspaceId);
      if (tileables.length <= 1 && !compat.isMaximized(tracked.win)) {
        this.deps.host.maximize(tracked.id);
      }
      return;
    }
    this.suppress.add(tracked.id);
    this.deps.host.applyWorkspace(tracked.id, previous);
    this.suppress.delete(tracked.id);
    const current = tracked.surface.workspaceId;
    tracked.surface.workspaceId = previous;
    tracked.previousWorkspaceIdx = null;
    // §7.3: a workspace that already holds a pair makes the newcomer float.
    // The incoming window is excluded: only two *others* make it a pair.
    if (this.tileables(previous).filter((t) => t.id !== tracked.id).length >= 2) {
      tracked.surface.setFloating(true);
      this.deps.host.applyLayer(tracked.id, Layer.FLOATING, 0);
    }
    this.deps.history.log('ws_removed', { id: tracked.id, from: current, to: previous, reason: 'unmaximize' });
    this.signatures.clearAll();
    this.removeIfEmptyDynamic(current);
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
      this.deps.host.applyWorkspace(tracked.id, workspaceId - 1);
      this.suppress.delete(tracked.id);
      tracked.surface.workspaceId = workspaceId - 1;
      this.deps.history.log('new_ws', { id: tracked.id, workspaceId: workspaceId - 1, reason: 'minimize' });
      this.removeIfEmptyDynamic(workspaceId);
    }
    this.scheduleRetile(workspaceId, 'minimize');
  }

  /** §7.5 close: leave an empty workspace, removing dynamic ones (§16). */
  private switchAwayIfEmpty(workspaceId: number): void {
    const manager = global.workspace_manager;
    if (manager.get_n_workspaces() <= 1) return;
    const workspace = manager.get_workspace_by_index(workspaceId);
    if (workspace === null) return;
    const remaining = workspace.list_windows().filter((win: any) => this.windows.has(win.get_id()));
    if (remaining.length > 0) return;

    if (this.removeIfEmptyDynamic(workspaceId)) return;

    if (manager.get_active_workspace_index() !== workspaceId) return;
    const next = workspaceId + 1 < manager.get_n_workspaces() ? workspaceId + 1 : Math.max(0, workspaceId - 1);
    this.deps.history.log('ws_switch_empty', { from: workspaceId, to: next });
    this.activateWorkspace(next);
  }

  /** §16: an empty workspace we created is removed again. */
  private removeIfEmptyDynamic(workspaceId: number): boolean {
    if (!this.dynamicWorkspaces.has(workspaceId)) return false;
    const manager = global.workspace_manager;
    if (manager.get_n_workspaces() <= 1) return false;
    const workspace = manager.get_workspace_by_index(workspaceId);
    if (workspace === null) return false;
    const remaining = workspace.list_windows().filter((win: any) => this.windows.has(win.get_id()));
    if (remaining.length > 0) return false;

    this.dynamicWorkspaces.delete(workspaceId);
    const shifted = new Set<number>();
    for (const index of this.dynamicWorkspaces) shifted.add(index > workspaceId ? index - 1 : index);
    this.dynamicWorkspaces.clear();
    for (const index of shifted) this.dynamicWorkspaces.add(index);
    this.scheduler.clear(`ws:${workspaceId}`);
    manager.remove_workspace(workspace, global.get_current_time());
    this.realignWorkspaces();
    this.signatures.clearAll();
    this.deps.history.log('ws_removed', { workspaceId, reason: 'dynamic-empty' });
    return true;
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
    // While the user is dragging, follow the frame but do not reflow (§11.3).
    if (this.dragging) {
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
    this.deps.onStateChanged();
    this.scheduleRetile(tracked.surface.workspaceId, 'frame');
  }

  private onMaximizeSignal(tracked: TrackedWindow): void {
    if (this.suppress.has(tracked.id)) return;
    tracked.surface.refresh();
    const maximized = compat.isMaximized(tracked.win);
    if (maximized) {
      const siblings = this.tileables(tracked.surface.workspaceId).filter((t) => t.id !== tracked.id);
      if (siblings.length > 0) this.moveToNewWorkspace(tracked, true);
      else this.signatures.clearAll();
      return;
    }
    if (tracked.previousWorkspaceIdx !== null) this.returnFromMaximize(tracked);
    else this.scheduleRetile(tracked.surface.workspaceId, 'unmaximize');
  }

  private onWorkspaceSignal(tracked: TrackedWindow): void {
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
    return { windows: this.windows.size, sources: this.scheduler.size + (this.retileSource !== null ? 1 : 0), signals: signalCount };
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

  /** §14 focus by direction, closest by centre. */
  focusDirection(direction: string): void {
    const current = this.focused();
    if (current === null) return;
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
    if (best !== null) this.focus(best.id);
  }
}

function fallbackScreen(): Screen {
  return { index: 0, connector: '', geometry: { x: 0, y: 0, width: 1920, height: 1080 }, scale: 1, refreshRate: 60, isPrimary: true };
}
