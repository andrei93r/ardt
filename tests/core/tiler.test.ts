// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { checkPlan } from '../../src/core/invariants.js';
import type { TilerConfig } from '../../src/core/tiler.js';
import { computePlans, layoutAll, pairKey, ratioKey } from '../../src/core/tiler.js';
import { SurfaceKind } from '../../src/core/types.js';
import { rect, screen, size, window } from './helpers.js';

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

const landscape = screen({ geometry: rect(0, 0, 1920, 1080) });
const portrait = screen({ geometry: rect(0, 0, 1080, 1920) });

describe('computePlans — work area', () => {
  const withPanel = screen({
    geometry: rect(0, 0, 1920, 1080),
    workArea: rect(0, 32, 1920, 1048),
  });

  it('tiles inside the work area, leaving the top bar alone', () => {
    const plan = computePlans([window({ id: 1 }), window({ id: 2, appId: 'b' })], withPanel, config({ gapBase: 8 }));
    expect(checkPlan(plan, { width: 1920, height: 1080 })).toEqual([]);
    for (const placement of plan.placements) {
      expect(placement.rect.y).toBe(40);
      expect(placement.rect.height).toBe(1048 - 16);
    }
  });

  it("leaves a dock's right edge alone", () => {
    const withDock = screen({
      geometry: rect(0, 0, 1920, 1080),
      workArea: rect(0, 0, 1840, 1080),
    });
    const plan = computePlans([window({ id: 1 })], withDock, config({ gapBase: 0 }));
    expect(plan.placements[0].rect).toEqual(rect(0, 0, 1840, 1080));
  });
});

describe('computePlans — single window', () => {
  it('fills the monitor minus the gap', () => {
    const plan = computePlans([window({ id: 1 })], landscape, config({ gapBase: 10 }));
    expect(plan.placements).toHaveLength(1);
    expect(plan.placements[0].rect).toEqual(rect(10, 10, 1900, 1060));
  });

  it('keeps the current rect when reflow-keeps-edges is off', () => {
    const plan = computePlans(
      [window({ id: 1, rect: rect(640, 0, 640, 1080) })],
      landscape,
      config({ gapBase: 10, reflowKeepsEdges: false }),
    );
    expect(plan.placements[0].rect).toEqual(rect(640, 0, 640, 1080));
  });

  it('never shrinks below the minimum size', () => {
    const plan = computePlans([window({ id: 1, min: size(2000, 2000) })], landscape, config({ gapBase: 10 }));
    expect(plan.placements[0].rect.width).toBe(1920);
    expect(plan.placements[0].rect.height).toBe(1080);
  });
});

describe('computePlans — landscape pair', () => {
  it('splits side by side and respects the gap', () => {
    const plan = computePlans([window({ id: 1 }), window({ id: 2, appId: 'b' })], landscape, config({ gapBase: 10 }));
    expect(checkPlan(plan, size(1920, 1080))).toEqual([]);
    const [left, right] = plan.placements;
    expect(left.rect.x).toBe(10);
    expect(right.rect.x).toBeGreaterThan(left.rect.x + left.rect.width);
    expect(left.rect.width + right.rect.width).toBe(1920 - 20 - 10);
  });

  it('gives the primary app its configured ratio', () => {
    const plan = computePlans(
      [window({ id: 1, appId: 'term' }), window({ id: 2, appId: 'browser' })],
      landscape,
      config({ primaryApps: ['term'], primaryAppRatio: 0.7 }),
    );
    expect(plan.placements[0].rect.width).toBeCloseTo(1920 * 0.7, 1);
  });

  it('uses a saved ratio keyed by app pair and axis', () => {
    const key = ratioKey('term', 'browser', 'horizontal');
    const plan = computePlans([window({ id: 1, appId: 'term' }), window({ id: 2, appId: 'browser' })], landscape, config({ ratios: { [key]: 0.25 } }));
    // The saved fraction belongs to the sorted-first app ("browser", surface 2).
    expect(plan.placements[1].rect.width).toBeCloseTo(1920 * 0.25, 1);
    expect(plan.placements[0].rect.width).toBeCloseTo(1920 * 0.75, 1);
  });

  it('honours the pair-swap flag', () => {
    const swapped = new Set([pairKey(1, 2)]);
    const plan = computePlans([window({ id: 1 }), window({ id: 2, appId: 'b' })], landscape, config({ swapPairs: swapped }));
    const normal = computePlans([window({ id: 1 }), window({ id: 2, appId: 'b' })], landscape, config());
    expect(plan.placements[0].rect).toEqual(normal.placements[1].rect);
    expect(plan.placements[1].rect).toEqual(normal.placements[0].rect);
  });
});

