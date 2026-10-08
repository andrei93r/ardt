// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §11: the three-lane drain scheduler.
 *
 * Owns the `EventQueue`, the lane arming (compositor laters, the maintenance
 * settle timeout and the frame-interval fallback), the per-lane armed flags and
 * the loop that turns drained events into policy. The policy itself stays in
 * the session: this module reaches it through `DrainHost`, so it never decides
 * anything about windows or workspaces.
 *
 * The one scheduling path is preserved exactly: every signal handler pushes an
 * event, pushing an event into an empty queue reports that the caller must arm
 * a lane, and the drain empties the queue in lane order with per-key coalescing.
 */

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import { EventQueue } from '../../core/queue.js';
import type { Lane, QueuedEvent } from '../../core/queue.js';

/** §10: how long a maintenance pass waits for the surface to settle (struts are
 * set asynchronously by the Shell; internal safety, not a frame cadence). */
const MAINTENANCE_SETTLE_MS = 200;

/**
 * The policy the drain invokes. Every entry point is owned by the session, so
 * the deferral machinery here stays pure scheduling.
 */
export interface DrainHost {
  /** §19: new work is refused while paused, but a held backlog still runs. */
  isPaused(): boolean;
  /** Whether any window is mid-animation; a reconcile wait re-arms itself. */
  isAnimating?(): boolean;
  /** Lane 1: re-derive the focused window's live rect and move the pointer. */
  applyCursorCentre(data: Record<string, unknown>): void;
  /** Lane 2: full reconcile pass. */
  reconcileAll(reason: string, rememberUndo: boolean): void;
  /** Lane 2: display rescue/replay. */
  applyDisplayChange(): void;
  /** Lane 3: periodic coherence sweep. */
  coherenceSweep(): void;
  /** Journal one maintenance event (§22). */
  logMaintenance(kind: string): void;
  /** Register a GLib timeout owned by the session's source registry. */
  addTimeout(ms: number, cb: () => void): void;
  /** The current screen's frame interval, used as the deferral fallback. */
  frameIntervalFor(): number;
  /** One non-empty drain was processed. */
  noteDrain(): void;
  /** One drain's wall time, in milliseconds. */
  noteDrainMs(ms: number): void;
  /** Log a caught error through the session boundary, never rethrow. */
  reportError(context: string, error: unknown): void;
}

export class DrainScheduler {
  /**
   * §11: one scheduling path. Every signal handler pushes here; a single
   * deferred drain runs the policy, in lane order, with per-key coalescing.
   */
  private readonly queue = new EventQueue();
  /** Re-queued layout passes waiting for an animation to finish. */
  private deferrals = 0;
  /** §19: set while the drain finishes the backlog a pause caught. */
  private drainingBacklog = false;
  private readonly armed: Record<Lane, boolean> = { 1: false, 2: false, 3: false };
  /** True once `destroy()` has run; a later-deferred drain must then be a no-op. */
  private destroyed = false;

  constructor(private readonly host: DrainHost) {}

  /**
   * Push an event. True when the queue was empty, so the caller must arm the
   * lane; a coalesce into a non-empty queue leaves the existing arm alone.
   */
  enqueue(lane: Lane, key: string, kind: string, data?: Record<string, unknown>): boolean {
    return this.queue.push(lane, key, kind, data);
  }

  depth(lane: Lane): number {
    return this.queue.depth(lane);
  }

  /** How many events are waiting, for the `queuePending` counter. */
  get pending(): number {
    return this.queue.pending;
  }

  /**
   * §21: how many lanes are armed. `DumpState.memoryBounds` reports sources
   * only while the queue is non-empty, exactly as before the split.
   */
  armedCount(): number {
    return (this.armed[1] ? 1 : 0) + (this.armed[2] ? 1 : 0) + (this.armed[3] ? 1 : 0);
  }

