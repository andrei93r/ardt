// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Version-specific API normalization (§41.4). Everything that differs between
 * Shell 48/49/50/51 — and every capability probe — lives here; no other adapter
 * file uses `typeof x === 'function'` (§4.2).
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';
import { PACKAGE_VERSION } from 'resource:///org/gnome/shell/misc/config.js';

import { SurfaceKind } from '../../core/types.js';

export const SHELL_MAJOR: number = Number.parseInt(PACKAGE_VERSION.split('.')[0], 10);

export function isMaximized(win: any): boolean {
  // Mutter 50 replaced get_maximized() with get_maximize_flags()/is_maximized().
  if (typeof win.get_maximize_flags === 'function') return win.get_maximize_flags() !== 0;
  return win.get_maximized() !== 0;
}

export function isFullyMaximized(win: any): boolean {
  const flags = typeof win.get_maximize_flags === 'function' ? win.get_maximize_flags() : win.get_maximized();
  return (flags & Meta.MaximizeFlags.HORIZONTAL) !== 0 && (flags & Meta.MaximizeFlags.VERTICAL) !== 0;
}

export function isAttachedDialog(win: any): boolean {
  return typeof win.is_attached_dialog === 'function' && win.is_attached_dialog() === true;
}

/** Map a Mutter window type onto the platform-neutral surface kind. */
export function kindFor(win: any): SurfaceKind {
  switch (win.get_window_type()) {
    case Meta.WindowType.NORMAL:
      return SurfaceKind.NORMAL;
    case Meta.WindowType.DIALOG:
      return SurfaceKind.DIALOG;
    case Meta.WindowType.MODAL_DIALOG:
      return SurfaceKind.MODAL;
    case Meta.WindowType.UTILITY:
      return SurfaceKind.UTILITY;
    case Meta.WindowType.TOOLBAR:
      return SurfaceKind.TOOLBAR;
    default:
      return SurfaceKind.SKIP;
  }
}

export function isSkipTaskbar(win: any): boolean {
  return typeof win.is_skip_taskbar === 'function' && win.is_skip_taskbar() === true;
}

export function isOverrideRedirect(win: any): boolean {
  return typeof win.is_override_redirect === 'function' && win.is_override_redirect() === true;
}

/**
 * Popup-family windows: menus, tooltips, popovers. On X11 these are
 * override-redirect, but on Wayland they are `xdg_popup` and report
 * `override_redirect == false`, so the override-redirect check does not see
 * them. They must never be tracked: closing one calls a NULL `close` vfunc in
 * Mutter (`MetaWaylandXdgPopup`), which segfaults the Shell — reproduced live in
 * `docs/shell-crash-audit.md` (windowType 9, `DROPDOWN_MENU`).
 */
export function isPopupWindow(win: any): boolean {
  switch (win.get_window_type()) {
    case Meta.WindowType.MENU:
    case Meta.WindowType.DROPDOWN_MENU:
    case Meta.WindowType.POPUP_MENU:
    case Meta.WindowType.TOOLTIP:
    case Meta.WindowType.NOTIFICATION:
    case Meta.WindowType.COMBO:
    case Meta.WindowType.DND:
      return true;
    default:
      return false;
  }
}

export function isOnAllWorkspaces(win: any): boolean {
  return win.is_on_all_workspaces() === true;
}

/**
 * The given meta windows in compositor stacking order, bottom-to-top. Used to
 * answer "what is drawn above this window" from live state instead of a cached
 * flag (occlusion is a property of the stack, not of how a window is
 * classified). Falls back to the input order when the API is unavailable.
 */
export function sortByStacking(windows: any[]): any[] {
  try {
    return global.display.sort_windows_by_stacking(windows);
  } catch {
    return windows;
  }
}

/** Compositor actor for a window, or null while unmapping (§26). */
export function compositorActor(win: any): any | null {
  try {
    const actor = win.get_compositor_private() ?? null;
    return actor !== null && actorAlive(actor) ? actor : null;
  } catch {
    return null;
  }
}

/** GNOME 50 virtual-input / devkit capability used by tests and gestures. */
export function hasDevkit(): boolean {
  return SHELL_MAJOR >= 49;
}

