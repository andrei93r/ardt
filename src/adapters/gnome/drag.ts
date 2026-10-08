// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §6/§10/§11/§12/§14/§17: the drag and adjust controller.
 *
 * Owns the one drag/adjust state object (the window grab, the client-DnD freeze,
 * the inner-edge resize, the pending drop and the cross-screen arrival) and the
 * frame-signal paths that feed it. The drop policy is pure (`core/drag`,
 * `core/adjust`, `core/placement`); this module only gathers the live model
 * state and applies the decision through `DragDeps`. The live window map, the
 * classification, the pair sibling and every apply/journal hook stay in the
 * session.
 */

import GLib from 'gi://GLib';
import type { MetaWindow } from 'gi://Meta';

import { classifyAdjust } from '../../core/adjust.js';
import type { AdjustMode } from '../../core/adjust.js';
import { dragOutcome } from '../../core/drag.js';
import type { DragOutcome } from '../../core/drag.js';
import { dropPlacement } from '../../core/placement.js';
import type { SignatureCache } from '../../core/scheduler.js';
import { ratioKey, screenArea } from '../../core/tiler.js';
import type { TilerConfig, TilerWindow } from '../../core/tiler.js';
import type { Rect, Screen } from '../../core/types.js';
import { dragIsWindowMove } from '../../core/windowmove.js';
import * as compat from './compat.js';
import type { GnomeHost } from './host.js';
import type { History } from './history.js';
import type { Retiler } from './retiler.js';
import type { GnomeSettings } from './settings.js';
import type { Tiling } from './tiling.js';
import type { TrackedWindow } from './tracked-window.js';
import type { WorkspaceController } from './workspace.js';

/** The drag/adjust state, one object because the code already groups it. */
interface DragState {
  /** §11.3: a compositor window move is in flight (Super+drag). */
  dragging: boolean;
  /**
   * §6: true while an application drag-and-drop holds the pointer button with
   * no compositor window grab. The client is placing its own window; adrt
   * freezes reflow and interprets no drop. Deliberately not the window-move
   * state: no `dragId`, no preview, no drop interpretation.
   */
  clientInteracting: boolean;
  /** §6/§11: the grab began on a window adrt had not placed yet (a tear-off). */
  dragTearOff: boolean;
  dragStartRect: Rect | null;
  /** The window being dragged, so the preview overlay can follow it (§6/§11). */
  dragId: number | null;
  /** The plane the drag started on, so the drop can tell a return from an arrival. */
  dragStartWorkspace: number;
  dragStartScreen: number;
  /** A cross-screen move reported by a directional key; the drain arrives it. */
  crossScreenFrom: 'left' | 'right' | 'above' | 'below' | null;
  crossScreenId: number | null;
  /** The screen the move is heading to; the arrival waits until it lands there. */
  crossScreenTarget: number | null;
  /** When the dragged window last changed geometry (stale-drag watchdog). */
  dragLastActivityMs: number;
  adjustId: number | null;
  adjustSource: number | null;
  /**
   * A released drag whose gesture the drain still has to interpret. The rect the
   * gesture started from travels with the intent.
   */
  dropPending: Map<number, { mode: AdjustMode; start: Rect | null }>;
}

