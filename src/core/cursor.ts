// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Pointer-target geometry (pure). The centre of a window's rect, clamped so it
 * stays inside the work area. Nothing here imports the compositor: the adapter
 * reads the live rect and performs the actual warp (§17 cursor-centre, §11 lane 1).
 */

import type { Rect } from './types.js';
import { clamp } from './types.js';

export interface Point {
  x: number;
  y: number;
}

/** The integer centre of a rectangle. */
export function rectCentre(rect: Rect): Point {
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
}

/**
 * Clamp a point so it lies inside `area`. Coordinates are pixel indices, so the
 * last addressable column/row is `x + width - 1`: a point on the inclusive
 * right/bottom edge would be outside the work area. A non-positive area is
 * returned unchanged (there is nothing to clamp to); the caller validates the
 * work area before it gets here anyway (§10).
 */
function clampPointToArea(point: Point, area: Rect): Point {
  if (area.width <= 0 || area.height <= 0) return { ...point };
  return {
    x: Math.round(clamp(point.x, area.x, area.x + area.width - 1)),
    y: Math.round(clamp(point.y, area.y, area.y + area.height - 1)),
  };
}

/**
 * The cursor target for a window: the centre of `rect`, clamped inside
 * `workArea`. This is the whole of the cursor-follow policy that is pure — the
 * drain owns reading the focused window's live rect and the setting.
 */
export function centreInWorkArea(rect: Rect, workArea: Rect): Point {
  return clampPointToArea(rectCentre(rect), workArea);
}
