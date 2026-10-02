// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { checkPlan } from '../../src/core/invariants.js';
import type { TilerConfig } from '../../src/core/tiler.js';
import { computePlans, layoutAll, pairKey, parseRatioKey, ratioKey, remapRatiosAfterReap, resolveGaps, sanitizeRatios } from '../../src/core/tiler.js';
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
    // §10: the outer 8 px must be asked for explicitly now; gapBase alone is the
    // between-window gap. The point here is that the work area is respected.
    const plan = computePlans(
      [window({ id: 1 }), window({ id: 2, appId: 'b' })],
      withPanel,
      config({ gapBase: 8, gapLeft: 8, gapRight: 8, gapTop: 8, gapBottom: 8 }),
    );
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
  it('fills the whole monitor by default: outer gaps are 0 (§10)', () => {
    const plan = computePlans([window({ id: 1 })], landscape, config({ gapBase: 10 }));
    expect(plan.placements).toHaveLength(1);
    expect(plan.placements[0].rect).toEqual(rect(0, 0, 1920, 1080));
  });

  it('applies explicit per-side outer gaps', () => {
    const plan = computePlans(
      [window({ id: 1 })],
      landscape,
      config({ gapBase: 0, gapLeft: 20, gapRight: 5, gapTop: 10, gapBottom: 3 }),
    );
    expect(plan.placements[0].rect).toEqual(rect(20, 10, 1895, 1067));
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
  it('splits side by side, flush at the edges and gapped at the split', () => {
    const plan = computePlans([window({ id: 1 }), window({ id: 2, appId: 'b' })], landscape, config({ gapBase: 10 }));
    expect(checkPlan(plan, size(1920, 1080))).toEqual([]);
    const [left, right] = plan.placements;
    // §10: gapBase is the between-window gap; the outer edges are flush (0).
    expect(left.rect.x).toBe(0);
    expect(left.rect.y).toBe(0);
    expect(left.rect.height).toBe(1080);
    expect(right.rect.x).toBe(left.rect.x + left.rect.width + 10);
    expect(left.rect.width + right.rect.width).toBe(1920 - 10);
  });

  it('gives the primary app its configured ratio', () => {
    const plan = computePlans(
      [window({ id: 1, appId: 'term' }), window({ id: 2, appId: 'browser' })],
      landscape,
      config({ primaryApps: ['term'], primaryAppRatio: 0.7 }),
    );
    expect(plan.placements[0].rect.width).toBeCloseTo(1920 * 0.7, 1);
  });

  it('uses a saved ratio keyed by the workspace pair and axis', () => {
    const key = ratioKey(0, 0, 'horizontal');
    const plan = computePlans([window({ id: 1, appId: 'term' }), window({ id: 2, appId: 'browser' })], landscape, config({ ratios: { [key]: 0.25 } }));
    // The saved fraction belongs to the sorted-first app ("browser", surface 2).
    expect(plan.placements[1].rect.width).toBeCloseTo(1920 * 0.25, 1);
    expect(plan.placements[0].rect.width).toBeCloseTo(1920 * 0.75, 1);
  });

  it('rounds a fractional saved ratio to whole pixels at an integer scale', () => {
    // A drag saves the pointer fraction (the live Chrome ratio was 0.2421875),
    // so `split * ratio` is fractional, e.g. 1912 * 0.7578125 = 1448.9375. The
    // plan must reach Mutter as whole logical pixels, or Mutter truncates each
    // argument on its own and the pair can read a sub-pixel seam.
    const key = ratioKey(0, 0, 'horizontal');
    const plan = computePlans(
      [window({ id: 1, appId: 'term' }), window({ id: 2, appId: 'browser' })],
      landscape,
      config({ gapBase: 8, ratios: { [key]: 0.2421875 } }),
    );
    const a = plan.placements[0].rect;
    const b = plan.placements[1].rect;
    for (const value of [a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height]) {
      expect(Number.isInteger(value)).toBe(true);
    }
    // The pair meets at the rounded boundary plus the gap and ends flush.
    expect(b.x).toBe(a.x + a.width + 8);
    expect(b.x + b.width).toBe(landscape.geometry.width);
  });

  it('honours the pair-swap flag', () => {
    const swapped = new Set([pairKey(1, 2)]);
    const plan = computePlans([window({ id: 1 }), window({ id: 2, appId: 'b' })], landscape, config({ swapPairs: swapped }));
    const normal = computePlans([window({ id: 1 }), window({ id: 2, appId: 'b' })], landscape, config());
    const rectFor = (p: typeof plan, id: number) => p.placements.find((x) => x.surfaceId === id)!.rect;
    // Swapping exchanges the two windows' sides.
    expect(rectFor(plan, 1)).toEqual(rectFor(normal, 2));
    expect(rectFor(plan, 2)).toEqual(rectFor(normal, 1));
  });
});

