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
