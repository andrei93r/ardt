// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Directional focus selection (§14). Pure: the caller supplies the focused
 * rect and the candidate windows of the *current workspace* (any monitor).
 */

import type { Rect } from './types.js';

export type FocusDirection = 'left' | 'right' | 'up' | 'down';

export interface FocusCandidate {
  id: number;
  rect: Rect;
}

/**
 * The nearest candidate in `direction`, relative to `current`.
 *
 * Candidates must begin beyond `current` on that axis. On the first pass they
 * must also overlap `current` on the perpendicular axis, which is what makes
 * the choice follow the layout — left/right for a side-by-side pair, up/down
 * for a stacked one — and what lets it reach another monitor. If nothing
 * overlaps (an offset layout), a second pass drops that requirement.
 */
/** One step of the focus cycle: a managed window or a float on the plane. */
export interface CycleEntry {
  id: number;
  /** Managed windows cycle in slot order; floats after them, left to right. */
  kind: 'managed' | 'float';
  /** The slot, for a managed window. */
  slot?: 0 | 1;
  /** Position, for a float: left to right, then a stable tiebreak. */
  rect?: Rect;
  /**
   * Compositor stacking position. Recorded by callers, but deliberately *not*
   * used to order the cycle: focusing a float raises it, so a live stacking
   * order would flip two perfectly-overlapping floats mid-lap.
   */
  z?: number;
  minimized?: boolean;
}

function compareCycle(a: CycleEntry, b: CycleEntry): number {
  if (a.kind !== b.kind) return a.kind === 'managed' ? -1 : 1;
  if (a.kind === 'managed') {
    const sa = a.slot ?? 0;
    const sb = b.slot ?? 0;
    if (sa !== sb) return sa - sb;
    return a.id - b.id;
  }
  const ra = a.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  const rb = b.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  const dx = ra.x - rb.x;
  if (Math.abs(dx) > 1) return dx;
  const dy = ra.y - rb.y;
  if (Math.abs(dy) > 1) return dy;
  // Perfect overlap: order by a stable key, never the live stacking order.
  // Focusing a float raises it, so a `z` tiebreak would flip two
  // perfectly-overlapping floats as the cycle steps between them and one would
  // be skipped. A fixed id tiebreak makes each lap a deterministic permutation
  // that visits every member exactly once.
  return a.id - b.id;
}

/**
 * §6/§17 focus cycle order: the managed windows of the current screen and
 * workspace in slot order, then the floats left to right (a perfect overlap
 * resolves by a stable id tiebreak, not the live stacking order); minimized
 * windows are skipped. Returns the next id after `current`, wrapping, or the
 * first entry when `current` is not in the cycle. `null` when there is nothing
 * to focus.
 */
export function cycleOrder(current: number | null, entries: readonly CycleEntry[]): number | null {
  const live = entries.filter((entry) => entry.minimized !== true).sort(compareCycle);
  if (live.length === 0) return null;
  const index = current === null ? -1 : live.findIndex((entry) => entry.id === current);
  if (index < 0) return live[0].id;
  return live[(index + 1) % live.length].id;
}

export function pickDirectional(
  current: Rect,
  candidates: readonly FocusCandidate[],
  direction: FocusDirection,
): number | null {
  const horizontal = direction === 'left' || direction === 'right';
  const pick = (requireOverlap: boolean): number | null => {
    let best: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const q = candidate.rect;
      const along = horizontal
        ? direction === 'left'
          ? current.x - (q.x + q.width)
          : q.x - (current.x + current.width)
        : direction === 'up'
          ? current.y - (q.y + q.height)
          : q.y - (current.y + current.height);
      if (along < -1) continue;
      if (requireOverlap) {
        const overlap = horizontal
          ? Math.min(current.y + current.height, q.y + q.height) - Math.max(current.y, q.y)
          : Math.min(current.x + current.width, q.x + q.width) - Math.max(current.x, q.x);
        if (overlap <= 0) continue;
      }
      if (along < bestDistance) {
        bestDistance = along;
        best = candidate.id;
      }
    }
    return best;
  };
  return pick(true) ?? pick(false);
}
