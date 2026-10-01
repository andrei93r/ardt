// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Core geometry, surface and placement types.
 *
 * `Surface` is defined here rather than in `platform/host.ts` because `core/`
 * must not import from `platform/` (§2.2) while `classify` needs the shape.
 * `platform/host.ts` re-exports it, so the §2.6 import site is unchanged.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Screen {
  index: number;
  connector: string;
  geometry: Rect;
  /**
   * Usable area of the monitor: geometry minus panels, docks and other struts.
   * Tiling happens inside this; absent means the whole geometry is usable.
   */
  workArea?: Rect;
  scale: number;
  refreshRate: number;
  isPrimary: boolean;
}

export enum SurfaceKind {
  NORMAL = 'normal',
  DIALOG = 'dialog',
  MODAL = 'modal',
  UTILITY = 'utility',
  TOOLBAR = 'toolbar',
  SKIP = 'skip',
}

export interface SurfaceFlags {
  transient: boolean;
  modal: boolean;
  attachedDialog: boolean;
  fullscreen: boolean;
  above: boolean;
  minimized: boolean;
  maximized: boolean;
  floating: boolean;
  skipTaskbar: boolean;
  overrideRedirect: boolean;
  /** Mutter's raw `on-all-workspaces`. May be implied by the monitor: see `sticky`. */
  onAllWorkspaces: boolean;
  /**
   * Genuinely pinned to every workspace. Mutter also reports `onAllWorkspaces`
   * for windows on a non-primary monitor whenever `workspaces-only-on-primary`
   * is set (the GNOME default), so only this flag may disqualify a window from
   * tiling.
   */
  sticky: boolean;
}

export enum Layer {
  BACKGROUND = 0,
  TILED = 1,
  FLOATING = 2,
  MODAL = 3,
  INDICATOR = 4,
}

export interface Placement {
  surfaceId: number;
  rect: Rect;
  layer: Layer;
  order: number;
}

export interface TilePlan {
  placements: Placement[];
}

/** Window kinds that can never be tiled (§5). */
export const NON_TILEABLE_KINDS: ReadonlySet<SurfaceKind> = new Set([
  SurfaceKind.DIALOG,
  SurfaceKind.MODAL,
  SurfaceKind.SKIP,
]);

/** Compositor-facing view of a single surface. Derived fields are read-only. */
export interface Surface {
  readonly id: number;
  readonly kind: SurfaceKind;
  /** wmClass on GNOME. */
  readonly appId: string;
  readonly appVersion: string;
  readonly title: string;
  readonly min: Size;
  readonly max: Size;
  /** Position and size in logical pixels. x and y are the top-left corner. */
  readonly frame: Rect;
  readonly screenId: number;
  readonly workspaceId: number;
  readonly flags: SurfaceFlags;
  readonly parentId: number | null;
  /** Derived via `layerFor(surface)`. Never stored by the caller. */
  readonly layer: Layer;
  /** Compositor's current stacking order. */
  readonly zPosition: number;
}

export function emptyFlags(): SurfaceFlags {
  return {
    transient: false,
    modal: false,
    attachedDialog: false,
    fullscreen: false,
    above: false,
    minimized: false,
    maximized: false,
    floating: false,
    skipTaskbar: false,
    overrideRedirect: false,
    onAllWorkspaces: false,
    sticky: false,
  };
}

export function rectEquals(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Snap a logical-pixel value to the monitor scale grid (§25). */
export function snap(value: number, scale: number): number {
  if (scale <= 1) return value;
  return Math.round(value * scale) / scale;
}

export function snapRect(rect: Rect, scale: number): Rect {
  return {
    x: snap(rect.x, scale),
    y: snap(rect.y, scale),
    width: snap(rect.width, scale),
    height: snap(rect.height, scale),
  };
}
