// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { checkPlan } from '../../src/core/invariants.js';
import type { TilerConfig } from '../../src/core/tiler.js';
import { computePlans, layoutAll } from '../../src/core/tiler.js';
import type { Rect, TilePlan } from '../../src/core/types.js';
import { snapRectInward } from '../../src/core/types.js';
import { rect, screen, window } from './helpers.js';

function config(overrides: Partial<TilerConfig> = {}): TilerConfig {
  return {
    gapBase: 0,
    gapPortrait: -1,
    gapLandscape: -1,
    minSizePolicy: 'respect',
    primaryApps: [],
    primaryAppRatio: 0.5,
    ratios: {},
    swapPairs: new Set(),
    rules: [],
    ...overrides,
  };
}

/// A two-window plan on a monitor whose geometry and work area are `area`.
function pairOn(area: Rect, scale: number, gap = 0): TilePlan {
  const s = screen({ geometry: area, scale });
  return computePlans(
    [window({ id: 1 }), window({ id: 2, appId: 'b' })],
    s,
    config({ gapBase: gap, gapBetween: gap }),
  );
}

/** The two placements in reading order (top-left first), independent of slot. */
function ordered(plan: TilePlan): [Rect, Rect] {
  const [a, b] = [...plan.placements].sort((p, q) => p.rect.x - q.rect.x || p.rect.y - q.rect.y);
  return [a.rect, b.rect];
}

function expectInside(area: Rect, r: Rect): void {
  expect(r.x).toBeGreaterThanOrEqual(area.x);
  expect(r.y).toBeGreaterThanOrEqual(area.y);
  expect(r.x + r.width).toBeLessThanOrEqual(area.x + area.width);
  expect(r.y + r.height).toBeLessThanOrEqual(area.y + area.height);
}

/**
 * The two tiles share one physical-pixel boundary at `scale` — exactly the
 * "no seam, no 1 px overlap" the surface demands. Logical arithmetic can differ
 * by a floating-point ulp, so the shared grid boundary is compared in physical
 * pixels (the unit that actually matters), and the logical overlap is capped at
 * half a physical pixel (which rounds to the same pixel).
 */
function expectMeet(a: Rect, b: Rect, axis: 'x' | 'y', scale: number): void {
  const aEnd = axis === 'x' ? a.x + a.width : a.y + a.height;
  const bStart = axis === 'x' ? b.x : b.y;
  expect(Math.round(aEnd * scale)).toBe(Math.round(bStart * scale));
  expect(aEnd).toBeLessThanOrEqual(bStart + 0.5 / scale);
}

/**
 * §10/§25: at a fractional scale the split boundary must be reconciled, so the
 * two tiles meet exactly (no seam, no 1 px overlap) and both stay inside the
 * work area. The work areas below are deliberately off the scale grid (an
 * offset origin, or a width the scale does not divide), which is where the
 * independent rounding of `snapRect` used to break the pair.
 */