describe('computePlans — ratio scope (§10, decision 14)', () => {
  it('keys a ratio by the screen, workspace and axis', () => {
    expect(ratioKey(0, 0, 'horizontal')).toBe('0:0:horizontal');
    expect(ratioKey(1, 0, 'horizontal')).not.toBe(ratioKey(0, 0, 'horizontal'));
    expect(ratioKey(0, 1, 'horizontal')).not.toBe(ratioKey(0, 0, 'horizontal'));
    expect(ratioKey(0, 0, 'vertical')).not.toBe(ratioKey(0, 0, 'horizontal'));
  });

  it('applies a ratio only to the pair it was set in', () => {
    // The window the user set the ratio on was on screen 0, workspace 0.
    const key = ratioKey(0, 0, 'horizontal');
    const saved = config({ ratios: { [key]: 0.25 } });
    const apps = [window({ id: 1, appId: 'chrome' }), window({ id: 2, appId: 'chrome' })];
    const widths = (c: TilerConfig, overrides: Partial<ReturnType<typeof window>> = {}) => {
      const plan = computePlans(apps.map((w) => ({ ...w, ...overrides })), landscape, c);
      return [plan.placements[0].rect.width, plan.placements[1].rect.width];
    };
    // Same pair: the saved 25/75 applies.
    expect(widths(saved)[0]).toBeCloseTo(1920 * 0.25, 1);
    // A different workspace, a different screen, or the other axis: 50/50.
    for (const overrides of [{ workspaceId: 1 }, { screenId: 1 }]) {
      const [left, right] = widths(saved, overrides);
      expect(left).toBeCloseTo(1920 * 0.5, 1);
      expect(right).toBeCloseTo(1920 * 0.5, 1);
    }
  });

  it('parses a workspace key and rejects a legacy app-pair key', () => {
    expect(parseRatioKey('2:3:vertical')).toEqual({ screenId: 2, workspaceId: 3, axis: 'vertical' });
    expect(parseRatioKey('google-chrome|google-chrome|horizontal')).toBeNull();
  });

  it('drops legacy app-pair keys from persisted state (§23 migration)', () => {
    const ratios = {
      'google-chrome|google-chrome|horizontal': 0.2390625,
      [ratioKey(1, 0, 'horizontal')]: 0.3,
    };
    expect(sanitizeRatios(ratios)).toEqual({ [ratioKey(1, 0, 'horizontal')]: 0.3 });
  });

  it('drops a reaped workspace ratio and shifts the ones to its right (§10)', () => {
    const ratios = {
      [ratioKey(0, 0, 'horizontal')]: 0.2,
      [ratioKey(0, 1, 'horizontal')]: 0.3,
      [ratioKey(0, 2, 'horizontal')]: 0.4,
      [ratioKey(1, 2, 'horizontal')]: 0.6,
    };
    // Workspace 1 is reaped: its ratio goes, workspace 2 becomes 1.
    expect(remapRatiosAfterReap(ratios, [1])).toEqual({
      [ratioKey(0, 0, 'horizontal')]: 0.2,
      [ratioKey(0, 1, 'horizontal')]: 0.4,
      [ratioKey(1, 1, 'horizontal')]: 0.6,
    });
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

describe('gaps — outer sides and the split (§10)', () => {
  it('defaults to flush outer edges and a base-sized split', () => {
    const plan = computePlans([window({ id: 1 }), window({ id: 2, appId: 'b' })], landscape, config({ gapBase: 8 }));
    const [left, right] = plan.placements;
    expect(left.rect.x).toBe(0);
    expect(left.rect.y).toBe(0);
    expect(left.rect.height).toBe(1080);
    expect(right.rect.x - (left.rect.x + left.rect.width)).toBe(8);
    expect(left.rect.width + right.rect.width).toBe(1920 - 8);
  });

  it('applies per-side outer gaps and the between-window gap together', () => {
    const plan = computePlans(
      [window({ id: 1 }), window({ id: 2, appId: 'b' })],
      landscape,
      config({ gapBase: 0, gapLeft: 20, gapRight: 5, gapTop: 10, gapBottom: 3, gapBetween: 7 }),
    );
    expect(checkPlan(plan, size(1920, 1080))).toEqual([]);
    const [left, right] = plan.placements;
    expect(left.rect).toEqual(rect(20, 10, 944, 1067));
    expect(right.rect).toEqual(rect(971, 10, 944, 1067));
  });

  it('inherits the base for negative per-side gaps but keeps an explicit 0 flush', () => {
    const plan = computePlans(
      [window({ id: 1 })],
      portrait,
      config({ gapBase: 12, gapPortrait: -1, gapLeft: -1, gapRight: 0, gapTop: -1, gapBottom: 0 }),
    );
    expect(plan.placements[0].rect).toEqual(rect(12, 12, 1068, 1908));
  });

  it('zero gaps are exactly zero', () => {
    const plan = computePlans(
      [window({ id: 1 }), window({ id: 2, appId: 'b' })],
      landscape,
      config({ gapBase: 8, gapLeft: 0, gapRight: 0, gapTop: 0, gapBottom: 0, gapBetween: 0 }),
    );
    const [left, right] = plan.placements;
    expect(left.rect).toEqual(rect(0, 0, 960, 1080));
    expect(right.rect).toEqual(rect(960, 0, 960, 1080));
    expect(left.rect.x + left.rect.width).toBe(right.rect.x);
  });

  it('resolves the orientation override into the base that negatives inherit', () => {
    const plan = computePlans(
      [window({ id: 1 })],
      landscape,
      config({
        gapBase: 10,
        gapLandscape: 30,
        gapLeft: -1,
        gapRight: -1,
        gapTop: -1,
        gapBottom: -1,
      }),
    );
    expect(plan.placements[0].rect).toEqual(rect(30, 30, 1860, 1020));
  });

  it('defaults the split to the orientation-resolved base', () => {
    const plan = computePlans(
      [window({ id: 1 }), window({ id: 2, appId: 'b' })],
      portrait,
      config({ gapBase: 8, gapPortrait: 14 }),
    );
    const [top, bottom] = plan.placements;
    expect(top.rect.y).toBe(0);
    expect(bottom.rect.y - (top.rect.y + top.rect.height)).toBe(14);
    expect(top.rect.height + bottom.rect.height).toBe(1920 - 14);
  });

  it('changing gaps-between moves only the split, not the outer edges', () => {
    const base = computePlans([window({ id: 1 }), window({ id: 2, appId: 'b' })], landscape, config({ gapBase: 8 }));
    const wider = computePlans(
      [window({ id: 1 }), window({ id: 2, appId: 'b' })],
      landscape,
      config({ gapBase: 8, gapBetween: 30 }),
    );
    const [b0] = base.placements;
    const [w0, w1] = wider.placements;
    expect(w0.rect.x).toBe(b0.rect.x);
    expect(w0.rect.y).toBe(b0.rect.y);
    expect(w0.rect.height).toBe(b0.rect.height);
    expect(w1.rect.x - (w0.rect.x + w0.rect.width)).toBe(30);
    expect(w0.rect.width + w1.rect.width).toBe(1920 - 30);
  });

  it('applies gaps per screen (the monitor being planned)', () => {
    const plans = layoutAll({
      windows: [
        window({ id: 1, workspaceId: 0, screenId: 0 }),
        window({ id: 2, appId: 'b', workspaceId: 0, screenId: 1 }),
      ],
      screens: [landscape, { ...portrait, index: 1 }],
      config: config({
        gapBase: 10,
        gapLandscape: 20,
        gapPortrait: 40,
        gapLeft: -1,
        gapRight: -1,
        gapTop: -1,
        gapBottom: -1,
      }),
    });
    const on = (screenId: number) => plans.find((p) => p.screenId === screenId)!.plan.placements[0].rect;
    expect(on(0)).toEqual(rect(20, 20, 1880, 1040));
    expect(on(1)).toEqual(rect(40, 40, 1000, 1840));
  });
});

describe('resolveGaps', () => {
  it('treats an unset outer side as 0, a negative one as the base, and unset between as the base', () => {
    expect(resolveGaps(config({ gapBase: 8 }), landscape)).toEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      between: 8,
    });
    expect(resolveGaps(config({ gapBase: 8, gapLeft: -1, gapBetween: -1 }), landscape)).toEqual({
      left: 8,
      right: 0,
      top: 0,
      bottom: 0,
      between: 8,
    });
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

describe('computePlans — vertical workspaces', () => {
  it('stacks a pair top/bottom on a landscape monitor when the workspace layout is vertical', () => {
    const plan = computePlans(
      [window({ id: 1 }), window({ id: 2, appId: 'b' })],
      landscape,
      config({ workspaceAxis: 'vertical' }),
    );
    const rectFor = (id: number) => plan.placements.find((p) => p.surfaceId === id)!.rect;
    const top = rectFor(1);
    const bottom = rectFor(2);
    expect(top.y).toBeLessThan(bottom.y);
    expect(top.width).toBe(1920);
    expect(top.height).toBe(bottom.height);
  });

  it('keeps a horizontal pair when the workspace layout is horizontal', () => {
    const plan = computePlans(
      [window({ id: 1 }), window({ id: 2, appId: 'b' })],
      landscape,
      config({ workspaceAxis: 'horizontal' }),
    );
    const rectFor = (id: number) => plan.placements.find((p) => p.surfaceId === id)!.rect;
    expect(rectFor(1).x).toBeLessThan(rectFor(2).x);
  });

  it('honours an explicit slot over the geometric guess (§3/§4)', () => {
    // Both windows report a left-side rect; the explicit slots decide the side.
    const left = rect(0, 0, 800, 600);
    const plan = computePlans(
      [window({ id: 1, rect: left, slot: 1 }), window({ id: 2, appId: 'b', rect: left, slot: 0 })],
      landscape,
      config(),
    );
    const rectFor = (id: number) => plan.placements.find((p) => p.surfaceId === id)!.rect;
    expect(rectFor(2).x).toBeLessThan(rectFor(1).x);
  });
});
