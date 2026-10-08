// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REFRESH_RATE,
  FrameIntervalTracker,
  alignToFrame,
  alignToInterval,
  effectiveDuration,
  effectiveIntervalMs,
  frameIntervalForScreen,
  frameIntervalMs,
  normalizeRefreshRate,
  normalizeSlowDownFactor,
  resolveTiming,
} from '../../src/core/timing.js';

describe('frameIntervalMs', () => {
  it('derives the interval from fixed refresh rates, never assuming 60', () => {
    expect(frameIntervalMs(60)).toBeCloseTo(16.6667, 3);
    expect(frameIntervalMs(120)).toBeCloseTo(8.3333, 3);
    expect(frameIntervalMs(144)).toBeCloseTo(6.9444, 3);
    expect(frameIntervalMs(240)).toBeCloseTo(4.1667, 3);
  });

  it('falls back to 60 Hz for missing or nonsensical rates', () => {
    expect(normalizeRefreshRate(undefined)).toBe(DEFAULT_REFRESH_RATE);
    expect(normalizeRefreshRate(0)).toBe(DEFAULT_REFRESH_RATE);
    expect(normalizeRefreshRate(-120)).toBe(DEFAULT_REFRESH_RATE);
    expect(normalizeRefreshRate(Number.NaN)).toBe(DEFAULT_REFRESH_RATE);
    expect(frameIntervalMs(0)).toBeCloseTo(1000 / 60, 5);
  });
});

describe('alignToFrame', () => {
  it('snaps a duration to whole frames at a fixed rate', () => {
    // 180 ms at 60 Hz is 10.8 frames -> 11 frames.
    const aligned60 = alignToFrame(180, 60);
    expect(aligned60 / frameIntervalMs(60)).toBeCloseTo(Math.round(aligned60 / frameIntervalMs(60)), 6);
    expect(Math.abs(aligned60 - 180)).toBeLessThanOrEqual(frameIntervalMs(60));

    // At 144 Hz the same 180 ms is a whole number of (shorter) frames.
    const aligned144 = alignToFrame(180, 144);
    expect(aligned144 / frameIntervalMs(144)).toBeCloseTo(Math.round(aligned144 / frameIntervalMs(144)), 6);
    expect(Math.abs(aligned144 - 180)).toBeLessThanOrEqual(frameIntervalMs(144));
  });

  it('never returns less than one frame for a positive duration', () => {
    const one = alignToFrame(0.1, 60);
    expect(one).toBeCloseTo(frameIntervalMs(60), 6);
  });

  it('maps a zero duration to zero (no frame)', () => {
    expect(alignToFrame(0, 144)).toBe(0);
    expect(alignToInterval(0, 6.944)).toBe(0);
  });

  it('scales by the OS slow-down factor', () => {
    const normal = alignToFrame(150, 60, 1);
    const slowed = alignToFrame(150, 60, 2);
    expect(slowed).toBeCloseTo(normal * 2, 0);
    // A factor that is missing or nonsense means "no slow-down".
    expect(normalizeSlowDownFactor(0)).toBe(1);
    expect(normalizeSlowDownFactor(Number.NaN)).toBe(1);
    expect(alignToFrame(150, 60, 0)).toBe(normal);
  });
});

describe('effectiveDuration', () => {
  it('is instant when animations are disabled', () => {
    expect(effectiveDuration(180, { animationsEnabled: false, slowDownFactor: 1, refreshRate: 60 })).toBe(0);
    expect(effectiveDuration(180, { animationsEnabled: false, slowDownFactor: 2, refreshRate: 144 })).toBe(0);
  });

  it('is frame-aligned when animations are enabled', () => {
    const at120 = effectiveDuration(180, { animationsEnabled: true, slowDownFactor: 1, refreshRate: 120 });
    expect(at120 / frameIntervalMs(120)).toBeCloseTo(Math.round(at120 / frameIntervalMs(120)), 6);
  });

  it('prefers a measured interval over the nominal rate (variable refresh)', () => {
    // A VRR sequence around ~90 Hz would be misread as 60 Hz from the nominal
    // rate; the measured interval must win.
    const measured = 11.1;
    const duration = effectiveDuration(111, {
      animationsEnabled: true,
      slowDownFactor: 1,
      refreshRate: 60,
      observedIntervalMs: measured,
    });
    expect(duration / measured).toBeCloseTo(10, 6);
    expect(duration).not.toBeCloseTo(alignToFrame(111, 60), 6);
  });
});

