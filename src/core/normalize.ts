// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §20 startup, adoption and enable-time normalisation.
 *
 * Pure: given the managed windows of one workspace and the work area they are
 * fitted to, decide what the layout should be on **every enable**, including a
 * mid-session enable. The three branches are, in order (§20):
 *
 *   1. one managed window  -> it is maximized (the lone law);
 *   2. one window covers at least `DOMINANCE_THRESHOLD` of the work area ->
 *      it is maximized and every other managed window on that workspace is
 *      minimized;
 *   3. otherwise the two windows with the most visible surface pair up (the
 *      leftmost of the two takes the left slot) and the rest are minimized.
 *
 * Floats and dialogs are never normalised, and a **fullscreen** window is left
 * untouched: it is the "does not fit" case and moves only on its own transition
 * (§16). The work area is the surface the windows are fitted to, so the
 * threshold is a fraction of its area.
 */

import type { Rect } from './types.js';

/** §20: a window covering this fraction of the work area dominates it. */
export const DOMINANCE_THRESHOLD = 0.7;

/** One window as the normaliser sees it. */
export interface NormalizeWindow {
  id: number;
  /** The window's rect, used to choose the leftmost of the pair. */
  rect: Rect;
  /**
   * Visible surface in square logical pixels: the window's own area minus
   * whatever is stacked above it on the same workspace. Zero for a hidden
   * window.
   */
  visibleArea: number;
  /** A managed tile (tileable, not floating, not fullscreen, not minimized). */
  managed: boolean;
  fullscreen: boolean;
  floating: boolean;
}

/** The slot a paired window is assigned. */
interface NormalizeSlot {
  id: number;
  slot: 0 | 1;
}

/** What the adapter must do to normalise one workspace. */
export interface NormalizeDecision {
  kind: 'none' | 'lone' | 'dominant' | 'pair';
  /** Windows to maximize (in place; the lone law). */
  maximize: number[];
  /** Windows to minimize. */
  minimize: number[];
  /** The pair's slots, leftmost first. */
  slots: NormalizeSlot[];
}

function emptyDecision(kind: NormalizeDecision['kind']): NormalizeDecision {
  return { kind, maximize: [], minimize: [], slots: [] };
}

/** Area of a rect, never negative. */
export function rectArea(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

/**
 * Ranking comparator: most visible surface first, then leftmost, then id, so
 * ties are deterministic. One definition replaces the two inline copies the
 * dominant and pair branches used to carry.
 */
function byVisibleThenPosition(a: NormalizeWindow, b: NormalizeWindow): number {
  return b.visibleArea - a.visibleArea || a.rect.x - b.rect.x || a.id - b.id;
}

/**
 * The normalisation decision for one workspace. `windows` may contain floats,
 * fullscreen windows and dialogs; they are ignored, never minimised.
 */
export function normalizePlan(
  windows: readonly NormalizeWindow[],
  area: Rect,
  threshold: number = DOMINANCE_THRESHOLD,
): NormalizeDecision {
  // One pass builds the managed set. The dominant branch below needs no further
  // copy: a single scan finds its top, and the pair branch sorts this array in
  // place (safe — the sorted order is only consumed there).
  const managed: NormalizeWindow[] = [];
  for (const win of windows) {
    if (win.managed && !win.floating && !win.fullscreen) managed.push(win);
  }
  if (managed.length === 0) return emptyDecision('none');
  if (managed.length === 1) return { ...emptyDecision('lone'), maximize: [managed[0].id] };

  const total = rectArea(area);
  // The ranking's first element, found without sorting. Ties keep the earliest
  // index, matching a stable sort.
  let top = managed[0];
  for (let i = 1; i < managed.length; i += 1) {
    if (byVisibleThenPosition(managed[i], top) < 0) top = managed[i];
  }

  // The top-ranked entry has the maximum visible surface, so dominance exists
  // exactly when it qualifies; when it does, it is the entry the old sort
  // picked. The rest are minimised in their original order.
  if (total > 0 && top.visibleArea >= threshold * total) {
    const id = top.id;
    const minimize: number[] = [];
    for (const win of managed) if (win.id !== id) minimize.push(win.id);
    return { ...emptyDecision('dominant'), maximize: [id], minimize };
  }

  // The two with the most visible surface become the pair; the leftmost takes
  // the left slot. Ties on surface fall back to position, then id, so the
  // decision is deterministic.
  managed.sort(byVisibleThenPosition);
  const first = managed[0];
  const second = managed[1];
  const minimize: number[] = [];
  for (let i = 2; i < managed.length; i += 1) minimize.push(managed[i].id);
  const leftFirst =
    first.rect.x < second.rect.x || (first.rect.x === second.rect.x && first.id < second.id);
  const left = leftFirst ? first : second;
  const right = leftFirst ? second : first;
  return {
    ...emptyDecision('pair'),
    minimize,
    slots: [
      { id: left.id, slot: 0 },
      { id: right.id, slot: 1 },
    ],
  };
}