describe('computePlans — portrait pair', () => {
  it('stacks vertically', () => {
    const plan = computePlans([window({ id: 1 }), window({ id: 2, appId: 'b' })], portrait, config());
    expect(checkPlan(plan, size(1080, 1920))).toEqual([]);
    expect(plan.placements[1].rect.y).toBeGreaterThan(plan.placements[0].rect.y);
    expect(plan.placements[0].rect.width).toBe(1080);
  });
});

describe('computePlans — minimum-size policies', () => {
  const cramped = screen({ geometry: rect(0, 0, 400, 300) });
  const big = { min: size(300, 200) };

  it('falls back to the other axis under respect', () => {
    const plan = computePlans(
      [window({ id: 1, min: size(300, 100) }), window({ id: 2, appId: 'b', min: size(300, 100) })],
      cramped,
      config({ minSizePolicy: 'respect' }),
    );
    // Horizontal needs 600 > 400, so it stacks vertically instead.
    expect(plan.placements[0].rect.width).toBe(400);
    expect(plan.placements[1].rect.y).toBe(plan.placements[0].rect.height);
  });

  it('stacks both windows at minimum size when that fits', () => {
    const plan = computePlans(
      [window({ id: 1, min: size(150, 100) }), window({ id: 2, appId: 'b', min: size(150, 100) })],
      cramped,
      config({ minSizePolicy: 'stack' }),
    );
    expect(checkPlan(plan, size(400, 300))).toEqual([]);
    expect(plan.placements[0].rect.width).toBe(150);
    expect(plan.placements[1].rect.x).toBe(400 - 150);
  });

  it('stays non-overlapping when neither minimum fits', () => {
    const plan = computePlans([window({ id: 1, ...big }), window({ id: 2, appId: 'b', ...big })], cramped, config());
    expect(checkPlan(plan, size(400, 300))).toEqual([]);
  });

  it('ignores minimums under the ignore policy', () => {
    const plan = computePlans(
      [window({ id: 1, ...big }), window({ id: 2, appId: 'b', ...big })],
      cramped,
      config({ minSizePolicy: 'ignore' }),
    );
    expect(checkPlan(plan, size(400, 300))).toEqual([]);
    expect(plan.placements[0].rect.width).toBe(200);
  });
});

describe('computePlans — rule override', () => {
  it('gives the matching window the left half', () => {
    const rules = [{ match: { appId: 'special' }, tile: 'left-half' as const }];
    const plan = computePlans([window({ id: 1 }), window({ id: 2, appId: 'special' })], landscape, config({ rules }));
    expect(plan.placements.find((p) => p.surfaceId === 2)?.rect.x).toBe(0);
    expect(plan.placements.find((p) => p.surfaceId === 1)?.rect.x).toBe(960);
  });

  it('gives the matching window the full monitor', () => {
    const rules = [{ match: { appId: 'special' }, tile: 'full' as const }];
    const plan = computePlans([window({ id: 1 }), window({ id: 2, appId: 'special' })], landscape, config({ rules }));
    expect(plan.placements).toHaveLength(1);
    expect(plan.placements[0].surfaceId).toBe(2);
    expect(plan.placements[0].rect).toEqual(rect(0, 0, 1920, 1080));
  });

  it('picks the lowest-id window when several match', () => {
    const rules = [{ match: { appId: 'special' }, tile: 'right-half' as const }];
    const plan = computePlans(
      [window({ id: 5, appId: 'special' }), window({ id: 2, appId: 'special' })],
      landscape,
      config({ rules }),
    );
    expect(plan.placements.find((p) => p.surfaceId === 2)?.rect.x).toBe(960);
  });
});

