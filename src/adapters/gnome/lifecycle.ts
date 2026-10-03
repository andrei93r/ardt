// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §36: Lifecycle registries.
 *
 * Centralised ownership of every compositor/shell signal connection and every
 * GLib timer. The extension must never leak a signal handler or a timeout:
 * every subscription/timer is registered here, and `disable()` drains the
 * registries in a single pass. This makes teardown idempotent and deterministic.
 */

import GLib from 'gi://GLib';

/**
 * A handle returned by `SignalRegistry.add()`. Calling `disconnect()` or
 * letting the registry clear itself will disconnect the signal.
 */
export interface SignalHandle {
  /** Disconnect this specific signal. Idempotent. */
  disconnect(): void;
}

/**
 * Registry for GObject signal connections.
 *
 * Usage:
 * ```ts
 * const signals = new SignalRegistry();
 * signals.add('overview', obj, 'signal-name', this.guard('name', () => handler()));
 * signals.disconnect('overview'); // disconnects one group
 * signals.disconnect(); // disconnects all
 * ```
 */
export class SignalRegistry {
  private entries: Array<{ group: string; obj: any; signal: string; id: number }> = [];

  /**
   * Connect a signal and track it under a teardown group. Returns a handle
   * that can disconnect early. Callbacks must already be guarded by the
   * caller (the extension's `guard()`), so a throw never escapes into the
   * compositor's emission.
   */
  add(
    group: string,
    obj: any,
    signal: string,
    callback: (...args: any[]) => void,
  ): SignalHandle {
    const id = obj.connect(signal, callback);
    const entry = { group, obj, signal, id };
    this.entries.push(entry);
    return {
      disconnect: () => {
        const idx = this.entries.indexOf(entry);
        if (idx >= 0) {
          this.entries.splice(idx, 1);
          try { obj.disconnect(id); } catch { /* already gone */ }
        }
      },
    };
  }

  /**
   * Disconnect one teardown group, or everything when called with no group.
   * Idempotent; a disconnect against a disposed emitter is skipped, never
   * turned into a g_closure_unref assertion.
   */
  disconnect(group?: string): void {
    const remaining: typeof this.entries = [];
    for (const entry of this.entries) {
      if (group === undefined || entry.group === group) {
        try { entry.obj.disconnect(entry.id); } catch { /* already gone */ }
      } else {
        remaining.push(entry);
      }
    }
    this.entries = remaining;
  }

  /**
   * Disconnect and forget all tracked signals. Idempotent.
   */
  clear(): void {
    for (const { obj, id } of this.entries) {
      try { obj.disconnect(id); } catch { /* already gone */ }
    }
    this.entries.length = 0;
  }

  /** Number of tracked connections. */
  get size(): number {
    return this.entries.length;
  }

  /** Number of tracked connections in one teardown group. */
  groupSize(group: string): number {
    let n = 0;
    for (const entry of this.entries) if (entry.group === group) n += 1;
    return n;
  }
}

/**
 * Registry for GLib timeouts/intervals.
 *
 * Only the shapes the extension uses exist: one-shot `add`, repeating
 * `addInterval`, and `clear`/`clearAll` for teardown. Anything else is
 * speculative API on a teardown module.
 */
export class TimeoutRegistry {
  private timeouts = new Map<string, number>();

  /**
   * Add a one-shot timeout. If a timer with the same name exists, it is
   * replaced (the old one is removed).
   */
  add(name: string, ms: number, callback: () => void | boolean): void {
    this.clear(name);
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      this.timeouts.delete(name);
      callback();
      return GLib.SOURCE_REMOVE;
    });
    this.timeouts.set(name, id);
  }

  /**
   * Add a repeating timeout. If a timer with the same name exists, it is
   * replaced. A callback returning `false` stops the timer (GLib convention).
   */
  addInterval(name: string, ms: number, callback: () => void | boolean): void {
    this.clear(name);
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      const keep = callback();
      if (keep === false) {
        this.timeouts.delete(name);
        return GLib.SOURCE_REMOVE;
      }
      return GLib.SOURCE_CONTINUE;
    });
    this.timeouts.set(name, id);
  }

  /**
   * Remove a named timeout/interval. Idempotent.
   */
  clear(name: string): void {
    const id = this.timeouts.get(name);
    if (id !== undefined) {
      GLib.source_remove(id);
      this.timeouts.delete(name);
    }
  }

  /** Check if a named timeout is currently armed. */
  has(name: string): boolean {
    return this.timeouts.has(name);
  }

  /**
   * Remove and stop all timeouts. Idempotent.
   */
  clearAll(): void {
    for (const id of this.timeouts.values()) {
      GLib.source_remove(id);
    }
    this.timeouts.clear();
  }

  /** Number of active timers. */
  get size(): number {
    return this.timeouts.size;
  }
}