describe('computePlans — fractional scale reconciliation', () => {
  const cases: ReadonlyArray<{ scale: number; area: Rect }> = [
    { scale: 1.25, area: rect(2, 0, 1278, 800) },
    { scale: 1.5, area: rect(1, 0, 1278, 800) },
    { scale: 1.75, area: rect(1, 1, 1275, 799) },
    { scale: 2, area: rect(1, 0, 1278, 800) },
  ];

  for (const { scale, area } of cases) {
    it(`makes the pair meet exactly inside the work area at scale ${scale}`, () => {
      const plan = pairOn(area, scale);
      expect(checkPlan(plan, area)).toEqual([]);
      const [left, right] = ordered(plan);
      // Adjacent: the shared boundary is a single rounded decision, not two.
      expectMeet(left, right, 'x', scale);
      expectInside(area, left);
      expectInside(area, right);
      // Fitted to the surface: the shrink is at most one grid step per outer edge.
      const step = 1 / scale;
      expect(left.x - area.x).toBeLessThan(step + 1e-9);
      expect(area.x + area.width - (right.x + right.width)).toBeLessThan(step + 1e-9);
    });
  }

  it('keeps the configured between-window gap and never overlaps', () => {
    const area = rect(1, 0, 1278, 800);
    const plan = pairOn(area, 1.5, 10);
    const [left, right] = ordered(plan);
    const gap = right.x - (left.x + left.width);
    expect(gap).toBeGreaterThanOrEqual(-0.5 / 1.5);
    // Rounding the gap lands within one grid step of what was asked for.
    expect(Math.abs(gap - 10)).toBeLessThanOrEqual(1 / 1.5 + 1e-9);
    expectInside(area, left);
    expectInside(area, right);
  });

  it('reconciles a vertical split the same way on a portrait monitor', () => {
    const area = rect(0, 1, 800, 1278);
    const plan = pairOn(area, 1.5);
    const [top, bottom] = ordered(plan);
    expectMeet(top, bottom, 'y', 1.5);
    expectInside(area, top);
    expectInside(area, bottom);
  });

  it('handles an offset-origin monitor at a fractional scale', () => {
    const area = rect(1921, 0, 1278, 800);
    const plan = pairOn(area, 1.5);
    const [left, right] = ordered(plan);
    expectMeet(left, right, 'x', 1.5);
    expectInside(area, left);
    expectInside(area, right);
    // The whole pair is fitted to the offset surface, not to the origin.
    expect(left.x).toBeGreaterThanOrEqual(area.x);
    expect(right.x + right.width).toBeGreaterThanOrEqual(area.x + area.width - 1 / 1.5 - 1e-9);
  });

  it('keeps integer scales byte-identical (no reconciliation at scale 1/2)', () => {
    const one = pairOn(rect(0, 0, 1920, 1080), 1, 10);
    const two = pairOn(rect(0, 0, 1920, 1080), 2, 10);
    for (const plan of [one, two]) {
      expect(plan.placements[0].rect).toEqual(rect(0, 0, 955, 1080));
      expect(plan.placements[1].rect).toEqual(rect(965, 0, 955, 1080));
    }
  });
});

describe('layoutAll — mixed scale session', () => {
  it('keeps each monitor pair adjacent and inside its own work area', () => {
    const small = screen({ index: 0, connector: 'M0', geometry: rect(2, 0, 1278, 800), scale: 1.25 });
    const large = screen({ index: 1, connector: 'M1', geometry: rect(1282, 0, 1276, 800), scale: 1.75 });
    const plans = layoutAll({
      windows: [
        window({ id: 1, workspaceId: 0, screenId: 0 }),
        window({ id: 2, appId: 'b', workspaceId: 0, screenId: 0 }),
        window({ id: 3, appId: 'c', workspaceId: 0, screenId: 1 }),
        window({ id: 4, appId: 'd', workspaceId: 0, screenId: 1 }),
      ],
      screens: [small, large],
      config: config(),
    });
    expect(plans).toHaveLength(2);
    for (const entry of plans) {
      const area = entry.screenId === 0 ? rect(2, 0, 1278, 800) : rect(1282, 0, 1276, 800);
      expect(checkPlan(entry.plan, area)).toEqual([]);
      const [left, right] = ordered(entry.plan);
      expectMeet(left, right, 'x', entry.screenId === 0 ? 1.25 : 1.75);
      expectInside(area, left);
      expectInside(area, right);
    }
  });
});

describe('snapRectInward', () => {
  it('shrinks to the grid from the inside and is never larger than the input', () => {
    const snapped = snapRectInward(rect(1, 1, 1278, 800), 1.25);
    expect(snapped.x).toBe(1.6);
    expect(snapped.y).toBe(1.6);
    expect(snapped.width).toBeCloseTo(1276.8, 6);
    expect(snapped.height).toBeCloseTo(799.2, 6);
  });

  it('is a no-op at scale 1 and at integer scales', () => {
    const r = rect(3, 5, 1279, 801);
    expect(snapRectInward(r, 1)).toBe(r);
    expect(snapRectInward(r, 2)).toBe(r);
  });
});
