// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * OS timing source (§11.3, §18). Reads GNOME's animation state and each
 * screen's refresh rate, keeps a rolling estimate of the *observed* frame
 * interval (so variable-refresh setups are followed rather than assumed), and
 * feeds the pure functions in `core/timing.ts`.
 *
 * The `notify::` handlers here never run policy: they ask for a read-only
 * re-derivation. `resolve()` itself re-reads the OS on every call.
 */

import Gio from 'gi://Gio';
import St from 'gi://St';

import {
  DEFAULT_REFRESH_RATE,
  FrameIntervalTracker,
  effectiveDuration,
  frameIntervalForScreen,
  resolveTiming,
} from '../../core/timing.js';
import type { FrameIntervalSummary, ResolvedTiming, ScreenTiming } from '../../core/timing.js';
import type { Screen } from '../../core/types.js';

export interface TimingDeps {
  screens(): readonly Screen[];
  /** adrt's own `disable-animations` setting, used when St is unavailable. */
  animationsDisabled?(): boolean;
  /** Whether the OS reports adaptive sync (VRR) is enabled. */
  adaptiveSync?(): boolean;
  /** Called (no policy) whenever an OS animation setting or frame sample changes. */
  onChanged?(): void;
}

/** `St.Settings.get()`, or null in a bare test shell that has no St settings. */
function safeStSettings(): any {
  try {
    return St.Settings.get();
  } catch {
    return null;
  }
}

