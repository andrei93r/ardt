// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Version-specific API normalization (§41.4). Everything that differs between
 * Shell 48/49/50 — and every capability probe — lives here; no other adapter
 * file uses `typeof x === 'function'` (§4.2).
 */

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
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
    const seat = Clutter.get_default_backend()?.get_default_seat?.();
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
