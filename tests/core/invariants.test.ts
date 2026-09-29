// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { checkPlan, planIsValid } from '../../src/core/invariants.js';
import { Layer } from '../../src/core/types.js';
import { rect, size } from './helpers.js';

describe('checkPlan', () => {
  it('accepts a clean two-window plan', () => {
    const plan = {
      placements: [
        { surfaceId: 1, rect: rect(0, 0, 960, 1080), layer: Layer.TILED, order: 0 },
        { surfaceId: 2, rect: rect(960, 0, 960, 1080), layer: Layer.TILED, order: 1 },
      ],
    };
    expect(checkPlan(plan, size(1920, 1080))).toEqual([]);
  });

  it('detects overlap', () => {
    const plan = {
      placements: [
        { surfaceId: 1, rect: rect(0, 0, 1000, 500), layer: Layer.TILED, order: 0 },
        { surfaceId: 2, rect: rect(500, 0, 1000, 500), layer: Layer.TILED, order: 1 },
      ],
    };
    expect(checkPlan(plan, size(1920, 1080)).some((v) => v.kind === 'overlap')).toBe(true);
  });

  it('detects out-of-bounds and non-positive rects', () => {
    const plan = {
      placements: [{ surfaceId: 1, rect: rect(-10, 0, 0, 100), layer: Layer.TILED, order: 0 }],
    };
    const kinds = checkPlan(plan, size(1920, 1080)).map((v) => v.kind);
    expect(kinds).toContain('out-of-bounds');
    expect(kinds).toContain('non-positive');
  });

  it('detects duplicates and below-min sizes', () => {
    const plan = {
      placements: [
        { surfaceId: 1, rect: rect(0, 0, 100, 100), layer: Layer.TILED, order: 0 },
        { surfaceId: 1, rect: rect(0, 0, 100, 100), layer: Layer.TILED, order: 0 },
      ],
    };
    const mins = new Map([[1, size(200, 200)]]);
    const violations = checkPlan(plan, size(1920, 1080), mins);
    expect(violations.some((v) => v.kind === 'duplicate')).toBe(true);
    expect(violations.some((v) => v.kind === 'below-min')).toBe(true);
  });

  it('honours a non-zero bounds origin (work area offset)', () => {
    const plan = { placements: [{ surfaceId: 1, rect: rect(8, 40, 1264, 752), layer: Layer.TILED, order: 0 }] };
    expect(checkPlan(plan, { x: 0, y: 32, width: 1280, height: 768 })).toEqual([]);
    const bad = { placements: [{ surfaceId: 1, rect: rect(8, 8, 1264, 752), layer: Layer.TILED, order: 0 }] };
    expect(checkPlan(bad, { x: 0, y: 32, width: 1280, height: 768 }).some((v) => v.kind === 'out-of-bounds')).toBe(true);
  });

  it('planIsValid mirrors checkPlan', () => {
    const plan = { placements: [{ surfaceId: 1, rect: rect(0, 0, 100, 100), layer: Layer.TILED, order: 0 }] };
    expect(planIsValid(plan, size(1920, 1080))).toBe(true);
  });
});
