// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Touchpad gesture wiring (§41). All decisions live in `core/gestures.ts`;
 * this file only produces `GestureEvent`s and dispatches `GestureAction`s.
 * `simulate()` is the D-Bus `SimulateGesture` path (§41.1).
 *
 * §41.4 real wiring: modern Shells recognise gestures with the Clutter gesture
 * stack. Two feature-detected sources feed the pure machine:
 *
 *  1. raw `event::touchpad` swipe/pinch events on the stage, which carry the
 *     finger count, the unaccelerated motion delta and the pinch scale. This is
 *     the only source that sees 4-finger swipes and pinch gestures.
 *  2. a `Clutter.PanGesture` recognizer on the stage, which covers touchscreen
 *     pans (three to four points) and is the recogniser GNOME Shell itself uses.
 *
 * The pre-45 `Clutter.GestureAction` is kept only as a last-resort fallback for
 * a Shell where neither modern source exists; it cannot distinguish finger
 * counts, so 4-finger and pinch are unavailable there.
 *
 * `gesture-enabled` gates every path (the adapter is not installed at all when
 * off, so GNOME's own gestures are untouched) and `gesture-sensitivity` is the
 * travel threshold, applied by `feedGesture` (§41.2).
 */

import Clutter from 'gi://Clutter';

import type { GestureAction, GestureConfig, GestureKind, GesturePhase, GestureState } from '../../core/gestures.js';
import { feedGesture, initialGestureState } from '../../core/gestures.js';
import * as compat from './compat.js';
import type { History } from './history.js';
import type { GnomeSettings } from './settings.js';

export interface GestureDispatcher {
  switchWorkspace(direction: 'left' | 'right' | 'up' | 'down'): void;
  toggleOverview(): void;
  showDesktop(): void;
  swapPair(direction: 'left' | 'right'): void;
  custom(action: string): void;
}

const SIMULATED_STEPS = 4;
/** Travel a raw touchpad/pan swipe must accumulate before it commits to an axis. */
const SWIPE_COMMIT_PX = 16;
/** Pixels one unit of pinch scale counts as, so pinch uses the same threshold. */
const PINCH_TRAVEL_PX = 600;
/** Scale change that commits a pinch to in/out, ignoring jitter. */
const PINCH_COMMIT = 0.02;
const MIN_SWIPE_FINGERS = 3;
const MAX_SWIPE_FINGERS = 4;

/**
 * Structural views of the GJS gesture objects. `gi.d.ts` declares `Clutter` as
 * `any`, so each view names only the members this file calls and marks optional
 * exactly what the code probes — the same pattern as `compat.ts`.
 */

/** A Clutter action (the `PanGesture`, or the legacy `GestureAction`) on the stage. */
interface ClutterActionLike {
  connect<A extends unknown[]>(signal: string, callback: (...args: A) => unknown): number;
  disconnect(id: number): void;
}

/** The modern `Clutter.PanGesture`, read for its point count and delta. */
interface PanGestureLike extends ClutterActionLike {
  get_n_points?(): number;
  get_delta_abs?(): { get_x?(): number; x?: number; get_y?(): number; y?: number };
}

/** The `Clutter.Stage` methods the gesture wiring uses. */
interface GestureStageLike {
  connect<A extends unknown[]>(signal: string, callback: (...args: A) => unknown): number;
  disconnect(id: number): void;
  add_action(action: ClutterActionLike): void;
  remove_action(action: ClutterActionLike): void;
}

/** The recognizer constructors/enums, exactly where `Clutter` is dynamic (§41.4). */
interface PanGestureApi {
  PanGesture: new (params: { min_n_points: number; max_n_points: number; pan_axis: number }) => PanGestureLike;
  PanAxis?: { BOTH?: number };
}

/** The legacy pre-45 `new Clutter.GestureAction()` (§41.4). */
interface GestureActionApi {
  GestureAction: new () => ClutterActionLike;
}

/** A `Clutter.Event` carrying a raw touchpad swipe/pinch, as `compat` reads it. */
interface TouchpadGestureEventLike {
  type(): unknown;
  get_gesture_phase?(): unknown;
  get_touchpad_gesture_finger_count?(): unknown;
  get_gesture_pinch_scale?(): unknown;
  get_gesture_motion_delta_unaccelerated(): [unknown, unknown];
}

interface SwipeTracker {
  kind: GestureKind | null;
  fingers: number;
  dx: number;
  dy: number;
  /** True once the axis has been decided and a `begin` has been fed. */
  started: boolean;
}

interface PinchTracker {
  kind: GestureKind | null;
  fingers: number;
  /** Last scale fed, so per-update deltas can be derived. */
  scale: number;
  started: boolean;
}

function emptySwipe(): SwipeTracker {
  return { kind: null, fingers: MIN_SWIPE_FINGERS, dx: 0, dy: 0, started: false };
}

function emptyPinch(): PinchTracker {
  return { kind: null, fingers: 2, scale: 1, started: false };
}

export class GestureInput {
  private state: GestureState = initialGestureState();
  /** Legacy `Clutter.GestureAction` (last-resort fallback only). */
  private action: ClutterActionLike | null = null;
  private signalIds: number[] = [];
  private lastPointer: [number, number] | null = null;
  /** Modern `Clutter.PanGesture` recognizer on the stage. */
  private panGesture: PanGestureLike | null = null;
  private panSignalIds: number[] = [];
  private pan: SwipeTracker = emptySwipe();
  /** Raw touchpad swipe/pinch events on the stage. */
  private stage: GestureStageLike | null = null;
  private touchpadSignalId = 0;
  private touchpad: SwipeTracker = emptySwipe();
  private pinch: PinchTracker = emptyPinch();

  constructor(
    private readonly settings: GnomeSettings,
    private readonly history: History,
    private readonly dispatch: GestureDispatcher,
  ) {}

  configure(): void {
    this.disable();
    // §41.5: when every configured action matches GNOME's own, defer to GNOME.
    if (!this.config().enabled || !this.overridesBuiltin()) return;
    // §41.4: prefer the modern recognizers; only a Shell without both falls
    // back to the legacy private action.
    const touchpad = this.attachTouchpadGestures();
    const pan = this.attachPanGesture();
    if (!touchpad && !pan) this.connectClutterAction();
  }

  enable(): void {
    this.configure();
  }

  disable(): void {
    if (this.touchpadSignalId !== 0) {
      try {
        this.stage?.disconnect(this.touchpadSignalId);
      } catch {
        /* stage gone */
      }
      this.touchpadSignalId = 0;
    }
    this.stage = null;
    if (this.panGesture !== null) {
      for (const id of this.panSignalIds) {
        try {
          this.panGesture.disconnect(id);
        } catch {
          /* action gone */
        }
      }
      this.panSignalIds = [];
      try {
        global.stage.remove_action(this.panGesture);
      } catch {
        /* action gone */
      }
      this.panGesture = null;
    }
    if (this.action !== null) {
      for (const id of this.signalIds) this.action.disconnect(id);
      this.signalIds = [];
      global.stage.remove_action(this.action);
      this.action = null;
    }
    this.touchpad = emptySwipe();
    this.pinch = emptyPinch();
    this.pan = emptySwipe();
  }

  get hasRealWiring(): boolean {
    return this.action !== null || this.panGesture !== null || this.touchpadSignalId !== 0;
  }

  /**
   * Drive the pure state machine with a synthetic begin → update → end
   * sequence. Returns true when the gesture produced a non-`none` action.
   */
  simulate(kind: GestureKind, deltaX: number, deltaY: number, touchPoints: number): boolean {
    const config = this.config();
    if (!config.enabled) return false;

    this.state = initialGestureState();
    let result: GestureAction | null = feedGesture(
      this.state,
      { kind, phase: 'begin', progress: 0, deltaX: 0, deltaY: 0, direction: null, touchPoints, timestampUs: 0 },
      config,
    );
    for (let step = 1; step <= SIMULATED_STEPS; step++) {
      const isLast = step === SIMULATED_STEPS;
      result = feedGesture(
        this.state,
        {
          kind,
          phase: isLast ? 'end' : 'update',
          progress: step / SIMULATED_STEPS,
          deltaX: deltaX / SIMULATED_STEPS,
          deltaY: deltaY / SIMULATED_STEPS,
          direction: null,
          touchPoints,
          timestampUs: 0,
        },
        config,
      );
    }

    if (result === null || result.type === 'none') return false;
    this.apply(result);
    return true;
  }

  private apply(action: GestureAction): void {
    this.history.log('gesture', { action: action.type });
    switch (action.type) {
      case 'switch-workspace':
        this.dispatch.switchWorkspace(action.direction);
        break;
      case 'toggle-overview':
        this.dispatch.toggleOverview();
        break;
      case 'show-desktop':
        this.dispatch.showDesktop();
        break;
      case 'swap-pair':
        this.dispatch.swapPair(action.direction);
        break;
      case 'custom':
        this.dispatch.custom(action.action);
        break;
      default:
        break;
    }
  }

  private config(): GestureConfig {
    return {
      enabled: this.settings.boolean('gesture-enabled', true),
      swipe3Horizontal: this.settings.string('gesture-3-swipe-action', 'switch-workspace') as GestureConfig['swipe3Horizontal'],
      swipe3Vertical: this.settings.string('gesture-3-vertical-action', 'toggle-overview') as GestureConfig['swipe3Vertical'],
      swipe4Horizontal: this.settings.string('gesture-4-swipe-action', 'switch-workspace') as GestureConfig['swipe4Horizontal'],
      swipe4Vertical: this.settings.string('gesture-4-vertical-action', 'none') as GestureConfig['swipe4Vertical'],
      pinchAction: this.settings.string('gesture-pinch-action', 'show-desktop') as GestureConfig['pinchAction'],
      sensitivity: this.settings.int('gesture-sensitivity', 50),
    };
  }

  /** True when any configured action differs from GNOME's own gestures. */
  private overridesBuiltin(): boolean {
    const config = this.config();
    return (
      config.swipe3Horizontal !== 'switch-workspace' ||
      config.swipe3Vertical !== 'toggle-overview' ||
      config.swipe4Horizontal !== 'none' ||
      config.swipe4Vertical !== 'none' ||
      config.pinchAction !== 'none'
    );
  }

  /** Feed one normalised event into the pure machine with the live config. */
  private feed(kind: GestureKind, phase: GesturePhase, deltaX: number, deltaY: number, touchPoints: number): GestureAction | null {
    return feedGesture(
      this.state,
      {
        kind,
        phase,
        progress: phase === 'end' ? 1 : 0,
        deltaX,
        deltaY,
        direction: null,
        touchPoints,
        timestampUs: 0,
      },
      this.config(),
    );
  }

  private swipeKind(fingers: number, horizontal: boolean): GestureKind {
    const four = fingers >= MAX_SWIPE_FINGERS;
    if (horizontal) return four ? 'swipe-4-horizontal' : 'swipe-3-horizontal';
    return four ? 'swipe-4-vertical' : 'swipe-3-vertical';
  }

  /**
   * Decide the axis of a pending swipe once it has travelled far enough, then
   * feed the state machine's `begin`. Returns true once committed.
   */
  private commitSwipe(tracker: SwipeTracker, fingers: number): boolean {
    if (tracker.started) return true;
    if (Math.hypot(tracker.dx, tracker.dy) < SWIPE_COMMIT_PX) return false;
    const horizontal = Math.abs(tracker.dx) >= Math.abs(tracker.dy);
    tracker.kind = this.swipeKind(fingers, horizontal);
    tracker.started = true;
    this.state = initialGestureState();
    this.feed(tracker.kind, 'begin', 0, 0, fingers);
    return true;
  }

  private finishSwipe(tracker: SwipeTracker, phase: 'end' | 'cancel'): void {
    if (!tracker.started || tracker.kind === null) return;
    const action = this.feed(tracker.kind, phase, 0, 0, tracker.fingers);
    if (action !== null && action.type !== 'none') this.apply(action);
  }

  // ---------------------------------------------------------- raw touchpad

  private attachTouchpadGestures(): boolean {
    if (!compat.hasTouchpadGestureEvents()) return false;
    const stage: GestureStageLike | null | undefined = global.stage;
    if (stage === null || stage === undefined || typeof stage.connect !== 'function') return false;
    try {
      this.touchpadSignalId = stage.connect('event::touchpad', (_stage: GestureStageLike, event: TouchpadGestureEventLike) => this.onTouchpadEvent(event));
      this.stage = stage;
      return true;
    } catch (e) {
      console.error(`[adrt] failed to install touchpad gesture listener: ${(e as Error).message}`);
      this.touchpadSignalId = 0;
      this.stage = null;
      return false;
    }
  }

  /** Return `EVENT_STOP` once we own a gesture, so GNOME's own handler defers. */
  private onTouchpadEvent(event: TouchpadGestureEventLike): boolean {
    if (!this.config().enabled) return Clutter.EVENT_PROPAGATE;
    const reading = compat.readTouchpadGesture(event);
    if (reading === null) return Clutter.EVENT_PROPAGATE;
    return reading.type === 'pinch' ? this.onTouchpadPinch(reading) : this.onTouchpadSwipe(reading);
  }

  private onTouchpadSwipe(reading: compat.TouchpadGestureReading): boolean {
    const fingers = reading.fingers;
    if (fingers < MIN_SWIPE_FINGERS || fingers > MAX_SWIPE_FINGERS) return Clutter.EVENT_PROPAGATE;

    if (reading.phase === 'begin') {
      this.touchpad = emptySwipe();
      this.touchpad.fingers = fingers;
      // Own the gesture from its first event so GNOME's built-in tracker never
      // starts it in parallel; the action is only dispatched once it commits.
      return Clutter.EVENT_STOP;
    }
    if (reading.phase === 'update') {
      this.touchpad.dx += reading.deltaX;
      this.touchpad.dy += reading.deltaY;
      if (this.commitSwipe(this.touchpad, fingers)) {
        this.feed(this.touchpad.kind as GestureKind, 'update', reading.deltaX, reading.deltaY, fingers);
      }
      return Clutter.EVENT_STOP;
    }

    this.finishSwipe(this.touchpad, reading.phase === 'cancel' ? 'cancel' : 'end');
    this.touchpad = emptySwipe();
    return Clutter.EVENT_STOP;
  }

  private commitPinch(scale: number, fingers: number): boolean {
    if (this.pinch.started) return true;
    if (Math.abs(scale - 1) < PINCH_COMMIT) return false;
    this.pinch.kind = scale < 1 ? 'pinch-in' : 'pinch-out';
    this.pinch.started = true;
    this.pinch.scale = scale;
    this.state = initialGestureState();
    this.feed(this.pinch.kind, 'begin', 0, 0, fingers);
    return true;
  }

  private onTouchpadPinch(reading: compat.TouchpadGestureReading): boolean {
    const fingers = reading.fingers > 0 ? reading.fingers : 2;

    if (reading.phase === 'begin') {
      this.pinch = emptyPinch();
      this.pinch.fingers = fingers;
      this.pinch.scale = reading.scale;
      return Clutter.EVENT_STOP;
    }
    if (reading.phase === 'update') {
      if (this.commitPinch(reading.scale, fingers)) {
        const delta = (reading.scale - this.pinch.scale) * PINCH_TRAVEL_PX;
        this.pinch.scale = reading.scale;
        this.feed(this.pinch.kind as GestureKind, 'update', delta, 0, fingers);
      }
      return Clutter.EVENT_STOP;
    }

    if (this.pinch.started && this.pinch.kind !== null) {
      const delta = (reading.scale - this.pinch.scale) * PINCH_TRAVEL_PX;
      if (delta !== 0) this.feed(this.pinch.kind, 'update', delta, 0, fingers);
      const action = this.feed(this.pinch.kind, reading.phase === 'cancel' ? 'cancel' : 'end', 0, 0, fingers);
      if (action !== null && action.type !== 'none') this.apply(action);
    }
    this.pinch = emptyPinch();
    return Clutter.EVENT_STOP;
  }

  // ------------------------------------------------------- pan recognizer

  private attachPanGesture(): boolean {
    if (!compat.hasPanGesture()) return false;
    try {
      // `Clutter` is declared `any`: this view is the recognizer surface used here.
      const api: PanGestureApi = Clutter;
      this.panGesture = new api.PanGesture({
        min_n_points: MIN_SWIPE_FINGERS,
        max_n_points: MAX_SWIPE_FINGERS,
        pan_axis: api.PanAxis?.BOTH ?? 0,
      });
      this.panSignalIds.push(this.panGesture.connect('recognize', () => this.onPanRecognize()));
      this.panSignalIds.push(this.panGesture.connect('pan-update', () => this.onPanUpdate()));
      this.panSignalIds.push(this.panGesture.connect('end', () => this.onPanEnd(false)));
      this.panSignalIds.push(this.panGesture.connect('cancel', () => this.onPanEnd(true)));
      global.stage.add_action(this.panGesture);
      return true;
    } catch (e) {
      console.error(`[adrt] failed to install pan gesture recognizer: ${(e as Error).message}`);
      this.panSignalIds = [];
      this.panGesture = null;
      return false;
    }
  }

  private onPanRecognize(): void {
    let fingers = MIN_SWIPE_FINGERS;
    try {
      const points = Number(this.panGesture?.get_n_points?.() ?? MIN_SWIPE_FINGERS);
      if (points >= MIN_SWIPE_FINGERS && points <= MAX_SWIPE_FINGERS) fingers = points;
    } catch {
      fingers = MIN_SWIPE_FINGERS;
    }
    this.pan = emptySwipe();
    this.pan.fingers = fingers;
  }

  private onPanUpdate(): void {
    if (!this.config().enabled) return;
    let dx = 0;
    let dy = 0;
    try {
      const delta = this.panGesture?.get_delta_abs?.();
      dx = Number(delta?.get_x?.() ?? delta?.x ?? 0) || 0;
      dy = Number(delta?.get_y?.() ?? delta?.y ?? 0) || 0;
    } catch {
      dx = 0;
      dy = 0;
    }
    this.pan.dx += dx;
    this.pan.dy += dy;
    if (!this.commitSwipe(this.pan, this.pan.fingers)) return;
    this.feed(this.pan.kind as GestureKind, 'update', dx, dy, this.pan.fingers);
  }

  private onPanEnd(cancelled: boolean): void {
    this.finishSwipe(this.pan, cancelled ? 'cancel' : 'end');
    this.pan = emptySwipe();
  }

  // ------------------------------------------------------ legacy fallback

  private connectClutterAction(): void {
    if (!compat.hasLegacyGestureAction()) return;
    try {
      // `Clutter` is declared `any`: this view is the legacy action constructor.
      const api: GestureActionApi = Clutter;
      this.action = new api.GestureAction();
      global.stage.add_action(this.action);
      this.signalIds.push(this.action.connect('gesture-begin', () => this.onClutterPhase('begin')));
      this.signalIds.push(this.action.connect('gesture-end', () => this.onClutterPhase('end')));
      this.signalIds.push(this.action.connect('gesture-cancel', () => this.onClutterPhase('cancel')));
    } catch (e) {
      console.error(`[adrt] failed to install gesture action: ${(e as Error).message}`);
      this.action = null;
      this.signalIds = [];
    }
  }

  /**
   * Legacy path only: the pre-45 action exposes begin/end without a finger
   * count, so direction comes from the pointer delta and every swipe is treated
   * as three-finger. Modern Shells never reach this.
   */
  private onClutterPhase(phase: 'begin' | 'end' | 'cancel'): void {
    const [x, y] = global.get_pointer();
    if (phase === 'begin') {
      this.state = initialGestureState();
      this.lastPointer = [x, y];
      feedGesture(
        this.state,
        { kind: 'swipe-3-horizontal', phase: 'begin', progress: 0, deltaX: 0, deltaY: 0, direction: null, touchPoints: 3, timestampUs: 0 },
        this.config(),
      );
      return;
    }
    const start = this.lastPointer ?? [x, y];
    const dx = x - start[0];
    const dy = y - start[1];
    const kind: GestureKind = Math.abs(dx) >= Math.abs(dy) ? 'swipe-3-horizontal' : 'swipe-3-vertical';
    const action = feedGesture(
      this.state,
      { kind, phase: phase === 'cancel' ? 'cancel' : 'end', progress: 1, deltaX: dx, deltaY: dy, direction: null, touchPoints: 3, timestampUs: 0 },
      this.config(),
    );
    this.lastPointer = null;
    if (action !== null && action.type !== 'none') this.apply(action);
  }
}