/**
 * The Clutter backend. GNOME 51 removed `Clutter.get_default_backend()`, so the
 * supported replacement — `global.stage.context.get_backend()`, or an actor's
 * `get_context().get_backend()` — is tried first. The old getter remains the
 * fallback for 48–50. Probed, never assumed.
 */
export function defaultBackend(): any | null {
  try {
    const stage: any = (global as any)?.stage;
    if (stage !== null && stage !== undefined) {
      const context = typeof stage.get_context === 'function' ? stage.get_context() : stage.context;
      const backend = typeof context?.get_backend === 'function' ? context.get_backend() : null;
      if (backend !== null && backend !== undefined) return backend;
    }
  } catch {
    /* no stage/context yet (headless before the stage exists) */
  }
  try {
    if (typeof (Clutter as any).get_default_backend === 'function') return (Clutter as any).get_default_backend();
  } catch {
    /* removed in 51 */
  }
  return null;
}

/** The default Clutter seat, through whichever backend accessor this Shell has. */
export function defaultSeat(): any | null {
  const backend = defaultBackend();
  if (backend === null) return null;
  try {
    return typeof backend.get_default_seat === 'function' ? backend.get_default_seat() : null;
  } catch {
    return null;
  }
}

/**
 * GNOME 51 renamed `St.ButtonMask.ONE/TWO/THREE` to `PRIMARY/MIDDLE/SECONDARY`
 * (the old names remain as deprecated aliases). Map the semantic button onto
 * whichever spelling this Shell exposes; 0 when the mask is unavailable.
 */
export function stButtonMask(button: 'primary' | 'middle' | 'secondary'): number {
  const mask: any = (St as any)?.ButtonMask ?? {};
  const candidates =
    button === 'primary' ? ['PRIMARY', 'ONE'] : button === 'middle' ? ['MIDDLE', 'TWO'] : ['SECONDARY', 'THREE'];
  for (const name of candidates) {
    if (typeof mask[name] === 'number') return mask[name];
  }
  return 0;
}

/**
 * GNOME 51 moved reduced motion onto `St.Settings` as the `St.ReducedMotion`
 * enum (`NO_PREFERENCE=0`, `REDUCE=1`); 48–50 expose no such preference here.
 * Returns true/false, or null when this Shell has no reading.
 */
export function stReducedMotion(): boolean | null {
  let settings: any;
  try {
    settings = (St as any)?.Settings?.get?.();
  } catch {
    return null;
  }
  if (settings === null || settings === undefined) return null;
  let value: unknown;
  try {
    value = settings.reduced_motion ?? settings['reduced-motion'];
  } catch {
    return null;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    const reduce = (St as any)?.ReducedMotion?.REDUCE;
    return value === (typeof reduce === 'number' ? reduce : 1);
  }
  return null;
}

/**
 * Close a Shell popup menu. GNOME 51 replaced the single `PopupAnimation`
 * argument with a `{animate, fadeOnly}` parameters object; the object form is
 * tried first and the enum argument is the fallback, so both generations work.
 */
export function closePopupMenu(menu: any, animate = false): void {
  if (menu === null || menu === undefined || typeof menu.close !== 'function') return;
  try {
    menu.close({ animate });
    return;
  } catch {
    /* pre-51 signature: an object is not a PopupAnimation */
  }
  try {
    menu.close(animate ? 1 : 0);
  } catch {
    /* nothing to close */
  }
}

/**
 * A `Gio.DBusProxy` wrapper factory. GJS exposes it on `Gio.DBusProxy` (older
 * builds also on `Gio.DBus`); GNOME 51 returns a `Gio.DBusProxy` subclass where
 * earlier Shells returned a plain constructor — both are invoked with `new`, so
 * callers get the constructor either way. Null when this GJS has no wrapper.
 */
export function makeProxyWrapper(interfaceXml: string): any {
  const factory =
    typeof (Gio as any)?.DBus?.makeProxyWrapper === 'function'
      ? (Gio as any).DBus.makeProxyWrapper
      : typeof (Gio as any)?.DBusProxy?.makeProxyWrapper === 'function'
        ? (Gio as any).DBusProxy.makeProxyWrapper
        : null;
  if (factory === null) return null;
  try {
    return factory(interfaceXml);
  } catch {
    return null;
  }
}

