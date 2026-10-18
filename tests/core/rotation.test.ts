// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import {
  LOG_RETENTION_DAYS,
  isDayExpired,
  partPath,
  partsToPrune,
  retentionCutoffDay,
  shouldRotate,
} from '../../src/core/rotation.js';

describe('shouldRotate', () => {
  it('rotates at or above the threshold', () => {
    expect(shouldRotate(999, 1000)).toBe(false);
    expect(shouldRotate(1000, 1000)).toBe(true);
    expect(shouldRotate(5000, 1000)).toBe(true);
  });

  it('never rotates when the cap is disabled', () => {
    expect(shouldRotate(1e12, 0)).toBe(false);
    expect(shouldRotate(1e12, -5)).toBe(false);
  });
});

describe('partPath', () => {
  it('names parts after the day file', () => {
    const base = '/home/u/.local/share/adrt/history/2026-09-30.jsonl';
    expect(partPath(base, 1)).toBe(base);
    expect(partPath(base, 2)).toBe('/home/u/.local/share/adrt/history/2026-09-30.2.jsonl');
    expect(partPath(base, 7)).toBe('/home/u/.local/share/adrt/history/2026-09-30.7.jsonl');
  });
});

describe('partsToPrune', () => {
  it('keeps the newest parts', () => {
    expect(partsToPrune(3, 5)).toEqual([]);
    expect(partsToPrune(5, 5)).toEqual([]);
    expect(partsToPrune(7, 5)).toEqual([7, 6]);
  });

  it('always keeps at least the live part', () => {
    expect(partsToPrune(4, 0)).toEqual([4, 3, 2]);
    expect(partsToPrune(4, 1)).toEqual([4, 3, 2]);
  });
});

describe('31-day retention', () => {
  it('defaults to exactly 31 days', () => {
    expect(LOG_RETENTION_DAYS).toBe(31);
  });

  it('computes a day-based cutoff 31 days back', () => {
    const now = new Date(2026, 9, 18, 12, 0, 0);
    expect(retentionCutoffDay(now)).toBe('2026-09-17');
    expect(retentionCutoffDay(now, 1)).toBe('2026-10-17');
    expect(retentionCutoffDay(now, 31)).toBe('2026-09-17');
  });

  it('keeps the cutoff day and expires the day before it', () => {
    const now = new Date(2026, 9, 18, 12, 0, 0);
    expect(isDayExpired('2026-09-18', now)).toBe(false);
    expect(isDayExpired('2026-09-17', now)).toBe(false);
    expect(isDayExpired('2026-09-16', now)).toBe(true);
    expect(isDayExpired('2025-01-01', now)).toBe(true);
  });

  it('falls back to 31 days for a nonsensical setting', () => {
    const now = new Date(2026, 9, 18, 12, 0, 0);
    expect(retentionCutoffDay(now, 0)).toBe('2026-09-17');
    expect(retentionCutoffDay(now, Number.NaN)).toBe('2026-09-17');
  });
});
