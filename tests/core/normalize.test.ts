// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { DOMINANCE_THRESHOLD, normalizePlan, rectArea } from '../../src/core/normalize.js';
import type { NormalizeWindow } from '../../src/core/normalize.js';
import { rect } from './helpers.js';

const area = rect(0, 0, 1000, 800); // 800 000 px²

const win = (id: number, x: number, y: number, w: number, h: number, extra: Partial<NormalizeWindow> = {}): NormalizeWindow => ({
  id,
  rect: rect(x, y, w, h),
  visibleArea: w * h,
  managed: true,
  fullscreen: false,
  floating: false,
  ...extra,
});

describe('normalizePlan (§20 enable-time normalisation)', () => {
  it('does nothing with no managed windows', () => {
    expect(normalizePlan([], area)).toEqual({ kind: 'none', maximize: [], minimize: [], slots: [] });
  });

  it('maximizes a lone managed window (the lone law)', () => {
    const decision = normalizePlan([win(1, 0, 0, 400, 300)], area);
    expect(decision.kind).toBe('lone');
    expect(decision.maximize).toEqual([1]);
    expect(decision.minimize).toEqual([]);
  });

  it('maximizes a dominant window and minimizes the rest', () => {
    const big = win(1, 0, 0, 900, 700); // 630 000 = 78.75%
    const small = win(2, 900, 0, 200, 200);
    const decision = normalizePlan([big, small], area);
    expect(decision.kind).toBe('dominant');
    expect(decision.maximize).toEqual([1]);
    expect(decision.minimize).toEqual([2]);
  });

  it('treats exactly the threshold as dominating', () => {
    const covering = win(1, 0, 0, 1000, 800 * DOMINANCE_THRESHOLD); // exactly 70%
    const other = win(2, 0, 0, 100, 100);
    expect(normalizePlan([covering, other], area).kind).toBe('dominant');
  });

  it('pairs the top two by visible surface and minimizes the rest', () => {
    const a = win(1, 0, 0, 400, 300); // 120 000
    const b = win(2, 450, 0, 300, 300); // 90 000
    const c = win(3, 0, 400, 100, 100); // 10 000
    const decision = normalizePlan([a, b, c], area);
    expect(decision.kind).toBe('pair');
    expect(decision.slots).toEqual([
      { id: 1, slot: 0 },
      { id: 2, slot: 1 },
    ]);
    expect(decision.minimize).toEqual([3]);
  });

  it('puts the leftmost of the two most-visible windows in the left slot', () => {
    const right = win(1, 600, 0, 400, 400); // more visible, but right
    const left = win(2, 0, 0, 300, 300);
    const decision = normalizePlan([right, left], area);
    expect(decision.slots).toEqual([
      { id: 2, slot: 0 },
      { id: 1, slot: 1 },
    ]);
  });

  it('ignores floats and never minimizes them', () => {
    const floating = win(1, 0, 0, 400, 300, { floating: true, managed: false });
    const a = win(2, 0, 0, 400, 300);
    const b = win(3, 500, 0, 400, 300);
    const decision = normalizePlan([floating, a, b], area);
    expect(decision.kind).toBe('pair');
    expect(decision.minimize).toEqual([]);
    expect(decision.maximize).toEqual([]);
    expect(decision.slots.map((slot) => slot.id)).toEqual([2, 3]);
  });

  it('leaves a fullscreen window untouched and normalises the rest', () => {
    const fullscreen = win(1, 0, 0, 1000, 800, { fullscreen: true, managed: false });
    const only = win(2, 0, 0, 400, 300);
    const decision = normalizePlan([fullscreen, only], area);
    expect(decision.kind).toBe('lone');
    expect(decision.maximize).toEqual([2]);
    expect(decision.minimize).toEqual([]);
  });

  it('ignores a float when choosing the dominant window', () => {
    const floatingBig = win(1, 0, 0, 1000, 800, { floating: true, managed: false });
    const small = win(2, 0, 0, 100, 100);
    const decision = normalizePlan([floatingBig, small], area);
    expect(decision.kind).toBe('lone');
    expect(decision.maximize).toEqual([2]);
  });

  it('uses a variable threshold for the tests to vary', () => {
    const half = win(1, 0, 0, 1000, 400); // 50%
    const other = win(2, 0, 500, 100, 100);
    expect(normalizePlan([half, other], area).kind).toBe('pair');
    expect(normalizePlan([half, other], area, 0.4).kind).toBe('dominant');
  });

  it('rectArea is never negative', () => {
    expect(rectArea(rect(0, 0, -5, 5))).toBe(0);
  });
});