describe('FrameIntervalTracker', () => {
  it('reports a stable interval for a fixed refresh rate', () => {
    const tracker = new FrameIntervalTracker();
    for (let i = 0; i < 12; i++) tracker.observe(16.7);
    const summary = tracker.summary();
    expect(summary.samples).toBe(12);
    expect(summary.intervalMs).toBeCloseTo(16.7, 3);
    expect(summary.spread).toBe(0);
    expect(summary.variable).toBe(false);
  });

  it('detects a varying (adaptive-sync) sequence', () => {
    const tracker = new FrameIntervalTracker();
    for (const interval of [8.3, 11.1, 13.9, 16.7, 8.3, 11.1, 13.9, 16.7]) tracker.observe(interval);
    const summary = tracker.summary();
    expect(summary.variable).toBe(true);
    expect(summary.spread).toBeGreaterThan(0.15);
    // The median is the robust estimate, not the mean.
    expect(summary.intervalMs).toBeCloseTo((11.1 + 13.9) / 2, 3);
  });

  it('rejects stalls and nonsense instead of learning them', () => {
    const tracker = new FrameIntervalTracker();
    expect(tracker.observe(0)).toBe(false);
    expect(tracker.observe(Number.NaN)).toBe(false);
    expect(tracker.observe(500)).toBe(false);
    expect(tracker.size).toBe(0);
  });

  it('keeps re-measuring instead of caching the first window', () => {
    const tracker = new FrameIntervalTracker({ capacity: 4 });
    for (let i = 0; i < 4; i++) tracker.observe(16.7);
    expect(tracker.summary().intervalMs).toBeCloseTo(16.7, 3);
    for (let i = 0; i < 4; i++) tracker.observe(8.3);
    expect(tracker.summary().intervalMs).toBeCloseTo(8.3, 3);
  });

  it('reports the exact min/median/max/spread of the window', () => {
    const even = new FrameIntervalTracker();
    for (const interval of [30, 10, 20, 40]) even.observe(interval);
    const evenSummary = even.summary();
    expect(evenSummary.samples).toBe(4);
    expect(evenSummary.intervalMs).toBe(25);
    expect(evenSummary.minMs).toBe(10);
    expect(evenSummary.maxMs).toBe(40);
    expect(evenSummary.spread).toBeCloseTo(1.2, 6);
    expect(evenSummary.variable).toBe(true);

    const odd = new FrameIntervalTracker();
    for (const interval of [3, 1, 2]) odd.observe(interval);
    const oddSummary = odd.summary();
    expect(oddSummary.intervalMs).toBe(2);
    expect(oddSummary.minMs).toBe(1);
    expect(oddSummary.maxMs).toBe(3);
    expect(oddSummary.spread).toBeCloseTo(1, 6);
    // Fewer than four samples never claims variable refresh.
    expect(oddSummary.variable).toBe(false);
  });

  it('invalidates the cached sorted view when a sample is observed', () => {
    const tracker = new FrameIntervalTracker({ capacity: 4 });
    for (const interval of [30, 10, 20, 40]) tracker.observe(interval);
    const first = tracker.summary();
    expect(first.intervalMs).toBe(25);
    // Reading again with no new sample returns the same cached result.
    expect(tracker.summary()).toEqual(first);
    // One observation evicts the oldest and must be reflected exactly.
    tracker.observe(5);
    const after = tracker.summary();
    expect(after.samples).toBe(4);
    expect(after.intervalMs).toBe(15);
    expect(after.minMs).toBe(5);
    expect(after.maxMs).toBe(40);
  });

  it('invalidates the cached sorted view on reset', () => {
    const tracker = new FrameIntervalTracker();
    tracker.observe(16.7);
    expect(tracker.summary().intervalMs).toBeCloseTo(16.7, 3);
    tracker.reset();
    expect(tracker.summary()).toEqual({ samples: 0, intervalMs: 0, minMs: 0, maxMs: 0, spread: 0, variable: false });
    // A fresh sample after reset builds a new sorted view.
    for (const interval of [8, 12]) tracker.observe(interval);
    expect(tracker.summary().intervalMs).toBe(10);
  });
});