describe('computePlans — scale snapping', () => {
  it('snaps rects to the monitor scale grid', () => {
    const scaled = screen({ geometry: rect(0, 0, 1920, 1080), scale: 2 });
    const plan = computePlans([window({ id: 1 }), window({ id: 2, appId: 'b' })], scaled, config({ minSizePolicy: 'ignore', ratios: {} }));
    for (const placement of plan.placements) {
      expect(placement.rect.width * 2).toBe(Math.round(placement.rect.width * 2));
    }
  });
});

describe('layoutAll', () => {
  it('groups by workspace and screen', () => {
    const plans = layoutAll({
      windows: [
        window({ id: 1, workspaceId: 0, screenId: 0 }),
        window({ id: 2, appId: 'b', workspaceId: 0, screenId: 0 }),
        window({ id: 3, appId: 'c', kind: SurfaceKind.NORMAL, workspaceId: 1, screenId: 0 }),
      ],
      screens: [landscape],
      config: config(),
    });
    expect(plans).toHaveLength(2);
    expect(plans.find((p) => p.workspaceId === 0)?.plan.placements).toHaveLength(2);
    expect(plans.find((p) => p.workspaceId === 1)?.plan.placements).toHaveLength(1);
  });
});

describe('gap overrides', () => {
  it('prefers the orientation-specific gap over the base', () => {
    const plan = computePlans([window({ id: 1 })], landscape, config({ gapBase: 10, gapLandscape: 30 }));
    expect(plan.placements[0].rect).toEqual(rect(30, 30, 1860, 1020));
  });

  it('inherits the base gap when the override is negative', () => {
    const plan = computePlans([window({ id: 1 })], portrait, config({ gapBase: 12, gapPortrait: -1 }));
    expect(plan.placements[0].rect).toEqual(rect(12, 12, 1056, 1896));
  });
});

describe('computePlans — sides follow relative position', () => {
  it('keeps the window that is visually on the left on the left, whatever the ids', () => {
    // id 2 is on the left, id 1 on the right.
    const left = window({ id: 2, appId: 'b', rect: rect(0, 0, 400, 600) });
    const right = window({ id: 1, appId: 'a', rect: rect(1000, 0, 400, 600) });
    const plan = computePlans([right, left], landscape, config());
    const at = (id: number) => plan.placements.find((p) => p.surfaceId === id)!;
    expect(at(2).rect.x).toBeLessThan(at(1).rect.x);
    expect(at(2).order).toBe(0);
    expect(at(1).order).toBe(1);
  });

  it('falls back to the id when the windows overlap exactly', () => {
    const a = window({ id: 1, appId: 'a', rect: rect(0, 0, 400, 600) });
    const b = window({ id: 2, appId: 'b', rect: rect(0, 0, 400, 600) });
    const plan = computePlans([b, a], landscape, config());
    expect(plan.placements.find((p) => p.surfaceId === 1)!.order).toBe(0);
    expect(plan.placements.find((p) => p.surfaceId === 2)!.order).toBe(1);
  });

  it('orders a stacked (vertical) pair top-to-bottom by y', () => {
    const top = window({ id: 2, appId: 'b', rect: rect(0, 0, 800, 300) });
    const bottom = window({ id: 1, appId: 'a', rect: rect(0, 700, 800, 300) });
    const plan = computePlans([bottom, top], portrait, config());
    const at = (id: number) => plan.placements.find((p) => p.surfaceId === id)!;
    expect(at(2).rect.y).toBeLessThan(at(1).rect.y);
  });
});
