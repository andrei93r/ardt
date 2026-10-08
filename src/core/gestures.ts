// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Pure gesture state machine (§41.2). All decisions live here; the adapter
 * only feeds events. `SimulateGesture` drives this exact code path (§41.1).
 */

export type GestureKind =
  | 'swipe-3-horizontal'
  | 'swipe-3-vertical'
  | 'swipe-4-horizontal'
  | 'swipe-4-vertical'
  | 'pinch-in'
  | 'pinch-out'
  | 'hold-3-swipe';

export type GesturePhase = 'begin' | 'update' | 'end' | 'cancel';

export interface GestureEvent {
  kind: GestureKind;
  phase: GesturePhase;
  progress: number;
  deltaX: number;
  deltaY: number;
  direction: 'left' | 'right' | 'up' | 'down' | null;
  touchPoints: number;
  timestampUs: number;
}

export interface GestureState {
  activeKind: GestureKind | null;
  startX: number;
  startY: number;
  accumulatedX: number;
  accumulatedY: number;
  touchPoints: number;
  phase: GesturePhase;
  startedAtUs: number;
}

export interface GestureConfig {
  enabled: boolean;
  swipe3Horizontal: GestureActionType;
  swipe3Vertical: GestureActionType;
  swipe4Horizontal: GestureActionType;
  swipe4Vertical: GestureActionType;
  pinchAction: GestureActionType;
  /** 0–100; higher means a smaller travel threshold. */
  sensitivity: number;
}

export type GestureActionType =
  | 'switch-workspace'
  | 'toggle-overview'
  | 'show-desktop'
  | 'swap-pair'
  | 'none'
  | `custom:${string}`;

export type GestureAction =
  | { type: 'switch-workspace'; direction: 'left' | 'right' | 'up' | 'down' }
  | { type: 'toggle-overview' }
  | { type: 'show-desktop' }
  | { type: 'swap-pair'; direction: 'left' | 'right' }
  | { type: 'custom'; action: string }
  | { type: 'none' };

/**
 * The shared below-threshold/cancel answer. Frozen so one caller mutating the
 * object it received cannot corrupt what every later completion returns.
 */
const NONE_ACTION: GestureAction = Object.freeze({ type: 'none' });

export function initialGestureState(): GestureState {
  return {
    activeKind: null,
    startX: 0,
    startY: 0,
    accumulatedX: 0,
    accumulatedY: 0,
    touchPoints: 0,
    phase: 'cancel',
    startedAtUs: 0,
  };
}

/** Travel in logical pixels required to trigger. Higher sensitivity, lower threshold. */
export function gestureThreshold(sensitivity: number): number {
  const clamped = Math.min(100, Math.max(0, sensitivity));
  return Math.max(40, 200 - 2 * clamped);
}

function isHorizontal(kind: GestureKind): boolean {
  return kind === 'swipe-3-horizontal' || kind === 'swipe-4-horizontal';
}

function isPinch(kind: GestureKind): boolean {
  return kind === 'pinch-in' || kind === 'pinch-out';
}

/** Travel distance that decides whether a completed gesture triggered. */
function travelled(kind: GestureKind, state: GestureState): number {
  if (isHorizontal(kind)) return Math.abs(state.accumulatedX);
  if (isPinch(kind)) return Math.max(Math.abs(state.accumulatedX), Math.abs(state.accumulatedY));
  return Math.abs(state.accumulatedY);
}

function reset(state: GestureState): void {
  state.activeKind = null;
  state.startX = 0;
  state.startY = 0;
  state.accumulatedX = 0;
  state.accumulatedY = 0;
  state.touchPoints = 0;
  state.phase = 'cancel';
  state.startedAtUs = 0;
}

function actionFor(kind: GestureKind, config: GestureConfig): GestureActionType {
  switch (kind) {
    case 'swipe-3-horizontal':
      return config.swipe3Horizontal;
    case 'swipe-3-vertical':
      return config.swipe3Vertical;
    case 'swipe-4-horizontal':
      return config.swipe4Horizontal;
    case 'swipe-4-vertical':
      return config.swipe4Vertical;
    case 'pinch-in':
    case 'pinch-out':
      return config.pinchAction;
    case 'hold-3-swipe':
      return 'none';
  }
}

function directionFor(kind: GestureKind, state: GestureState): 'left' | 'right' | 'up' | 'down' {
  if (isHorizontal(kind)) return state.accumulatedX < 0 ? 'left' : 'right';
  return state.accumulatedY < 0 ? 'up' : 'down';
}

function resolve(actionType: GestureActionType, kind: GestureKind, state: GestureState): GestureAction {
  switch (actionType) {
    case 'switch-workspace':
      return { type: 'switch-workspace', direction: directionFor(kind, state) };
    case 'toggle-overview':
      return { type: 'toggle-overview' };
    case 'show-desktop':
      return { type: 'show-desktop' };
    case 'swap-pair':
      return { type: 'swap-pair', direction: state.accumulatedX < 0 ? 'left' : 'right' };
    case 'none':
      return NONE_ACTION;
    default: {
      const action = actionType.startsWith('custom:') ? actionType.slice('custom:'.length) : actionType;
      return { type: 'custom', action };
    }
  }
}

/**
 * Feed one event into the state machine. Returns the resolved action when a
 * gesture completes, `{ type: 'none' }` when it completes below threshold or
 * is cancelled, and null while a gesture is in flight or ignored.
 */
export function feedGesture(state: GestureState, event: GestureEvent, config: GestureConfig): GestureAction | null {
  if (!config.enabled) return null;

  if (event.phase === 'begin') {
    // A second gesture while one is active is ignored (§41.6).
    if (state.activeKind !== null) return null;
    state.activeKind = event.kind;
    state.phase = 'begin';
    state.startX = event.deltaX;
    state.startY = event.deltaY;
    state.accumulatedX = event.deltaX;
    state.accumulatedY = event.deltaY;
    state.touchPoints = event.touchPoints;
    state.startedAtUs = event.timestampUs;
    return null;
  }

  if (event.phase === 'cancel') {
    reset(state);
    return NONE_ACTION;
  }

  const active = state.activeKind;
  if (active === null) return null;
  // A mismatched kind belongs to a different in-flight gesture; ignore it.
  if (event.kind !== active) return null;

  if (event.phase === 'update') {
    state.accumulatedX += event.deltaX;
    state.accumulatedY += event.deltaY;
    state.phase = 'update';
    state.touchPoints = event.touchPoints;
    return null;
  }

  // phase === 'end'
  state.accumulatedX += event.deltaX;
  state.accumulatedY += event.deltaY;
  const accumulated = travelled(active, state);
  const triggered = accumulated >= gestureThreshold(config.sensitivity);
  const action = triggered ? resolve(actionFor(active, config), active, state) : NONE_ACTION;
  reset(state);
  return action;
}
