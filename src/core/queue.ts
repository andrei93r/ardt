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
 *
 * Data structure (§5.11): three fixed lanes, each a `Map` keyed by the
 * coalescing key, plus a key→lane index. This beats a heap at this scale: a
 * heap would lose the coalescing invariant (one entry per key, earliest
 * position, newest payload) and charges O(log n) per push for an ordering the
 * three lanes already give for free. Do not replace it with a heap.
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

const LANES: readonly Lane[] = [1, 2, 3];

export class EventQueue {
  // A plain object over the three lane numbers instead of `LANES.map(...)`:
  // no closure or intermediate array is built at construction, and the lane
  // number indexes the map directly.
  private readonly lanes: Record<Lane, Map<string, QueuedEvent>> = {
    1: new Map(),
    2: new Map(),
    3: new Map(),
  };
  /**
   * key -> lane holding it, so `has` is O(1) instead of scanning all three
   * lanes. The same key may sit in two lanes at once (that is two events, not a
   * coalesce); the index then keeps the last lane. It is removed only when
   * every lane is emptied, which `drain`/`clear` always do together, so the
   * index never outlives its entry.
   */
  private readonly laneOf = new Map<string, Lane>();
  /**
   * Reused by `drain` so a pass allocates no array. Ownership contract: the
   * returned array is valid until the next `drain()` and must not be retained;
   * the only caller (`session.runDrain`) iterates it synchronously and drops it.
   */
  private readonly drained: QueuedEvent[] = [];
  private count = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** How many events are waiting. */
  get pending(): number {
    return this.count;
  }

  /** Whether pushing this key/lane would arm the drain (the queue was empty). */
  push(lane: Lane, key: string, kind: string, data?: Record<string, unknown>): boolean {
    const wasEmpty = this.count === 0;
    const laneMap = this.laneMap(lane);
    if (laneMap === undefined) return wasEmpty;
    const existing = laneMap.get(key);
    if (existing === undefined) {
      laneMap.set(key, { lane, key, kind, data, at: this.now() });
      this.laneOf.set(key, lane);
      this.count += 1;
    } else {
      // Coalesced: keep its place in the lane, take the newest payload.
      existing.kind = kind;
      existing.data = data;
      existing.at = this.now();
    }
    return wasEmpty;
  }

  /** O(1): the key->lane index decides presence. */
  has(key: string): boolean {
    return this.laneOf.has(key);
  }

  depth(lane: Lane): number {
    return this.laneMap(lane)?.size ?? 0;
  }

  /** The lowest-numbered non-empty lane: the one the drain should start with. */
  highestLane(): Lane | null {
    for (const lane of LANES) {
      if ((this.laneMap(lane)?.size ?? 0) > 0) return lane;
    }
    return null;
  }

  /**
   * Take everything, in lane order and then in insertion order. The result is
   * the queue's reused buffer: valid until the next `drain()`.
   */
  drain(): QueuedEvent[] {
    const out = this.drained;
    out.length = 0;
    for (const lane of LANES) {
      const laneMap = this.laneMap(lane);
      if (laneMap === undefined) continue;
      for (const event of laneMap.values()) out.push(event);
      laneMap.clear();
    }
    this.laneOf.clear();
    this.count = 0;
    return out;
  }

  clear(): void {
    for (const lane of LANES) this.laneMap(lane)?.clear();
    this.laneOf.clear();
    this.count = 0;
  }

  /**
   * The oldest (worst-case) age in a drained batch, for the perf counters. A
   * batch coalesces one entry per key retaining its earliest position, so the
   * oldest timestamp is the longest any event waited before this drain.
   */
  drainAge(now: number, drained: QueuedEvent[]): number {
    let oldest = now;
    for (const event of drained) oldest = Math.min(oldest, event.at);
    return Math.max(0, now - oldest);
  }

  /** The lane's map, or `undefined` for a number outside `Lane` (defensive). */
  private laneMap(lane: Lane): Map<string, QueuedEvent> | undefined {
    return this.lanes[lane];
  }
}
