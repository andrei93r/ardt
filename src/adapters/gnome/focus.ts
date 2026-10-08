// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §6/§17 focus routing.
 *
 * The window-state and apply paths stay in the session; this module owns the
 * two focus entry points: the cycle (the managed windows of the current plane
 * in slot order, then the floats) and positional direction focus. Both are
 * deliberately scoped to one screen and one workspace — focus never navigates
 * across either — and both reach the live state through `FocusHost`.
 */

import { cycleOrder, cycleSequence, pickDirectional } from '../../core/focus.js';
import type { CycleEntry, FocusDirection } from '../../core/focus.js';
import type { TrackedWindow } from './tracked-window.js';

/** The slice of session state the focus controller needs. */
export interface FocusHost {
  /** The live focused window, if it is one we track. */
  focused(): TrackedWindow | null;
  /** Activate a tracked window by id. */
  focus(id: number): void;
  /** Every tracked window. */
  allWindows(): Iterable<TrackedWindow>;
  /** The tracked window with this id, if any. */
  window(id: number): TrackedWindow | undefined;
  /** The classification of a window (`tileable` decides cycle membership). */
  classify(tracked: TrackedWindow): { tileable: boolean };
  /** The slot a window holds, or null when it is not a tiled half. */
  slotFor(tracked: TrackedWindow): 0 | 1 | null;
  /** The tiled windows on a workspace (directional focus candidates). */
  tileables(workspaceId: number): readonly TrackedWindow[];
  /** Per-subsystem debug logging (§22): gated on `debug-focus`. */
  logFocus(event: string, fields: Record<string, unknown>): void;
}

/** A focus-cycle lap in progress (§6/§17). */
interface FocusLap {
  workspaceId: number;
  screenId: number;
  order: number[];
  startId: number;
  lastId: number;
}

export class FocusController {
  /**
   * §6/§17: the fixed order of the focus-cycle lap in progress, and the last
   * window it focused. A lap is built once (from the live stacking order) and
   * kept until it wraps or focus changes by another route, so raising a float
   * as it is focused cannot re-order the lap.
   */
  private cycleLap: FocusLap | null = null;

  constructor(private readonly host: FocusHost) {}

  /**
   * §6/§17 focus cycle: the managed windows of the current screen and
   * workspace in slot order, then the floats left to right (a perfect overlap
   * resolves by stacking order), minimized skipped, wrapping. It never crosses
   * a screen or a workspace; focusing a float raises it.
   */
  focusCycle(): void {
    const current = this.host.focused();
    if (current === null) {
      this.cycleLap = null;
      return;
    }
    const workspaceId = current.surface.workspaceId;
    const screenId = current.surface.screenId;
    const entries = this.cycleEntries(workspaceId, screenId);
    const live = new Set(entries.filter((entry) => entry.minimized !== true).map((entry) => entry.id));
    // Keep the lap's snapshot while it still describes this plane and the
    // focused window is the one this lap last focused; a focus change by any
    // other route (a click, a direction key) starts a fresh lap.
    const lap = this.cycleLap;
    const sameSet =
      lap !== null &&
      lap.order.length === live.size &&
      lap.order.every((id) => live.has(id));
    const order =
      lap !== null &&
      lap.workspaceId === workspaceId &&
      lap.screenId === screenId &&
      lap.lastId === current.id &&
      sameSet
        ? lap.order
        : cycleSequence(entries);
    if (lap === null || order !== lap.order) {
      this.cycleLap = { workspaceId, screenId, order, startId: current.id, lastId: current.id };
    }
    const next = cycleOrder(current.id, entries, order);
    if (next === null || next === current.id) {
      this.cycleLap = null;
      return;
    }
    const target = this.host.window(next);
    if (target === undefined) {
      this.cycleLap = null;
      return;
    }
    if (target.surface.flags.floating || target.autoFloated) {
      target.win.raise();
    }
    this.host.logFocus('focus_cycle', { from: current.id, to: next });
    this.host.focus(next);
    const active = this.cycleLap;
    if (active !== null) {
      // A lap ends when it wraps back to its first window; the next press then
      // rebuilds the order from the then-live stacking.
      if (next === active.startId) this.cycleLap = null;
      else active.lastId = next;
    }
  }

  /**
   * §6/§17/§58: focus by direction, positional, never crossing a workspace. A
   * direction with nothing that way stays silent — that is the single exception
   * to "a request that changes nothing toasts".
   */
  focusDirection(direction: string): void {
    const current = this.host.focused();
    if (current === null) return;
    this.focusClosest(current, direction);
  }

  /**
   * Focus the nearest tile in `direction`, relative to the focused window.
   * Only the current workspace is considered: focus never navigates to another
   * workspace, it only reaches what is on screen (including other monitors).
   */
  private focusClosest(current: TrackedWindow, direction: string): boolean {
    const r = current.surface.frame;
    const candidates = this.host
      .tileables(current.surface.workspaceId)
      .filter((t) => t.id !== current.id)
      .map((t) => ({ id: t.id, rect: t.surface.frame }));
    const next = pickDirectional(r, candidates, direction as FocusDirection);
    if (next === null) return false;
    this.host.focus(next);
    return true;
  }

  /** The focus cycle of one plane: managed in slot order, then floats. */
  private cycleEntries(workspaceId: number, screenId: number): CycleEntry[] {
    const entries: CycleEntry[] = [];
    for (const tracked of this.host.allWindows()) {
      if (tracked.surface.workspaceId !== workspaceId) continue;
      if (tracked.surface.screenId !== screenId) continue;
      // A float is unmanaged but still part of the cycle; a dialog or popup is
      // neither managed nor a float and is skipped.
      const floating = tracked.surface.flags.floating || tracked.autoFloated;
      if (!floating && !this.host.classify(tracked).tileable) continue;
      if (tracked.surface.flags.minimized) {
        entries.push({ id: tracked.id, kind: 'managed', minimized: true });
        continue;
      }
      if (floating) {
        tracked.surface.captureZ();
        entries.push({ id: tracked.id, kind: 'float', rect: tracked.surface.frame, z: tracked.surface.zPosition });
        continue;
      }
      entries.push({ id: tracked.id, kind: 'managed', slot: this.host.slotFor(tracked) ?? 0 });
    }
    return entries;
  }
}
