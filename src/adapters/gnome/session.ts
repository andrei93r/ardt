// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Window lifecycle and workspace policy (§7, §9.4, §14, §16, §17).
 * Owns the one `Map<number, TrackedWindow>` and every per-window signal.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import { wm } from 'resource:///org/gnome/shell/ui/main.js';

import type { HeuristicContext } from '../../core/classify.js';
import { classifyAdjust } from '../../core/adjust.js';
import type { AdjustMode } from '../../core/adjust.js';
import { EventQueue } from '../../core/queue.js';
import { centreInWorkArea } from '../../core/cursor.js';
import type { DisplayMove, DisplayState, DisplayWorkspace, MemoryEntry, NewWorkspace } from '../../core/displays.js';
import { displayPlan } from '../../core/displays.js';
import { normalizePlan } from '../../core/normalize.js';
import type { NormalizeWindow } from '../../core/normalize.js';
import {
  dropPlacement, escapeSize, impossibleSplit, maximizeWindow, refusalLadder, routeNewWindow,
  swappedSides, unmaximizeWindow, windowCount,
} from '../../core/placement.js';
import type { Axis, Env, Placement, ScreenClass, State, Win, Ws } from '../../core/placement.js';
import { dragOutcome } from '../../core/drag.js';
import type { DragOutcome } from '../../core/drag.js';
import { reapPlan } from '../../core/workspaces.js';
import type { Change, ChangeLog, InstanceConfig, LiveInstance } from '../../core/undo.js';
import { validateChange } from '../../core/undo.js';

/** §10: how long a maintenance pass waits for the surface to settle (struts are
 * set asynchronously by the Shell; internal safety, not a frame cadence). */
const MAINTENANCE_SETTLE_MS = 200;
import { checkPlan } from '../../core/invariants.js';
import { SignatureCache, planSignature, shouldApplyPlan } from '../../core/scheduler.js';
import type { TilerConfig, TilerWindow } from '../../core/tiler.js';
import { computePlans, ratioKey, resolveGaps, screenArea } from '../../core/tiler.js';
import type { FocusDirection } from '../../core/focus.js';
import { cycleOrder, cycleSequence, pickDirectional } from '../../core/focus.js';
import type { CycleEntry } from '../../core/focus.js';
import { Layer, clampRectToArea, rectEquals } from '../../core/types.js';
import type { Rect, Screen, TilePlan } from '../../core/types.js';
import * as compat from './compat.js';
import type { GnomeHost } from './host.js';
import type { History } from './history.js';
import { instanceIdFor, resolveWindowIdentity } from './appidentity.js';
import type { RegistryStore } from './registry.js';
import type { GnomeSettings } from './settings.js';
import type { GnomeTiming } from './timing.js';
import type { Tiling } from './tiling.js';
import { TrackedWindow } from './tracked-window.js';