/** The slice of session state the drag controller needs. */
export interface DragDeps {
  readonly tiling: Tiling;
  readonly host: GnomeHost;
  readonly settings: GnomeSettings;
  readonly history: History;
  readonly workspaces: WorkspaceController;
  readonly signatures: SignatureCache;
  readonly retiler: Retiler;
  readonly windows: Map<number, TrackedWindow>;
  /** §11: notify the border/preview that a gesture started or ended. */
  readonly onDragChanged: (dragging: boolean) => void;
  classify(tracked: TrackedWindow): { tileable: boolean };
  screenFor(index: number): Screen | null;
  tileables(workspaceId: number): TrackedWindow[];
  tileablesOnScreen(workspaceId: number, screen: number, excludeId?: number): TrackedWindow[];
  slotFor(tracked: TrackedWindow): 0 | 1 | null;
  pairSibling(tracked: TrackedWindow): TrackedWindow | null;
  swapPairSides(a: TrackedWindow, b: TrackedWindow): void;
  tilerConfig(): TilerConfig;
  captureChange(ids: readonly number[], workspaceOverride?: number): void;
  withSelfUnmaximize(tracked: TrackedWindow, fn: () => void): void;
  scheduleReconcile(reason: string): void;
  scheduleRetile(workspaceId: number, reason: string): void;
  reconcileAll(reason: string, rememberUndo: boolean): void;
  /** Run a drag-end callback inside the session's error boundary. */
  runGuarded(cb: () => void): void;
  onStateChanged(): void;
  isPaused(): boolean;
  isSuspended(): boolean;
}

/** Quiet period after the last user frame change before a drop is interpreted. */
const ADJUST_SETTLE_MS = 150;
/**
 * A drag whose release never arrived must not disable tiling forever: every
 * path (reconcile, sweep, periodic retile) skips while a drag is set.
 */
const DRAG_STALE_MS = 2500;

export class DragController {
  private readonly state: DragState = {
    dragging: false,
    clientInteracting: false,
    dragTearOff: false,
    dragStartRect: null,
    dragId: null,
    dragStartWorkspace: 0,
    dragStartScreen: 0,
    crossScreenFrom: null,
    crossScreenId: null,
    crossScreenTarget: null,
    dragLastActivityMs: 0,
    adjustId: null,
    adjustSource: null,
    dropPending: new Map(),
  };

  constructor(private readonly deps: DragDeps) {}

  /** §11.3: while a drag is in flight, freeze reflow and hide the border. */
  isDragging(): boolean {
    return this.state.dragging || this.state.adjustId !== null;
  }