function numberProperty(object: any, name: string): number | null {
  try {
    const value = object?.[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function booleanProperty(object: any, name: string): boolean | null {
  try {
    const value = object?.[name];
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

function rawProperty(object: any, name: string): unknown {
  try {
    return object?.[name];
  } catch {
    return undefined;
  }
}

/**
 * Interpret a reduced-motion reading, which differs across Shell versions: a
 * boolean (GNOME 50), a `St.ReducedMotion` enum (GNOME 51: NO=0, REDUCE=1,
 * DEFAULT=2) or a string. Only an affirmative value counts.
 */
function reducedMotionValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value === 'reduce' || value === 'reduced';
  return null;
}

export class GnomeTiming {
  private readonly stSettings: any;
  private interfaceSettings: any = null;
  private notifyIds: number[] = [];
  private readonly tracker = new FrameIntervalTracker();

  constructor(private readonly deps: TimingDeps) {
    this.stSettings = safeStSettings();
    if (this.stSettings !== null && typeof this.stSettings.connect === 'function') {
      for (const property of ['enable-animations', 'slow-down-factor', 'reduced-motion', 'reduced_motion']) {
        // Skip a property this Shell does not have, so connecting never warns.
        try {
          if (typeof this.stSettings.find_property === 'function' && this.stSettings.find_property(property) === null) continue;
        } catch {
          continue;
        }
        try {
          this.notifyIds.push(this.stSettings.connect(`notify::${property}`, () => this.invalidate()));
        } catch {
          /* The property does not exist on this Shell; the read falls back. */
        }
      }
    }
    try {
      this.interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    } catch {
      this.interfaceSettings = null;
    }
  }

  destroy(): void {
    if (this.stSettings !== null && typeof this.stSettings.disconnect === 'function') {
      for (const id of this.notifyIds) {
        try {
          this.stSettings.disconnect(id);
        } catch {
          /* already gone */
        }
      }
    }
    this.notifyIds = [];
  }

  /** A screen/setting changed: ask for a read-only re-derivation (no policy). */
  invalidate(): void {
    this.deps.onChanged?.();
  }

  /** Feed one observed compositor frame interval (ms). Keeps re-measuring. */
  observeFrame(intervalMs: number): boolean {
    if (!this.tracker.observe(intervalMs)) return false;
    this.deps.onChanged?.();
    return true;
  }

  summary(): FrameIntervalSummary {
    return this.tracker.summary();
  }

  /** Drop measured intervals: a screen/topology change makes them stale. */
  resetObserved(): void {
    this.tracker.reset();
  }

  /**
   * The resolved timing property. Deliberately stateless: the OS settings and
   * the screen list are re-read on every call, so a change is followed even if
   * a `notify::` signal is missed. The `notify::` handlers only ask for a
   * read-only re-derivation, never run policy.
   */
  resolve(): ResolvedTiming {
    return resolveTiming(
      this.deps.screens(),
      this.animationsEnabled(),
      this.slowDownFactor(),
      this.tracker.summary(),
      this.deps.adaptiveSync?.() === true,
    );
  }

  /** `St.Settings.enable_animations`, never overriding an explicit adrt disable. */
  animationsEnabled(): boolean {
    if (this.deps.animationsDisabled?.() === true) return false;
    return this.osAnimationsEnabled();
  }

  /** The OS's own animation state, ignoring adrt's internal `disable-animations`. */
  osAnimationsEnabled(): boolean {
    // GNOME 51's reduced-motion preference is the strongest signal: no motion.
    if (this.reducedMotion()) return false;
    const fromSt = booleanProperty(this.stSettings, 'enable_animations');
    if (fromSt !== null) return fromSt;
    try {
      return this.interfaceSettings?.get_boolean('enable-animations') ?? true;
    } catch {
      return true;
    }
  }

  /**
   * GNOME's reduced-motion preference, where the Shell exposes it (GNOME 51's
   * `St.Settings`, boolean or `St.ReducedMotion` enum), else the mirror key if
   * the schema has one, else false.
   */
  reducedMotion(): boolean {
    for (const name of ['reduced_motion', 'reduced-motion']) {
      const value = reducedMotionValue(rawProperty(this.stSettings, name));
      if (value !== null) return value;
    }
    try {
      const variant = this.interfaceSettings?.get_value('reduced-motion');
      const value = typeof variant?.unpack === 'function' ? variant.unpack() : undefined;
      const interpreted = reducedMotionValue(value);
      if (interpreted !== null) return interpreted;
    } catch {
      /* key absent on this desktop */
    }
    return false;
  }

  /** `St.Settings.slow_down_factor`, the accessibility slow-down multiplier. */
  slowDownFactor(): number {
    const fromSt = numberProperty(this.stSettings, 'slow_down_factor');
    if (fromSt !== null) return fromSt;
    try {
      return this.interfaceSettings?.get_double('slow-down-factor') ?? 1;
    } catch {
      return 1;
    }
  }

  screens(): ScreenTiming[] {
    return this.resolve().screens;
  }

  /** The nominal Mutter refresh rate of a screen, 60 when unknown. */
  refreshRateFor(screenId: number | undefined): number {
    const timing = this.resolve();
    if (screenId === undefined) return timing.screens[0]?.refreshRate ?? DEFAULT_REFRESH_RATE;
    return timing.screens.find((screen) => screen.index === screenId)?.refreshRate ?? DEFAULT_REFRESH_RATE;
  }

  /** The frame interval for a screen; a measured variable interval wins. */
  frameIntervalFor(screenId?: number): number {
    return frameIntervalForScreen(this.resolve(), screenId);
  }

  /** A whole number of frames at the current interval, for a fixed timer. */
  sampleIntervalMs(frames: number): number {
    const interval = this.resolve().resolvedFrameIntervalMs;
    return Math.max(1, Math.round(interval * Math.max(1, frames)));
  }

  /**
   * The duration an animation should run for, frame-aligned. Uses the measured
   * interval only when the display actually looks adaptive, so a fixed-rate
   * screen keeps using its own nominal rate in a mixed setup.
   */
  effectiveDuration(baseMs: number, screenId?: number): number {
    const timing = this.resolve();
    return effectiveDuration(baseMs, {
      animationsEnabled: timing.animationsEnabled,
      slowDownFactor: timing.slowDownFactor,
      refreshRate: this.refreshRateFor(screenId),
      observedIntervalMs: timing.adaptiveSync ? timing.observedFrameIntervalMs : null,
    });
  }

  /** The resolved timing, for `DumpState` (add-only). */
  describe(): {
    animationsEnabled: boolean;
    osAnimationsEnabled: boolean;
    reducedMotion: boolean;
    slowDownFactor: number;
    baseFrameIntervalMs: number;
    observedFrameIntervalMs: number | null;
    adaptiveSync: boolean;
    variableRefresh: boolean;
    resolvedFrameIntervalMs: number;
    screens: ScreenTiming[];
  } {
    const timing = this.resolve();
    return {
      animationsEnabled: timing.animationsEnabled,
      osAnimationsEnabled: this.osAnimationsEnabled(),
      reducedMotion: this.reducedMotion(),
      slowDownFactor: timing.slowDownFactor,
      baseFrameIntervalMs: timing.baseFrameIntervalMs,
      observedFrameIntervalMs: timing.observedFrameIntervalMs,
      adaptiveSync: timing.adaptiveSync,
      variableRefresh: timing.variableRefresh,
      resolvedFrameIntervalMs: timing.resolvedFrameIntervalMs,
      screens: timing.screens,
    };
  }
}