export interface SessionDeps {
  host: GnomeHost;
  settings: GnomeSettings;
  /** §11.3/§18: OS animation state and per-screen frame interval. */
  timing: GnomeTiming;
  tiling: Tiling;
  history: History;
  registry: RegistryStore;
  changes: ChangeLog;
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

/** Quiet period after the last user frame change before a drop is interpreted
 * (internal signal-latency guard, not a frame cadence). */
const ADJUST_SETTLE_MS = 150;
/**
 * A maximize/unmaximize signal that arrives within this window of a state
 * change we made (`noteSelfApply`) is our own, not the user's: a signal is
 * emitted asynchronously, so a boolean flag around the call is not enough.
 */
const SELF_APPLY_MS = 200;
/**
 * A drag whose release never arrived must not disable tiling forever: every
 * path (reconcile, sweep, periodic retile) skips while `dragging` is set. A
 * lost `grab-op-end` — an overview drag, a Shell restart, a grab taken over by
 * another actor — would otherwise freeze the layout until the next real drag.
 */
const DRAG_STALE_MS = 2500;
/** Delay before a maintenance sweep, so a burst of signals coalesces. */
const SWEEP_DELAY_MS = 150;
/** How long the switch-animation patch stays installed, then it is restored. */
const SWITCH_ANIMATION_PATCH_MS = 400;
/** Two settle passes after an action, so reaping sees the final state. */
const PRUNE_FIRST_MS = 300;
const PRUNE_SECOND_MS = 900;
/** Ignore plan-mismatch re-applies for this long after Undo (internal). */
const MISMATCH_SUPPRESSION_MS = 4000;
/** Backoff before re-trying a lone-window maximize the same window refused. */
const COHERENCE_RETRY_MS = 3000;
export class WindowSession {
  readonly windows = new Map<number, TrackedWindow>();
  private readonly signals = new Map<number, WindowSignal[]>();
  private readonly signatures = new SignatureCache();
  private readonly suppress = new Set<number>();
  /**
   * §11: one scheduling path. Every signal handler pushes here; a single
   * deferred drain runs the policy, in lane order, with per-key coalescing.
   * Lane 2 (layout) is armed on the compositor's resize later, lane 3
   * (maintenance) on idle; both are removed as soon as the drain runs.
   */
  private readonly queue = new EventQueue();
  /** §12: monotonic sequence for provisional `window:<seq>` identity keys. */
  private windowSeq = 0;
  /** §9: display memory keyed by connector, plus the previous screen list. */
  private displayMemory: MemoryEntry[] = [];
  private lastScreens: Screen[] | null = null;
  /** Re-queued layout passes waiting for an animation to finish. */
  private drainDeferrals = 0;
  /** §19: set while the drain finishes the backlog a pause caught. */
  private drainingBacklog = false;
  private drainArmed: { 1: boolean; 2: boolean; 3: boolean } = { 1: false, 2: false, 3: false };
  private drains = 0;
  private drainMsMax = 0;
  /** §22 perf: bounded samples for p50/p95 of drain and apply latency. */
  private readonly drainSamples: number[] = [];
  private readonly applySamples: number[] = [];
  private static readonly SAMPLE_RING = 256;
  private readonly timeoutSources = new Set<number>();
  private reorderSignal = 0;
  private displaySignals: number[] = [];
  private managerSignals: number[] = [];
  private grabBeginSignal = 0;
  private grabEndSignal = 0;
  private dragging = false;
  /**
   * §6: true while an application drag-and-drop holds the pointer button with
   * no compositor window grab. The client (Chrome tearing a tab off, VS Code
   * dragging a tab or panel, a GTK DnD) is placing its own window; adrt freezes
   * reflow so it neither fights the client nor interprets the gesture as a
   * window move, and routes/reflows once when the interaction ends. This is
   * deliberately **not** the window-move drag state: no `dragId`, no preview,
   * no drop interpretation.
   */
  private clientInteracting = false;
  private dragStartRect: Rect | null = null;
  /** The window being dragged, so the preview overlay can follow it (§6/§11). */
  private dragId: number | null = null;
  /** The plane the drag started on, so the drop can tell a same-plane return
   * from an arrival from another workspace or screen (§6). */
  private dragStartWorkspace = 0;
  private dragStartScreen = 0;
  /** A cross-screen move reported by a directional key; the drain arrives it. */
  private crossScreenFrom: 'left' | 'right' | 'above' | 'below' | null = null;
  private crossScreenId: number | null = null;
  /** The screen the move is heading to; the arrival waits until it lands there. */
  private crossScreenTarget: number | null = null;
  /** When the dragged window last changed geometry (stale-drag watchdog). */
  private dragLastActivityMs = 0;
  /** True while a compositor state makes tiling pointless (the overview). */
  private suspended = false;
  /** `org.gnome.mutter`, the authority on the screen classes (§1). */
  private mutterSettings: any = null;
  /** The static workspace count (`org.gnome.desktop.wm.preferences`). */
  private wmPreferencesSettings: any = null;
  private adjustId: number | null = null;
  private adjustSource: number | null = null;
  /**
   * A released drag whose gesture the drain still has to interpret (§6/§11).
   * The rect the gesture started from travels with the intent: `endDrag` clears
   * the shared `dragStartRect` before the deferred drain runs, and an inner-edge
   * resize needs it to tell which edge moved and to derive the new ratio (§10).
   */
  private readonly dropPending = new Map<number, { mode: AdjustMode; start: Rect | null }>();
  /** While set, plan-mismatch re-applies are suppressed (e.g. right after Undo). */
  private ignoreMismatchUntilMs = 0;
  private scanPerfCounter = 0;
  private lastReconcileMs = 0;
  private lastApplyMs = 0;
  private lastApplyAtMs = 0;
  /** Diagnostics (PERFORMANCE_PLAN.md stage 0): counted, never used to decide. */
  private classifyCalls = 0;
  private classifyMisses = 0;
  private plansComputed = 0;
  private sweepFrameReads = 0;
  private sweepMsTotal = 0;
  private sweepMsMax = 0;
  /** Frames the clamp-to-screen pass pulled back inside a monitor. */
  private clampsApplied = 0;
  /**
   * §6/§17: the fixed order of the focus-cycle lap in progress, and the last
   * window it focused. A lap is built once (from the live stacking order) and
   * kept until it wraps or focus changes by another route, so raising a float
   * as it is focused cannot re-order the lap.
   */
  private cycleLap: { workspaceId: number; screenId: number; order: number[]; startId: number; lastId: number } | null = null;

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
    this.reorderSignal = global.workspace_manager.connect('workspaces-reordered', this.guard('workspaces-reordered', () => this.onWorkspacesReordered()));
    // §11.3 / §23.1: never retile or show the border while the user is dragging.
    this.grabBeginSignal = global.display.connect('grab-op-begin', this.guard('grab-op-begin', (_display: any, win: any, op: number) =>
      this.onGrabBegin(win, op),
    ));
    this.grabEndSignal = global.display.connect('grab-op-end', this.guard('grab-op-end', (_display: any, win: any, op: number) =>
      this.onGrabEnd(win, op),
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

  /** §6: an application DnD is in progress (button held, no window grab). */
  get clientInteractionActive(): boolean {
    return this.clientInteracting;
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
    return {
      active: this.isDragging,
      windowDrag: this.dragging || this.adjustId !== null,
      clientInteraction: this.clientInteracting,
      dragId: this.dragId,
      adjustId: this.adjustId,
      button: compat.button1Pressed(),
      displayGrab: compat.displayGrabActive(),
    };
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
    // A real Meta grab supersedes a client-interaction freeze: the move is now
    // adrt's to follow and its drop to interpret.
    this.clientInteracting = false;
    this.dragging = true;
    this.dragId = id;
    this.dragLastActivityMs = Date.now();
    this.dragStartRect = { ...tracked.surface.frame };
    this.dragStartWorkspace = tracked.surface.workspaceId;
    this.dragStartScreen = tracked.surface.screenId;
    this.deps.onDragChanged(true);
    return true;
  }

  /**
   * A drag that never reported its release (a lost `grab-op-end`) disables every
   * tiling path, so it is abandoned once it has been quiet for a while and no
   * mouse button is held — the same test `isUserChange` uses to tell a user move
   * from one of our own applies. The drop is deliberately not interpreted: a
   * gesture we never saw the end of must not swap or resize anything.
   */
  private dragIsStale(): boolean {
    if (!this.dragging) return false;
    if (Date.now() - this.dragLastActivityMs < DRAG_STALE_MS) return false;
    return compat.button1Pressed() === false;
  }

  private abandonDrag(reason: string): void {
    this.dragging = false;
    this.dragId = null;
    this.dragLastActivityMs = 0;
    this.dragStartRect = null;
    this.deps.onDragChanged(false);
    this.deps.history.log('drag_abandoned', { reason });
    this.signatures.clearAll();
    this.reconcileAll('drag-abandoned', false);
  }

  /**
   * Drag released. §11: the signal handler only records the intent; the drain
   * interprets the gesture. - §12 inner-edge resize of a pair saves the new
   * split ratio; - §6 dragging one window past another swaps, takes a free
   * slot, or floats; - otherwise the workspace simply reflows.
   */
  endDrag(id: number): boolean {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return false;
    const wasDragging = this.dragging;
    this.dragging = false;
    this.clientInteracting = false;
    this.dragId = null;
    this.dragLastActivityMs = 0;
    this.deps.onDragChanged(false);
    if (!wasDragging) return true;

    tracked.refreshFrame();
    this.dropPending.set(id, { mode: this.adjustMode(tracked), start: this.dragStartRect });
    this.dragStartRect = null;
    this.signatures.clearAll();
    this.scheduleReconcile('drag-end');
    return true;
  }

  private pairSibling(tracked: TrackedWindow): TrackedWindow | null {
    const peers = this.tileables(tracked.surface.workspaceId).filter(
      (t) => t.id !== tracked.id && t.surface.screenId === tracked.surface.screenId,
    );
    return peers.length === 1 ? peers[0] : null;
  }

  /** §6/§13: the window was dropped onto its sibling, so the pair trades sides. */
  private applySwapIntent(tracked: TrackedWindow, sibling: TrackedWindow): void {
    this.captureChange([tracked.id, sibling.id]);
    this.deps.tiling.toggleSwap(tracked.id, sibling.id);
    this.swapPairSides(tracked, sibling);
    this.deps.history.log('swap', { a: tracked.id, b: sibling.id, reason: 'drag' });
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
    this.captureChange([tracked.id, sibling.id]);
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
      this.deps.host.applyLayer(tracked.id, Layer.FLOATING, 0);
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
    const siblings = this.tileables(workspaceId).filter(
      (t) => t.id !== tracked.id && t.surface.screenId === tracked.surface.screenId,
    );
    if (compat.isFullyMaximized(tracked.win) && siblings.length > 0) {
      // §16: an app that opens maximized (Nautilus, Files, …) is not a user
      // maximize: it is unmaximized and tiled with its sibling. A user-requested
      // maximize still gets its own workspace through `onMaximizeSignal`.
      this.deps.tiling.noteSelfApply();
      tracked.selfUnmaximize = true;
      try {
        this.deps.host.unmaximize(tracked.id);
      } finally {
        tracked.selfUnmaximize = false;
      }
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
      if (this.mutterSettings === null) this.mutterSettings = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
      dynamic = this.mutterSettings.get_boolean('dynamic-workspaces');
      onlyPrimary = this.mutterSettings.get_boolean('workspaces-only-on-primary');
      // The static workspace count lives in the wm preferences, not mutter.
      if (this.wmPreferencesSettings === null) {
        this.wmPreferencesSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
      }
      numWorkspaces = this.wmPreferencesSettings.get_int('num-workspaces');
    } catch {
      /* keep the defaults: GNOME's dynamic-workspace behaviour */
    }
    if (!dynamic) return numWorkspaces > 1 ? 'fixed' : 'single';
    const screen = this.screenFor(screenId);
    if (onlyPrimary && screen?.isPrimary !== true) return 'single';
    return 'dynamic';
  }

  private placementEnv(screenId: number): Env {
    return { screen: this.screenClass(screenId), axis: this.axisFor(screenId) };
  }

  /** §3: per workspace, the two visible slot occupants plus hidden windows. */
  private buildPlacementState(excludeId: number | null = null): State {
    const manager = global.workspace_manager;
    const count = manager.get_n_workspaces();
    const workspaces: Ws[] = [];
    for (let index = 0; index < count; index++) workspaces.push({ id: index, slots: [null, null], minimized: [], floats: [] });
    for (const tracked of [...this.windows.values()].sort((a, b) => a.id - b.id)) {
      if (tracked.id === excludeId) continue;
      // A newcomer whose placement is still pending holds no slot yet: its
      // routing is derived from live state in the drain (§3/§11).
      if (tracked.routePending) continue;
      const ws = workspaces[tracked.surface.workspaceId];
      if (ws === undefined) continue;
      const rec: Win = {
        id: tracked.id,
        minimized: tracked.surface.flags.minimized,
        floating: tracked.surface.flags.floating || !this.classify(tracked).tileable,
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
  private doesNotFit(tracked: TrackedWindow, env: Env): boolean {
    // When the user has asked us to ignore minimum sizes, nothing is too big to
    // share; the escape is only for a client that insists on its size.
    if (this.deps.settings.string('min-size-policy', 'respect') !== 'respect') return false;
    const screen = this.screenFor(tracked.surface.screenId);
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

  /** §3: route a newly opened window through the pure model, then apply it. */
  private routeWindow(tracked: TrackedWindow): void {
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
    const state = this.buildPlacementState(tracked.id);
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
   * Apply a placement decision to Mutter. The view follows only the app the
   * action is about, and only when the caller says so (§3).
   */
  private applyPlacement(tracked: TrackedWindow, placement: Placement, follow: boolean, reason: string): void {
    const id = tracked.id;
    let workspaceId = placement.workspace;
    if (placement.createRight === true) {
      const created = this.createWorkspaceRight(placement.workspace);
      if (created !== null) workspaceId = created;
    }
    const previous = tracked.surface.workspaceId;
    if (workspaceId !== previous) {
      this.moveWindowToWorkspace(tracked, workspaceId);
      this.deps.history.log('ws_switch_empty', { id, from: previous, to: workspaceId, reason });
    }
    if (placement.float === true) {
      this.floatWindow(tracked);
      if (follow && workspaceId !== previous) this.instantSwitch(() => this.activateWorkspace(workspaceId));
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
      this.instantSwitch(() => this.activateWorkspace(workspaceId));
    }
    this.signatures.clearAll();
    this.scheduleReconcile(`${reason}-settle`);
    // §12: keep the app's placement current for display memory and restarts.
    this.recordPlacement(tracked);
  }

  /** §4: maximize in place, minimizing the other managed windows on this monitor. */
  private maximizeInPlace(tracked: TrackedWindow): void {
    this.deps.tiling.noteSelfApply();
    // Clear the others first, so nothing is left on top of the trigger.
    for (const other of this.tileables(tracked.surface.workspaceId)) {
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
  private pinSlots(workspaceId: number, tracked: TrackedWindow, slot: 0 | 1): void {
    for (const other of this.windows.values()) {
      if (other.surface.workspaceId !== workspaceId) continue;
      if (other.surface.screenId !== tracked.surface.screenId) continue;
      other.pendingSlot = null;
    }
    tracked.pendingSlot = slot;
    const partner = this.tileables(workspaceId).find(
      (t) => t.id !== tracked.id && t.surface.screenId === tracked.surface.screenId,
    );
    if (partner !== undefined) partner.pendingSlot = slot === 1 ? 0 : 1;
  }

  /** §3/§5: unmaximize a maximized window that must share its workspace. */
  private unmaximizeOccupants(workspaceId: number, exceptId: number): void {
    for (const other of this.tileables(workspaceId)) {
      if (other.id === exceptId) continue;
      if (!compat.isMaximized(other.win)) continue;
      this.deps.tiling.noteSelfApply();
      // This is our own unmaximize to let the pair form: mark it so the
      // resulting signal does not run the user unmaximize ladder (A45).
      other.selfUnmaximize = true;
      try {
        this.deps.host.unmaximize(other.id);
      } finally {
        other.selfUnmaximize = false;
      }
    }
  }

  /** §4: minimize or close the maximizer brings the others back. */
  private restoreMinimizedOn(workspaceId: number, screenId: number): void {
    for (const tracked of this.windows.values()) {
      if (tracked.surface.workspaceId !== workspaceId) continue;
      if (tracked.surface.screenId !== screenId) continue;
      if (!tracked.surface.flags.minimized) continue;
      if (!this.classify(tracked).tileable) continue;
      this.deps.tiling.noteSelfApply();
      this.deps.host.unminimize(tracked.id);
    }
  }

  unregister(id: number): void {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return;
    if (this.crossScreenId === id) this.clearCrossScreenMove();
    const workspaceId = tracked.surface.workspaceId;
    const closedRect: Rect = { ...tracked.surface.frame };
    // Only windows we actually tiled get a close ghost; popups, menus,
    // tooltips and other transient surfaces must not flash a border.
    const wasTiled = tracked.lastTarget !== null;
    this.coherenceRetryAt.delete(id);
    // Defensive: a window we floated carries Mutter's "above" flag; drop it as
    // the window goes away so it cannot linger on a recycled surface.
    this.deps.host.clearAbove(id);
    this.disconnectWindow(id);
    this.windows.delete(id);
    this.deps.host.forgetSurface(id);
    if (wasTiled) this.deps.onClosed(id, closedRect);
    this.deps.onModelEvent?.('window-closed', { id });
    this.signatures.clear(`ws:${workspaceId}`);
    this.deps.history.log('close', { id, workspaceId });
    this.deps.onStateChanged();

    this.switchAwayIfEmpty(workspaceId);
    this.evaluateLoneMaximize(workspaceId);
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
    for (let index = 0; index < count; index++) {
      for (const screen of screens) {
        const plane = [...this.windows.values()].filter(
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
              tracked.selfUnmaximize = true;
              try {
                this.deps.host.unmaximize(tracked.id);
              } finally {
                tracked.selfUnmaximize = false;
              }
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
      area -= this.overlapArea(rect, other.surface.frame);
      if (area <= 0) return 0;
    }
    return Math.max(0, area);
  }

  // ---------------------------------------------------------- §9 displays
  /** §9: persisted display memory (keyed by connector). */
  setDisplayMemory(memory: MemoryEntry[]): void {
    this.displayMemory = Array.isArray(memory) ? memory : [];
  }

  getDisplayMemory(): MemoryEntry[] {
    return this.displayMemory;
  }

  /** §9: a screen/work-area change is planned in the layout drain, never in
   * the Mutter signal handler. */
  scheduleDisplayPass(reason: string): void {
    if (this.queue.push(2, 'displays', 'displays', { reason })) this.armDrain(2);
  }

  /** §9 display plan: rescue, replay and primary-change handling. */
  private applyDisplayChange(): void {
    const screens = this.deps.host.screens();
    // `prev` is the arrangement that was on screen *before* this change,
    // rebuilt from the live windows against the previous screen list. Storing a
    // full arrangement snapshot would miss windows that opened since.
    const next = this.buildDisplayState(screens);
    const prev = this.buildDisplayState(this.lastScreens ?? screens);
    const ttlMs = Math.max(1, this.deps.settings.int('display-memory-minutes', 30)) * 60 * 1000;
    const classes: Record<string, ScreenClass> = {};
    for (const screen of screens) classes[screen.connector] = this.screenClass(screen.index);
    let plan;
    try {
      plan = displayPlan(prev, next, this.displayMemory, { now: Date.now(), ttlMs, classes, alive: [...this.windows.keys()] });
    } catch (e) {
      this.deps.history.log('error', { reason: 'display-plan', error: (e as Error).message });
      return;
    }
    if (plan.moves.length > 0 || plan.remember.length > 0 || plan.forget.length > 0) {
      this.deps.history.log('screens_changed', {
        moves: plan.moves.length,
        remember: plan.remember.map((entry) => entry.connector),
        forget: plan.forget,
      });
    }
    // §9: a float's stacking is restored exactly. `floatWindow` raises on apply,
    // so applying the remembered floats bottom-to-top (ascending z) reproduces
    // their relative order; a float with no remembered z keeps its plan order.
    const floats = plan.moves
      .filter((move) => move.float === true && move.z !== undefined)
      .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    const restored = new Set(floats);
    // Every move that shares a `create.key` must land on the SAME created
    // workspace: the group is the pair (or single) the source workspace held, and
    // creating one per move split the pair across two workspaces (A110).
    const createdByKey = new Map<number, number>();
    for (const move of plan.moves) if (!restored.has(move)) this.applyDisplayMove(move, screens, createdByKey);
    for (const move of floats) this.applyDisplayMove(move, screens, createdByKey);
    for (const entry of plan.remember) {
      const at = this.displayMemory.findIndex((candidate) => candidate.connector === entry.connector);
      if (at >= 0) this.displayMemory[at] = entry;
      else this.displayMemory.push(entry);
    }
    if (plan.forget.length > 0) {
      this.displayMemory = this.displayMemory.filter((entry) => !plan.forget.includes(entry.connector));
    }
    this.lastScreens = screens;
    this.deps.onDisplayMemoryChanged?.();
    if (plan.moves.length > 0) {
      this.signatures.clearAll();
      this.scheduleReconcile('display-plan');
    }
  }

  private applyDisplayMove(
    move: DisplayMove,
    screens: readonly Screen[],
    createdByKey: Map<number, number>,
  ): void {
    const tracked = this.windows.get(move.id);
    if (tracked === undefined) return;
    let workspaceIndex = move.workspace ?? tracked.surface.workspaceId;
    let targetConnector: string | undefined;
    if (move.create !== undefined) {
      // One workspace per key: every window of a rescued pair or single shares it.
      let created = createdByKey.get(move.create.key);
      if (created === undefined) {
        const workspace = this.createWorkspaceForDisplay(move.create);
        if (workspace === null) return;
        created = workspace;
        createdByKey.set(move.create.key, created);
      }
      workspaceIndex = created;
    }
    // Move the workspace first, then route the screen. With
    // `workspaces-only-on-primary`, a workspace change can drag a window back to
    // the primary; doing it before the monitor move lets the monitor move win
    // (a replay to the reconnected connector must end there, not on the primary).
    if (workspaceIndex !== tracked.surface.workspaceId) this.moveWindowToWorkspace(tracked, workspaceIndex);
    // §9: a routed window lands on the screen the plan names — the primary on a
    // rescue, the reconnected connector on a replay. Without this a replay only
    // reassigned the workspace and the pair never left the primary.
    const targetScreen = move.create?.screen ?? move.screen;
    if (targetScreen !== undefined) {
      const target = screens.find((screen) => screen.index === targetScreen);
      if (target !== undefined) {
        targetConnector = target.connector;
        tracked.surface.screenId = target.index;
        this.deps.tiling.noteSelfApply();
        try {
          tracked.win.move_to_monitor?.(target.index);
        } catch {
          /* simulated screen: the policy move still stands */
        }
      }
    }
    this.deps.history.log('display_move', {
      id: move.id,
      workspace: workspaceIndex,
      create: move.create?.key ?? null,
      screen: targetScreen ?? null,
      float: move.float === true,
      minimize: move.minimize === true,
      maximize: move.maximize === true,
      slot: move.slot ?? null,
    });
    if (move.float === true) {
      this.floatWindow(tracked, move.rect);
      this.recordPlacement(tracked, targetConnector, move.slot);
      return;
    }
    if (move.minimize === true) {
      this.deps.tiling.noteSelfApply();
      this.deps.host.minimize(tracked.id);
      this.recordPlacement(tracked, targetConnector, move.slot);
      return;
    }
    if (move.maximize === true) {
      this.deps.tiling.noteSelfApply();
      this.deps.host.maximize(tracked.id);
    } else if (move.slot !== undefined) {
      tracked.pendingSlot = move.slot;
      this.pinSlots(workspaceIndex, tracked, move.slot);
      this.unmaximizeOccupants(workspaceIndex, tracked.id);
    }
    if (move.fullscreen === true) tracked.fullscreenApplied = true;
    // §12: the routed placement is what display memory and a restart replay.
    this.recordPlacement(tracked, targetConnector, move.slot);
  }

  /** §9: the workspaces a screen displays (the primary shows them all). */
  private workspacesForScreen(screen: Screen): number[] {
    const manager = global.workspace_manager;
    const count = manager.get_n_workspaces();
    if (screen.isPrimary) {
      const all: number[] = [];
      for (let index = 0; index < count; index++) all.push(index);
      return all;
    }
    return [manager.get_active_workspace_index()];
  }

  /** A snapshot of the display arrangement for the pure plan (§9). */
  private buildDisplayState(screens: Screen[]): DisplayState {
    const manager = global.workspace_manager;
    const entries = new Map<string, DisplayWorkspace>();
    const ensure = (screen: number, workspace: number): DisplayWorkspace => {
      const key = `${screen}:${workspace}`;
      let entry = entries.get(key);
      if (entry === undefined) {
        entry = { id: workspace, screen, slots: [null, null], minimized: [], floats: [] };
        entries.set(key, entry);
      }
      return entry;
    };
    for (const screen of screens) {
      for (const workspace of this.workspacesForScreen(screen)) ensure(screen.index, workspace);
    }
    const known = new Set(screens.map((screen) => screen.index));
    for (const tracked of [...this.windows.values()].sort((a, b) => a.id - b.id)) {
      if (!tracked.ready) continue;
      // A window on a screen that is no longer present is exactly the one a
      // disconnect plan must route; it is not part of the new arrangement.
      if (!known.has(tracked.surface.screenId)) continue;
      const managed = this.classify(tracked).tileable;
      const floating = tracked.surface.flags.floating || tracked.autoFloated || tracked.escaped;
      if (!managed && !floating) continue;
      const workspace = ensure(tracked.surface.screenId, tracked.surface.workspaceId);
      const win = {
        id: tracked.id,
        maximized: tracked.surface.flags.maximized || compat.isMaximized(tracked.win),
        fullscreen: tracked.surface.flags.fullscreen,
        rect: { ...tracked.surface.frame },
      };
      if (tracked.surface.flags.minimized) {
        workspace.minimized.push(win);
        continue;
      }
      if (floating) {
        // §9: a float's stacking is restored exactly, so capture it with the rect.
        tracked.surface.captureZ();
        (workspace.floats ??= []).push({ ...win, z: tracked.surface.zPosition });
        continue;
      }
      const slot = this.slotFor(tracked);
      if (slot !== null && workspace.slots[slot] === null) {
        workspace.slots[slot] = win;
      } else if (workspace.slots[0] === null) {
        workspace.slots[0] = win;
      } else {
        (workspace.floats ??= []).push(win);
      }
    }
    return { screens, workspaces: [...entries.values()], viewed: manager.get_active_workspace_index() };
  }

  /** §9: create a rescued workspace on the physical side the screen was on. */
  private createWorkspaceForDisplay(create: NewWorkspace): number | null {
    const manager = global.workspace_manager;
    if (create.side === 'right') return this.createWorkspaceRight(create.anchor);
    const target = create.leftmost === true ? 0 : Math.max(0, create.anchor - 1);
    const appended = manager.get_n_workspaces();
    manager.append_new_workspace(false, global.get_current_time());
    const created = manager.get_workspace_by_index(appended);
    if (created !== null && target < appended) manager.reorder_workspace(created, target);
    return Math.min(target, manager.get_n_workspaces() - 1);
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
    if (this.dragging || this.adjustId !== null || this.clientInteracting) return;
    // Only a genuine user adjust is undoable; a signal-driven reconcile is a
    // safety net and must not push an entry that masks the user's own action.
    const rememberUndo = reason === 'user-adjust';
    // One key for every reconcile: a burst of signals is one pass, and the drain
    // runs on the next compositor resize tick rather than on a private timer.
    if (this.queue.push(2, 'reconcile-all', 'reconcile', { reason, rememberUndo })) this.armDrain(2);
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
      this.queue.push(2, 'reconcile-all', 'reconcile', { reason: `${reason}#${i}` });
    }
    if (this.queue.depth(2) > 0) this.armDrain(2);
    return this.queue.depth(2);
  }

  /** Queue a maintenance job (lane 3): cheap, can wait for idle. */
  scheduleMaintenance(kind: string, data?: Record<string, unknown>): void {
    if (this.queue.push(3, `maintenance:${kind}`, 'maintenance', { kind, ...data })) this.armDrain(3);
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
    if (this.queue.push(1, 'cursor-centre', 'cursor', { explicit })) this.armDrain(1);
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
    const screen = this.deps.host.screens().find((s) => s.index === focused.surface.screenId);
    const area = screen === undefined ? focused.surface.frame : screen.workArea ?? screen.geometry;
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

  private armDrain(lane: 1 | 2 | 3): void {
    if (this.drainArmed[lane]) return;
    this.drainArmed[lane] = true;
    const run = (): number => {
      this.drainArmed[lane] = false;
      this.runDrain();
      return GLib.SOURCE_REMOVE;
    };
    if (lane === 3) {
      // §10: a work-area change can arrive before the shell has set its struts,
      // so maintenance waits for the surface to settle.
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, MAINTENANCE_SETTLE_MS, run);
      return;
    }
    try {
      const laters = global.compositor.get_laters();
      const laterTypes: Record<string, unknown> = Meta.LaterType ?? {};
      const type = lane === 1
        ? (laterTypes.BEFORE_REDRAW ?? laterTypes.META_LATER_RESIZE)
        : lane === 2
          ? (laterTypes.META_LATER_RESIZE ?? laterTypes.BEFORE_REDRAW)
          : (laterTypes.IDLE ?? laterTypes.BEFORE_REDRAW);
      laters.add(type, run);
    } catch {
      // No later machinery (or the enum moved): a short timeout is still one
      // deferred pass, never policy inside the signal handler. One frame at the
      // screen's refresh, never an assumed 60 Hz.
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, Math.floor(this.deps.timing.frameIntervalFor())), run);
    }
  }

  /** Run what the queue holds, in lane order. */
  private runDrain(): void {
    const started = GLib.get_monotonic_time();
    const events = this.queue.drain();
    if (events.length === 0) return;
    this.drains += 1;
    // §19: a pause lets the queue finish what it already holds. `isPaused()` is
    // consulted through the extension, which returns false while this flag is
    // set; new work is still refused at push time, so only the backlog runs.
    this.drainingBacklog = this.deps.isPaused();
    try {
      this.drainEvents(events);
    } catch (error) {
      // §19/§36: one bad event must not propagate into the compositor's later
      // callback and take the Shell down; log it and keep the loop alive.
      this.reportError('drain', error);
    } finally {
      this.drainingBacklog = false;
    }
    const ms = (GLib.get_monotonic_time() - started) / 1000;
    this.drainMsMax = Math.max(this.drainMsMax, ms);
    this.pushSample(this.drainSamples, ms);
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

  /** Log a caught error (`[adrt] ERROR`-style) and journal it, never rethrow. */
  private reportError(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
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

  private drainEvents(events: ReturnType<EventQueue['drain']>): void {
    for (const event of events) {
      const data = (event.data ?? {}) as Record<string, unknown>;
      if (event.kind === 'cursor') {
        // §17 lane-1 feedback: pure geometry, then one warp.
        this.applyCursorCentre(data);
      } else if (event.kind === 'reconcile') {
        // A frame applied while another window is animating lands on a moving
        // surface and drifts (A72): wait for the animation instead of fighting
        // it, bounded so a stuck animation cannot starve the layout.
        if (this.deps.isAnimating?.() === true && this.drainDeferrals < 60) {
          this.drainDeferrals += 1;
          this.queue.push(2, event.key, event.kind, data);
          this.armDrain(2);
          continue;
        }
        this.drainDeferrals = 0;
        this.reconcileAll(String(data.reason ?? 'queue'), data.rememberUndo === true);
      } else if (event.kind === 'displays') {
        this.applyDisplayChange();
      } else if (event.kind === 'maintenance') {
        const kind = String(data.kind ?? 'unknown');
        switch (kind) {
          case 'sweep':
            this.coherenceSweep();
            break;
          default:
            break;
        }
        this.deps.history.log('maintenance', { kind });
      }
    }
  }

  /** §19: true while the drain is finishing the backlog a pause caught. */
  isDrainingBacklog(): boolean {
    return this.drainingBacklog;
  }

  /** Check every workspace on every screen and correct anything out of place.
   * Full reconciles are safety nets: by default they do not record undo
   * entries, so they can never mask the entry a user action pushed. */
  reconcileAll(reason: string, rememberUndo = false): void {
    if (this.deps.isPaused() || this.suspended || this.dragging || this.adjustId !== null || this.clientInteracting) return;
    // §20: the first layout drain waits for the shell's startup to complete;
    // the host nudges us again when it does.
    if (!this.deps.host.isStartupComplete()) return;
    // §6/§11: a released drag is interpreted here, not inside the grab signal.
    for (const [id, pending] of [...this.dropPending]) {
      this.dropPending.delete(id);
      const tracked = this.windows.get(id);
      if (tracked === undefined) continue;
      // §10/§12: restore the gesture's start rect for the interpretation — it
      // was captured by `endDrag` and must survive until the drain runs, or an
      // inner-edge resize cannot derive the new split ratio and reflows to the
      // old one (the snap-back).
      this.dragStartRect = pending.start;
      this.interpretDrop(tracked, pending.mode);
      this.dragStartRect = null;
    }
    // §7.6/§8: after a user reorder every index moved; re-derive them here,
    // never in the signal handler.
    if (this.reorderPending) {
      this.reorderPending = false;
      this.realignWorkspaces();
    }
    // §6: a directional move that crossed a screen edge is arrived from here,
    // but only once Mutter has actually put the window on the target screen —
    // `move_to_monitor` is asynchronous and arriving early floats it against the
    // source work area (A106). The arrival is event-driven: `window-entered-
    // monitor` (wired in `startScan`) pushes another lane-2 pass when the move
    // lands, so a pass that still sees the source screen simply leaves the move
    // pending — no retry counter, no private timer.
    if (this.crossScreenId !== null) {
      const id = this.crossScreenId;
      const tracked = this.windows.get(id);
      if (tracked === undefined) {
        this.clearCrossScreenMove();
      } else {
        tracked.refreshFrame();
        const target = this.crossScreenTarget;
        if (target === null || tracked.surface.screenId === target) {
          const from = this.crossScreenFrom ?? 'left';
          this.clearCrossScreenMove();
          this.arriveCrossScreen(tracked, from);
        }
      }
    }
    // §3/§11: the routing decision is a property of the drain, never of the
    // `onReady` timeout: the newcomer's placement is computed here from live
    // state, so a raced spawn signal cannot leave the layout half-decided.
    for (const tracked of [...this.windows.values()]) {
      if (!tracked.routePending) continue;
      tracked.routePending = false;
      if (this.windows.has(tracked.id)) this.routeWindow(tracked);
    }
    // §4/§16: fullscreen and user-unmaximize transitions are re-derived here,
    // never acted on inside the Mutter signal handler that reported them.
    for (const tracked of [...this.windows.values()]) {
      if (tracked.surface.flags.fullscreen !== tracked.fullscreenApplied) {
        tracked.fullscreenApplied = tracked.surface.flags.fullscreen;
        this.fullscreenTracked(tracked, tracked.fullscreenApplied);
      }
      if (tracked.unmaximizeRequested) {
        tracked.unmaximizeRequested = false;
        this.unmaximizeTracked(tracked);
      }
      if (tracked.userMovedTo !== null) {
        const to = tracked.userMovedTo;
        tracked.userMovedTo = null;
        const others = this.tileables(to).filter(
          (t) => t.id !== tracked.id && t.surface.screenId === tracked.surface.screenId,
        );
        // §6/§34: a user move onto a full workspace floats the window there;
        // the destination keeps its pair and nobody is evicted.
        if (others.length >= 2) this.floatWindow(tracked);
      }
    }
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
    // Keep every window inside its own monitor's full geometry (the whole
    // surface, not the work area) — a property of the pass, not a reaction to
    // the move that put it out of bounds.
    this.clampWindowsToScreen();
    this.deps.onModelEvent?.('layout', { reason });
    this.deps.onStateChanged();
  }

  retileAll(reason: string, rememberUndo = false): void {
    this.reconcileAll(reason, rememberUndo);
  }

  /** §7.6: the user reordered workspaces; every index moved. */
  private onWorkspacesReordered(): void {
    // §11: no policy in a Mutter signal handler. The new indexes are re-derived
    // in the drain; here we only record the intent.
    this.reorderPending = true;
    this.signatures.clearAll();
    if (this.deps.settings.boolean('log-workspace-reorder', false)) {
      this.deps.history.log('ws_removed', { reason: 'reorder' });
    }
    // Debounced, never synchronous: this handler runs inside Mutter's signal
    // emission, so the drain does the work.
    this.scheduleReconcile('workspace-reorder');
  }
  /** Set by a reorder signal; the drain re-derives every index from Mutter. */
  private reorderPending = false;
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
    // Every policy below is per monitor, matching the tiler (§9: a pair shares
    // a monitor). Counting a workspace's windows across screens would make a
    // pair on one monitor an "extra" — or a lone window — on another.
    for (const screen of this.deps.host.screens()) {
      const onScreen = (t: TrackedWindow): boolean => t.surface.screenId === screen.index;
      const tileables = this.tileables(workspaceId).filter(onScreen).filter((t) => !t.surface.flags.fullscreen);
      if (tileables.length === 0) continue;
      // §4 maximize, as a property: a window the user maximized that still
      // shares its workspace is given its own workspace to the right, and the
      // view follows. Re-asserting it here means a signal that was missed or
      // raced can not leave the window sharing the pair.
      if (tileables.length > 1) {
        const requested = tileables.find((t) => t.maximizeRequested && compat.isMaximized(t.win));
        if (requested !== undefined) {
          this.maximizeTracked(requested);
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
          const screen = this.screenFor(refusing.surface.screenId);
          if (
            sibling !== undefined &&
            screen !== null &&
            this.refusalEscapes(refusing, sibling, screen, this.placementEnv(refusing.surface.screenId))
          ) {
            this.escapeRefusal(refusing, sibling);
            this.scheduleRetile(workspaceId, 'escape-refusal');
            continue;
          }
          // Step 2: the sibling adapts, so the pair stays. The tiler's clamp
          // below gives the refusing window its minimum and the sibling the
          // remainder; nothing is created, floated or minimized.
        }
      }
      // §4: a lone visible managed window is always maximized.
      if (this.shouldLoneMaximize(tileables, this.nonTransient(workspaceId).filter(onScreen))) {
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
          stale.selfUnmaximize = true;
          try {
            this.deps.host.unmaximize(stale.id);
          } finally {
            stale.selfUnmaximize = false;
          }
        }
        this.scheduleRetile(workspaceId, 'unmaximize-stale');
        continue;
      }
      const startedUs = GLib.get_monotonic_time();
      this.plansComputed += 1;
      const plan = computePlans(tileables.map((t) => this.toTilerWindow(t)), screen, this.tilerConfig());
      const violations = checkPlan(plan, screen.workArea ?? screen.geometry);
      if (violations.length > 0) {
        // §5: the packing invariant is asserted, not enforced — a violation is
        // logged with its identifier and the state so the long mixed run can
        // assert that the journal never carries one.
        this.deps.history.log('invariant_violated', { reason, workspaceId, violations });
      }
      if (Date.now() < this.ignoreMismatchUntilMs) continue;
    const key = `ws:${workspaceId}:${screen.index}`;
      // A signal (a title or frame change, most often) can clear the plan
      // cache mid-transition. Re-applying the identical plan then restarts the
      // frame animation from wherever Mutter's own maximise/unmaximise
      // transition happens to have the window, which reads as an overshoot
      // followed by a correction. See `shouldApplyPlan`.
      const mismatch = this.planMismatch(plan);
      const changed = this.signatures.changed(key, planSignature(plan.placements));
      if (!shouldApplyPlan({ mismatch, changed, alreadyTargeted: this.planIsCurrentTarget(plan) })) continue;
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
      this.pushSample(this.applySamples, this.lastApplyMs);
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
  private planIsCurrentTarget(plan: TilePlan): boolean {
    if (plan.placements.length === 0) return false;
    for (const placement of plan.placements) {
      const tracked = this.windows.get(placement.surfaceId);
      const target = tracked?.lastTarget;
      if (target === null || target === undefined) return false;
      if (!rectEquals(target, placement.rect)) return false;
    }
    return true;
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
   * §6: float a window adrt places itself — the explicit no-room cases and the
   * escape's single-workspace fallback. The placement is offset and kept inside
   * the work area so it is never exactly on top of what is beneath it. A display
   * rescue/replay passes the remembered `rect`, which is restored verbatim: a
   * float's frame is the user's, never re-centred by a screen change (§9).
   */
  private floatWindow(tracked: TrackedWindow, rect?: Rect): void {
    tracked.autoFloated = true;
    tracked.pendingSlot = null;
    tracked.surface.setFloating(true);
    // The cached classification still says tileable; drop it so the next pass
    // treats the window as the float it now is.
    tracked.invalidateClassification();
    this.recordPlacement(tracked);
    this.deps.tiling.noteSelfApply();
    this.deps.host.applyLayer(tracked.id, Layer.FLOATING, 0);
    // Never touch a minimized window's geometry: Mutter un-minimizes it as a
    // side effect, so a window the user minimized would pop back on screen.
    // It gets the float rect when it is restored instead (see onMinimized).
    if (tracked.surface.flags.minimized) return;
    // Keep it on top but do not hide the pair behind it: centre it with a
    // margin so the tiled windows stay visible.
    const screen = this.screenFor(tracked.surface.screenId);
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

  nonTransient(workspaceId: number): TrackedWindow[] {
    return this.tileables(workspaceId).filter((t) => !t.surface.flags.transient);
  }

  private shouldLoneMaximize(tileables: readonly TrackedWindow[], nonTransient: readonly TrackedWindow[]): boolean {
    if (tileables.length !== 1) return false;
    // §4: a lone *visible managed* window is maximized. Floats (an always-on-top
    // window, a dialog) do not count, or the window left behind when one floats
    // would stay at half size (A61).
    const managed = nonTransient.filter((t) => this.classify(t).tileable && !t.surface.flags.minimized);
    return managed.length === 1;
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
    const current = this.focused();
    if (current === null) {
      this.cycleLap = null;
      return;
    }
    const workspaceId = current.surface.workspaceId;
    const screenId = current.surface.screenId;
    const entries = this.cycleEntries(workspaceId, screenId);
    const live = new Set(entries.filter((entry) => entry.minimized !== true).map((entry) => entry.id));
    // Keep the lap's snapshot while it still describes this plane and the
    // focused window is the one this lap last focused; a focus change by any
    // other route (a click, a direction key) starts a fresh lap.
    const lap = this.cycleLap;
    const sameSet =
      lap !== null &&
      lap.order.length === live.size &&
      lap.order.every((id) => live.has(id));
    const order =
      lap !== null &&
      lap.workspaceId === workspaceId &&
      lap.screenId === screenId &&
      lap.lastId === current.id &&
      sameSet
        ? lap.order
        : cycleSequence(entries);
    if (lap === null || order !== lap.order) {
      this.cycleLap = { workspaceId, screenId, order, startId: current.id, lastId: current.id };
    }
    const next = cycleOrder(current.id, entries, order);
    if (next === null || next === current.id) {
      this.cycleLap = null;
      return;
    }
    const target = this.windows.get(next);
    if (target === undefined) {
      this.cycleLap = null;
      return;
    }
    if (target.surface.flags.floating || target.autoFloated) {
      target.win.raise();
    }
    this.logFocus('focus_cycle', { from: current.id, to: next });
    this.focus(next);
    const active = this.cycleLap;
    if (active !== null) {
      // A lap ends when it wraps back to its first window; the next press then
      // rebuilds the order from the then-live stacking.
      if (next === active.startId) this.cycleLap = null;
      else active.lastId = next;
    }
  }

  /** Per-subsystem debug logging (§22): gated on `debug-focus`. */
  private logFocus(event: string, fields: Record<string, unknown>): void {
    if (this.deps.settings.boolean('debug-focus', false)) this.deps.history.log(event, fields);
  }

  /** The focus cycle of one plane: managed in slot order, then floats. */
  private cycleEntries(workspaceId: number, screenId: number): CycleEntry[] {
    const entries: CycleEntry[] = [];
    for (const tracked of this.windows.values()) {
      if (tracked.surface.workspaceId !== workspaceId) continue;
      if (tracked.surface.screenId !== screenId) continue;
      // A float is unmanaged but still part of the cycle; a dialog or popup is
      // neither managed nor a float and is skipped.
      const floating = tracked.surface.flags.floating || tracked.autoFloated;
      if (!floating && !this.classify(tracked).tileable) continue;
      if (tracked.surface.flags.minimized) {
        entries.push({ id: tracked.id, kind: 'managed', minimized: true });
        continue;
      }
      if (floating) {
        tracked.surface.captureZ();
        entries.push({ id: tracked.id, kind: 'float', rect: tracked.surface.frame, z: tracked.surface.zPosition });
        continue;
      }
      entries.push({ id: tracked.id, kind: 'managed', slot: this.slotFor(tracked) ?? 0 });
    }
    return entries;
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
    this.moveToAdjacentMonitor(current, direction);
  }

  toggleFloat(id: number): boolean {
    const tracked = this.windows.get(id);
    if (tracked === undefined) return false;
    const floating = !tracked.surface.flags.floating;
    // §21: un-floating when both slots are taken changes nothing and toasts.
    if (!floating) {
      const others = this.tileables(tracked.surface.workspaceId).filter(
        (t) => t.id !== id && t.surface.screenId === tracked.surface.screenId,
      );
      if (others.length >= 2) {
        this.deps.onNotice?.('un-float-full', String(id));
        return false;
      }
    }
    this.capturePlane([tracked.surface.workspaceId], tracked.surface.screenId);
    tracked.autoFloated = false;
    tracked.surface.setFloating(floating);
    this.deps.host.applyLayer(id, floating ? Layer.FLOATING : Layer.TILED, 0);
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
        this.floatWindow(tracked);
      } else if (!value && (tracked.surface.flags.floating || tracked.autoFloated)) {
        tracked.autoFloated = false;
        tracked.surface.setFloating(false);
        this.deps.tiling.noteSelfApply();
        this.deps.host.applyLayer(tracked.id, Layer.TILED, 0);
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
        this.deps.host.applyLayer(tracked.id, Layer.TILED, 0);
        tracked.invalidateClassification();
      }
    }
    this.signatures.clearAll();
    this.scheduleReconcile('forget-app');
    return removed;
  }

  /** §13: capture the pair's current configuration before a user ratio change. */
  capturePairChange(a: number, b: number): void {
    this.captureChange([a, b]);
  }

  /**
   * §13 Undo: revert the one change — every instance's workspace, slot, rect,
   * maximized and floating state, plus the ratios. Everything is validated
   * before anything is applied; an impossible undo is announced and changes
   * nothing.
   */
  undo(): boolean {
    const change = this.deps.changes.take();
    if (change === null) {
      // §13: an undo with nothing to revert is announced, never silent.
      this.deps.onNotice?.('nothing-to-undo', 'undo');
      return false;
    }
    const live: LiveInstance[] = [];
    for (const tracked of this.windows.values()) {
      live.push({ id: tracked.id, workspace: tracked.surface.workspaceId, slot: this.slotFor(tracked) });
    }
    const check = validateChange(change, live);
    if (!check.ok) {
      this.deps.history.log('undo_impossible', { problem: check.problem, instances: change.instances.map((instance) => instance.id) });
      this.deps.onNotice?.('undo-impossible', check.problem ?? 'unknown');
      return false;
    }
    // Ratios first, so the retile that follows agrees with the restored rects.
    if (change.ratios !== undefined) this.deps.tiling.restoreRatios(change.ratios);
    for (const instance of change.instances) {
      const tracked = this.windows.get(instance.id);
      if (tracked === undefined) continue;
      // Workspace.
      if (tracked.surface.workspaceId !== instance.workspace) {
        this.moveWindowToWorkspace(tracked, instance.workspace);
      }
      // Floated flag (§6): undoing an un-float puts the window back in tiling.
      if (tracked.surface.flags.floating !== instance.floating) {
        tracked.autoFloated = false;
        tracked.surface.setFloating(instance.floating);
        this.deps.tiling.noteSelfApply();
        this.deps.host.applyLayer(tracked.id, instance.floating ? Layer.FLOATING : Layer.TILED, 0);
        tracked.invalidateClassification();
      }
      // Maximized (§4).
      if (instance.maximized !== compat.isMaximized(tracked.win)) {
        this.deps.tiling.noteSelfApply();
        if (instance.maximized) {
          this.deps.host.maximize(tracked.id);
        } else {
          tracked.selfUnmaximize = true;
          try {
            this.deps.host.unmaximize(tracked.id);
          } finally {
            tracked.selfUnmaximize = false;
          }
        }
      }
      tracked.refreshFrame();
    }
    // Slots: clear stale pins on the workspaces involved, then set the change's.
    const touched = new Set<number>();
    for (const instance of change.instances) touched.add(instance.workspace);
    for (const other of this.windows.values()) {
      if (touched.has(other.surface.workspaceId) && !change.instances.some((instance) => instance.id === other.id)) {
        other.pendingSlot = null;
      }
    }
    for (const instance of change.instances) {
      const tracked = this.windows.get(instance.id);
      if (tracked !== undefined) tracked.pendingSlot = instance.slot;
    }
    // Geometry last, from the rects captured before the change.
    for (const instance of change.instances) {
      const tracked = this.windows.get(instance.id);
      if (tracked === undefined) continue;
      // §10: the screen is read fresh; a vanished screen is not invented. A
      // window with no screen cannot be given a frame — the retile that follows
      // re-homes it.
      const screen = this.screenFor(tracked.surface.screenId);
      if (screen === null) continue;
      this.deps.tiling.applyFrame(tracked, instance.rect, screen, false, 'undo', 0);
    }
    if (change.instances.length > 0 && this.deps.host.activeWorkspaceId() !== change.instances[0].workspace) {
      this.activateWorkspace(change.instances[0].workspace);
    }
    this.deps.history.log('undo', { instances: change.instances.map((instance) => instance.id) });
    // Do not immediately re-tile over the restored rects.
    this.ignoreMismatchUntilMs = Date.now() + MISMATCH_SUPPRESSION_MS;
    this.signatures.clearAll();
    return true;
  }

  /** Capture every tiled window on the given workspaces of one screen. */
  private capturePlane(workspaceIds: readonly number[], screenId: number): void {
    const ids: number[] = [];
    for (const workspaceId of workspaceIds) {
      for (const tracked of this.tileables(workspaceId)) {
        if (tracked.surface.screenId === screenId) ids.push(tracked.id);
      }
    }
    if (ids.length > 0) this.captureChange(ids);
  }

  /** Snapshot the current configuration of `ids` as the single undo change. */
  private captureChange(ids: readonly number[], workspaceOverride?: number): void {
    const instances: InstanceConfig[] = [];
    for (const id of ids) {
      const tracked = this.windows.get(id);
      if (tracked === undefined) continue;
      tracked.refreshFrame();
      instances.push({
        id,
        workspace: workspaceOverride ?? tracked.surface.workspaceId,
        slot: this.slotFor(tracked),
        rect: { ...tracked.surface.frame },
        maximized: compat.isMaximized(tracked.win),
        floating: tracked.surface.flags.floating,
      });
    }
    if (instances.length === 0) return;
    const ratios: Record<string, number> = this.deps.tiling.getRatios();
    this.deps.changes.set({ instances, ratios } satisfies Change);
    this.deps.history.log('undo_captured', { instances: instances.map((instance) => instance.id) });
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
    this.suppress.add(current.id);
    this.deps.tiling.noteSelfApply();
    this.deps.onWindowMoving();
    this.deps.host.applyWorkspace(current.id, index);
    this.suppress.delete(current.id);
    current.surface.workspaceId = index;
    current.lastWorkspaceIdx = index;
    current.escaped = false;
    current.pendingSlot = null;
    this.deps.history.log('ws_switch_empty', { id: current.id, from, to: index, byUser: true });
    const others = this.tileables(index).filter(
      (t) => t.id !== current.id && t.surface.screenId === current.surface.screenId,
    );
    if (others.length >= 2) this.floatWindow(current);
    else if (others.length === 1) this.pinSlots(index, current, index > from ? 0 : 1);
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
    this.queue.clear();
    this.drainArmed = { 1: false, 2: false, 3: false };
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
    this.classifyCalls += 1;
    if (!tracked.hasClassification) this.classifyMisses += 1;
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
    const config = this.deps.settings.tilerConfig(this.deps.tiling.getRatios(), new Set(this.deps.tiling.getSwapPairs()));
    // §1/§6: the pair axis is per screen. A vertical workspace layout
    // (`layout_rows === -1`) forces the stack; otherwise leave `workspaceAxis`
    // unset so the tiler falls back to the monitor's own orientation (a portrait
    // screen stacks, a landscape one splits side by side). Setting it to
    // `horizontal` here would override the portrait fallback.
    const rows = global.workspace_manager.layout_rows;
    return rows === -1 ? { ...config, workspaceAxis: 'vertical' } : config;
  }

  private toTilerWindow(tracked: TrackedWindow): TilerWindow {
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

  private screenFor(index: number): Screen | null {
    for (const screen of this.deps.host.screens()) {
      if (screen.index === index) return screen;
    }
    return null;
  }

  /** §7.2 lone-maximize policy, per monitor (a pair on one monitor must not
   * turn a lone window on another into a "non-lone"). */
  private evaluateLoneMaximize(workspaceId: number): void {
    for (const screen of this.deps.host.screens()) {
      const onScreen = (t: TrackedWindow): boolean => t.surface.screenId === screen.index;
      const nonTransient = this.nonTransient(workspaceId).filter(onScreen);
      const tileables = this.tileables(workspaceId).filter(onScreen);
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
        this.scheduleRetile(workspaceId, 'lone-unmaximize');
      }
    }
  }

  /** Create a workspace immediately right of `after`, pushing the spare right. */
  private createWorkspaceRight(after: number): number | null {
    const manager = global.workspace_manager;
    const target = after + 1;
    if (target < manager.get_n_workspaces()) {
      const existing = manager.get_workspace_by_index(target);
      if (existing !== null && this.workspaceIsEmpty(existing)) return target;
    }
    const appended = manager.get_n_workspaces();
    manager.append_new_workspace(false, global.get_current_time());
    const created = manager.get_workspace_by_index(appended);
    if (created !== null && target < appended) manager.reorder_workspace(created, target);
    return Math.min(target, manager.get_n_workspaces() - 1);
  }

  /** Move one tracked window to a workspace, suppressing the resulting signals. */
  private moveWindowToWorkspace(tracked: TrackedWindow, index: number): void {
    this.suppress.add(tracked.id);
    this.deps.tiling.noteSelfApply();
    this.deps.onWindowMoving();
    this.deps.tiling.cancel(tracked.id);
    this.deps.host.applyWorkspace(tracked.id, index);
    this.suppress.delete(tracked.id);
    tracked.surface.workspaceId = index;
    tracked.lastWorkspaceIdx = index;
    this.signatures.clearAll();
  }

  private workspaceIsEmpty(workspace: any): boolean {
    return workspace.list_windows().filter((win: any) => this.windows.has(win.get_id())).length === 0;
  }

  /** §4: maximize — its own workspace to the right, or in place on `single`. */
  private maximizeTracked(tracked: TrackedWindow): void {
    tracked.maximizeRequested = true;
    // §16: a window that does not fit its slot gets its own workspace instead.
    if (this.doesNotFit(tracked, this.placementEnv(tracked.surface.screenId))) {
      this.escapeTracked(tracked);
      return;
    }
    // §13: the pair it leaves behind reacts (the survivor maximizes); capture
    // the whole plane so undo restores both windows.
    this.capturePlane([tracked.surface.workspaceId], tracked.surface.screenId);
    const own = tracked.surface.workspaceId;
    const env = this.placementEnv(tracked.surface.screenId);
    const state = this.buildPlacementState();
    this.applyPlacement(tracked, maximizeWindow(state, env, own), own === state.viewed, 'maximize');
    this.deps.onModelEvent?.('window-maximized', { id: tracked.id, workspace: own });
  }

  /** §4: the unmaximize ladder, from the pure model (no origin memory). */
  private unmaximizeTracked(tracked: TrackedWindow): void {
    tracked.maximizeRequested = false;
    const own = tracked.surface.workspaceId;
    this.capturePlane([own - 1, own, own + 1], tracked.surface.screenId);
    const env = this.placementEnv(tracked.surface.screenId);
    const state = this.buildPlacementState();
    const placement = unmaximizeWindow(state, env, own, tracked.id);
    // §4: there is no un-maximized lone window. When the ladder leaves the
    // window where it is (no neighbour holds windows), it is alone and the lone
    // law re-maximizes it rather than parking it minimized.
    if (placement.workspace === own && placement.minimize?.includes(tracked.id) === true) {
      this.deps.tiling.noteSelfApply();
      this.deps.host.maximize(tracked.id);
      this.scheduleReconcile('unmaximize-lone');
      return;
    }
    const follow = own === state.viewed || placement.workspace !== own;
    this.applyPlacement(tracked, placement, follow, 'unmaximize');
    this.deps.onModelEvent?.('window-unmaximized', { id: tracked.id, workspace: placement.workspace });
    if (env.screen === 'single') this.restoreMinimizedOn(placement.workspace, tracked.surface.screenId);
    this.schedulePrune();
  }

  /** §4/§16: fullscreen behaves as maximize; leaving it as unmaximize. */
  private fullscreenTracked(tracked: TrackedWindow, fullscreen: boolean): void {
    if (fullscreen) {
      const own = tracked.surface.workspaceId;
      const env = this.placementEnv(tracked.surface.screenId);
      const state = this.buildPlacementState();
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
  private escapeTracked(tracked: TrackedWindow): void {
    const env = this.placementEnv(tracked.surface.screenId);
    const screen = this.screenFor(tracked.surface.screenId);
    if (screen === null) return;
    // §13: the escape moves the window to a new workspace; it is undoable.
    this.capturePlane([tracked.surface.workspaceId], tracked.surface.screenId);
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
    const state = this.buildPlacementState();
    const created = this.createWorkspaceRight(own);
    if (created === null) {
      this.deps.tiling.applyFrame(tracked, rect, screen, false, 'escape-clamped', 0);
      return;
    }
    this.moveWindowToWorkspace(tracked, created);
    // A float is not our escape: a managed window that does not fit keeps its
    // clamped size, flush at slot 0 and full work-area height (§16).
    tracked.autoFloated = false;
    tracked.escaped = true;
    this.deps.tiling.applyFrame(tracked, rect, screen, false, 'escape', 0);
    if (own === state.viewed) this.instantSwitch(() => this.activateWorkspace(created));
    this.deps.history.log('spawn_ws', { id: tracked.id, workspaceId: created, reason: 'escape' });
    this.signatures.clearAll();
    this.scheduleReconcile('escape');
  }

  /**
   * §10 step 2: whether the refusing window's sibling can adapt to the
   * remainder. `escaped` false means the pair still exists, so the tiler's
   * ratio clamp is left to give the refusing window its minimum and the
   * sibling the rest; true means the pair cannot exist and step 3 applies.
   */
  private refusalEscapes(refusing: TrackedWindow, sibling: TrackedWindow, screen: Screen, env: Env): boolean {
    const area = screenArea(screen);
    // §10: the split extent uses the between-window gap, not the base, so an
    // explicit `gaps-between` is honoured by the refusal ladder.
    const gap = resolveGaps(this.tilerConfig(), screen).between;
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
  private escapeRefusal(refusing: TrackedWindow, sibling: TrackedWindow): void {
    const env = this.placementEnv(refusing.surface.screenId);
    const single = env.screen === 'single';
    const trigger = single ? refusing : sibling;
    const reactor = single ? sibling : refusing;
    const outcome = impossibleSplit(env, { id: trigger.id }, { id: reactor.id });
    if (outcome.giveWayTo === 'minimized') {
      this.maximizeInPlace(this.windows.get(outcome.keep) ?? trigger);
      return;
    }
    this.escapeTracked(this.windows.get(outcome.giveWay) ?? reactor);
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
        this.floatWindow(tracked);
        this.deps.onStateChanged();
        return;
      }
      const others = this.tileables(tracked.surface.workspaceId).filter(
        (t) => t.id !== tracked.id && t.surface.screenId === tracked.surface.screenId,
      );
      // §10 step 4: restoring makes this window the trigger. If a peer refuses
      // to share (it does not fit its half), the trigger keeps the screen
      // maximized and the peer gives way, and the two trade on each restore.
      const refuses = others.some((o) => this.doesNotFit(o, this.placementEnv(o.surface.screenId)));
      if (refuses) {
        this.maximizeInPlace(tracked);
        return;
      }
      // §6: restoring onto a workspace whose two slots are taken floats.
      if (others.length >= 2) {
        this.floatWindow(tracked);
        return;
      }
      this.scheduleRetile(tracked.surface.workspaceId, 'unminimize');
      return;
    }
    this.deps.onModelEvent?.('window-minimized', { id: tracked.id, workspace: tracked.surface.workspaceId });
    this.scheduleRetile(tracked.surface.workspaceId, 'minimize');
    this.schedulePrune();
  }

  /**
   * Run a programmatic workspace change with the switch animation suppressed.
   * Mutter draws *clones* of every window during that slide, each carrying the
   * window's shadow, so a window we are moving looks like it casts a shadow of
   * itself. Our own slides are instant instead; the user's switches keep their
   * animation.
   */
  private instantSwitch(fn: () => void): void {
    const controller = (wm as { _workspaceAnimation?: any })._workspaceAnimation;
    const original = controller?.animateSwitch;
    if (controller === undefined || controller === null || typeof original !== 'function') {
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
    controller.animateSwitch = function (_from: any, _to: any, _direction: any, onComplete: any) {
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

  /**
   * §5: reaping is a property. At every drain any empty workspace other than
   * GNOME's trailing spare is removed, wherever it sits; a workspace holding
   * only minimized windows relocates its occupant first (left, else right, else
   * it stays, the one legal look-empty workspace); a float pins its workspace.
   */
  private reapEmptyWorkspaces(): void {
    if (this.deps.isPaused() || this.suspended) return;
    const manager = global.workspace_manager;
    if (manager.get_n_workspaces() <= 1) return;
    const state = this.buildPlacementState();
    const plan = reapPlan(state);
    if (plan.reap.length === 0 && plan.relocate.length === 0) return;
    for (const move of plan.relocate) {
      const tracked = this.windows.get(move.id);
      if (tracked === undefined) continue;
      this.moveWindowToWorkspace(tracked, move.to);
      this.deps.history.log('new_ws', { id: move.id, workspaceId: move.to, reason: 'minimized-relocation' });
    }
    const reapSet = new Set(plan.reap);
    if (reapSet.has(manager.get_active_workspace_index())) {
      const target = this.nearestIndexHoldingWindows(state, manager.get_active_workspace_index(), reapSet);
      if (target >= 0) this.activateWorkspace(target);
    }
    for (const index of [...plan.reap].sort((a, b) => b - a)) {
      if (manager.get_n_workspaces() <= 1) break;
      const workspace = manager.get_workspace_by_index(index);
      if (workspace === null) continue;
      // Never reap a workspace that still holds any window, tracked or not.
      if (workspace.list_windows().length > 0) continue;
      if (manager.get_active_workspace_index() === index) continue;
      manager.remove_workspace(workspace, global.get_current_time());
      this.deps.history.log('ws_removed', { workspaceId: index, reason: 'reaped' });
    }
    this.realignWorkspaces();
    this.signatures.clearAll();
  }

  /** Nearest non-reaped workspace that holds windows, left first (§5). */
  private nearestIndexHoldingWindows(state: State, from: number, exclude: Set<number>): number {
    for (let index = from - 1; index >= 0; index--) {
      if (!exclude.has(index) && windowCount(state.workspaces[index]) > 0) return index;
    }
    for (let index = from + 1; index < state.workspaces.length; index++) {
      if (!exclude.has(index) && windowCount(state.workspaces[index]) > 0) return index;
    }
    for (let index = from - 1; index >= 0; index--) {
      if (!exclude.has(index)) return index;
    }
    return -1;
  }

  /** Reap empty workspaces shortly after an action, once state has settled. */
  private schedulePrune(): void {
    this.addTimeout(PRUNE_FIRST_MS, () => this.reapEmptyWorkspaces());
    this.addTimeout(PRUNE_SECOND_MS, () => this.reapEmptyWorkspaces());
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

  /**
   * §6/§14: move to the adjacent screen in `direction`, chosen by geometry; the
   * target screen's own drop ladder (free slot on the side it came from, a
   * crossing swap, else a float) is applied from the drain.
   */
  private moveToAdjacentMonitor(tracked: TrackedWindow, direction: string): void {
    const target = this.adjacentScreen(tracked, direction);
    if (target === null) return;
    this.captureChange([tracked.id]);
    tracked.win.move_to_monitor(target.index);
    tracked.userMovedAtMs = Date.now();
    this.crossScreenId = tracked.id;
    this.crossScreenFrom = direction === 'right' ? 'left' : direction === 'left' ? 'right' : direction === 'down' ? 'above' : 'below';
    // `move_to_monitor` is asynchronous: the arrival ladder must not run while
    // the window is still on the source screen, or its float rect (computed from
    // the source work area) drags it straight back (A106). `window-entered-
    // monitor` re-queues the drain when it lands; until then the move stays
    // pending.
    this.crossScreenTarget = target.index;
    this.signatures.clearAll();
    this.scheduleReconcile('move-monitor');
  }

  private clearCrossScreenMove(): void {
    this.crossScreenId = null;
    this.crossScreenFrom = null;
    this.crossScreenTarget = null;
  }

  /**
   * The screen next to this one in `direction`, chosen purely by geometry —
   * never by index. A candidate must lie on the requested side (its centre
   * past ours on that axis); a screen whose perpendicular extent overlaps ours
   * wins over one that does not, and among those the nearest edge wins. This
   * keeps the choice honest in a mixed landscape/portrait layout, where array
   * order and physical adjacency need not agree.
   */
  private adjacentScreen(tracked: TrackedWindow, direction: string): Screen | null {
    const screens = this.deps.host.screens();
    const from = this.screenFor(tracked.surface.screenId);
    if (from === null) return null;
    const horizontal = direction === 'left' || direction === 'right';
    const negated = direction === 'left' || direction === 'up';
    const f = from.geometry;
    let best: Screen | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const screen of screens) {
      if (screen.index === from.index) continue;
      const g = screen.geometry;
      const centre = horizontal
        ? g.x + g.width / 2 - (f.x + f.width / 2)
        : g.y + g.height / 2 - (f.y + f.height / 2);
      if (negated ? centre >= 0 : centre <= 0) continue;
      const gap = horizontal
        ? negated
          ? f.x - (g.x + g.width)
          : g.x - (f.x + f.width)
        : negated
          ? f.y - (g.y + g.height)
          : g.y - (f.y + f.height);
      const overlap = horizontal
        ? Math.min(f.y + f.height, g.y + g.height) - Math.max(f.y, g.y)
        : Math.min(f.x + f.width, g.x + g.width) - Math.max(f.x, g.x);
      // A screen with no perpendicular overlap is a fallback only.
      const score = (overlap > 0 ? 0 : 100000) + Math.max(0, gap);
      if (score < bestScore) {
        bestScore = score;
        best = screen;
      }
    }
    return best;
  }

  /** §6: arrive on another screen (a drag or a directional move). */
  private arriveCrossScreen(tracked: TrackedWindow, from: 'left' | 'right' | 'above' | 'below'): void {
    tracked.refreshFrame();
    // A maximized window dragged across screens is un-maximized at the drop.
    if (compat.isMaximized(tracked.win)) {
      tracked.selfUnmaximize = true;
      try {
        this.deps.host.unmaximize(tracked.id);
      } finally {
        tracked.selfUnmaximize = false;
      }
      tracked.refreshFrame();
    }
    const crossed = this.crossedWindow(tracked);
    const env = this.placementEnv(tracked.surface.screenId);
    const state = this.buildPlacementState(tracked.id);
    const result = dropPlacement(state, env, tracked.id, tracked.surface.workspaceId, from, crossed);
    this.applyDropResult(tracked, result);
  }

  private recenterModal(tracked: TrackedWindow): void {
    // §16: a dialog floats, is centred on its parent and raised.
    try {
      tracked.win.raise();
    } catch {
      /* window gone */
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
    const on = (signal: string, cb: (...args: any[]) => void) => {
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
    tracked.refreshFrame();

    // A server-side grab is in flight (Super+drag): follow, do not reflow.
    if (this.dragging) {
      this.dragLastActivityMs = Date.now();
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

    // §6: an application drag-and-drop (a Chrome tab tear-off, a VS Code
    // editor-tab or panel drag, a GTK DnD) holds the pointer button but starts
    // no compositor window grab. It is not a window move: freeze reflow so the
    // client places its own window, interpret no drop and show no preview, then
    // route/reflow once the interaction ends.
    if (this.trackClientInteraction()) {
      this.deps.onStateChanged();
      return;
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

  /**
   * §6: keep adrt out of an application drag-and-drop's way. While the pointer
   * button is held with **no** compositor window grab, the geometry changes are
   * the client's own (a tab tear-off creating and moving a window, a GTK DnD),
   * not a window move adrt may interpret — so the freeze is set and reflow is
   * deferred. The next pass that sees the button released clears it and reflows
   * exactly once, routing any newcomer that appeared mid-gesture.
   *
   * `displayGrabActive()` is `null` on a Shell with no grab reading; the old
   * button-only heuristic is kept then, so an unknown platform is no worse than
   * before.
   */
  private trackClientInteraction(): boolean {
    if (!compat.button1Pressed()) {
      if (this.clientInteracting) {
        this.clientInteracting = false;
        // The freeze is lifted: one deferred pass routes the newcomer and
        // settles the layout, even if no further frame signal arrives.
        this.scheduleReconcile('client-interaction-end');
      }
      return false;
    }
    if (compat.displayGrabActive() === false) {
      this.clientInteracting = true;
      return true;
    }
    return false;
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
    // §6: the compositor must actually hold a window move/resize grab. An
    // application DnD (Chrome tab tear-off, VS Code tab/panel drag, GTK DnD)
    // holds the button but starts no grab, so a client-driven frame change must
    // not be read as a user move — that is what swapped the pair under the
    // gesture and churned `beginUserAdjust`/`endUserAdjust` on every frame.
    if (compat.displayGrabActive() === false) return false;
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
    this.dragId = tracked.id;
    // Anchor to the last geometry we planned: `surface.frame` is already the
    // user's new rect by the time this signal arrives.
    this.dragStartRect = { ...(tracked.lastTarget ?? tracked.surface.frame) };
    this.dragStartWorkspace = tracked.surface.workspaceId;
    this.dragStartScreen = tracked.surface.screenId;
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
    this.dragId = null;
    this.deps.onDragChanged(false);
    this.interpretDrop(tracked, mode);
    this.dragStartRect = null;
    this.signatures.clearAll();
    this.scheduleRetile(tracked.surface.workspaceId, 'user-adjust');
  }

  private adjustMode(tracked: TrackedWindow): AdjustMode {
    const start = this.dragStartRect;
    if (start === null) return 'move';
    // Geometry-only, and deliberately strict: a size change on both axes is a
    // move (an overview drop scales the window to its target), never an
    // inner-edge resize — reading it as one would save a bogus split ratio that
    // then persists for that pair of apps.
    return classifyAdjust(start, tracked.surface.frame);
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
    sibling.refreshFrame();
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

  private interpretDrop(tracked: TrackedWindow, mode: AdjustMode): void {
    const screen = this.screenFor(tracked.surface.screenId);
    if (screen === null) return;
    const sibling = this.pairSibling(tracked);
    const samePlane = tracked.surface.workspaceId === this.dragStartWorkspace && tracked.surface.screenId === this.dragStartScreen;

    // §10: the inner edge of a pair changes the ratio. Landing on the sibling is
    // a crossing, never a resize — a client can clamp a dragged window, changing
    // its size, which used to read as an inner-edge resize (§6/A77).
    if (
      sibling !== null &&
      samePlane &&
      mode === 'resize' &&
      !this.overlaps(tracked.surface.frame, sibling.surface.frame)
    ) {
      this.applyResizeIntent(tracked, sibling, screen);
      return;
    }

    // §6/§11: the same decision the preview overlay shows, now applied.
    const target = this.dragOutcomeFor(tracked, mode);
    if (target === null || target.kind === 'none') return;
    this.applyDropResult(tracked, target);
  }

  /**
   * §6/§11: the live drop target for the preview overlay. The policy is pure
   * (`core/drag`); this only gathers the model state it needs. `null` when the
   * gesture is an inner-edge resize, which has no landing rect.
   */
  previewTarget(): DragOutcome | null {
    const id = this.dragId ?? this.adjustId;
    if (id === null) return null;
    const tracked = this.windows.get(id);
    if (tracked === undefined) return null;
    tracked.refreshFrame();
    return this.dragOutcomeFor(tracked, this.adjustMode(tracked));
  }

  /**
   * §6/§11: the one drag decision, shared by the preview and the drop. A
   * same-plane crossing swaps; a cross-plane drop follows §6's ladder; both
   * return the exact landing rect so the two can never disagree.
   */
  private dragOutcomeFor(tracked: TrackedWindow, mode: AdjustMode): DragOutcome | null {
    const screen = this.screenFor(tracked.surface.screenId);
    if (screen === null) return null;
    const sibling = this.pairSibling(tracked);
    const samePlane =
      tracked.surface.workspaceId === this.dragStartWorkspace && tracked.surface.screenId === this.dragStartScreen;
    if (sibling !== null && samePlane && mode === 'resize' && !this.overlaps(tracked.surface.frame, sibling.surface.frame)) {
      return null;
    }
    const crossed = samePlane ? this.crossedWindow(tracked) : null;
    return dragOutcome({
      state: this.buildPlacementState(tracked.id),
      env: this.placementEnv(tracked.surface.screenId),
      id: tracked.id,
      workspace: tracked.surface.workspaceId,
      from: this.dropFrom(tracked),
      crossed,
      samePlane,
      screen,
      config: this.tilerConfig(),
      dragged: this.dragTilerWindow(tracked),
      othersByWorkspace: this.previewOthers(tracked),
      dropped: { ...tracked.surface.frame },
    });
  }

  /** A window's tiler description with the side it currently occupies (§13). */
  private dragTilerWindow(tracked: TrackedWindow): TilerWindow {
    return { ...this.toTilerWindow(tracked), slot: this.slotFor(tracked) ?? undefined };
  }

  /** Every other tileable window on the dragged screen, grouped by workspace. */
  private previewOthers(tracked: TrackedWindow): Map<number, TilerWindow[]> {
    const map = new Map<number, TilerWindow[]>();
    const count = global.workspace_manager.get_n_workspaces();
    for (let workspace = 0; workspace < count; workspace++) {
      const list: TilerWindow[] = [];
      for (const other of this.tileables(workspace)) {
        if (other.id === tracked.id) continue;
        if (other.surface.screenId !== tracked.surface.screenId) continue;
        list.push(this.dragTilerWindow(other));
      }
      map.set(workspace, list);
    }
    return map;
  }

  /** The direction a drop arrived from, from the plane it started on (§3/§6). */
  private dropFrom(tracked: TrackedWindow): 'left' | 'right' | 'above' | 'below' | null {
    if (tracked.surface.screenId !== this.dragStartScreen) {
      const from = this.screenFor(this.dragStartScreen);
      const to = this.screenFor(tracked.surface.screenId);
      if (from !== null && to !== null) {
        if (to.geometry.x > from.geometry.x) return 'left';
        if (to.geometry.x < from.geometry.x) return 'right';
        if (to.geometry.y > from.geometry.y) return 'above';
        if (to.geometry.y < from.geometry.y) return 'below';
      }
    }
    if (tracked.surface.workspaceId !== this.dragStartWorkspace) {
      return tracked.surface.workspaceId > this.dragStartWorkspace ? 'left' : 'right';
    }
    return null;
  }

  /** A visible managed window on the drop's plane whose rect the drop crosses. */
  private crossedWindow(tracked: TrackedWindow): number | null {
    const rect = tracked.surface.frame;
    let best: number | null = null;
    let bestOverlap = 0;
    for (const other of this.windows.values()) {
      if (other.id === tracked.id) continue;
      if (other.surface.workspaceId !== tracked.surface.workspaceId) continue;
      if (other.surface.screenId !== tracked.surface.screenId) continue;
      if (other.surface.flags.minimized) continue;
      if (!this.classify(other).tileable) continue;
      const overlap = this.overlapArea(rect, other.surface.frame);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = other.id;
      }
    }
    return best;
  }

  /** Any genuine overlap of two rects, with a couple of pixels of slack. */
  private overlaps(a: Rect, b: Rect): boolean {
    return this.overlapArea(a, b) > 4;
  }

  private overlapArea(a: Rect, b: Rect): number {
    const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) - 2);
    const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) - 2);
    return x * y;
  }

  /** Apply the pure drop decision through Mutter. */
  private applyDropResult(
    tracked: TrackedWindow,
    result: ReturnType<typeof dropPlacement>,
  ): void {
    const workspaceChanged = result.workspace !== tracked.surface.workspaceId;
    // §13: a drop is a user move, so it is undoable; capture the origin first.
    this.captureChange([tracked.id]);
    if (workspaceChanged) this.moveWindowToWorkspace(tracked, result.workspace);
    switch (result.kind) {
      case 'slot':
        this.pinSlots(result.workspace, tracked, result.slot);
        this.unmaximizeOccupants(result.workspace, tracked.id);
        break;
      case 'maximize':
        this.deps.tiling.noteSelfApply();
        this.deps.host.maximize(tracked.id);
        break;
      case 'swap': {
        const withWin = this.windows.get(result.with);
        if (withWin !== undefined) this.applySwapIntent(tracked, withWin);
        break;
      }
      case 'float':
        this.floatWindow(tracked);
        break;
      default:
        break;
    }
    this.signatures.clearAll();
    this.scheduleReconcile('drop');
  }

  private onMaximizeSignal(tracked: TrackedWindow): void {
    if (!tracked.ready) return;
    if (this.suppress.has(tracked.id)) return;
    tracked.surface.refresh();
    // §11: a Mutter signal records the intent; the drain re-derives the state
    // and applies it (the A45 pattern). `selfUnmaximize` is our own tiler's
    // unmaximize and must not drive the ladder.
    if (compat.isMaximized(tracked.win)) {
      // A maximize we caused — the lone law, a routed arrival, the coherence
      // sweep — is not a user request. Without this the drain's §4 property
      // reads our own maximize as the user's and exiles a window that was only
      // being tiled (S05: a sweep that saw one member of a forming pair while
      // its sibling animated maximized it, then exiled it to its own workspace).
      if (Date.now() - this.deps.tiling.lastApplyAtMs < SELF_APPLY_MS) return;
      tracked.maximizeRequested = true;
      this.scheduleReconcile('maximize');
      return;
    }
    if (tracked.selfUnmaximize) {
      this.scheduleReconcile('self-unmaximize');
      return;
    }
    tracked.maximizeRequested = false;
    tracked.unmaximizeRequested = true;
    this.scheduleReconcile('unmaximize');
  }

  private onWorkspaceSignal(tracked: TrackedWindow): void {
    if (!tracked.ready) return;
    if (this.suppress.has(tracked.id)) return;
    const workspace = tracked.win.get_workspace();
    if (workspace === null) return;
    const index = workspace.index();
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
    const others = this.tileables(index).filter(
      (t) => t.id !== tracked.id && t.surface.screenId === tracked.surface.screenId,
    );
    if (others.length === 1) {
      tracked.pendingSlot = index > from ? 0 : 1;
      others[0].pendingSlot = tracked.pendingSlot === 0 ? 1 : 0;
    }
    // §11: no policy in a signal handler. The arrival (a no-room float when the
    // destination is full) is applied from the drain.
    tracked.userMovedTo = index;
    this.scheduleReconcile('workspace-changed');
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
    this.deps.registry.prune();
    this.deps.registry.save();
    this.reapEmptyWorkspaces();
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

  /**
   * Keep every tracked window inside its own monitor's **full geometry** (the
   * whole screen surface, not the work area). A property re-derived by the
   * lane-2 drain and the periodic coherence sweep, never a one-shot reaction to
   * a move, so a window dragged out of bounds is clamped on the next pass after
   * the drag ends and dragging still feels free.
   *
   * Fullscreen windows (they own the screen) and minimized windows (Mutter
   * manages their frame) are skipped. A tiled/maximized window is already inside
   * the work area, so in practice the clamp only ever fires for a manual float.
   * It is idempotent — a window already inside is untouched — and it reuses the
   * tiler's bounded retry/refusal path for a window that refuses the geometry,
   * so it can never loop or fight a stubborn client.
   */
  private clampWindowsToScreen(): void {
    if (!this.deps.settings.boolean('clamp-windows-to-screen', true)) return;
    // No clamping mid-drag: the user owns the geometry until the gesture ends.
    if (this.dragging || this.adjustId !== null) return;
    for (const tracked of this.windows.values()) {
      const flags = tracked.surface.flags;
      if (flags.fullscreen || flags.minimized || tracked.stubborn) {
        tracked.clamped = false;
        continue;
      }
      const screen = this.screenFor(tracked.surface.screenId);
      if (screen === null) continue;
      tracked.refreshFrame();
      const current = tracked.surface.frame;
      const clamped = clampRectToArea(current, screen.geometry);
      if (rectEquals(current, clamped)) {
        tracked.clamped = false;
        continue;
      }
      tracked.clamped = true;
      this.clampsApplied += 1;
      this.deps.history.log('clamp_to_screen', { id: tracked.id, from: current, to: clamped });
      this.deps.tiling.noteSelfApply();
      this.deps.tiling.applyFrame(tracked, clamped, screen, false, 'clamp-to-screen', 0);
    }
  }

  /**
   * §35: periodic coherence guarantee. A normal (non-floating, non-modal)
   * window on a workspace with a sibling must be tiled. If one was left untiled
   * — a refused apply, a missed signal, a `stubborn` record — push the plan
   * through, clearing the refusal bookkeeping so it is retried.
   */
  coherenceSweep(): void {
    if (this.deps.isPaused() || this.suspended) return;
    // A drag whose release never arrived must not disable the guarantee below:
    // clear it first, then run the pass.
    if (this.dragIsStale()) {
      this.abandonDrag('stale');
      return;
    }
    // §6: an application DnD froze reflow; once the button is released the
    // sweep lifts the freeze and reflows exactly once, so the newcomer is
    // routed and the layout settles even if no frame signal arrives after the
    // drop.
    if (this.clientInteracting) {
      if (compat.button1Pressed()) return;
      this.clientInteracting = false;
      this.scheduleReconcile('client-interaction-end');
    }
    if (this.dragging || this.adjustId !== null) return;
    // The backstop for a clamp the lane-2 drain missed: an off-screen window is
    // pulled back here even if no frame signal scheduled a reconcile.
    this.clampWindowsToScreen();
    this.coherenceRuns += 1;
    const sweepStartedUs = GLib.get_monotonic_time();
    const count = global.workspace_manager.get_n_workspaces();
    for (let index = 0; index < count; index++) {
      for (const screen of this.deps.host.screens()) {
        const onScreen = (t: TrackedWindow) => t.surface.screenId === screen.index;
        const busy = (t: TrackedWindow) => this.deps.tiling.isAnimating(t.id);

        const tileables = this.tileables(index).filter(onScreen);

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
            this.deps.tiling.noteSelfApply();
            this.deps.host.maximize(only.id);
            this.coherenceFixes += 1;
            this.deps.history.log('tile', { reason: 'coherence-maximize', id: only.id, workspaceId: index });
          }
          continue;
        }

        // A pair is the most a workspace holds in v2; extra visible windows are
        // a routing bug, not something to evict — leave them alone and let the
        // next reconcile resolve them.
        if (tileables.length > 2) continue;

        this.plansComputed += 1;
        const plan = computePlans(tileables.map((t) => this.toTilerWindow(t)), screen, this.tilerConfig());
        let offender = false;
        for (const placement of plan.placements) {
          const tracked = this.windows.get(placement.surfaceId);
          if (tracked === undefined) continue;
          this.sweepFrameReads += 1;
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
        this.signatures.clearAll();
        this.ignoreMismatchUntilMs = 0;
        this.deps.tiling.applyPlan(plan, screen, 'coherence', false, false);
        this.coherenceFixes += 1;
        this.deps.history.log('tile', { reason: 'coherence', workspaceId: index, screen: screen.index });
        this.deps.onStateChanged();
      }
    }
    const sweepMs = (GLib.get_monotonic_time() - sweepStartedUs) / 1000;
    this.sweepMsTotal += sweepMs;
    if (sweepMs > this.sweepMsMax) this.sweepMsMax = sweepMs;
  }

  /** How many periodic coherence sweeps have run (diagnostics). */
  private coherenceRuns = 0;
  /** How many corrections the sweeps have made (diagnostics). */
  private coherenceFixes = 0;
  /** Per-window throttle for re-maximizing a lone window (ms epoch). */
  private readonly coherenceRetryAt = new Map<number, number>();
  coherenceSweepCount(): number {
    return this.coherenceRuns;
  }

  /** How many corrections the sweeps have made (diagnostics). */
  coherenceFixCount(): number {
    return this.coherenceFixes;
  }

  /**
   * Stage 0 counters (PERFORMANCE_PLAN.md). They exist only to be observed:
   * no decision anywhere reads them.
   */
  counters(): {
    sweeps: number;
    sweepMsMax: number;
    sweepMsAvg: number;
    classifyCalls: number;
    classifyMisses: number;
    plansComputed: number;
    sweepFrameReads: number;
    drains: number;
    queuePending: number;
    drainMsMax: number;
    drainMsP50: number;
    drainMsP95: number;
    applyMsP50: number;
    applyMsP95: number;
    applySamples: number;
    clampsApplied: number;
    errors: number;
  } {
    const round = (value: number): number => Math.round(value * 1000) / 1000;
    return {
      sweeps: this.coherenceRuns,
      sweepMsMax: round(this.sweepMsMax),
      sweepMsAvg: this.coherenceRuns > 0 ? round(this.sweepMsTotal / this.coherenceRuns) : 0,
      classifyCalls: this.classifyCalls,
      classifyMisses: this.classifyMisses,
      plansComputed: this.plansComputed,
      sweepFrameReads: this.sweepFrameReads,
      drains: this.drains,
      queuePending: this.queue.pending,
      drainMsMax: round(this.drainMsMax),
      drainMsP50: round(percentile(this.drainSamples, 0.5)),
      drainMsP95: round(percentile(this.drainSamples, 0.95)),
      applyMsP50: round(percentile(this.applySamples, 0.5)),
      applyMsP95: round(percentile(this.applySamples, 0.95)),
      applySamples: this.applySamples.length,
      clampsApplied: this.clampsApplied,
      errors: this.errorCount,
    };
  }

  private pushSample(samples: number[], value: number): void {
    samples.push(value);
    while (samples.length > WindowSession.SAMPLE_RING) samples.shift();
  }

  /** §21: bounded state assertion. */
  memoryBounds(): { windows: number; sources: number; signals: number } {
    let signalCount = 0;
    for (const handlers of this.signals.values()) signalCount += handlers.length;
    const armed = (this.drainArmed[1] ? 1 : 0) + (this.drainArmed[2] ? 1 : 0) + (this.drainArmed[3] ? 1 : 0);
    return { windows: this.windows.size, sources: this.queue.pending > 0 ? armed : 0, signals: signalCount };
  }

  /** §21: retile timings for the perf event. */
  perf(): { lastReconcileMs: number; lastApplyMs: number; lastApplyAtMs: number } {
    return { lastReconcileMs: this.lastReconcileMs, lastApplyMs: this.lastApplyMs, lastApplyAtMs: this.lastApplyAtMs };
  }

  /**
   * §6/§17/§58: focus by direction, positional, never crossing a workspace. A
   * direction with nothing that way stays silent — that is the single exception
   * to "a request that changes nothing toasts".
   */
  focusDirection(direction: string): void {
    const current = this.focused();
    if (current === null) return;
    this.focusClosest(current, direction);
  }

  /**
   * Focus the nearest tile in `direction`, relative to the focused window.
   * Only the current workspace is considered: focus never navigates to another
   * workspace, it only reaches what is on screen (including other monitors).
   */
  private focusClosest(current: TrackedWindow, direction: string): boolean {
    const r = current.surface.frame;
    const candidates = this.tileables(current.surface.workspaceId)
      .filter((t) => t.id !== current.id)
      .map((t) => ({ id: t.id, rect: t.surface.frame }));
    const next = pickDirectional(r, candidates, direction as FocusDirection);
    if (next === null) return false;
    this.focus(next);
    return true;
  }
}

/** Nearest-rank percentile of a small bounded sample set; 0 when empty. */
function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}