  /** §6: an application DnD is in progress (button held, no window grab). */
  clientInteractionActive(): boolean {
    return this.state.clientInteracting;
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
      active: this.isDragging(),
      windowDrag: this.state.dragging || this.state.adjustId !== null,
      clientInteraction: this.state.clientInteracting,
      dragId: this.state.dragId,
      adjustId: this.state.adjustId,
      button: compat.button1Pressed(),
      displayGrab: compat.displayGrabActive(),
    };
  }

  /** The raw compositor window-move flag (retile freezes only on this). */
  windowDragActive(): boolean {
    return this.state.dragging;
  }

  /** A drag or resize gesture is in flight. */
  gestureActive(): boolean {
    return this.isDragging();
  }

  /** Any gesture that freezes reflow and every reconcile pass. */
  flowBlocked(): boolean {
    return this.state.dragging || this.state.adjustId !== null || this.state.clientInteracting;
  }

  /**
   * A drag that never reported its release (a lost `grab-op-end`) disables every
   * tiling path, so it is abandoned once it has been quiet for a while and no
   * mouse button is held — the same test `isUserChange` uses.
   */
  recoverStaleDrag(): boolean {
    if (!this.dragIsStale()) return false;
    this.abandonDrag('stale');
    return true;
  }

  /** §6: lift the client-interaction freeze (the sweep calls this on release). */
  endClientInteraction(): void {
    this.state.clientInteracting = false;
  }

  /** A window is gone: drop any pending cross-screen move for it. */
  forgetWindow(id: number): void {
    if (this.state.crossScreenId === id) this.clearCrossScreenMove();
  }

  /** Cancel any owned adjust timeout (session teardown). */
  destroy(): void {
    if (this.state.adjustSource !== null) {
      GLib.source_remove(this.state.adjustSource);
      this.state.adjustSource = null;
    }
  }

  /** §6/§11: interpret every released drag the drain still owes. */
  flushPendingDrops(): void {
    for (const [id, pending] of [...this.state.dropPending]) {
      this.state.dropPending.delete(id);
      const tracked = this.deps.windows.get(id);
      if (tracked === undefined) continue;
      // §10/§12: restore the gesture's start rect for the interpretation — it
      // was captured by `endDrag` and must survive until the drain runs, or an
      // inner-edge resize cannot derive the new split ratio and reflows to the
      // old one (the snap-back).
      this.state.dragStartRect = pending.start;
      this.interpretDrop(tracked, pending.mode);
      this.state.dragStartRect = null;
    }
  }

  /**
   * §6: arrive a directional move that crossed a screen edge, but only once
   * Mutter has actually put the window on the target screen — `move_to_monitor`
   * is asynchronous and arriving early floats it against the source work area
   * (A106). The arrival is event-driven, so a pass that still sees the source
   * screen simply leaves the move pending — no retry counter, no private timer.
   */
  flushCrossScreen(): void {
    if (this.state.crossScreenId === null) return;
    const id = this.state.crossScreenId;
    const tracked = this.deps.windows.get(id);
    if (tracked === undefined) {
      this.clearCrossScreenMove();
      return;
    }
    tracked.refreshFrame();
    const target = this.state.crossScreenTarget;
    if (target === null || tracked.surface.screenId === target) {
      const from = this.state.crossScreenFrom ?? 'left';
      this.clearCrossScreenMove();
      this.arriveCrossScreen(tracked, from);
    }
  }

  onGrabBegin(win: MetaWindow, _op: number): void {
    if (win === null) return;
    this.beginDrag(win.get_id());
  }

  onGrabEnd(win: MetaWindow, _op: number): void {
    if (win === null) return;
    this.endDrag(win.get_id());
  }

  /** §11.3: while a drag is in flight, freeze reflow and hide the border. */
  beginDrag(id: number): boolean {
    const tracked = this.deps.windows.get(id);
    if (tracked === undefined) return false;
    if (this.state.dragging) return true;
    // §6/§11: a grab on a window adrt has not placed yet is a tab tear-off, not
    // a window move. The app created the window during the gesture (Chrome,
    // VS Code) and is moving it itself; it has no slot to swap out of, so its
    // drop must not be interpreted. Freeze reflow while the gesture owns the
    // geometry and route the newcomer once at the end.
    if (!dragIsWindowMove({ ready: tracked.ready, routePending: tracked.routePending })) {
      this.state.dragTearOff = true;
      this.state.clientInteracting = true;
      this.deps.onDragChanged(true);
      return true;
    }
    this.state.dragTearOff = false;
    // A real Meta grab supersedes a client-interaction freeze: the move is now
    // adrt's to follow and its drop to interpret.
    this.state.clientInteracting = false;
    this.state.dragging = true;
    this.state.dragId = id;
    this.state.dragLastActivityMs = Date.now();
    this.state.dragStartRect = { ...tracked.surface.frame };
    this.state.dragStartWorkspace = tracked.surface.workspaceId;
    this.state.dragStartScreen = tracked.surface.screenId;
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
  dragIsStale(): boolean {
    if (!this.state.dragging) return false;
    if (Date.now() - this.state.dragLastActivityMs < DRAG_STALE_MS) return false;
    return compat.button1Pressed() === false;
  }

  abandonDrag(reason: string): void {
    this.state.dragging = false;
    this.state.dragTearOff = false;
    this.state.dragId = null;
    this.state.dragLastActivityMs = 0;
    this.state.dragStartRect = null;
    this.deps.onDragChanged(false);
    this.deps.history.log('drag_abandoned', { reason });
    this.deps.signatures.clearAll();
    this.deps.reconcileAll('drag-abandoned', false);
  }

  /**
   * Drag released. §11: the signal handler only records the intent; the drain
   * interprets the gesture. - §12 inner-edge resize of a pair saves the new
   * split ratio; - §6 dragging one window past another swaps, takes a free
   * slot, or floats; - otherwise the workspace simply reflows.
   */
  endDrag(id: number): boolean {
    const tracked = this.deps.windows.get(id);
    if (tracked === undefined) return false;
    const wasDragging = this.state.dragging;
    const wasTearOff = this.state.dragTearOff;
    this.state.dragging = false;
    this.state.dragTearOff = false;
    this.state.clientInteracting = false;
    this.state.dragId = null;
    this.state.dragLastActivityMs = 0;
    this.deps.onDragChanged(false);
    if (!wasDragging) {
      // §6/§11: a tab tear-off interprets no drop. The freeze lifts and the
      // next drain routes the newcomer exactly once.
      if (wasTearOff) {
        this.deps.signatures.clearAll();
        this.deps.scheduleReconcile('tear-off');
      }
      return true;
    }

    tracked.refreshFrame();
    this.state.dropPending.set(id, { mode: this.adjustMode(tracked), start: this.state.dragStartRect });
    this.state.dragStartRect = null;
    this.deps.signatures.clearAll();
    this.deps.scheduleReconcile('drag-end');
    return true;
  }

  /** §6/§13: the window was dropped onto its sibling, so the pair trades sides. */
  applySwapIntent(tracked: TrackedWindow, sibling: TrackedWindow): void {
    this.deps.captureChange([tracked.id, sibling.id]);
    this.deps.tiling.toggleSwap(tracked.id, sibling.id);
    this.deps.swapPairSides(tracked, sibling);
    this.deps.history.log('swap', { a: tracked.id, b: sibling.id, reason: 'drag' });
  }

  /** §12: a shared inner edge moved; save the resulting ratio. */
  applyResizeIntent(tracked: TrackedWindow, sibling: TrackedWindow, screen: Screen): void {
    const start = this.state.dragStartRect;
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
    const key = ratioKey(screen.connector, tracked.surface.workspaceId, axis);
    this.deps.captureChange([tracked.id, sibling.id]);
    this.deps.tiling.setRatio(key, sortedFirstIsLeft ? ratioLeft : 1 - ratioLeft);
    this.deps.history.log('split_resize', { pair: key, ratio: ratioLeft, reason: 'drag' });
  }

  onFrameSignal(tracked: TrackedWindow): void {
    tracked.refreshFrame();

    // A server-side grab is in flight (Super+drag): follow, do not reflow.
    if (this.state.dragging) {
      this.state.dragLastActivityMs = Date.now();
      this.deps.onStateChanged();
      return;
    }
    // A change we caused ourselves while following the user's resize.
    if (this.state.adjustId !== null && this.state.adjustId !== tracked.id) {
      this.deps.onStateChanged();
      return;
    }
    // The user is adjusting this window. Client-side/CSD resizes never emit a
    // grab op, so this is the only signal we get.
    if (this.state.adjustId === tracked.id) {
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
        this.deps.signatures.clear(`ws:${tracked.surface.workspaceId}`);
        this.deps.scheduleRetile(tracked.surface.workspaceId, 'size-hints');
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
    this.deps.scheduleRetile(tracked.surface.workspaceId, 'frame');
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
  trackClientInteraction(): boolean {
    if (!compat.button1Pressed()) {
      if (this.state.clientInteracting) {
        this.state.clientInteracting = false;
        // The freeze is lifted: one deferred pass routes the newcomer and
        // settles the layout, even if no further frame signal arrives.
        this.deps.scheduleReconcile('client-interaction-end');
      }
      return false;
    }
    if (compat.displayGrabActive() === false) {
      this.state.clientInteracting = true;
      return true;
    }
    return false;
  }

  /** A geometry change that did not come from us is the user moving a window. */
  isUserChange(tracked: TrackedWindow): boolean {
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

  beginUserAdjust(tracked: TrackedWindow): void {
    this.state.adjustId = tracked.id;
    this.state.dragId = tracked.id;
    // Anchor to the last geometry we planned: `surface.frame` is already the
    // user's new rect by the time this signal arrives.
    this.state.dragStartRect = { ...(tracked.lastTarget ?? tracked.surface.frame) };
    this.state.dragStartWorkspace = tracked.surface.workspaceId;
    this.state.dragStartScreen = tracked.surface.screenId;
    this.deps.onDragChanged(true);
  }

  armAdjustEnd(tracked: TrackedWindow): void {
    if (this.state.adjustSource !== null) {
      GLib.source_remove(this.state.adjustSource);
      this.state.adjustSource = null;
    }
    this.state.adjustSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ADJUST_SETTLE_MS, () => {
      this.state.adjustSource = null;
      // §Self-heal containment: never escape the source dispatch uncaught.
      this.deps.runGuarded(() => this.endUserAdjust(tracked));
      return GLib.SOURCE_REMOVE;
    });
  }

  endUserAdjust(tracked: TrackedWindow): void {
    if (this.state.adjustId !== tracked.id) return;
    const mode = this.adjustMode(tracked);
    this.state.adjustId = null;
    this.state.dragId = null;
    this.deps.onDragChanged(false);
    this.interpretDrop(tracked, mode);
    this.state.dragStartRect = null;
    this.deps.signatures.clearAll();
    this.deps.scheduleRetile(tracked.surface.workspaceId, 'user-adjust');
  }

  adjustMode(tracked: TrackedWindow): AdjustMode {
    const start = this.state.dragStartRect;
    if (start === null) return 'move';
    // Geometry-only, and deliberately strict: a size change on both axes is a
    // move (an overview drop scales the window to its target), never an
    // inner-edge resize — reading it as one would save a bogus split ratio that
    // then persists for that pair of apps.
    return classifyAdjust(start, tracked.surface.frame);
  }

  /** Keep the sibling in step with the user's live resize. */
  followSibling(tracked: TrackedWindow): void {
    const sibling = this.deps.pairSibling(tracked);
    const screen = this.deps.screenFor(tracked.surface.screenId);
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

  effectiveGap(area: Rect): number {
    const base = this.deps.settings.int('gaps-base', 8);
    const override = area.height > area.width
      ? this.deps.settings.int('gaps-portrait', -1)
      : this.deps.settings.int('gaps-landscape', -1);
    return override >= 0 ? override : base;
  }

  interpretDrop(tracked: TrackedWindow, mode: AdjustMode): void {
    const screen = this.deps.screenFor(tracked.surface.screenId);
    if (screen === null) return;
    const sibling = this.deps.pairSibling(tracked);
    const samePlane = tracked.surface.workspaceId === this.state.dragStartWorkspace && tracked.surface.screenId === this.state.dragStartScreen;

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
    const id = this.state.dragId ?? this.state.adjustId;
    if (id === null) return null;
    const tracked = this.deps.windows.get(id);
    if (tracked === undefined) return null;
    tracked.refreshFrame();
    return this.dragOutcomeFor(tracked, this.adjustMode(tracked));
  }

  /**
   * §6/§11: the one drag decision, shared by the preview and the drop. A
   * same-plane crossing swaps; a cross-plane drop follows §6's ladder; both
   * return the exact landing rect so the two can never disagree.
   */
  dragOutcomeFor(tracked: TrackedWindow, mode: AdjustMode): DragOutcome | null {
    const screen = this.deps.screenFor(tracked.surface.screenId);
    if (screen === null) return null;
    const sibling = this.deps.pairSibling(tracked);
    const samePlane =
      tracked.surface.workspaceId === this.state.dragStartWorkspace && tracked.surface.screenId === this.state.dragStartScreen;
    if (sibling !== null && samePlane && mode === 'resize' && !this.overlaps(tracked.surface.frame, sibling.surface.frame)) {
      return null;
    }
    const crossed = samePlane ? this.crossedWindow(tracked) : null;
    return dragOutcome({
      state: this.deps.retiler.buildPlacementState(tracked.id, tracked.surface.screenId),
      env: this.deps.retiler.placementEnv(tracked.surface.screenId),
      id: tracked.id,
      workspace: tracked.surface.workspaceId,
      from: this.dropFrom(tracked),
      crossed,
      // §6: only a managed (tileable) window has a landing decision. A dragged
      // dialog, popup, skip-taskbar utility, always-on-top widget, fixed-size
      // client or never-tiled app gets no drop-assist highlight and no
      // swap/slot/maximize — the drag is a plain move. This is the one place the
      // preview and the drop both read, so they can never disagree.
      managed: this.deps.classify(tracked).tileable,
      samePlane,
      screen,
      config: this.deps.tilerConfig(),
      dragged: this.dragTilerWindow(tracked),
      othersByWorkspace: this.previewOthers(tracked),
      dropped: { ...tracked.surface.frame },
    });
  }

  /** A window's tiler description with the side it currently occupies (§13). */
  dragTilerWindow(tracked: TrackedWindow): TilerWindow {
    return { ...this.deps.retiler.toTilerWindow(tracked), slot: this.deps.slotFor(tracked) ?? undefined };
  }

  /** Every other tileable window on the dragged screen, grouped by workspace. */
  previewOthers(tracked: TrackedWindow): Map<number, TilerWindow[]> {
    const map = new Map<number, TilerWindow[]>();
    const count = global.workspace_manager.get_n_workspaces();
    for (let workspace = 0; workspace < count; workspace++) {
      const list: TilerWindow[] = [];
      for (const other of this.deps.tileables(workspace)) {
        if (other.id === tracked.id) continue;
        if (other.surface.screenId !== tracked.surface.screenId) continue;
        list.push(this.dragTilerWindow(other));
      }
      map.set(workspace, list);
    }
    return map;
  }

  /** The direction a drop arrived from, from the plane it started on (§3/§6). */
  dropFrom(tracked: TrackedWindow): 'left' | 'right' | 'above' | 'below' | null {
    if (tracked.surface.screenId !== this.state.dragStartScreen) {
      const from = this.deps.screenFor(this.state.dragStartScreen);
      const to = this.deps.screenFor(tracked.surface.screenId);
      if (from !== null && to !== null) {
        if (to.geometry.x > from.geometry.x) return 'left';
        if (to.geometry.x < from.geometry.x) return 'right';
        if (to.geometry.y > from.geometry.y) return 'above';
        if (to.geometry.y < from.geometry.y) return 'below';
      }
    }
    if (tracked.surface.workspaceId !== this.state.dragStartWorkspace) {
      return tracked.surface.workspaceId > this.state.dragStartWorkspace ? 'left' : 'right';
    }
    return null;
  }

  /** A visible managed window on the drop's plane whose rect the drop crosses. */
  crossedWindow(tracked: TrackedWindow): number | null {
    const rect = tracked.surface.frame;
    let best: number | null = null;
    let bestOverlap = 0;
    for (const other of this.deps.windows.values()) {
      if (other.id === tracked.id) continue;
      if (other.surface.workspaceId !== tracked.surface.workspaceId) continue;
      if (other.surface.screenId !== tracked.surface.screenId) continue;
      if (other.surface.flags.minimized) continue;
      if (!this.deps.classify(other).tileable) continue;
      const overlap = this.overlapArea(rect, other.surface.frame);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = other.id;
      }
    }
    return best;
  }

  /** Any genuine overlap of two rects, with a couple of pixels of slack. */
  overlaps(a: Rect, b: Rect): boolean {
    return this.overlapArea(a, b) > 4;
  }

  overlapArea(a: Rect, b: Rect): number {
    const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) - 2);
    const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) - 2);
    return x * y;
  }

  /** Apply the pure drop decision through Mutter. */
  applyDropResult(
    tracked: TrackedWindow,
    result: ReturnType<typeof dropPlacement>,
  ): void {
    const workspaceChanged = result.workspace !== tracked.surface.workspaceId;
    // §13: a drop is a user move, so it is undoable; capture the origin first.
    this.deps.captureChange([tracked.id]);
    if (workspaceChanged) this.deps.workspaces.moveWindow(tracked, result.workspace);
    switch (result.kind) {
      case 'slot':
        this.deps.retiler.pinSlots(result.workspace, tracked, result.slot);
        this.deps.retiler.unmaximizeOccupants(result.workspace, tracked.id);
        break;
      case 'maximize':
        this.deps.tiling.noteSelfApply();
        this.deps.tiling.noteSelfMaximize();
        this.deps.host.maximize(tracked.id);
        break;
      case 'swap': {
        const withWin = this.deps.windows.get(result.with);
        if (withWin !== undefined) this.applySwapIntent(tracked, withWin);
        break;
      }
      case 'float':
        this.deps.retiler.floatWindow(tracked);
        break;
      default:
        break;
    }
    this.deps.signatures.clearAll();
    this.deps.scheduleReconcile('drop');
  }

  /**
   * §6/§14: move to the adjacent screen in `direction`, chosen by geometry; the
   * target screen's own drop ladder (free slot on the side it came from, a
   * crossing swap, else a float) is applied from the drain.
   */
  moveToAdjacentMonitor(tracked: TrackedWindow, direction: string): void {
    const target = this.adjacentScreen(tracked, direction);
    if (target === null) return;
    // §Shell stability: the screen was chosen from the cached list; only make
    // the Mutter call while its index still exists in the live monitor list.
    // An index that vanished mid-transition asserts inside the compositor.
    if (!this.deps.host.isLiveMonitorIndex(target.index)) return;
    this.deps.captureChange([tracked.id]);
    tracked.win.move_to_monitor(target.index);
    tracked.userMovedAtMs = Date.now();
    this.state.crossScreenId = tracked.id;
    this.state.crossScreenFrom = direction === 'right' ? 'left' : direction === 'left' ? 'right' : direction === 'down' ? 'above' : 'below';
    // `move_to_monitor` is asynchronous: the arrival ladder must not run while
    // the window is still on the source screen, or its float rect (computed from
    // the source work area) drags it straight back (A106). `window-entered-
    // monitor` re-queues the drain when it lands; until then the move stays
    // pending.
    this.state.crossScreenTarget = target.index;
    this.deps.signatures.clearAll();
    this.deps.scheduleReconcile('move-monitor');
  }

  clearCrossScreenMove(): void {
    this.state.crossScreenId = null;
    this.state.crossScreenFrom = null;
    this.state.crossScreenTarget = null;
  }

  /**
   * The screen next to this one in `direction`, chosen purely by geometry —
   * never by index. A candidate must lie on the requested side (its centre
   * past ours on that axis); a screen whose perpendicular extent overlaps ours
   * wins over one that does not, and among those the nearest edge wins. This
   * keeps the choice honest in a mixed landscape/portrait layout, where array
   * order and physical adjacency need not agree.
   */
  adjacentScreen(tracked: TrackedWindow, direction: string): Screen | null {
    const screens = this.deps.host.screens();
    const from = this.deps.screenFor(tracked.surface.screenId);
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
  arriveCrossScreen(tracked: TrackedWindow, from: 'left' | 'right' | 'above' | 'below'): void {
    tracked.refreshFrame();
    // A maximized window dragged across screens is un-maximized at the drop.
    if (compat.isMaximized(tracked.win)) {
      this.deps.withSelfUnmaximize(tracked, () => this.deps.host.unmaximize(tracked.id));
      tracked.refreshFrame();
    }
    const crossed = this.crossedWindow(tracked);
    const env = this.deps.retiler.placementEnv(tracked.surface.screenId);
    const state = this.deps.retiler.buildPlacementState(tracked.id, tracked.surface.screenId);
    const result = dropPlacement(state, env, tracked.id, tracked.surface.workspaceId, from, crossed);
    this.applyDropResult(tracked, result);
  }
}
