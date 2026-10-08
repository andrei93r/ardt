// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * P6e / §5.9: the dev-gated section profiler.
 *
 * `enabled` is read once at enable from the existing `trace-enabled` setting
 * (no new gschema key). When it is false every instrumented site is a single
 * boolean test: no clock read, no allocation, no closure. When it is true a
 * named section records its call count and cumulative wall time, surfaced
 * add-only in `DumpState.perfStats.sections`. Nothing here decides anything and
 * nothing is ever logged from inside a section: the probe only observes.
 *
 * The section name set is a closed union, so the totals map is bounded by
 * construction and a typo cannot grow it. `snapshot()` copies the totals into a
 * fresh plain object, so the live map is never handed out by reference.
 */

import GLib from 'gi://GLib';

/** The bounded hot set; exactly one entry per instrumented section. */
type PerfSection = 'drain' | 'retile' | 'applyPlan' | 'coherenceSweep' | 'classify';

interface PerfSectionStat {
  count: number;
  totalMs: number;
}

export class PerfProbe {
  /**
   * Set once at enable from `trace-enabled`. Public so a hot call site can
   * guard *before* constructing a closure (the zero-cost path); `section()`
   * itself is only ever reached when this is true.
   */
  enabled = false;

  /** Bounded by the `PerfSection` union: at most one entry per name. */
  private readonly sections = new Map<PerfSection, PerfSectionStat>();

  /**
   * Time one named section. The caller guards on `enabled`, so neither this
   * call nor the callback exists while the profiler is off. Returns whatever
   * `fn` returns; an exception still records the elapsed time.
   */
  section<T>(name: PerfSection, fn: () => T): T {
    const startedUs = GLib.get_monotonic_time();
    try {
      return fn();
    } finally {
      this.add(name, (GLib.get_monotonic_time() - startedUs) / 1000);
    }
  }

  /**
   * The collected totals as a fresh plain object (copied, never a reference).
   * Empty until the first enabled section runs, so `DumpState` stays add-only.
   */
  snapshot(): Record<string, PerfSectionStat> {
    const out: Record<string, PerfSectionStat> = {};
    for (const [name, stat] of this.sections) out[name] = { count: stat.count, totalMs: stat.totalMs };
    return out;
  }

  private add(name: PerfSection, ms: number): void {
    let stat = this.sections.get(name);
    if (stat === undefined) {
      stat = { count: 0, totalMs: 0 };
      this.sections.set(name, stat);
    }
    stat.count += 1;
    stat.totalMs += ms;
  }
}
