// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand this code.

/**
 * Undo (§13). Exactly one change is held, in memory only, per instance and
 * configuration: workspace, slot, rect, maximized, floating — plus the ratios
 * that produced them. A restart clears it; it is never persisted.
 *
 * The change is only ever *described* here, never applied: the adapter reads
 * the live state, asks `validateChange` whether the whole change can still be
 * restored, and applies all of it or none of it.
 */

import type { Rect } from './types.js';

/** The configuration one window instance had when a change was captured. */
export interface InstanceConfig {
  id: number;
  workspace: number;
  /** The tiling slot it held, or null when it was not a tiled half. */
  slot: 0 | 1 | null;
  rect: Rect;
  maximized: boolean;
  floating: boolean;
}

/** §13: one change — the instances it touched and the ratios behind them. */
export interface Change {
  instances: InstanceConfig[];
  ratios?: Record<string, number>;
}

/** The single in-memory undo slot. `set` overwrites: there is never a stack. */
export class ChangeLog {
  private entry: Change | null = null;

  /** Record a change. An empty change is ignored, so it cannot mask the real one. */
  set(change: Change): boolean {
    if (change.instances.length === 0) return false;
    this.entry = {
      instances: change.instances.map((instance) => ({ ...instance, rect: { ...instance.rect } })),
      ratios: change.ratios === undefined ? undefined : { ...change.ratios },
    };
    return true;
  }

  /** Take the change (undo consumes it: it can be undone once). */
  take(): Change | null {
    const entry = this.entry;
    this.entry = null;
    return entry;
  }

  peek(): Change | null {
    return this.entry;
  }

  clear(): void {
    this.entry = null;
  }

  get size(): number {
    return this.entry === null ? 0 : 1;
  }
}

/** The live state of an instance, as the validator needs to see it. */
export interface LiveInstance {
  id: number;
  workspace: number;
  /** The slot the window currently holds, or null when not a tiled half. */
  slot: 0 | 1 | null;
}

export type UndoProblem = 'instance-gone' | 'slot-taken' | null;

export interface UndoValidation {
  ok: boolean;
  problem: UndoProblem;
}

/**
 * §13: validate the *whole* change before applying any of it. It is impossible
 * when an instance is gone, or when a slot the change needs is now held by a
 * window that is not part of the change (the change's own swap is fine).
 * Partial restores never happen.
 */
export function validateChange(change: Change, live: readonly LiveInstance[]): UndoValidation {
  const byId = new Map<number, LiveInstance>();
  for (const instance of live) byId.set(instance.id, instance);
  for (const instance of change.instances) {
    if (!byId.has(instance.id)) return { ok: false, problem: 'instance-gone' };
  }
  const own = new Set(change.instances.map((instance) => instance.id));
  for (const instance of change.instances) {
    if (instance.slot === null) continue;
    const occupant = live.find(
      (candidate) => candidate.workspace === instance.workspace && candidate.slot === instance.slot && candidate.id !== instance.id,
    );
    if (occupant !== undefined && !own.has(occupant.id)) return { ok: false, problem: 'slot-taken' };
  }
  return { ok: true, problem: null };
}
