// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Emptiness and packing (§5). Reaping is a **property, not an event**: at every
 * drain, any empty workspace other than GNOME's trailing spare is removed,
 * wherever it sits. A workspace whose only windows are minimized relocates its
 * occupant first (left, else right, else it is left alone), so that it can be
 * reaped — except when no neighbour holds windows, which is the one legal
 * look-empty workspace.
 */

import { windowCount, minimizeRelocation } from './placement.js';
import type { State, Ws } from './placement.js';

/** Whether a workspace holds anything at all (visible, minimized or floating). */
export function holdsWindows(ws: Ws): boolean {
  return windowCount(ws) > 0;
}

/** GNOME's trailing empty workspace: the last one, never removed by adrt. */
export function spareIndex(state: State): number {
  return Math.max(0, state.workspaces.length - 1);
}

export interface ReapPlan {
  /** Workspace indexes to remove. */
  reap: number[];
  /** Windows to move before the reap, in order. */
  relocate: { id: number; to: number }[];
}

/**
 * What the drain should reap and relocate. Workspaces holding only minimized
 * windows relocate their occupant and are then reaped; empty workspaces other
 * than the spare are reaped; a workspace pinned by a float stays.
 */
export function reapPlan(state: State): ReapPlan {
  const spare = spareIndex(state);
  const reap: number[] = [];
  const relocate: { id: number; to: number }[] = [];
  for (let index = 0; index < state.workspaces.length; index++) {
    if (index === spare) continue;
    const ws = state.workspaces[index];
    const visible = (ws.slots[0] === null ? 0 : 1) + (ws.slots[1] === null ? 0 : 1);
    const floats = ws.floats?.length ?? 0;
    if (floats > 0) continue; // a float pins its workspace (§6)
    if (visible > 0) continue;
    if (ws.minimized.length > 0) {
      const move = minimizeRelocation(state, index);
      if (move === null) continue; // allowed to stay: no neighbour holds windows
      for (const hidden of ws.minimized) relocate.push({ id: hidden.id, to: move.to });
      reap.push(index);
      continue;
    }
    reap.push(index);
  }
  return { reap, relocate };
}
