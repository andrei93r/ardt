// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * The one scheduling path (§11). Every signal handler pushes an event; a single
 * deferred drain runs the policy. Three lanes give a stable priority order:
 *
 *   1 feedback     focus, border, marker — the cheapest, most visible
 *   2 layout       route, plan, apply, workspace create/reap, view shift
 *   3 maintenance  reap, persist, work-area refresh, sweep
 *
 * Pushing the same **key** before a drain coalesces: the latest payload wins and
 * the entry keeps its earliest position, so a burst of signals for one window
 * costs one pass. That is what makes a signal storm harmless.
 *
 * The queue owns no timers: `push` says whether the caller must arm the drain
 * (it was empty), and the drain empties the queue.
 */

export type Lane = 1 | 2 | 3;

export interface QueuedEvent {
  lane: Lane;
  key: string;
  kind: string;
  data?: Record<string, unknown>;
  /** When it was enqueued, from the injected clock. */
  at: number;
}

const LANES: Lane[] = [1, 2, 3];

export class EventQueue {
  private readonly lanes = new Map<Lane, Map<string, QueuedEvent>>(LANES.map((l) => [l, new Map()]));
  private count = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** How many events are waiting. */
  get pending(): number {
    return this.count;
  }

  isEmpty(): boolean {
    return this.count === 0;
  }

  /** Whether pushing this key/lane would arm the drain (the queue was empty). */
  push(lane: Lane, key: string, kind: string, data?: Record<string, unknown>): boolean {
    const wasEmpty = this.count === 0;
    const laneMap = this.lanes.get(lane);
    if (laneMap === undefined) return wasEmpty;
    const existing = laneMap.get(key);
    if (existing === undefined) {
      laneMap.set(key, { lane, key, kind, data, at: this.now() });
      this.count += 1;
    } else {
      // Coalesced: keep its place in the lane, take the newest payload.
      existing.kind = kind;
      existing.data = data;
      existing.at = this.now();
    }
    return wasEmpty;
  }

  has(key: string): boolean {
    for (const lane of LANES) {
      if (this.lanes.get(lane)?.has(key) === true) return true;
    }
    return false;
  }

  depth(lane: Lane): number {
    return this.lanes.get(lane)?.size ?? 0;
  }

  /** The lowest-numbered non-empty lane: the one the drain should start with. */
  highestLane(): Lane | null {
    for (const lane of LANES) {
      if (this.depth(lane) > 0) return lane;
    }
    return null;
  }

  /** Take everything, in lane order and then in insertion order. */
  drain(): QueuedEvent[] {
    const out: QueuedEvent[] = [];
    for (const lane of LANES) {
      const laneMap = this.lanes.get(lane);
      if (laneMap === undefined) continue;
      for (const event of laneMap.values()) out.push(event);
      laneMap.clear();
    }
    this.count = 0;
    return out;
  }

  clear(): void {
    for (const lane of LANES) this.lanes.get(lane)?.clear();
    this.count = 0;
  }

  /** The newest age in a drained batch, for the perf counters. */
  drainAge(now: number, drained: QueuedEvent[]): number {
    let oldest = now;
    for (const event of drained) oldest = Math.min(oldest, event.at);
    return Math.max(0, now - oldest);
  }
}
