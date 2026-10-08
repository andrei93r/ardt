// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Window lifecycle and workspace policy (§7, §9.4, §14, §16, §17).
 * Owns the one `Map<number, TrackedWindow>` and every per-window signal.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import type { Settings as GioSettings } from 'gi://Gio';
import Meta from 'gi://Meta';
import type { MetaDisplay, MetaWindow } from 'gi://Meta';
import { wm } from 'resource:///org/gnome/shell/ui/main.js';

import type { HeuristicContext } from '../../core/classify.js';
import { centreInWorkArea } from '../../core/cursor.js';
import type { MemoryEntry } from '../../core/displays.js';
import { normalizePlan } from '../../core/normalize.js';
import type { NormalizeWindow } from '../../core/normalize.js';
import { swappedSides } from '../../core/placement.js';
import type { Axis, ScreenClass } from '../../core/placement.js';
import type { DragOutcome } from '../../core/drag.js';
import type { ChangeLog } from '../../core/undo.js';

import { SignatureCache } from '../../core/scheduler.js';
import type { TilerConfig } from '../../core/tiler.js';
import { Layer } from '../../core/types.js';
import type { Rect, Screen } from '../../core/types.js';
import * as compat from './compat.js';
import { DisplayController } from './display.js';
import { DrainScheduler } from './drain.js';
import { FocusController } from './focus.js';
import type { GnomeHost } from './host.js';
import type { History } from './history.js';
import { SessionDiagnostics } from './diagnostics.js';
import type { SessionCounters, SessionPerf } from './diagnostics.js';
import { instanceIdFor, resolveWindowIdentity } from './appidentity.js';
import type { RegistryStore } from './registry.js';
import { Retiler } from './retiler.js';
import type { PerfProbe } from './perf.js';
import { DragController } from './drag.js';
import { SelfHeal } from './selfheal.js';
import type { GnomeSettings } from './settings.js';
import type { GnomeTiming } from './timing.js';
import type { Tiling } from './tiling.js';
import { TrackedWindow } from './tracked-window.js';
import { UndoCoordinator } from './undo.js';
import { WorkspaceController } from './workspace.js';

export interface SessionDeps {
  host: GnomeHost;
  settings: GnomeSettings;
  /** §11.3/§18: OS animation state and per-screen frame interval. */
  timing: GnomeTiming;
  tiling: Tiling;
  history: History;
  registry: RegistryStore;
  changes: ChangeLog;
  /** P6e: the dev-gated section profiler, owned by the extension. */
  probe: PerfProbe;
  isPaused(): boolean;
  onStateChanged(): void;
  onStubborn(appId: string): void;
  onClosed(id: number, rect: Rect): void;
  onDragChanged(dragging: boolean): void;
  /** The window is being moved to another workspace: hide the border now. */
  onWindowMoving(): void;
  /** Raise a decision notification (§21); the extension owns the gate. */
  onNotice?(key: string, subject: string): void;
  /** Journal one model-level event for the replayable trace (§22, Stage 6). */
  onModelEvent?(event: string, fields: Record<string, unknown>): void;
  /** §9: display memory changed and should be persisted. */
  onDisplayMemoryChanged?(): void;
  /** Whether any window is mid-animation (the drain waits for it rather than
   * applying a frame onto a moving surface). */
  isAnimating?: () => boolean;
}

interface WindowSignal {
  id: number;
}

/**
 * §11/§16: what we expect one of our own state changes to produce. Mutter emits
 * the matching maximize/workspace signal asynchronously, so a synchronous flag
 * around the call is already cleared when it arrives; the handler matches this
 * echo (value + monotonic time) instead. One entry per kind so a workspace move
 * cannot refresh the timestamp of an in-flight unmaximize.
 */
interface SelfApplyEcho {
  /** GLib monotonic µs of our last maximize/unmaximize apply (0 = none). */
  maximizeAtUs: number;
  /** The maximize state our apply is expected to produce. */
  maximized: boolean;
  /** GLib monotonic µs of our last workspace apply (0 = none). */
  workspaceAtUs: number;
  /** The workspace index our apply is expected to land on. */
  workspace: number;
}

/**
 * The private `Main.wm._workspaceAnimation` controller (§23.2). `wm` is
 * declared `any`; this names only the members `instantSwitch` reads and
 * patches, each optional because Shell internals move between releases — the
 * same structural boundary `extension.ts` uses for `wm._workspaceAnimation`.
 */
interface SwitchAnimationController {
  animateSwitch?: (from: unknown, to: unknown, direction: unknown, onComplete: unknown) => void;
  cancelSwitchAnimation?(): void;
}

/**
 * A maximize/unmaximize/workspace signal that arrives within this window of a
 * state change we made is our own, not the user's: Mutter emits the signal
 * asynchronously, so the handler matches the recorded echo (see `selfEcho`)
 * rather than a boolean flag that would already be cleared by then.
 */
const SELF_APPLY_MS = 200;
/** Delay before a maintenance sweep, so a burst of signals coalesces. */
const SWEEP_DELAY_MS = 150;
/** How long the switch-animation patch stays installed, then it is restored. */
const SWITCH_ANIMATION_PATCH_MS = 400;
/**
 * The heuristic modal check is the only reader of the classification context,
 * so a miss with the heuristic disabled skips building the title list and
 * shares this empty one (read-only; `classify` never mutates it).
 */
const EMPTY_HEURISTIC_CONTEXT: HeuristicContext = { liveTitles: [] };
export class WindowSession {
  readonly windows = new Map<number, TrackedWindow>();
  private readonly signals = new Map<number, WindowSignal[]>();
  private readonly signatures = new SignatureCache();
  /** §11/§16: our own recent maximize/workspace changes, one per window. */
  private readonly selfEcho = new Map<number, SelfApplyEcho>();
  /**
   * §11: one scheduling path, owned by the drain module. Every signal handler
   * pushes there; a single deferred drain runs the policy, in lane order, with
   * per-key coalescing. Lane 2 (layout) is armed on the compositor's resize
   * later, lane 3 (maintenance) on idle; both are removed as soon as it runs.
   */
  private readonly drain: DrainScheduler;
  /** §12: monotonic sequence for provisional `window:<seq>` identity keys. */
  private windowSeq = 0;
  /** §21/§36: counters and latency samples, owned by the diagnostics module. */
  private readonly diagnostics = new SessionDiagnostics();
  private readonly timeoutSources = new Set<number>();
  private reorderSignal = 0;
  private displaySignals: number[] = [];
  private managerSignals: number[] = [];
  private grabBeginSignal = 0;
  private grabEndSignal = 0;
  /** True while a compositor state makes tiling pointless (the overview). */
  private suspended = false;
  /** `org.gnome.mutter`, the authority on the screen classes (§1). */
  private mutterSettings: GioSettings | null = null;
  /** One-shot diagnostic so a persistent schema failure is logged once, not per pass. */
  private screenClassErrorLogged = false;
  /** The static workspace count (`org.gnome.desktop.wm.preferences`). */
  private wmPreferencesSettings: GioSettings | null = null;
  /** While set, plan-mismatch re-applies are suppressed (e.g. right after Undo). */
  private ignoreMismatchUntilMs = 0;
  /** §6/§17: the focus cycle and directional focus, owned by the focus module. */
  private readonly focusController: FocusController;
  /** §13: capture/restore/undo, owned by the undo module. */
  private readonly undoCoordinator: UndoCoordinator;
  /** §5/§7/§16: workspace create/reap/reorder/move, owned by its module. */
  private readonly workspaces: WorkspaceController;
  /** §3/§4/§6/§10/§16: the tiling pass and placement ladder, owned by its module. */
  private readonly retiler: Retiler;
  /** §6/§10/§11/§12/§17: drag/adjust and cross-screen state, owned by its module. */
  private readonly drag: DragController;
  /** §9: display memory and the display plan, owned by its module. */
  private readonly display: DisplayController;
  /** §24/§35: the adaptive scan tick, clamp and coherence sweep. */
  private readonly selfHeal: SelfHeal;

