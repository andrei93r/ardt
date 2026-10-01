// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Pure animation timing (§11.3, §18). No compositor imports: the adapter reads
 * the OS (the Shell's animation settings, per-screen refresh rate, observed
 * frame intervals) and feeds these functions, so the arithmetic is unit-testable
 * and no screen is assumed to be 60 Hz.
 *
 * Fixed refresh (a constant 60/120/144 Hz panel): the frame interval is
 * `1000 / refreshRate` and durations are snapped to whole frames.
 *
 * Variable refresh (VRR / adaptive sync): the interval is not constant, so a
 * single nominal rate is not enough. The compositor frame clock is preferred
 * (frame-clock-driven timelines and eases follow actual presentation); where a
 * number is unavoidable, `FrameIntervalTracker` keeps a rolling estimate of the
 * observed interval and `effectiveIntervalMs` prefers it over the nominal rate.
 */

/** Refresh rate assumed only when the compositor reports none. */
export const DEFAULT_REFRESH_RATE = 60;

/** A guard for nonsense rates from the compositor; real panels stay well inside. */
const MIN_REFRESH_RATE = 1;
const MAX_REFRESH_RATE = 1000;

/** A frame gap larger than this is a stall, not a frame; it is not sampled. */
const MAX_FRAME_GAP_MS = 250;

export interface FrameTimingOptions {
  animationsEnabled: boolean;
  slowDownFactor: number;
  refreshRate: number;
  /**
   * A measured frame interval (VRR): when set it takes precedence over the
   * nominal `refreshRate`.
   */
  observedIntervalMs?: number | null;
}

export interface ScreenTiming {
  index: number;
  refreshRate: number;
  /** `1000 / refreshRate`, raw so callers can budget against it. */
  frameIntervalMs: number;
}

export interface ResolvedTiming {
  animationsEnabled: boolean;
  slowDownFactor: number;
  screens: ScreenTiming[];
  /**
   * The tightest nominal frame interval across every screen. Signal-sampling
   * cadences use it so they are never slower than the fastest fixed display.
   */
  baseFrameIntervalMs: number;
  /** The measured frame interval, once enough frames have been seen (VRR). */
  observedFrameIntervalMs: number | null;
  /** Whether the OS reports adaptive sync (the experimental feature) is on. */
  adaptiveSync: boolean;
  /** Whether the measured sequence looks adaptive (spread beyond a threshold). */
  variableRefresh: boolean;
  /** The interval a single-number caller should use: measured under VRR, else tightest. */
  resolvedFrameIntervalMs: number;
}

/** A finite, positive refresh rate, else the 60 Hz fallback. */
export function normalizeRefreshRate(refreshRate: number | undefined | null): number {
  if (typeof refreshRate !== 'number' || !Number.isFinite(refreshRate) || refreshRate <= 0) {
    return DEFAULT_REFRESH_RATE;
  }
  return Math.min(MAX_REFRESH_RATE, Math.max(MIN_REFRESH_RATE, refreshRate));
}

/** The frame interval for a screen, in milliseconds (`1000 / refreshRate`). */
export function frameIntervalMs(refreshRate: number | undefined | null): number {
  return 1000 / normalizeRefreshRate(refreshRate);
}

/** A positive slow-down factor, else 1 (GNOME's "no slow-down"). */
export function normalizeSlowDownFactor(factor: number | undefined | null): number {
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) return 1;
  return factor;
}

/**
 * Snap a duration to a whole number of compositor frames at an explicit
 * interval (milliseconds), scaled first by `slowDownFactor`. Returns the
 * nearest whole-frame duration, so a caller handing the result to a
 * frame-clock timeline is at most one frame off the requested length.
 */
export function alignToInterval(
  durationMs: number,
  intervalMs: number | undefined | null,
  slowDownFactor: number | undefined | null = 1,
): number {
  const requested = Math.max(0, durationMs) * normalizeSlowDownFactor(slowDownFactor);
  if (requested <= 0) return 0;
  const interval = typeof intervalMs === 'number' && Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : frameIntervalMs(DEFAULT_REFRESH_RATE);
  const frames = Math.max(1, Math.round(requested / interval));
  return frames * interval;
}

/** Snap a duration to whole frames at a nominal refresh rate. */
export function alignToFrame(
  durationMs: number,
  refreshRate: number | undefined | null,
  slowDownFactor: number | undefined | null = 1,
): number {
  return alignToInterval(durationMs, frameIntervalMs(refreshRate), slowDownFactor);
}

/**
 * The duration an animation should actually run for: zero when the OS (or the
 * user's adrt setting) disables animations, otherwise frame-aligned against the
 * measured interval when one is available, else the nominal refresh rate.
 */
export function effectiveDuration(durationMs: number, options: FrameTimingOptions): number {
  if (!options.animationsEnabled) return 0;
  const observed = options.observedIntervalMs;
  if (typeof observed === 'number' && Number.isFinite(observed) && observed > 0) {
    return alignToInterval(durationMs, observed, options.slowDownFactor);
  }
  return alignToFrame(durationMs, options.refreshRate, options.slowDownFactor);
}