  /** Arm a lane when it is not already armed and the session is alive. */
  arm(lane: Lane): void {
    if (this.destroyed || this.armed[lane]) return;
    this.armed[lane] = true;
    const run = (): boolean => {
      this.armed[lane] = false;
      // A later registered before `destroy()` can still fire afterwards; the
      // queue is already cleared, and running policy on a torn-down session
      // must be a no-op.
      if (this.destroyed) return GLib.SOURCE_REMOVE;
      this.runDrain();
      return GLib.SOURCE_REMOVE;
    };
    if (lane === 3) {
      // §10: a work-area change can arrive before the shell has set its struts,
      // so maintenance waits for the surface to settle. Registered so
      // `destroy()` cancels it while the lane stays armed until it fires.
      this.host.addTimeout(MAINTENANCE_SETTLE_MS, run);
      return;
    }
    try {
      const laters = global.compositor.get_laters();
      const laterTypes: Record<string, unknown> = Meta.LaterType ?? {};
      const type = lane === 1
        ? (laterTypes.BEFORE_REDRAW ?? laterTypes.META_LATER_RESIZE)
        : (laterTypes.META_LATER_RESIZE ?? laterTypes.BEFORE_REDRAW);
      laters.add(type, run);
    } catch {
      // No later machinery (or the enum moved): a short timeout is still one
      // deferred pass, never policy inside the signal handler. One frame at the
      // screen's refresh, never an assumed 60 Hz. Registered so `destroy()`
      // cancels it.
      try {
        this.host.addTimeout(Math.max(1, Math.floor(this.host.frameIntervalFor())), run);
      } catch (error) {
        // No deferral source could be armed at all: drop the arm so the next
        // push retries instead of leaving the lane armed forever.
        this.armed[lane] = false;
        this.host.reportError('arm-drain', error);
      }
    }
  }

  /** Run what the queue holds, in lane order. */
  private runDrain(): void {
    const started = GLib.get_monotonic_time();
    const events = this.queue.drain();
    if (events.length === 0) return;
    this.host.noteDrain();
    // §19: a pause lets the queue finish what it already holds. `isPaused()` is
    // consulted through the extension, which returns false while this flag is
    // set; new work is still refused at push time, so only the backlog runs.
    this.drainingBacklog = this.host.isPaused();
    try {
      this.drainEvents(events);
    } catch (error) {
      // §19/§36: one bad event must not propagate into the compositor's later
      // callback and take the Shell down; log it and keep the loop alive.
      this.host.reportError('drain', error);
    } finally {
      this.drainingBacklog = false;
    }
    const ms = (GLib.get_monotonic_time() - started) / 1000;
    this.host.noteDrainMs(ms);
  }

  private drainEvents(events: QueuedEvent[]): void {
    for (const event of events) {
      const data = (event.data ?? {}) as Record<string, unknown>;
      if (event.kind === 'cursor') {
        // §17 lane-1 feedback: pure geometry, then one warp.
        this.host.applyCursorCentre(data);
      } else if (event.kind === 'reconcile') {
        // A frame applied while another window is animating lands on a moving
        // surface and drifts (A72): wait for the animation instead of fighting
        // it, bounded so a stuck animation cannot starve the layout.
        if (this.host.isAnimating?.() === true && this.deferrals < 60) {
          this.deferrals += 1;
          this.queue.push(2, event.key, event.kind, data);
          this.arm(2);
          continue;
        }
        this.deferrals = 0;
        this.host.reconcileAll(String(data.reason ?? 'queue'), data.rememberUndo === true);
      } else if (event.kind === 'displays') {
        this.host.applyDisplayChange();
      } else if (event.kind === 'maintenance') {
        const kind = String(data.kind ?? 'unknown');
        switch (kind) {
          case 'sweep':
            this.host.coherenceSweep();
            break;
          default:
            break;
        }
        this.host.logMaintenance(kind);
      }
    }
  }

  /** §19: true while the drain is finishing the backlog a pause caught. */
  isDrainingBacklog(): boolean {
    return this.drainingBacklog;
  }

  /** Tear down: clear the queue and drop every lane arm. */
  destroy(): void {
    this.destroyed = true;
    this.queue.clear();
    this.armed[1] = false;
    this.armed[2] = false;
    this.armed[3] = false;
  }
}