export type NormalizedGesturePhase = 'begin' | 'update' | 'end' | 'cancel';

export interface TouchpadGestureReading {
  type: 'swipe' | 'pinch';
  phase: NormalizedGesturePhase;
  fingers: number;
  /** Unaccelerated motion delta for a swipe; 0 for a pinch. */
  deltaX: number;
  deltaY: number;
  /** Current pinch scale (1.0 at begin); 1 for a swipe. */
  scale: number;
}

/**
 * The modern Clutter gesture recognizer (`Clutter.PanGesture`, a
 * `Clutter.Gesture`) is what GNOME Shell itself drives; the pre-45
 * `Clutter.GestureAction` no longer exists. Both `Clutter.get_default_backend`
 * and this are probed, never assumed.
 */
export function hasPanGesture(): boolean {
  return typeof (Clutter as any)?.PanGesture === 'function';
}

/** Whether the Shell delivers raw touchpad swipe/pinch gesture events. */
export function hasTouchpadGestureEvents(): boolean {
  try {
    const types: any = (Clutter as any)?.EventType;
    return typeof types?.TOUCHPAD_SWIPE === 'number' && typeof types?.TOUCHPAD_PINCH === 'number';
  } catch {
    return false;
  }
}

/** The legacy pre-45 gesture action, kept as the last-resort fallback. */
export function hasLegacyGestureAction(): boolean {
  return typeof (Clutter as any)?.GestureAction === 'function';
}

function touchpadPhase(event: any): NormalizedGesturePhase | null {
  let phase: unknown;
  try {
    phase = event.get_gesture_phase?.();
  } catch {
    return null;
  }
  const phases: any = (Clutter as any)?.TouchpadGesturePhase ?? {};
  if (phase === phases.BEGIN) return 'begin';
  if (phase === phases.UPDATE) return 'update';
  if (phase === phases.END) return 'end';
  if (phase === phases.CANCEL) return 'cancel';
  return null;
}

/**
 * Normalise one `Clutter.Event` into the adapter's gesture vocabulary: its type,
 * phase, finger count and swipe delta / pinch scale. Returns null for anything
 * that is not a touchpad swipe or pinch.
 */
export function readTouchpadGesture(event: any): TouchpadGestureReading | null {
  if (event === null || event === undefined) return null;
  let type: unknown;
  try {
    type = event.type();
  } catch {
    return null;
  }
  const types: any = (Clutter as any)?.EventType ?? {};
  const pinch = type === types.TOUCHPAD_PINCH;
  if (!pinch && type !== types.TOUCHPAD_SWIPE) return null;
  const phase = touchpadPhase(event);
  if (phase === null) return null;
  let fingers = 0;
  try {
    fingers = Number(event.get_touchpad_gesture_finger_count?.() ?? 0);
  } catch {
    fingers = 0;
  }
  let deltaX = 0;
  let deltaY = 0;
  let scale = 1;
  if (pinch) {
    try {
      const reading = Number(event.get_gesture_pinch_scale?.() ?? 1);
      if (Number.isFinite(reading) && reading > 0) scale = reading;
    } catch {
      scale = 1;
    }
  } else {
    try {
      const [dx, dy] = event.get_gesture_motion_delta_unaccelerated();
      deltaX = Number(dx) || 0;
      deltaY = Number(dy) || 0;
    } catch {
      deltaX = 0;
      deltaY = 0;
    }
  }
  return { type: pinch ? 'pinch' : 'swipe', phase, fingers, deltaX, deltaY, scale };
}

/**
 * Fully convert a GVariant to JS. `unpack()` leaves nested arrays as Variant
 * objects (so an `as` key would stringify to "[object variant of type s]").
 */
export function unpackVariant(value: any): any {
  if (value === null || value === undefined) return undefined;
  return typeof value.recursiveUnpack === 'function' ? value.recursiveUnpack() : value.unpack();
}

