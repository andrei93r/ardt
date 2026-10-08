// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { DOMINANCE_THRESHOLD, normalizePlan, rectArea } from '../../src/core/normalize.js';
import type { NormalizeDecision, NormalizeWindow } from '../../src/core/normalize.js';
import type { Rect } from '../../src/core/types.js';
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

/**
 * A literal transcription of the pre-optimisation `normalizePlan` body
 * (filter + sorts + copies). It is the behaviour authority: the tests below
 * assert the rewritten single-scan/single-sort version produces byte-identical
 * decisions, including on ties and duplicate ids.
 */
function referenceNormalize(
  windows: readonly NormalizeWindow[],
  area: Rect,
  threshold: number = DOMINANCE_THRESHOLD,
): NormalizeDecision {
  const managed = windows.filter((win) => win.managed && !win.floating && !win.fullscreen);
  if (managed.length === 0) return { kind: 'none', maximize: [], minimize: [], slots: [] };
  if (managed.length === 1) return { kind: 'lone', maximize: [managed[0].id], minimize: [], slots: [] };

  const total = rectArea(area);
  const dominant = total > 0 ? managed.filter((win) => win.visibleArea >= threshold * total) : [];
  if (dominant.length > 0) {
    const top = [...dominant].sort(
      (a, b) => b.visibleArea - a.visibleArea || a.rect.x - b.rect.x || a.id - b.id,
    )[0];
    return {
      kind: 'dominant',
      maximize: [top.id],
      minimize: managed.filter((win) => win.id !== top.id).map((win) => win.id),
      slots: [],
    };
  }

  const ranked = [...managed].sort(
    (a, b) => b.visibleArea - a.visibleArea || a.rect.x - b.rect.x || a.id - b.id,
  );
  const pair = ranked.slice(0, 2);
  const rest = ranked.slice(2).map((win) => win.id);
  const leftmost = [...pair].sort((a, b) => a.rect.x - b.rect.x || a.id - b.id);
  return {
    kind: 'pair',
    maximize: [],
    minimize: rest,
    slots: [
      { id: leftmost[0].id, slot: 0 },
      { id: leftmost[1].id, slot: 1 },
    ],
  };
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('normalizePlan — rewritten scan matches the original', () => {
  it('breaks a dominant tie by leftmost position, then id', () => {
    const total = rectArea(area);
    const covering = (id: number, x: number): NormalizeWindow => {
      const w = win(id, x, 0, 200, 200);
      w.visibleArea = total; // every candidate dominates
      return w;
    };
    expect(normalizePlan([covering(5, 500), covering(6, 100)], area).maximize).toEqual([6]);
    expect(normalizePlan([covering(9, 100), covering(3, 100)], area).maximize).toEqual([3]);
  });

  it('breaks a pair tie on surface by position, then id', () => {
    const a = win(1, 100, 0, 200, 200);
    const b = win(2, 50, 0, 200, 200);
    const c = win(3, 400, 0, 100, 100);
    const decision = normalizePlan([a, b, c], area);
    expect(decision.slots).toEqual([
      { id: 2, slot: 0 },
      { id: 1, slot: 1 },
    ]);
    expect(decision.minimize).toEqual([3]);
  });

  it('breaks a pair tie on position by the stable id', () => {
    const a = win(7, 0, 0, 200, 200);
    const b = win(2, 0, 0, 200, 200);
    const c = win(9, 400, 0, 100, 100);
    expect(normalizePlan([a, b, c], area).slots).toEqual([
      { id: 2, slot: 0 },
      { id: 7, slot: 1 },
    ]);
  });

  it('matches the original filter/sort implementation on 1000 random inputs', () => {
    const rand = lcg(0x1234abcd);
    const pick = (n: number): number => Math.floor(rand() * n);
    for (let iter = 0; iter < 1000; iter += 1) {
      const count = pick(6);
      const windows: NormalizeWindow[] = [];
      for (let i = 0; i < count; i += 1) {
        windows.push({
          id: pick(5), // duplicate ids on purpose
          rect: rect(pick(4) * 250, 0, 1 + pick(4) * 250, 1 + pick(4) * 200),
          visibleArea: pick(6) * 100000, // coarse buckets force ties
          managed: rand() > 0.25,
          fullscreen: rand() > 0.8,
          floating: rand() > 0.8,
        });
      }
      const threshold = rand() > 0.5 ? DOMINANCE_THRESHOLD : 0.4;
      expect(normalizePlan(windows, area, threshold)).toEqual(referenceNormalize(windows, area, threshold));
    }
  });
});