describe('effectiveIntervalMs', () => {
  it('uses the nominal rate until enough frames have been measured', () => {
    const tracker = new FrameIntervalTracker();
    tracker.observe(11.1);
    expect(effectiveIntervalMs(60, tracker.summary(), 8)).toBeCloseTo(frameIntervalMs(60), 6);
    for (let i = 0; i < 10; i++) tracker.observe(11.1);
    expect(effectiveIntervalMs(60, tracker.summary(), 8)).toBeCloseTo(11.1, 3);
  });
});

describe('resolveTiming', () => {
  it('resolves per-screen intervals and the tightest base', () => {
    const timing = resolveTiming(
      [
        { index: 0, refreshRate: 60 },
        { index: 1, refreshRate: 144 },
      ],
      true,
      1,
    );
    expect(timing.screens.map((s) => s.index)).toEqual([0, 1]);
    expect(timing.screens[0].frameIntervalMs).toBeCloseTo(16.6667, 3);
    expect(timing.screens[1].frameIntervalMs).toBeCloseTo(6.9444, 3);
    expect(timing.baseFrameIntervalMs).toBeCloseTo(6.9444, 3);
    expect(timing.animationsEnabled).toBe(true);
    expect(timing.observedFrameIntervalMs).toBeNull();
    expect(timing.variableRefresh).toBe(false);
  });

  it('reports a measured, variable interval when one is available', () => {
    const tracker = new FrameIntervalTracker();
    for (const interval of [8.3, 11.1, 13.9, 16.7, 8.3, 11.1, 13.9, 16.7]) tracker.observe(interval);
    const timing = resolveTiming([{ index: 0, refreshRate: 60 }], true, 1, tracker.summary(), true);
    expect(timing.observedFrameIntervalMs).toBeCloseTo(12.5, 3);
    expect(timing.adaptiveSync).toBe(true);
    expect(timing.variableRefresh).toBe(true);
    expect(timing.resolvedFrameIntervalMs).toBeCloseTo(12.5, 3);
    // A screen query for a VRR measurement returns the measured interval.
    expect(frameIntervalForScreen(timing, 0)).toBeCloseTo(12.5, 3);
  });

  it('ignores a measured interval when the OS reports no adaptive sync', () => {
    const tracker = new FrameIntervalTracker();
    for (const interval of [8.3, 11.1, 13.9, 16.7, 8.3, 11.1, 13.9, 16.7]) tracker.observe(interval);
    const timing = resolveTiming([{ index: 0, refreshRate: 60 }], true, 1, tracker.summary(), false);
    // The measurement is still reported for diagnostics, but the fixed rate wins.
    expect(timing.observedFrameIntervalMs).toBeCloseTo(12.5, 3);
    expect(timing.adaptiveSync).toBe(false);
    expect(timing.variableRefresh).toBe(false);
    expect(timing.resolvedFrameIntervalMs).toBeCloseTo(frameIntervalMs(60), 3);
    expect(frameIntervalForScreen(timing, 0)).toBeCloseTo(frameIntervalMs(60), 3);
  });

  it('carries the resolved slow-down factor and disables durations', () => {
    const timing = resolveTiming([{ index: 0, refreshRate: 60 }], false, 3);
    expect(timing.slowDownFactor).toBe(3);
    expect(timing.animationsEnabled).toBe(false);
    expect(
      effectiveDuration(180, {
        animationsEnabled: timing.animationsEnabled,
        slowDownFactor: timing.slowDownFactor,
        refreshRate: timing.screens[0].refreshRate,
      }),
    ).toBe(0);
  });
});