/** A rolling summary of observed compositor frame intervals. */
export interface FrameIntervalSummary {
  samples: number;
  /** Median observed interval, robust to a single outlier. */
  intervalMs: number;
  minMs: number;
  maxMs: number;
  /** `(max - min) / median`; the spread that reveals adaptive sync. */
  spread: number;
  /** True when the spread exceeds the threshold for long enough. */
  variable: boolean;
}

const EMPTY_SUMMARY: FrameIntervalSummary = {
  samples: 0,
  intervalMs: 0,
  minMs: 0,
  maxMs: 0,
  spread: 0,
  variable: false,
};

/**
 * Keep re-measuring frame intervals instead of caching a nominal rate once.
 * Feed it every compositor frame while animating; `summary()` gives a robust
 * median and a VRR hint. Pure: no timers, no compositor access.
 */
export class FrameIntervalTracker {
  private readonly window: number[] = [];
  private readonly capacity: number;
  private readonly variableThreshold: number;

  constructor(options: { capacity?: number; variableThreshold?: number } = {}) {
    this.capacity = Math.max(4, options.capacity ?? 48);
    this.variableThreshold = options.variableThreshold ?? 0.15;
  }

  /** Sample one frame interval; a stall or nonsense value is ignored. */
  observe(intervalMs: number): boolean {
    if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) return false;
    if (intervalMs > MAX_FRAME_GAP_MS) return false;
    this.window.push(intervalMs);
    if (this.window.length > this.capacity) this.window.shift();
    return true;
  }

  get size(): number {
    return this.window.length;
  }

  reset(): void {
    this.window.length = 0;
  }

  summary(): FrameIntervalSummary {
    if (this.window.length === 0) return { ...EMPTY_SUMMARY };
    const sorted = [...this.window].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const spread = median > 0 ? (max - min) / median : 0;
    return {
      samples: sorted.length,
      intervalMs: median,
      minMs: min,
      maxMs: max,
      spread,
      variable: sorted.length >= 4 && spread > this.variableThreshold,
    };
  }
}

/**
 * The interval a fixed timer should use: the measured interval once it has
 * enough samples, else the nominal rate. `minSamples` keeps a couple of
 * start-up frames from being mistaken for the panel's rate.
 */
export function effectiveIntervalMs(
  nominalRefreshRate: number | undefined | null,
  observed: FrameIntervalSummary | null | undefined,
  minSamples = 8,
): number {
  if (observed !== null && observed !== undefined && observed.samples >= minSamples && observed.intervalMs > 0) {
    return observed.intervalMs;
  }
  return frameIntervalMs(nominalRefreshRate);
}

/** Derive the resolved timing property from the OS readings and screen list. */
export function resolveTiming(
  screens: readonly { index: number; refreshRate: number }[],
  animationsEnabled: boolean,
  slowDownFactor: number | undefined | null,
  observed: FrameIntervalSummary | null = null,
  adaptiveSync = false,
): ResolvedTiming {
  const list: ScreenTiming[] = screens.map((screen) => ({
    index: screen.index,
    refreshRate: normalizeRefreshRate(screen.refreshRate),
    frameIntervalMs: frameIntervalMs(screen.refreshRate),
  }));
  const baseFrameIntervalMs =
    list.length === 0 ? frameIntervalMs(DEFAULT_REFRESH_RATE) : Math.min(...list.map((s) => s.frameIntervalMs));
  const measured = observed !== null && observed.samples > 0 ? observed : null;
  const measuredReady = measured !== null && measured.samples >= 8;
  const observedFrameIntervalMs = measured === null ? null : measured.intervalMs;
  // Follow the measured interval only when the OS actually reports adaptive
  // sync; a fixed display (or a headless shell whose frame clock is not
  // vsync-limited) uses the nominal per-screen rate, which is exact there.
  const useMeasured = adaptiveSync && measuredReady;
  return {
    animationsEnabled: animationsEnabled === true,
    slowDownFactor: normalizeSlowDownFactor(slowDownFactor),
    screens: list,
    baseFrameIntervalMs,
    observedFrameIntervalMs,
    adaptiveSync: adaptiveSync === true,
    variableRefresh: adaptiveSync && measured !== null && measured.variable,
    resolvedFrameIntervalMs: useMeasured && measured !== null ? measured.intervalMs : baseFrameIntervalMs,
  };
}

/** The frame interval of one screen by index, falling back to the resolved one. */
export function frameIntervalForScreen(timing: ResolvedTiming, screenId: number | undefined): number {
  if (timing.adaptiveSync && timing.observedFrameIntervalMs !== null) return timing.observedFrameIntervalMs;
  if (screenId === undefined) return timing.baseFrameIntervalMs;
  return timing.screens.find((screen) => screen.index === screenId)?.frameIntervalMs ?? timing.baseFrameIntervalMs;
}