export const MOVE_OP: number = Meta.GrabOp.MOVING_UNCONSTRAINED;

/** Stage-space position of an actor, including any moving parent (workspace). */
export function actorStagePosition(actor: any): [number, number] {
  // A window actor can be disposed while we still hold a reference (the window
  // closed); touching it throws. Report "no position" instead of raising.
  try {
    const [x, y] = actor.get_transformed_position();
    return [x, y];
  } catch {
    return [Number.NaN, Number.NaN];
  }
}

/** Whether a compositor actor reference is still usable (not disposed). */
export function actorAlive(actor: any): boolean {
  if (actor === null || actor === undefined) return false;
  try {
    return actor.get_stage() !== null;
  } catch {
    return false;
  }
}

/**
 * Whether the primary mouse button is held. A user move/resize always drags
 * with the button down; our own applies never do, so this is the reliable way
 * to tell user geometry changes from compositor/extension ones.
 */
export function button1Pressed(): boolean {
  const [, , modifiers] = global.get_pointer();
  return (modifiers & Clutter.ModifierType.BUTTON1_MASK) !== 0;
}

/**
 * §6: whether the compositor currently holds a **window** move/resize grab — a
 * real window drag. GNOME 50 exposes `Meta.Display.is_grabbed()` ("there is an
 * ongoing grab operation", i.e. `grab_op != NONE`); some builds also expose
 * `get_grab_op()`, whose `WINDOW_BASE` bit marks the window ops. Returns `null`
 * when neither reading exists, so callers keep their own fallback rather than
 * guessing.
 *
 * This is what tells a window move apart from an application drag-and-drop: a
 * Chrome tab tear-off, a VS Code editor-tab or panel drag and a GTK DnD all
 * hold the pointer button but start **no** compositor window grab, so they must
 * never be mistaken for adrt's own move gesture.
 */
export function displayGrabActive(): boolean | null {
  const display: any = (global as any)?.display;
  try {
    if (typeof display?.get_grab_op === 'function') {
      const op: unknown = display.get_grab_op();
      if (typeof op === 'number') {
        const base: unknown = (Meta as any)?.GrabOp?.WINDOW_BASE;
        const mask = typeof base === 'number' ? base : 1;
        return (op & mask) !== 0;
      }
    }
  } catch {
    /* fall through to the boolean reading */
  }
  try {
    if (typeof display?.is_grabbed === 'function') return display.is_grabbed() === true;
  } catch {
    /* no grab reading on this Shell */
  }
  return null;
}

/**
 * §17 cursor: which public mechanism this Shell exposes to move the pointer.
 * Probed, never assumed: `global.display.warp_pointer` exists in some Mutter
 * versions, `Clutter.Seat.warp_pointer` (public API) in this one. The cursor
 * renderer/tracker are reported for honesty even though neither moves a
 * Wayland pointer.
 */
export function cursorCapabilities(): {
  displayWarp: boolean;
  seatWarp: boolean;
  cursorRenderer: boolean;
  cursorTracker: boolean;
} {
  let displayWarp = false;
  try {
    displayWarp = typeof (global.display as any)?.warp_pointer === 'function';
  } catch {
    displayWarp = false;
  }
  let seatWarp = false;
  try {
    const seat = defaultSeat();
    seatWarp = typeof seat?.warp_pointer === 'function';
  } catch {
    seatWarp = false;
  }
  let cursorRenderer = false;
  let cursorTracker = false;
  try {
    const backend = (global as any).backend;
    cursorRenderer = typeof backend?.get_cursor_renderer === 'function';
    cursorTracker = typeof backend?.get_cursor_tracker === 'function';
  } catch {
    cursorRenderer = false;
    cursorTracker = false;
  }
  return { displayWarp, seatWarp, cursorRenderer, cursorTracker };
}

/** The simplest pointer-warp mechanism available, or `'none'`. */
export function cursorWarpMethod(): 'display' | 'seat' | 'none' {
  const caps = cursorCapabilities();
  if (caps.displayWarp) return 'display';
  if (caps.seatWarp) return 'seat';
  return 'none';
}