  constructor(private readonly deps: SessionDeps) {
    this.drain = new DrainScheduler({
      isPaused: () => this.deps.isPaused(),
      isAnimating: () => this.deps.isAnimating?.() === true,
      applyCursorCentre: (data) => this.applyCursorCentre(data),
      reconcileAll: (reason, rememberUndo) => this.reconcileAll(reason, rememberUndo),
      applyDisplayChange: () => this.applyDisplayChange(),
      coherenceSweep: () => this.coherenceSweep(),
      logMaintenance: (kind) => this.deps.history.log('maintenance', { kind }),
      addTimeout: (ms, cb) => this.addTimeout(ms, cb),
      frameIntervalFor: () => this.deps.timing.frameIntervalFor(),
      noteDrain: () => this.diagnostics.noteDrain(),
      noteDrainMs: (ms) => this.diagnostics.noteDrainMs(ms),
      reportError: (context, error) => this.reportError(context, error),
      probe: this.deps.probe,
    });
    this.focusController = new FocusController({
      focused: () => this.focused(),
      focus: (id) => this.focus(id),
      allWindows: () => this.windows.values(),
      window: (id) => this.windows.get(id),
      classify: (tracked) => this.classify(tracked),
      slotFor: (tracked) => this.slotFor(tracked),
      tileables: (workspaceId) => this.tileables(workspaceId),
      logFocus: (event, fields) => {
        if (this.deps.settings.boolean('debug-focus', false)) this.deps.history.log(event, fields);
      },
    });
    this.undoCoordinator = new UndoCoordinator({
      changes: deps.changes,
      tiling: deps.tiling,
      host: deps.host,
      history: deps.history,
      onNotice: deps.onNotice,
      tileables: (workspaceId) => this.tileables(workspaceId),
      window: (id) => this.windows.get(id),
      allWindows: () => this.windows.values(),
      screenFor: (index) => this.screenFor(index),
      slotFor: (tracked) => this.slotFor(tracked),
      moveWindowToWorkspace: (tracked, index) => this.workspaces.moveWindow(tracked, index),
      withSelfUnmaximize: (tracked, fn) => this.withSelfUnmaximize(tracked, fn),
      activateWorkspace: (index) => this.activateWorkspace(index),
      activeWorkspaceId: () => this.deps.host.activeWorkspaceId(),
      clearSignatures: () => this.signatures.clearAll(),
      suppressMismatchUntil: (until) => {
        this.ignoreMismatchUntilMs = until;
      },
    });
    this.workspaces = new WorkspaceController({
      allWindows: () => this.windows.values(),
      window: (id) => this.windows.get(id),
      hasWindow: (id) => this.windows.has(id),
      placementState: () => this.retiler.buildPlacementState(),
      noteSelfEcho: (id, expected) => this.noteSelfEcho(id, expected),
      noteSelfApply: () => this.deps.tiling.noteSelfApply(),
      cancelApply: (id) => this.deps.tiling.cancel(id),
      applyWorkspace: (id, index) => this.deps.host.applyWorkspace(id, index),
      onWindowMoving: () => this.deps.onWindowMoving(),
      log: (event, fields) => this.deps.history.log(event, fields),
      reindexRatiosAfterReap: (removed) => this.deps.tiling.reindexRatiosAfterReap(removed),
      activateWorkspace: (index) => this.activateWorkspace(index),
      clearSignatures: () => this.signatures.clearAll(),
      scheduleReconcile: (reason) => this.scheduleReconcile(reason),
      addTimeout: (ms, cb) => this.addTimeout(ms, cb),
      isPaused: () => this.deps.isPaused(),
      isSuspended: () => this.suspended,
      reorderLoggingEnabled: () => this.deps.settings.boolean('log-workspace-reorder', false),
    });
    this.retiler = new Retiler({
      tiling: deps.tiling,
      host: deps.host,
      settings: deps.settings,
      history: deps.history,
      diagnostics: this.diagnostics,
      workspaces: this.workspaces,
      signatures: this.signatures,
      windows: this.windows,
      probe: this.deps.probe,
      onModelEvent: deps.onModelEvent,
      axisFor: (screenId) => this.axisFor(screenId),
      tilerConfig: () => this.tilerConfig(),
      screenFor: (index) => this.screenFor(index),
      screenClass: (screenId) => this.screenClass(screenId),
      tileables: (workspaceId) => this.tileables(workspaceId),
      classify: (tracked) => this.classify(tracked),
      capturePlane: (workspaceIds, screenId) => this.capturePlane(workspaceIds, screenId),
      withSelfUnmaximize: (tracked, fn) => this.withSelfUnmaximize(tracked, fn),
      recordPlacement: (tracked, connectorOverride, slotOverride) =>
        this.recordPlacement(tracked, connectorOverride, slotOverride),
      scheduleReconcile: (reason) => this.scheduleReconcile(reason),
      scheduleRetile: (workspaceId, reason) => this.scheduleRetile(workspaceId, reason),
      instantSwitch: (fn) => this.instantSwitch(fn),
      activateWorkspace: (index) => this.activateWorkspace(index),
      onStateChanged: () => this.deps.onStateChanged(),
      isPaused: () => this.deps.isPaused(),
      isSuspended: () => this.suspended,
      isDragging: () => this.drag.windowDragActive(),
      ignoreMismatchUntilMs: () => this.ignoreMismatchUntilMs,
    });
    this.drag = new DragController({
      tiling: deps.tiling,
      host: deps.host,
      settings: deps.settings,
      history: deps.history,
      workspaces: this.workspaces,
      signatures: this.signatures,
      retiler: this.retiler,
      windows: this.windows,
      onDragChanged: (dragging) => this.deps.onDragChanged(dragging),
      classify: (tracked) => this.classify(tracked),
      screenFor: (index) => this.screenFor(index),
      tileables: (workspaceId) => this.tileables(workspaceId),
      tileablesOnScreen: (workspaceId, screen, excludeId) =>
        this.tileablesOnScreen(workspaceId, screen, excludeId),
      slotFor: (tracked) => this.slotFor(tracked),
      pairSibling: (tracked) => this.pairSibling(tracked),
      swapPairSides: (a, b) => this.swapPairSides(a, b),
      tilerConfig: () => this.tilerConfig(),
      captureChange: (ids, workspaceOverride) => this.captureChange(ids, workspaceOverride),
      withSelfUnmaximize: (tracked, fn) => this.withSelfUnmaximize(tracked, fn),
      scheduleReconcile: (reason) => this.scheduleReconcile(reason),
      scheduleRetile: (workspaceId, reason) => this.scheduleRetile(workspaceId, reason),
      reconcileAll: (reason, rememberUndo) => this.reconcileAll(reason, rememberUndo),
      runGuarded: (cb) => this.guard('adjust-end', cb)(),
      onStateChanged: () => this.deps.onStateChanged(),
      isPaused: () => this.deps.isPaused(),
      isSuspended: () => this.suspended,
    });
    this.display = new DisplayController({
      host: deps.host,
      history: deps.history,
      settings: deps.settings,
      tiling: deps.tiling,
      workspaces: this.workspaces,
      windowIds: () => [...this.windows.keys()],
      allWindows: () => this.windows.values(),
      window: (id) => this.windows.get(id),
      screenClass: (screenId) => this.screenClass(screenId),
      classify: (tracked) => this.classify(tracked),
      slotFor: (tracked) => this.slotFor(tracked),
      floatWindow: (tracked, rect) => this.retiler.floatWindow(tracked, rect),
      recordPlacement: (tracked, connectorOverride, slotOverride) =>
        this.recordPlacement(tracked, connectorOverride, slotOverride),
      pinSlots: (workspaceId, tracked, slot) => this.retiler.pinSlots(workspaceId, tracked, slot),
      unmaximizeOccupants: (workspaceId, exceptId) => this.retiler.unmaximizeOccupants(workspaceId, exceptId),
      clearSignatures: () => this.signatures.clearAll(),
      scheduleReconcile: (reason) => this.scheduleReconcile(reason),
      onDisplayMemoryChanged: () => this.deps.onDisplayMemoryChanged?.(),
      errorText: (error) => this.errorText(error),
    });
    this.selfHeal = new SelfHeal({
      tiling: this.deps.tiling,
      history: this.deps.history,
      registry: this.deps.registry,
      host: this.deps.host,
      diagnostics: this.diagnostics,
      windows: () => this.windows.values(),
      windowCount: () => this.windows.size,
      window: (id) => this.windows.get(id),
      register: (win) => this.register(win),
      unregister: (id) => this.unregister(id),
      reapEmptyWorkspaces: () => this.workspaces.reapEmpty(),
      retileAll: (reason) => this.retileAll(reason),
      isPaused: () => this.deps.isPaused(),
      isSuspended: () => this.suspended,
      gestureActive: () => this.drag.gestureActive(),
      recoverStaleDrag: () => this.drag.recoverStaleDrag(),
      clientInteractionActive: () => this.drag.clientInteractionActive(),
      endClientInteraction: () => this.drag.endClientInteraction(),
      scheduleReconcile: (reason) => this.scheduleReconcile(reason),
      runGuarded: (cb) => this.guard('scan-tick', cb)(),
      debugEnabled: () => this.deps.settings.boolean('debug-enabled', false),
      scanBaseMs: () => Math.max(1000, this.deps.settings.int('scan-interval', 5000)),
      clampEnabled: () => this.deps.settings.boolean('clamp-windows-to-screen', true),
      screenFor: (index) => this.screenFor(index),
      tileables: (workspaceId) => this.tileables(workspaceId),
      toTilerWindow: (tracked) => this.retiler.toTilerWindow(tracked),
      tilerConfig: () => this.tilerConfig(),
      clearSignatures: () => this.signatures.clearAll(),
      resetIgnoreMismatch: () => {
        this.ignoreMismatchUntilMs = 0;
      },
      onStateChanged: () => this.deps.onStateChanged(),
      probe: this.deps.probe,
    });
  }

  startScan(): void {
    if (this.selfHeal.scanning()) return;
    this.selfHeal.startScan();
    // §7.6: user reorders shift every window's workspace index.
    this.reorderSignal = global.workspace_manager.connect('workspaces-reordered', this.guard('workspaces-reordered', () => this.workspaces.onReordered()));
    // §11.3 / §23.1: never retile or show the border while the user is dragging.
    this.grabBeginSignal = global.display.connect('grab-op-begin', this.guard('grab-op-begin', (_display: MetaDisplay, win: MetaWindow, op: number) =>
      this.drag.onGrabBegin(win, op),
    ));
    this.grabEndSignal = global.display.connect('grab-op-end', this.guard('grab-op-end', (_display: MetaDisplay, win: MetaWindow, op: number) =>
      this.drag.onGrabEnd(win, op),
    ));
    // Anything that can move, restack or re-parent a window triggers a
    // debounced global reconcile pass. `window-entered-monitor` is also what
    // re-queues a pending cross-screen move once `move_to_monitor` lands (A106).
    this.displaySignals.push(
      global.display.connect('window-entered-monitor', this.guard('window-entered-monitor', () => this.scheduleReconcile('window-monitor'))),
      global.display.connect('window-left-monitor', this.guard('window-left-monitor', () => this.scheduleReconcile('window-monitor'))),
      global.display.connect('notify::focus-window', this.guard('focus-window', () => {
        // §11/§17: no policy here. Push the lane-1 feedback event; the drain
        // re-derives the live focused window and moves the pointer.
        this.scheduleCursorCentre(false);
        this.scheduleReconcile('focus');
      })),
    );
    this.managerSignals.push(
      global.workspace_manager.connect('active-workspace-changed', this.guard('active-workspace-changed', () => this.scheduleReconcile('workspace-active'))),
      global.workspace_manager.connect('workspace-added', this.guard('workspace-added', () => this.scheduleReconcile('workspace-added'))),
      global.workspace_manager.connect('workspace-removed', this.guard('workspace-removed', () => this.scheduleReconcile('workspace-removed'))),
      global.workspace_manager.connect('notify::n-workspaces', this.guard('n-workspaces', () => this.scheduleReconcile('workspace-count'))),
    );
  }

