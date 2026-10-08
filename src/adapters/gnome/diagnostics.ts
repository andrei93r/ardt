// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §21/§36: session diagnostics.
 *
 * Owns the stage-0 counters (PERFORMANCE_PLAN.md) and the bounded latency
 * sample rings. Nothing here decides anything: the values are only observed,
 * either through `counters()`/`perf()` for `DumpState` or by the periodic
 * `perf` history event. Keeping them in one owner means the session code only
 * calls a `note*` method at each observed event.
 */

/** The stage-0 counter snapshot consumed by `DumpState.counters`. */
export interface SessionCounters {
  sweeps: number;
  sweepMsMax: number;
  sweepMsAvg: number;
  classifyCalls: number;
  classifyMisses: number;
  plansComputed: number;
  sweepFrameReads: number;
  drains: number;
  queuePending: number;
  drainMsMax: number;
  drainMsP50: number;
  drainMsP95: number;
  applyMsP50: number;
  applyMsP95: number;
  applySamples: number;
  clampsApplied: number;
  errors: number;
}

/** The retile timings consumed by `DumpState.perf`. */
export interface SessionPerf {
  lastReconcileMs: number;
  lastApplyMs: number;
  lastApplyAtMs: number;
}

/** How many reconcile passes between periodic `perf` history events (§21). */
const RECONCILE_PERF_EVERY = 60;

export class SessionDiagnostics {
  private drains = 0;
  private drainMsMax = 0;
  /** §22 perf: bounded samples for p50/p95 of drain and apply latency. */
  private readonly drainSamples: number[] = [];
  private readonly applySamples: number[] = [];
  private static readonly SAMPLE_RING = 256;
  /** Diagnostics (PERFORMANCE_PLAN.md stage 0): counted, never used to decide. */
  private classifyCalls = 0;
  private classifyMisses = 0;
  private plansComputed = 0;
  private sweepFrameReads = 0;
  private sweepMsTotal = 0;
  private sweepMsMax = 0;
  /** Frames the clamp-to-screen pass pulled back inside a monitor. */
  private clampsApplied = 0;
  private coherenceRuns = 0;
  private coherenceFixes = 0;
  private lastReconcileMs = 0;
  private lastApplyMs = 0;
  private lastApplyAtMs = 0;
  /** Reconcile passes since the last periodic `perf` event (throttle). */
  private reconcileTicks = 0;

  /** One drain ran (a non-empty batch was processed). */
  noteDrain(): void {
    this.drains += 1;
  }

  /** One drain's wall time; feeds the max and the p50/p95 ring. */
  noteDrainMs(ms: number): void {
    this.drainMsMax = Math.max(this.drainMsMax, ms);
    this.pushSample(this.drainSamples, ms);
  }

  noteClassifyCall(): void {
    this.classifyCalls += 1;
  }

  noteClassifyMiss(): void {
    this.classifyMisses += 1;
  }

  notePlanComputed(): void {
    this.plansComputed += 1;
  }

  noteSweepFrameRead(): void {
    this.sweepFrameReads += 1;
  }

  /** One retile apply completed; records its latency and timestamp. */
  noteApply(ms: number): void {
    this.lastApplyMs = ms;
    this.lastApplyAtMs = Date.now();
    this.pushSample(this.applySamples, ms);
  }

  /** The last apply latency, for the debug `perf` log. */
  lastApplyDurationMs(): number {
    return this.lastApplyMs;
  }

  /** One coherence sweep ran. */
  noteCoherenceRun(): void {
    this.coherenceRuns += 1;
  }

  /** The sweeps made one correction. */
  noteCoherenceFix(): void {
    this.coherenceFixes += 1;
  }

  /** The clamp-to-screen pass pulled one window back inside a monitor. */
  noteClamp(): void {
    this.clampsApplied += 1;
  }

  /** One coherence sweep's wall time. */
  noteSweep(ms: number): void {
    this.sweepMsTotal += ms;
    if (ms > this.sweepMsMax) this.sweepMsMax = ms;
  }

  /**
   * One safety-net reconcile completed. Returns true on the tick where the
   * periodic `perf` history event is due (§21, one per `RECONCILE_PERF_EVERY`).
   */
  noteReconcile(ms: number): boolean {
    this.lastReconcileMs = ms;
    this.reconcileTicks += 1;
    if (this.reconcileTicks >= RECONCILE_PERF_EVERY) {
      this.reconcileTicks = 0;
      return true;
    }
    return false;
  }

  /** How many periodic coherence sweeps have run (diagnostics). */
  coherenceSweepCount(): number {
    return this.coherenceRuns;
  }

  /** How many corrections the sweeps have made (diagnostics). */
  coherenceFixCount(): number {
    return this.coherenceFixes;
  }

  /**
   * Stage 0 counters. They exist only to be observed: no decision anywhere
   * reads them. `queuePending` and `errors` stay owned by the session.
   */
  counters(queuePending: number, errors: number): SessionCounters {
    const round = (value: number): number => Math.round(value * 1000) / 1000;
    return {
      sweeps: this.coherenceRuns,
      sweepMsMax: round(this.sweepMsMax),
      sweepMsAvg: this.coherenceRuns > 0 ? round(this.sweepMsTotal / this.coherenceRuns) : 0,
      classifyCalls: this.classifyCalls,
      classifyMisses: this.classifyMisses,
      plansComputed: this.plansComputed,
      sweepFrameReads: this.sweepFrameReads,
      drains: this.drains,
      queuePending,
      drainMsMax: round(this.drainMsMax),
      drainMsP50: round(percentile(this.drainSamples, 0.5)),
      drainMsP95: round(percentile(this.drainSamples, 0.95)),
      applyMsP50: round(percentile(this.applySamples, 0.5)),
      applyMsP95: round(percentile(this.applySamples, 0.95)),
      applySamples: this.applySamples.length,
      clampsApplied: this.clampsApplied,
      errors,
    };
  }

  private pushSample(samples: number[], value: number): void {
    samples.push(value);
    while (samples.length > SessionDiagnostics.SAMPLE_RING) samples.shift();
  }

  /** §21: retile timings for the perf event. */
  perf(): SessionPerf {
    return { lastReconcileMs: this.lastReconcileMs, lastApplyMs: this.lastApplyMs, lastApplyAtMs: this.lastApplyAtMs };
  }
}

/** Nearest-rank percentile of a small bounded sample set; 0 when empty. */
function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}
