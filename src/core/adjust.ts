// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Drag intent: did the user resize a shared inner edge, or move the window?
 * Pure, so the awkward cases can be unit-tested (§12, §13).
 *
 * The caller's only signals are the rect before the gesture and the rect after
 * it. An inner-edge resize touches exactly one edge, leaving the other three
 * where they were. Anything else — a move, a compositor clamp, or an overview
 * drop that scales the window to its target — changes more than one edge and
 * must be treated as a move: reading a scaled drop as a resize saves a bogus
 * split ratio that then persists for that pair of apps.
 */

import type { Rect } from './types.js';

export type AdjustMode = 'move' | 'resize';

/** How much an edge may drift and still count as "did not move" (px). */
const ADJUST_TOLERANCE = 8;

export function classifyAdjust(start: Rect, now: Rect, tolerance = ADJUST_TOLERANCE): AdjustMode {
  const dx = Math.abs(now.x - start.x);
  const dy = Math.abs(now.y - start.y);
  const dw = Math.abs(now.width - start.width);
  const dh = Math.abs(now.height - start.height);

  // Horizontal inner edge: the width changed, the vertical axis did not.
  if (dw > tolerance && dy <= tolerance && dh <= tolerance) return 'resize';
  // Vertical inner edge: the height changed, the horizontal axis did not.
  if (dh > tolerance && dx <= tolerance && dw <= tolerance) return 'resize';
  return 'move';
}