  stopScan(): void {
    this.selfHeal.stopScan();
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
    return this.drag.isDragging();
  }

  /** §6: an application DnD is in progress (button held, no window grab). */
  get clientInteractionActive(): boolean {
    return this.drag.clientInteractionActive();
  }

  /** Drag/reflow state for `DumpState` (§22) — observation only. */
  dragState(): {
    active: boolean;
    windowDrag: boolean;
    clientInteraction: boolean;
    dragId: number | null;
    adjustId: number | null;
    button: boolean;
    displayGrab: boolean | null;
  } {
    return this.drag.dragState();
  }

  /** §11.3: observe one window grab (`grab-op-begin`). */
  beginDrag(id: number): boolean {
    return this.drag.beginDrag(id);
  }

  /** §11: observe one window grab release; the drain interprets the drop. */
  endDrag(id: number): boolean {
    return this.drag.endDrag(id);
  }

  /** §6/§11: the live drop target for the preview overlay. */
  previewTarget(): DragOutcome | null {
    return this.drag.previewTarget();
  }

  /** Suspend tiling (e.g. the overview is open); one pass runs on resume. */
  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    if (!suspended) this.scheduleReconcile('resume');
  }

  private pairSibling(tracked: TrackedWindow): TrackedWindow | null {
    const peers = this.tileablesOnScreen(tracked.surface.workspaceId, tracked.surface.screenId, tracked.id);
    return peers.length === 1 ? peers[0] : null;
  }

  /**
   * §13: record a pair swap as explicit sides. The swap flag is a stable
   * id-order override, but toggling it alone is not invertible: when the pair's
   * position order already matches the reverse of its id order (a newcomer that
   * took the left slot), setting it changes nothing and clearing it restores
   * nothing. Pinning the exchanged sides makes every swap a real exchange, and
   * explicit slots win over the flag in `computePlans`.
   */
  private swapPairSides(a: TrackedWindow, b: TrackedWindow): void {
    const [slotA, slotB] = swappedSides(a.id, this.slotFor(a), b.id, this.slotFor(b));
    a.pendingSlot = slotA;
    b.pendingSlot = slotB;
  }

  /** §13: swap a pair on request (the `SwapPair` test trigger). */
  swapPair(a: number, b: number): boolean {
    const ta = this.windows.get(a);
    const tb = this.windows.get(b);
    if (ta === undefined || tb === undefined) return false;
    this.captureChange([a, b]);
    this.deps.tiling.toggleSwap(a, b);
    this.swapPairSides(ta, tb);
    this.signatures.clearAll();
    this.deps.history.log('swap', { a, b });
    this.retile(ta.surface.workspaceId, 'swap');
    return true;
  }

  /** §18 invariant: paused means no retiles, no scan tick.**/
  setScanning(enabled: boolean): void {
    if (enabled) this.startScan();
    else this.stopScan();
  }

  register(win: MetaWindow): void {
    const id: number = win.get_id();
    if (this.windows.has(id)) return;
    // Popups, menus and tooltips are override-redirect on X11; they are never
    // tiled and tracking them only creates work and spurious signals.
    if (compat.isOverrideRedirect(win)) return;
    // On Wayland the same windows are `xdg_popup` and are *not*
    // override-redirect, so the check above misses them. Tracking one is not
    // just noise: closing it calls a NULL `close` vfunc in Mutter and crashes
    // the Shell, so popup-family windows are refused outright (§5,
    // docs/shell-crash-audit.md).
    if (compat.isPopupWindow(win)) return;
    const surface = this.deps.host.ensureSurface(win);
    const tracked = new TrackedWindow(win, surface);
    this.windowSeq += 1;
    tracked.instanceId = instanceIdFor(win);
    tracked.seq = this.windowSeq;
    tracked.originalRect = { ...surface.frame };
    tracked.lastWorkspaceIdx = surface.workspaceId;
    this.windows.set(id, tracked);
    this.connectWindow(tracked);
    this.deps.history.log('register', { id, appId: surface.appId, title: surface.title });
    this.deferReady(tracked, 0);
  }

  /** §7.1: wait for the first frame plus the configured delay. The floor is
   * three compositor frames, derived from the screen refresh, not a fixed 50 ms. */
  private deferReady(tracked: TrackedWindow, attempt: number): void {
    const configured = this.deps.settings.int('gnome-animation-delay', 0);
    const delay = Math.max(this.deps.timing.sampleIntervalMs(3), configured);
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
    this.resolveTrackedIdentity(tracked);
    const appId = tracked.appKey;
    this.deps.registry.observe(appId, tracked.surface.title);
    // §12: neverTile takes precedence over everything: the user asked this app
    // to float, so it floats and is never re-tiled, however it arrived.
    if (this.deps.registry.isNeverTile(appId)) {
      tracked.autoFloated = false;
      tracked.surface.setFloating(true);
      this.deps.host.applyLayer(tracked.id, Layer.FLOATING);
      tracked.invalidateClassification();
      this.deps.registry.place(appId, tracked.instanceId, this.placementInput(tracked));
      return;
    }
    const classification = this.classify(tracked);
    if (!classification.tileable) {
      if (classification.modal) this.recenterModal(tracked);
      return;
    }

    const workspaceId = tracked.surface.workspaceId;
    const siblings = this.tileablesOnScreen(workspaceId, tracked.surface.screenId, tracked.id);
    if (compat.isFullyMaximized(tracked.win) && siblings.length > 0) {
      // §16: an app that opens maximized (Nautilus, Files, …) is not a user
      // maximize: it is unmaximized and tiled with its sibling. A user-requested
      // maximize still gets its own workspace through `onMaximizeSignal`.
      this.deps.tiling.noteSelfApply();
      this.withSelfUnmaximize(tracked, () => this.deps.host.unmaximize(tracked.id));
      tracked.surface.refresh();
      // §3/§16: opening maximized is not a user maximize, so it is never
      // *placed* by it — but it is still an arrival. Route it through the pure
      // model in the drain: with room it takes the free slot beside its sibling,
      // and with the workspace already full it gets its own workspace to the
      // right (exactly like any other newcomer). Returning here used to skip
      // routing and leave the newcomer stacked in a slot over the pair.
      tracked.routePending = true;
      this.scheduleReconcile('register-unmaximize');
      return;
    }
    // §3: routing comes from the pure model and is applied by the lane-2
    // drain. Here we only record that the window is ready and push the work.
    tracked.routePending = true;
    this.scheduleReconcile('route');
  }

  /**
   * §12: resolve the window's identity at its first frame and on every signal
   * that can change it (`notify::wm-class`, `tracked-windows-changed`). A
   * provisional key is re-keyed onto the real identity, carrying its entry.
   */
  private resolveTrackedIdentity(tracked: TrackedWindow): void {
    const previous = tracked.identityKey;
    const resolution = resolveWindowIdentity(tracked.win, tracked.seq);
    tracked.identityKey = resolution.key;
    tracked.identitySource = resolution.source;
    tracked.provisional = resolution.provisional;
    tracked.rawValues = resolution.rawValues;
    tracked.identityResolved = true;
    // The app class is empty at registration, so the timing profile was frozen
    // to `default`; re-derive it now that the real identity is known.
    tracked.refreshProfile();
    if (previous.length > 0 && previous !== resolution.key) {
      this.deps.registry.rekey(previous, resolution.key);
      this.deps.history.log('identity_rekey', { id: tracked.id, from: previous, to: resolution.key, origin: resolution.source });
    }
    this.deps.history.log('identity', {
      id: tracked.id,
      key: resolution.key,
      origin: resolution.source,
      provisional: resolution.provisional,
    });
  }

  /** Re-resolve every tracked window (a Shell `tracked-windows-changed`). */
  refreshIdentities(): void {
    for (const tracked of this.windows.values()) {
      if (!tracked.ready) continue;
      this.resolveTrackedIdentity(tracked);
    }
  }

  private placementInput(
    tracked: TrackedWindow,
    connectorOverride?: string,
    slotOverride?: number,
  ): { connector: string; slot: number; maximized?: boolean; fullscreen?: boolean; rect: Rect } {
    const screen = this.screenFor(tracked.surface.screenId);
    const slot = slotOverride ?? this.slotFor(tracked);
    return {
      connector: connectorOverride ?? screen?.connector ?? '',
      slot: slot ?? 0,
      maximized: tracked.surface.flags.maximized || compat.isMaximized(tracked.win),
      fullscreen: tracked.surface.flags.fullscreen,
      rect: { ...tracked.surface.frame },
    };
  }

  /** §12: record the window's current placement under its app entry. */
  private recordPlacement(tracked: TrackedWindow, connectorOverride?: string, slotOverride?: number): void {
    if (!tracked.identityResolved) return;
    const appId = tracked.appKey;
    if (appId.length === 0) return;
    this.deps.registry.place(appId, tracked.instanceId, this.placementInput(tracked, connectorOverride, slotOverride));
  }

  // ------------------------------------------------------------- v2 model

  /** The split axis of a screen: portrait or vertical workspaces stack (§1). */
  private axisFor(screenId: number): Axis {
    // A vertical workspace stack (`layout_rows === -1`) forces the split axis.
    // Otherwise the axis follows the monitor's own orientation, exactly as the
    // tiler does (a portrait screen stacks; a landscape one splits side by side).
    // `layout_rows` is `1` for the default horizontal workspace layout on every
    // monitor, so returning `horizontal` for any positive row count would force
    // a portrait monitor to split side by side here while the tiler stacked it.
    const rows = global.workspace_manager.layout_rows;
    if (rows === -1) return 'vertical';
    const screen = this.screenFor(screenId);
    return screen === null || screen.geometry.width >= screen.geometry.height ? 'horizontal' : 'vertical';
  }

  /**
   * §1: which class a screen is in, read from GNOME — never from internal vs
   * external. Dynamic workspaces off with one workspace is single-workspace;
   * off with two or more is fixed; on, every screen can host workspaces unless
   * `workspaces-only-on-primary` restricts them to the primary.
   */
  screenClass(screenId: number): ScreenClass {
    let dynamic = true;
    let numWorkspaces = 1;
    let onlyPrimary = true;
    try {
      const mutter: GioSettings = this.mutterSettings ?? new Gio.Settings({ schema_id: 'org.gnome.mutter' });
      this.mutterSettings = mutter;
      dynamic = mutter.get_boolean('dynamic-workspaces');
      onlyPrimary = mutter.get_boolean('workspaces-only-on-primary');
      // The static workspace count lives in the wm preferences, not mutter.
      const wmPrefs: GioSettings = this.wmPreferencesSettings ?? new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
      this.wmPreferencesSettings = wmPrefs;
      numWorkspaces = wmPrefs.get_int('num-workspaces');
    } catch (error) {
      // Keep the defaults (GNOME's dynamic-workspace behaviour) but report the
      // failure once: this is called from the retile pass, so logging every
      // attempt would put file I/O in a hot path.
      if (!this.screenClassErrorLogged) {
        this.screenClassErrorLogged = true;
        this.deps.history.log('error', { reason: 'screen-class', error: this.errorText(error) });
      }
    }
    if (!dynamic) return numWorkspaces > 1 ? 'fixed' : 'single';
    const screen = this.screenFor(screenId);
    if (onlyPrimary && screen?.isPrimary !== true) return 'single';
    return 'dynamic';
  }

  unregister(id: number): void {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return;
    this.drag.forgetWindow(id);
    const workspaceId = tracked.surface.workspaceId;
    const closedRect: Rect = { ...tracked.surface.frame };
    // Only windows we actually tiled get a close ghost; popups, menus,
    // tooltips and other transient surfaces must not flash a border.
    const wasTiled = tracked.lastTarget !== null;
    this.selfHeal.forgetWindow(id);
    // Defensive: a window we floated carries Mutter's "above" flag; drop it as
    // the window goes away so it cannot linger on a recycled surface.
    this.deps.host.clearAbove(id);
    this.disconnectWindow(id);
    this.windows.delete(id);
    this.selfEcho.delete(id);
    this.deps.host.forgetSurface(id);
    if (wasTiled) this.deps.onClosed(id, closedRect);
    this.deps.onModelEvent?.('window-closed', { id });
    this.signatures.clear(`ws:${workspaceId}`);
    this.deps.history.log('close', { id, workspaceId });
    this.deps.onStateChanged();

    this.workspaces.switchAwayIfEmpty(workspaceId);
    this.retiler.evaluateLoneMaximize(workspaceId);
    this.scheduleRetile(workspaceId, 'close');
    // A close can leave a window we had floated over a pair with nowhere to
    // float: run the sweep so it comes back into the tiling and its "above"
    // flag is cleared with it.
    this.addTimeout(SWEEP_DELAY_MS, () => this.scheduleMaintenance('sweep'));
  }

  /** Re-classify and retile after a settings change. */
  invalidateAll(): void {
    for (const tracked of this.windows.values()) tracked.invalidateClassification();
    this.signatures.clearAll();
    this.retileAll('settings');
  }

  // ------------------------------------------------------ §20 normalisation

  /**
   * §20 enable-time normalisation, run on every enable (including a mid-session
   * one). Per workspace and screen: one managed window is maximized; a window
   * dominating the work area is maximized with the rest minimized; otherwise
   * the top two by visible surface pair up and the rest are minimized. Floats
   * and fullscreen windows are left exactly as they are.
   */
  normalizeOnEnable(): void {
    const screens = this.deps.host.screens();
    const count = global.workspace_manager.get_n_workspaces();
    let changed = false;
    let normalised = 0;
    // §24/P2.5: one snapshot of the window map for the whole pass. The filter
    // reads live fields, and the decisions below neither add nor remove a
    // window, so membership is stable across every workspace×screen; the copy
    // per plane was pure allocation.
    const snapshot = [...this.windows.values()];
    for (let index = 0; index < count; index++) {
      for (const screen of screens) {
        const plane = snapshot.filter(
          (tracked) =>
            tracked.ready &&
            tracked.surface.workspaceId === index &&
            tracked.surface.screenId === screen.index &&
            !tracked.surface.flags.minimized &&
            !tracked.surface.flags.floating &&
            !tracked.surface.flags.fullscreen &&
            !tracked.autoFloated &&
            !tracked.escaped &&
            this.classify(tracked).tileable,
        );
        if (plane.length === 0) continue;
        const area = screen.workArea ?? screen.geometry;
        const inputs: NormalizeWindow[] = plane.map((tracked) => ({
          id: tracked.id,
          rect: tracked.surface.frame,
          visibleArea: this.visibleSurface(tracked, plane),
          managed: true,
          fullscreen: tracked.surface.flags.fullscreen,
          floating: false,
        }));
        const decision = normalizePlan(inputs, area);
        if (decision.kind === 'lone' || decision.kind === 'dominant') {
          normalised += decision.maximize.length + decision.minimize.length;
          for (const id of decision.maximize) {
            const tracked = this.windows.get(id);
            if (tracked === undefined || compat.isMaximized(tracked.win)) continue;
            this.deps.tiling.noteSelfApply();
            this.deps.tiling.noteSelfMaximize();
            this.deps.host.maximize(id);
            changed = true;
          }
          for (const id of decision.minimize) {
            if (!this.windows.get(id)?.surface.flags.minimized) {
              this.deps.tiling.noteSelfApply();
              this.deps.host.minimize(id);
              changed = true;
            }
          }
        } else if (decision.kind === 'pair') {
          normalised += decision.slots.length + decision.minimize.length;
          for (const slot of decision.slots) {
            const tracked = this.windows.get(slot.id);
            if (tracked === undefined) continue;
            tracked.escaped = false;
            tracked.pendingSlot = slot.slot;
            if (compat.isMaximized(tracked.win)) {
              this.deps.tiling.noteSelfApply();
              this.withSelfUnmaximize(tracked, () => this.deps.host.unmaximize(tracked.id));
            }
            changed = true;
          }
          for (const id of decision.minimize) {
            if (!this.windows.get(id)?.surface.flags.minimized) {
              this.deps.tiling.noteSelfApply();
              this.deps.host.minimize(id);
              changed = true;
            }
          }
        }
      }
    }
    if (normalised > 0) {
      this.deps.history.log('normalize', { workspaces: count, windows: normalised });
      this.deps.onModelEvent?.('normalize', { workspaces: count, windows: normalised });
    }
    if (changed) {
      this.signatures.clearAll();
      this.scheduleReconcile('normalize-enable');
    }
  }

  /** Visible surface: the rect's area minus what is stacked above it. */
  private visibleSurface(tracked: TrackedWindow, peers: readonly TrackedWindow[]): number {
    tracked.surface.captureZ();
    const rect = tracked.surface.frame;
    let area = Math.max(0, rect.width) * Math.max(0, rect.height);
    const z = tracked.surface.zPosition;
    for (const other of peers) {
      if (other.id === tracked.id) continue;
      other.surface.captureZ();
      if (other.surface.zPosition <= z) continue;
      area -= this.drag.overlapArea(rect, other.surface.frame);
      if (area <= 0) return 0;
    }
    return Math.max(0, area);
  }

  // ---------------------------------------------------------- §9 displays
  /** §9: persisted display memory (keyed by connector), owned by its module. */
  setDisplayMemory(memory: MemoryEntry[]): void {
    this.display.setDisplayMemory(memory);
  }

  /** Read-only: the caller must copy to modify, never mutate session state. */
  getDisplayMemory(): readonly MemoryEntry[] {
    return this.display.getDisplayMemory();
  }

  /** §9: a screen/work-area change is planned in the layout drain, never in
   * the Mutter signal handler. */
  scheduleDisplayPass(reason: string): void {
    if (this.drain.enqueue(2, 'displays', 'displays', { reason })) this.drain.arm(2);
  }

  /** §9 display plan: rescue, replay and primary-change handling (delegated). */
  private applyDisplayChange(): void {
    this.display.applyDisplayChange();
  }

  /**
   * §10: a monitor or work-area change. The host has already re-read its
   * screens; every surface is re-read in full (frame, monitor, the
   * monitor-implied sticky flag, size hints) and its classification is dropped,
   * because both depend on where the window is and how big the surface is. The
   * replan itself is deferred by the caller so the struts have settled.
   */
  onScreensChanged(): void {
    for (const tracked of this.windows.values()) {
      tracked.refresh();
      tracked.refreshFrame();
    }
    this.signatures.clearAll();
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
    if (this.drag.flowBlocked()) return;
    // Only a genuine user adjust is undoable; a signal-driven reconcile is a
    // safety net and must not push an entry that masks the user's own action.
    const rememberUndo = reason === 'user-adjust';
    // One key for every reconcile: a burst of signals is one pass, and the drain
    // runs on the next compositor resize tick rather than on a private timer.
    if (this.drain.enqueue(2, 'reconcile-all', 'reconcile', { reason, rememberUndo })) this.drain.arm(2);
  }

  /**
   * Test hook: push N layout events for the same key inside one call, the way a
   * same-frame signal storm does, and report the queue depth afterwards. One
   * coalesced entry is the whole point of the queue.
   */
  simulateBurst(count: number, reason: string): number {
    // §19: a pause refuses new work; the queue only carries what it held.
    if (this.deps.isPaused()) return 0;
    for (let i = 0; i < Math.max(0, Math.trunc(count)); i++) {
      this.drain.enqueue(2, 'reconcile-all', 'reconcile', { reason: `${reason}#${i}` });
    }
    if (this.drain.depth(2) > 0) this.drain.arm(2);
    return this.drain.depth(2);
  }

  /** Queue a maintenance job (lane 3): cheap, can wait for idle. */
  scheduleMaintenance(kind: string, data?: Record<string, unknown>): void {
    if (this.drain.enqueue(3, `maintenance:${kind}`, 'maintenance', { kind, ...data })) this.drain.arm(3);
  }

  /**
   * §17 cursor-centre / §11 lane 1 feedback. Pushing only: the drain re-derives
   * the focused window's live rect, so a coalesced focus storm still ends with
   * the pointer at the *current* window, never a stale one. `explicit` is the
   * keybinding/`CursorToCentre` path, which acts even when the automatic
   * `cursor-follows-focus` setting is off.
   */
  scheduleCursorCentre(explicit: boolean): void {
    if (this.deps.isPaused() || this.suspended) return;
    if (this.drain.enqueue(1, 'cursor-centre', 'cursor', { explicit })) this.drain.arm(1);
  }

  /** The keybinding/trigger path: move now (through the drain). False when
   * there is no focused window to aim at. */
  centreCursorNow(): boolean {
    const hasFocus = this.focused() !== null;
    this.scheduleCursorCentre(true);
    return hasFocus;
  }

  /** The drain half of the cursor-centre property (§17). */
  private applyCursorCentre(data: Record<string, unknown>): void {
    const explicit = data.explicit === true;
    if (!explicit && !this.deps.settings.boolean('cursor-follows-focus', false)) return;
    const focused = this.focused();
    if (focused === null) return;
    // The live rect, never the one captured when the focus signal fired.
    focused.refreshFrame();
    const screen = this.deps.host.screenByIndex(focused.surface.screenId);
    const area = screen === null ? focused.surface.frame : screen.workArea ?? screen.geometry;
    const target = centreInWorkArea(focused.surface.frame, area);
    const moved = this.deps.host.warpPointer(target.x, target.y);
    this.deps.history.log('cursor_centre', {
      id: focused.id,
      x: target.x,
      y: target.y,
      explicit,
      moved,
    });
  }

  /**
   * Guard a signal/actor callback so a throw is logged, never propagated into
   * the compositor's emission. Cheap: one closure per connection, one try/catch
   * per event. Programming errors are still visible (`[adrt] ERROR` + history).
   */
  private guard<A extends unknown[]>(context: string, cb: (...args: A) => void): (...args: A) => void {
    return (...args: A): void => {
      try {
        cb(...args);
      } catch (error) {
        this.reportError(context, error);
      }
    };
  }

  /** The message of a caught unknown, for the diagnostics below. */
  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** Log a caught error (`[adrt] ERROR`-style) and journal it, never rethrow. */
  private reportError(context: string, error: unknown): void {
    const message = this.errorText(error);
    this.errorCount += 1;
    console.error(`[adrt] ERROR ${context}: ${message}`);
    try {
      this.deps.history.log('error', { context, error: message });
    } catch {
      /* a logging failure must never escape the boundary */
    }
  }

  /** Errors caught by the drain/signal boundary (DumpState diagnostics). */
  private errorCount = 0;

  get errorBoundaryCount(): number {
    return this.errorCount;
  }

  /** §19: true while the drain is finishing the backlog a pause caught. */
  isDrainingBacklog(): boolean {
    return this.drain.isDrainingBacklog();
  }

  /** Check every workspace on every screen and correct anything out of place.
   * Full reconciles are safety nets: by default they do not record undo
   * entries, so they can never mask the entry a user action pushed. */
  reconcileAll(reason: string, rememberUndo = false): void {
    if (this.deps.isPaused() || this.suspended || this.drag.flowBlocked()) return;
    // §20: the first layout drain waits for the shell's startup to complete;
    // the host nudges us again when it does.
    if (!this.deps.host.isStartupComplete()) return;
    // §6/§11: a released drag is interpreted here, not inside the grab signal.
    this.drag.flushPendingDrops();
    // §7.6/§8: after a user reorder every index moved; re-derive them here,
    // never in the signal handler.
    this.workspaces.flushPendingReorder();
    // §6: a directional move that crossed a screen edge is arrived from here,
    // but only once Mutter has actually put the window on the target screen —
    // `move_to_monitor` is asynchronous and arriving early floats it against the
    // source work area (A106). The arrival is event-driven: `window-entered-
    // monitor` (wired in `startScan`) pushes another lane-2 pass when the move
    // lands, so a pass that still sees the source screen simply leaves the move
    // pending — no retry counter, no private timer.
    this.drag.flushCrossScreen();
    // §24/P2.5: one snapshot of the window map for the whole pass. Both loops
    // below read live fields off each `TrackedWindow`, and no branch reachable
    // from them adds or removes a window (routing, floating and escaping only
    // rewrite a window's own state), so the membership cannot change mid-pass;
    // re-copying the map between the loops was pure allocation.
    const snapshot = [...this.windows.values()];
    // §3/§11: the routing decision is a property of the drain, never of the
    // `onReady` timeout: the newcomer's placement is computed here from live
    // state, so a raced spawn signal cannot leave the layout half-decided.
    for (const tracked of snapshot) {
      if (!tracked.routePending) continue;
      tracked.routePending = false;
      if (this.windows.has(tracked.id)) this.retiler.routeWindow(tracked);
    }
    // §4/§16: fullscreen and user-unmaximize transitions are re-derived here,
    // never acted on inside the Mutter signal handler that reported them.
    for (const tracked of snapshot) {
      if (tracked.surface.flags.fullscreen !== tracked.fullscreenApplied) {
        tracked.fullscreenApplied = tracked.surface.flags.fullscreen;
        this.retiler.fullscreenTracked(tracked, tracked.fullscreenApplied);
      }
      if (tracked.unmaximizeRequested) {
        tracked.unmaximizeRequested = false;
        this.retiler.unmaximizeTracked(tracked);
      }
      if (tracked.userMovedTo !== null) {
        const to = tracked.userMovedTo;
        tracked.userMovedTo = null;
        const others = this.tileablesOnScreen(to, tracked.surface.screenId, tracked.id);
        // §6/§34: a user move onto a full workspace floats the window there;
        // the destination keeps its pair and nobody is evicted.
        if (others.length >= 2) this.retiler.floatWindow(tracked);
      }
    }
    const count = global.workspace_manager.get_n_workspaces();
    const seen = new Set<number>();
    for (let index = 0; index < count; index++) {
      seen.add(index);
      this.retile(index, reason, true, rememberUndo);
    }
    // A window can briefly report a workspace beyond the current count.
    for (const tracked of snapshot) {
      if (!seen.has(tracked.surface.workspaceId)) this.retile(tracked.surface.workspaceId, reason, true, rememberUndo);
    }
    // Keep every window inside its own monitor's full geometry (the whole
    // surface, not the work area) — a property of the pass, not a reaction to
    // the move that put it out of bounds.
    this.selfHeal.clampToScreen();
    this.deps.onModelEvent?.('layout', { reason });
    this.deps.onStateChanged();
  }

  retileAll(reason: string, rememberUndo = false): void {
    this.reconcileAll(reason, rememberUndo);
  }

  /** Compute and apply the plan for every monitor of one workspace (§6). */
  retile(workspaceId: number, reason: string, animate = true, rememberUndo = true): void {
    this.retiler.retile(workspaceId, reason, animate, rememberUndo);
  }

  tileables(workspaceId: number): TrackedWindow[] {
    const out: TrackedWindow[] = [];
    for (const tracked of this.windows.values()) {
      if (tracked.surface.workspaceId !== workspaceId) continue;
      if (tracked.surface.flags.minimized) continue;
      // A window that has not finished opening is not yet part of a pair: its
      // routing (and the side it takes) has not been decided. Tiling it early
      // is the race that let a pair form swapped (§3, §20 adoption).
      if (!tracked.ready) continue;
      // §16: an escaped window owns its workspace at its own size; it is not
      // tiled and the lone law does not maximize it.
      if (tracked.escaped) continue;
      // §3/§11: a newcomer whose placement has not been decided is not tiled.
      if (tracked.routePending) continue;
      if (this.classify(tracked).tileable) out.push(tracked);
    }
    return out.sort((a, b) => a.id - b.id);
  }

  /**
   * §3/P4: the tiles of `workspaceId` that live on screen `screen`, in
   * `tileables` order. `excludeId` drops one window (the caller is counting the
   * rest of a pair); the default -1 matches no real id, so a caller that wants
   * the whole on-screen set simply omits it.
   */
  private tileablesOnScreen(workspaceId: number, screen: number, excludeId = -1): TrackedWindow[] {
    return this.tileables(workspaceId).filter((t) => t.id !== excludeId && t.surface.screenId === screen);
  }

  nonTransient(workspaceId: number): TrackedWindow[] {
    return this.tileables(workspaceId).filter((t) => !t.surface.flags.transient);
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

  /**
   * §6/§17 focus cycle: the managed windows of the current screen and
   * workspace in slot order, then the floats left to right (a perfect overlap
   * resolves by stacking order), minimized skipped, wrapping. It never crosses
   * a screen or a workspace; focusing a float raises it.
   */
  focusCycle(): void {
    this.focusController.focusCycle();
  }

  /** §13: keyboard move toward the sibling toggles the swap flag. */
  moveToward(direction: string): void {
    const current = this.focused();
    if (current === null) return;
    const peers = this.tileablesOnScreen(current.surface.workspaceId, current.surface.screenId);
    if (peers.length === 2) {
      const sibling = peers.find((t) => t.id !== current.id);
      if (sibling === undefined) return;
      const horizontal = direction === 'left' || direction === 'right';
      // §1/§6: the axis is the focused screen's own — a portrait screen (or a
      // vertical workspace layout) stacks, so up/down toggle its swap.
      const splitHorizontal = this.axisFor(current.surface.screenId) === 'horizontal';
      if (horizontal === splitHorizontal) {
        this.captureChange([current.id, sibling.id]);
        this.deps.tiling.toggleSwap(current.id, sibling.id);
        this.swapPairSides(current, sibling);
        this.signatures.clearAll();
        this.deps.history.log('swap', { a: current.id, b: sibling.id });
        this.retile(current.surface.workspaceId, 'swap');
        return;
      }
    }
    this.drag.moveToAdjacentMonitor(current, direction);
  }

  toggleFloat(id: number): boolean {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return false;
    const floating = !tracked.surface.flags.floating;
    // §21: un-floating when both slots are taken changes nothing and toasts.
    if (!floating) {
      const others = this.tileablesOnScreen(tracked.surface.workspaceId, tracked.surface.screenId, id);
      if (others.length >= 2) {
        this.deps.onNotice?.('un-float-full', String(id));
        return false;
      }
    }
    this.capturePlane([tracked.surface.workspaceId], tracked.surface.screenId);
    tracked.autoFloated = false;
    tracked.surface.setFloating(floating);
    this.deps.host.applyLayer(id, floating ? Layer.FLOATING : Layer.TILED);
    // §12: the float key floats this window for the session. The durable
    // per-app decision is `neverTile`, set through the registry (prefs, the
    // `SetNeverTile` trigger) or, when the user opts in, by this toggle.
    if (this.deps.settings.boolean('float-persistence', false)) {
      this.deps.registry.setNeverTile(tracked.appKey, floating);
    }
    tracked.invalidateClassification();
    this.deps.history.log('float_toggle', { id, floating });
    this.signatures.clearAll();
    this.scheduleRetile(tracked.surface.workspaceId, 'float');
    return floating;
  }

  /** §12: set the durable neverTile decision and float/un-float live windows. */
  setNeverTile(appId: string, value: boolean): boolean {
    if (appId.length === 0) return false;
    this.deps.registry.setNeverTile(appId, value);
    for (const tracked of [...this.windows.values()]) {
      if (tracked.appKey !== appId) continue;
      if (value && !tracked.surface.flags.floating) {
        this.retiler.floatWindow(tracked);
      } else if (!value && (tracked.surface.flags.floating || tracked.autoFloated)) {
        tracked.autoFloated = false;
        tracked.surface.setFloating(false);
        this.deps.tiling.noteSelfApply();
        this.deps.host.applyLayer(tracked.id, Layer.TILED);
        tracked.invalidateClassification();
      }
    }
    this.signatures.clearAll();
    this.scheduleReconcile('never-tile');
    return true;
  }

  /** §12: forget an app entry; its live windows return to the tiling. */
  forgetApp(appId: string): boolean {
    const removed = this.deps.registry.forget(appId);
    for (const tracked of [...this.windows.values()]) {
      if (tracked.appKey !== appId) continue;
      if (tracked.surface.flags.floating && !tracked.autoFloated) {
        tracked.surface.setFloating(false);
        this.deps.tiling.noteSelfApply();
        this.deps.host.applyLayer(tracked.id, Layer.TILED);
        tracked.invalidateClassification();
      }
    }
    this.signatures.clearAll();
    this.scheduleReconcile('forget-app');
    return removed;
  }

  /** §13: capture the pair's current configuration before a user ratio change. */
  capturePairChange(a: number, b: number): void {
    this.undoCoordinator.capturePairChange(a, b);
  }

  /**
   * §13 Undo: revert the one change — every instance's workspace, slot, rect,
   * maximized and floating state, plus the ratios. Everything is validated
   * before anything is applied; an impossible undo is announced and changes
   * nothing.
   */
  undo(): boolean {
    return this.undoCoordinator.undo();
  }

  /** Capture every tiled window on the given workspaces of one screen. */
  private capturePlane(workspaceIds: readonly number[], screenId: number): void {
    this.undoCoordinator.capturePlane(workspaceIds, screenId);
  }

  /** Snapshot the current configuration of `ids` as the single undo change. */
  private captureChange(ids: readonly number[], workspaceOverride?: number): void {
    this.undoCoordinator.captureChange(ids, workspaceOverride);
  }

  /** The slot a window holds: its pin, else read from its rect and screen axis. */
  private slotFor(tracked: TrackedWindow): 0 | 1 | null {
    if (tracked.pendingSlot !== null) return tracked.pendingSlot;
    if (tracked.surface.flags.maximized || tracked.surface.flags.floating) return null;
    const screen = this.screenFor(tracked.surface.screenId);
    if (screen === null) return null;
    const axis = this.axisFor(tracked.surface.screenId);
    const area = screen.workArea ?? screen.geometry;
    const span = axis === 'vertical' ? area.height : area.width;
    if (span <= 0) return null;
    const rect = tracked.surface.frame;
    const start =
      (axis === 'vertical' ? rect.y - area.y : rect.x - area.x) +
      (axis === 'vertical' ? rect.height : rect.width) / 2;
    if (Math.abs(start - span / 2) < span * 0.1) return null;
    return start < span / 2 ? 0 : 1;
  }

  /** Test hook: mark a window "always on top" (it must still be tiled). */
  simulateAbove(id: number): boolean {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return false;
    tracked.win.make_above();
    tracked.invalidateClassification();
    this.signatures.clearAll();
    this.scheduleRetile(tracked.surface.workspaceId, 'simulate-above');
    return true;
  }

  /** Test hook: pretend the surface cache already saw a workspace change, the
   * way a `refresh()` during an overview drag would. */
  markWorkspaceCached(id: number, index: number): boolean {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return false;
    tracked.surface.workspaceId = index;
    return true;
  }

  /**
   * Which way the focused screen's pair splits, exactly as the tiler and the
   * placement model compute it: vertical workspaces (`layout_rows === -1`) or a
   * portrait screen stack top/bottom, everything else splits side by side
   * (§1, §6). Reading it per screen (never globally) is what lets a mixed
   * landscape + portrait session re-slot a window on the axis of the screen it
   * lands on.
   */
  tileAxis(): 'vertical' | 'horizontal' {
    const focused = this.focused();
    if (focused !== null) return this.axisFor(focused.surface.screenId);
    const screens = this.deps.host.screens();
    const anchor = screens.find((screen) => screen.isPrimary) ?? screens[0];
    return anchor === undefined ? 'horizontal' : this.axisFor(anchor.index);
  }

  /** Test hook: set the workspace orientation the way Vertical Workspaces does. */
  simulateWorkspaceOrientation(vertical: boolean): boolean {
    try {
      global.workspace_manager.override_workspace_layout(
        Meta.DisplayCorner.TOPLEFT,
        false,
        vertical ? -1 : 1,
        vertical ? 1 : -1,
      );
      this.signatures.clearAll();
      this.retileAll('orientation', false);
      return true;
    } catch {
      return false;
    }
  }

  /** Test hook: reorder workspaces the way the overview does (the trigger that
   * used to send the exile policy into an unbounded loop). */
  simulateWorkspaceReorder(from: number, to: number): boolean {
    const manager = global.workspace_manager;
    const workspace = manager.get_workspace_by_index(from);
    if (workspace === null || to < 0 || to >= manager.get_n_workspaces()) return false;
    manager.reorder_workspace(workspace, to);
    return true;
  }

  /** Test hook: make a window genuinely sticky (pinned to every workspace). */
  simulateSticky(id: number, sticky: boolean): boolean {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return false;
    try {
      if (sticky) tracked.win.stick();
      else tracked.win.unstick();
    } catch {
      return false;
    }
    tracked.surface.refresh();
    tracked.invalidateClassification();
    this.signatures.clearAll();
    this.retileAll('sticky', false);
    return true;
  }

  /** Toggle fullscreen on the focused window (customisable keybinding). */
  toggleFullscreen(id: number): boolean {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return false;
    this.deps.tiling.cancel(id);
    if (tracked.win.is_fullscreen()) tracked.win.unmake_fullscreen();
    else tracked.win.make_fullscreen();
    this.signatures.clearAll();
    this.scheduleRetile(tracked.surface.workspaceId, 'fullscreen');
    return true;
  }

  /** Close the focused window (customisable keybinding). */
  closeFocused(): boolean {
    const focused = this.focused();
    if (focused === null) return false;
    // A popup must never reach `delete()` (Mutter has no `close` vfunc for it);
    // refusing it in `register()` should make this unreachable, but the guard is
    // cheap and this is the path that crashed the live Shell.
    if (compat.isPopupWindow(focused.win)) return false;
    focused.win.delete(global.get_current_time());
    return true;
  }

  /**
   * §17: the keyboard workspace move is the only keyboard way a window changes
   * workspace. A move onto a full workspace floats there; `follow-moved-window`
   * decides whether the view follows. A screen with only one workspace has no
   * target, so the request is announced rather than silently ignored.
   */
  moveFocusedToWorkspace(index: number): boolean {
    const current = this.focused();
    if (current === null) return false;
    const manager = global.workspace_manager;
    const count = manager.get_n_workspaces();
    if (count <= 1) {
      this.deps.onNotice?.('cannot-move-workspace', 'one-workspace');
      return false;
    }
    if (index < 0 || index >= count || index === current.surface.workspaceId) return false;
    const from = current.surface.workspaceId;
    // §13: a user workspace move is the change undo will revert, on both planes.
    this.capturePlane([from, index], current.surface.screenId);
    this.noteSelfEcho(current.id, { workspace: index });
    this.deps.tiling.noteSelfApply();
    this.deps.onWindowMoving();
    this.deps.host.applyWorkspace(current.id, index);
    current.surface.workspaceId = index;
    current.lastWorkspaceIdx = index;
    current.escaped = false;
    current.pendingSlot = null;
    this.deps.history.log('ws_switch_empty', { id: current.id, from, to: index, byUser: true });
    const others = this.tileablesOnScreen(index, current.surface.screenId, current.id);
    if (others.length >= 2) this.retiler.floatWindow(current);
    else if (others.length === 1) this.retiler.pinSlots(index, current, index > from ? 0 : 1);
    if (this.deps.settings.boolean('follow-moved-window', true)) {
      this.instantSwitch(() => this.activateWorkspace(index));
    }
    this.signatures.clearAll();
    this.scheduleReconcile('move-workspace-key');
    return true;
  }

  moveFocusedToAdjacentWorkspace(direction: 'next' | 'prev'): boolean {
    const current = this.focused();
    if (current === null) return false;
    const step = direction === 'next' ? 1 : -1;
    return this.moveFocusedToWorkspace(current.surface.workspaceId + step);
  }

  /** §17: nudge the focused pair's shared edge; a no-op request toasts. */
  nudgeFocused(direction: string, step: number): boolean {
    const focused = this.focused();
    if (focused === null) return false;
    const sibling = this.pairSibling(focused);
    if (!this.deps.tiling.nudgeSplit(focused.id, direction, step)) {
      this.deps.onNotice?.('nothing-to-nudge', String(focused.id));
      return false;
    }
    if (sibling !== null) this.captureChange([focused.id, sibling.id]);
    this.signatures.clearAll();
    this.scheduleReconcile('nudge');
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
    this.drain.destroy();
    for (const id of this.timeoutSources) GLib.source_remove(id);
    this.timeoutSources.clear();
    this.selfEcho.clear();
    this.drag.destroy();
    this.windows.clear();
  }

  private addTimeout(ms: number, cb: () => void): void {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, ms), () => {
      this.timeoutSources.delete(id);
      // §Self-heal containment: a session timer callback must never escape the
      // GLib source dispatch uncaught.
      this.guard('session-timeout', cb)();
      return GLib.SOURCE_REMOVE;
    });
    this.timeoutSources.add(id);
  }

  classify(tracked: TrackedWindow): ReturnType<TrackedWindow['classify']> {
    // P6e: guard before constructing anything; disabled ⇒ no closure allocated
    // and no clock read. `classify` is hot (per window per pass), so this is
    // the only added cost on the disabled path.
    if (this.deps.probe.enabled) {
      return this.deps.probe.section('classify', () => this.classifyInner(tracked));
    }
    return this.classifyInner(tracked);
  }

  private classifyInner(tracked: TrackedWindow): ReturnType<TrackedWindow['classify']> {
    this.diagnostics.noteClassifyCall();
    // §24 item 1 / Phase 2: a hit is the common case — `tileables`, the focus
    // cycle, `buildPlacementState` and `refreshOcclusion` classify per window —
    // so return the cached answer before building either input. The live-title
    // context is O(n) strings and must not be allocated on a hit.
    const cached = tracked.peekClassification();
    if (cached !== null) return cached;
    this.diagnostics.noteClassifyMiss();
    const config = this.deps.settings.classifierConfig();
    // The context is read only by the heuristic modal check, so build the title
    // list only when the heuristic is enabled; otherwise an empty context yields
    // the identical result without the per-window title walk.
    const context = config.heuristicModalDetect ? this.heuristicContext(tracked.id) : EMPTY_HEURISTIC_CONTEXT;
    return tracked.classify(config, context);
  }

  private heuristicContext(excludeId: number): HeuristicContext {
    const liveTitles: string[] = [];
    for (const tracked of this.windows.values()) {
      if (tracked.id !== excludeId) liveTitles.push(tracked.surface.title);
    }
    return { liveTitles };
  }

  private tilerConfig(): TilerConfig {
    const config = this.deps.settings.tilerConfig(this.deps.tiling.getRatios(), new Set(this.deps.tiling.getSwapPairs()));
    // §1/§6: the pair axis is per screen. A vertical workspace layout
    // (`layout_rows === -1`) forces the stack; otherwise leave `workspaceAxis`
    // unset so the tiler falls back to the monitor's own orientation (a portrait
    // screen stacks, a landscape one splits side by side). Setting it to
    // `horizontal` here would override the portrait fallback.
    const rows = global.workspace_manager.layout_rows;
    return rows === -1 ? { ...config, workspaceAxis: 'vertical' } : config;
  }

  /**
   * §9/P2.6: resolve a screen by index through the host's maintained index
   * (built once per screen change) instead of scanning the screen list on
   * every window of the clamp/reconcile/sweep paths. A missing index still
   * resolves to `null`, so every caller's fallback is unchanged.
   */
  private screenFor(index: number): Screen | null {
    return this.deps.host.screenByIndex(index);
  }

  /**
   * §4/§5: minimize releases the slot; the pure reaper relocates a workspace
   * left holding only minimized windows. A window restored onto a full
   * workspace floats (§6).
   */
  private onMinimized(tracked: TrackedWindow): void {
    this.deps.tiling.cancel(tracked.id);
    if (!tracked.surface.flags.minimized) {
      // A window adrt floated itself gets its float rect back; it is not a tile.
      if (tracked.autoFloated) {
        tracked.surface.refresh();
        this.retiler.floatWindow(tracked);
        this.deps.onStateChanged();
        return;
      }
      const others = this.tileablesOnScreen(tracked.surface.workspaceId, tracked.surface.screenId, tracked.id);
      // §10 step 4: restoring makes this window the trigger. If a peer refuses
      // to share (it does not fit its half), the trigger keeps the screen
      // maximized and the peer gives way, and the two trade on each restore.
      const refuses = others.some((o) => this.retiler.doesNotFit(o, this.retiler.placementEnv(o.surface.screenId)));
      if (refuses) {
        this.retiler.maximizeInPlace(tracked);
        return;
      }
      // §6: restoring onto a workspace whose two slots are taken floats.
      if (others.length >= 2) {
        this.retiler.floatWindow(tracked);
        return;
      }
      this.scheduleRetile(tracked.surface.workspaceId, 'unminimize');
      return;
    }
    this.deps.onModelEvent?.('window-minimized', { id: tracked.id, workspace: tracked.surface.workspaceId });
    this.scheduleRetile(tracked.surface.workspaceId, 'minimize');
    this.workspaces.schedulePrune();
  }

  /**
   * `Main.wm._workspaceAnimation`, a private Shell field; read through one
   * structural view because `wm` has no public type (§23.2).
   */
  private workspaceAnimation(): SwitchAnimationController | null {
    const controller = (wm as { _workspaceAnimation?: SwitchAnimationController | null })._workspaceAnimation;
    return controller ?? null;
  }

  /**
   * Run a programmatic workspace change with the switch animation suppressed.
   * Mutter draws *clones* of every window during that slide, each carrying the
   * window's shadow, so a window we are moving looks like it casts a shadow of
   * itself. Our own slides are instant instead; the user's switches keep their
   * animation.
   */
  private instantSwitch(fn: () => void): void {
    const controller = this.workspaceAnimation();
    const original = controller?.animateSwitch;
    if (controller === null || typeof original !== 'function') {
      fn();
      return;
    }
    // A switch animation already in flight would leave its clone groups on
    // screen (the doubled/frozen view); tear it down before we move.
    try {
      if (typeof controller.cancelSwitchAnimation === 'function') controller.cancelSwitchAnimation();
    } catch {
      /* private API changed: carry on */
    }
    controller.animateSwitch = function (_from: unknown, _to: unknown, _direction: unknown, onComplete: unknown) {
      if (typeof onComplete === 'function') onComplete();
    };
    try {
      fn();
    } finally {
      this.addTimeout(SWITCH_ANIMATION_PATCH_MS, () => {
        controller.animateSwitch = original;
      });
    }
  }

  private recenterModal(tracked: TrackedWindow): void {
    // §16: a dialog floats, is centred on its parent and raised.
    try {
      tracked.win.raise();
    } catch (error) {
      // The dialog is gone; centring is skipped but the failed raise is worth a
      // diagnostic (the fallback below still runs).
      this.deps.history.log('error', { reason: 'recenter-modal-raise', id: tracked.id, error: this.errorText(error) });
    }
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
    // §10: the screen is read fresh; never a hard-coded geometry.
    const screen = this.screenFor(tracked.surface.screenId);
    if (screen === null) return;
    this.deps.tiling.applyFrame(tracked, rect, screen, false, 'modal-center', 0);
  }

  private connectWindow(tracked: TrackedWindow): void {
    const win = tracked.win;
    const handlers: WindowSignal[] = [];
    const on = (signal: string, cb: (...args: unknown[]) => void) => {
      handlers.push({ id: win.connect(signal, this.guard(`window:${signal}`, cb)) });
    };

    on('notify::title', () => this.onFlagSignal(tracked, true));
    on('notify::wm-class', () => {
      // §12: the identity chain can change once wm_class arrives; re-resolve and
      // re-key the registry entry before the classification is rebuilt.
      tracked.surface.refresh();
      if (tracked.ready) this.resolveTrackedIdentity(tracked);
      this.onFlagSignal(tracked, true);
    });
    on('notify::skip-taskbar', () => this.onFlagSignal(tracked, true));
    on('notify::transient-for', () => this.onFlagSignal(tracked, true));
    on('notify::above', () => this.onFlagSignal(tracked, true));
    on('notify::fullscreen', () => {
      // §11: no policy in a signal handler; the drain reconciles the transition.
      tracked.surface.refresh();
      this.scheduleReconcile('fullscreen');
    });
    on('notify::window-type', () => this.onFlagSignal(tracked, true));
    on('notify::minimized', () => {
      tracked.surface.refresh();
      this.onMinimized(tracked);
    });
    on('notify::mapped', () => this.onFlagSignal(tracked, true));
    on('notify::maximized-vertically', () => this.onMaximizeSignal(tracked));
    on('notify::maximized-horizontally', () => this.onMaximizeSignal(tracked));
    on('position-changed', () => this.drag.onFrameSignal(tracked));
    on('size-changed', () => this.drag.onFrameSignal(tracked));
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

  /**
   * §11/§16: record that *we* are about to change a window's maximize or
   * workspace state. Mutter emits the matching signal asynchronously, so the
   * expected value is kept with a monotonic timestamp instead of a synchronous
   * boolean that would already be cleared when the signal arrives.
   */
  private noteSelfEcho(id: number, expected: { maximized?: boolean; workspace?: number }): void {
    const now = GLib.get_monotonic_time();
    const echo = this.selfEcho.get(id) ?? { maximizeAtUs: 0, maximized: false, workspaceAtUs: 0, workspace: -1 };
    if (expected.maximized !== undefined) {
      echo.maximizeAtUs = now;
      echo.maximized = expected.maximized;
    }
    if (expected.workspace !== undefined) {
      echo.workspaceAtUs = now;
      echo.workspace = expected.workspace;
    }
    this.selfEcho.set(id, echo);
  }

  /** True while `id` has an unexpired echo matching the reported change. */
  private hasSelfEcho(id: number, match: { maximized?: boolean; workspace?: number }): boolean {
    const echo = this.selfEcho.get(id);
    if (echo === undefined) return false;
    const now = GLib.get_monotonic_time();
    let matched = false;
    if (match.maximized !== undefined && echo.maximizeAtUs !== 0) {
      if (now - echo.maximizeAtUs > SELF_APPLY_MS * 1000) echo.maximizeAtUs = 0;
      else if (echo.maximized === match.maximized) matched = true;
    }
    if (match.workspace !== undefined && echo.workspaceAtUs !== 0) {
      if (now - echo.workspaceAtUs > SELF_APPLY_MS * 1000) echo.workspaceAtUs = 0;
      else if (echo.workspace === match.workspace) matched = true;
    }
    if (echo.maximizeAtUs === 0 && echo.workspaceAtUs === 0) this.selfEcho.delete(id);
    return matched;
  }

  /**
   * §4/§11: record that *we* are about to unmaximize `id` (the tiler calls this
   * through its deps before its own `applyFrame` unmaximize). The echo must
   * outlive the call: Mutter emits the matching signal asynchronously.
   */
  noteSelfUnmaximize(id: number): void {
    this.noteSelfEcho(id, { maximized: false });
  }

  /**
   * §4/§11: run one of our own unmaximizes. The echo must outlive the call:
   * Mutter emits the matching signal asynchronously, so the transient boolean
   * this replaced was already false when the signal arrived.
   */
  private withSelfUnmaximize(tracked: TrackedWindow, fn: () => void): void {
    this.noteSelfUnmaximize(tracked.id);
    fn();
  }

  private onMaximizeSignal(tracked: TrackedWindow): void {
    if (!tracked.ready) return;
    tracked.surface.refresh();
    // §11: a Mutter signal records the intent; the drain re-derives the state
    // and applies it (the A45 pattern). An unmaximize we caused (`withSelfUnmaximize`,
    // or the tiler's own unmaximize in `applyFrame`) must not drive the ladder.
    if (compat.isMaximized(tracked.win)) {
      // A maximize we caused — the lone law, a routed arrival, the coherence
      // sweep, a display replay — is not a user request, so it must not drive
      // the §4 exile ladder. Only *maximizes* mark this clock: a tile apply
      // must never swallow a real user maximize (A04/S04; the previous
      // `lastApplyAtMs` guard did exactly that).
      if (Date.now() - this.deps.tiling.selfMaximizeAtMs < SELF_APPLY_MS) return;
      tracked.maximizeRequested = true;
      this.scheduleReconcile('maximize');
      return;
    }
    if (this.hasSelfEcho(tracked.id, { maximized: false })) {
      this.scheduleReconcile('self-unmaximize');
      return;
    }
    tracked.maximizeRequested = false;
    tracked.unmaximizeRequested = true;
    this.scheduleReconcile('unmaximize');
  }

  private onWorkspaceSignal(tracked: TrackedWindow): void {
    if (!tracked.ready) return;
    const workspace = tracked.win.get_workspace();
    if (workspace === null) return;
    const index = workspace.index();
    // Our own workspace move (`noteSelfEcho`): match the index we applied. The
    // old `suppress` set was already empty by the time this signal arrived.
    if (this.hasSelfEcho(tracked.id, { workspace: index })) return;
    // Compare against the index WE last recorded, not `surface.workspaceId`:
    // `refresh()` copies the live workspace into the surface at every frame, so
    // by the time this signal arrives the cached value can already be the new
    // one — and the change would be missed entirely (the overview-drag case).
    const from = tracked.lastWorkspaceIdx;
    if (index === from) return;
    // §13: the user's move is the change undo reverts, captured on its origin.
    this.captureChange([tracked.id], from);
    tracked.surface.workspaceId = index;
    tracked.lastWorkspaceIdx = index;
    // A user move takes the window back into the ordinary tiling.
    tracked.escaped = false;
    tracked.pendingSlot = null;
    // §19.1: remember the user's move so policies leave the window alone.
    tracked.userMovedAtMs = Date.now();
    this.deps.history.log('ws_switch_empty', { id: tracked.id, from, to: index, byUser: true });
    this.signatures.clearAll();
    // §3: a workspace move keeps the side it came from — a window from the
    // workspace on its left takes slot 0, from the right slot 1.
    const others = this.tileablesOnScreen(index, tracked.surface.screenId, tracked.id);
    if (others.length === 1) {
      tracked.pendingSlot = index > from ? 0 : 1;
      others[0].pendingSlot = tracked.pendingSlot === 0 ? 1 : 0;
    }
    // §11: no policy in a signal handler. The arrival (a no-room float when the
    // destination is full) is applied from the drain.
    tracked.userMovedTo = index;
    this.scheduleReconcile('workspace-changed');
  }

  /**
   * §35: periodic coherence guarantee. A normal (non-floating, non-modal)
   * window on a workspace with a sibling must be tiled. If one was left untiled
   * — a refused apply, a missed signal, a `stubborn` record — push the plan
   * through, clearing the refusal bookkeeping so it is retried.
   */
  coherenceSweep(): void {
    this.selfHeal.coherenceSweep();
  }

  /** How many periodic coherence sweeps have run (diagnostics). */
  coherenceSweepCount(): number {
    return this.diagnostics.coherenceSweepCount();
  }

  /** How many corrections the sweeps have made (diagnostics). */
  coherenceFixCount(): number {
    return this.diagnostics.coherenceFixCount();
  }

  /**
   * Stage 0 counters (PERFORMANCE_PLAN.md). They exist only to be observed:
   * no decision anywhere reads them.
   */
  counters(): SessionCounters {
    return this.diagnostics.counters(this.drain.pending, this.errorCount);
  }

  /** §21: bounded state assertion. */
  memoryBounds(): { windows: number; sources: number; signals: number } {
    let signalCount = 0;
    for (const handlers of this.signals.values()) signalCount += handlers.length;
    return { windows: this.windows.size, sources: this.drain.pending > 0 ? this.drain.armedCount() : 0, signals: signalCount };
  }

  /** §21: retile timings for the perf event. */
  perf(): SessionPerf {
    return this.diagnostics.perf();
  }

  /**
   * §6/§17/§58: focus by direction, positional, never crossing a workspace. A
   * direction with nothing that way stays silent — that is the single exception
   * to "a request that changes nothing toasts".
   */
  focusDirection(direction: string): void {
    this.focusController.focusDirection(direction);
  }
}
