// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { clampRectToArea } from '../../src/core/types.js';
import type { Rect } from '../../src/core/types.js';

const area: Rect = { x: 0, y: 0, width: 1280, height: 800 };

describe('clampRectToArea', () => {
  it('returns a fresh copy with unchanged coordinates when already inside', () => {
    const rect: Rect = { x: 100, y: 100, width: 200, height: 150 };
    const clamped = clampRectToArea(rect, area);
    expect(clamped).toEqual(rect);
    expect(clamped).not.toBe(rect);
  });

  it('returns a copy for a rect touching every edge (inside is inclusive)', () => {
    const rect: Rect = { x: 0, y: 0, width: 1280, height: 800 };
    const clamped = clampRectToArea(rect, area);
    expect(clamped).toEqual(rect);
    expect(clamped).not.toBe(rect);
  });

  it('does not alias the input, so mutating the result leaves the input intact', () => {
    const rect: Rect = { x: 100, y: 100, width: 200, height: 150 };
    clampRectToArea(rect, area).x = -999;
    expect(rect.x).toBe(100);
  });

  it('moves a window that hangs off the left edge back inside', () => {
    expect(clampRectToArea({ x: -200, y: 100, width: 400, height: 300 }, area)).toEqual({
      x: 0,
      y: 100,
      width: 400,
      height: 300,
    });
  });

  it('moves a window that hangs off the top edge back inside', () => {
    expect(clampRectToArea({ x: 100, y: -150, width: 400, height: 300 }, area)).toEqual({
      x: 100,
      y: 0,
      width: 400,
      height: 300,
    });
  });

  it('moves a window that hangs off the right edge back inside', () => {
    expect(clampRectToArea({ x: 1000, y: 100, width: 400, height: 300 }, area)).toEqual({
      x: 880,
      y: 100,
      width: 400,
      height: 300,
    });
  });

  it('moves a window that hangs off the bottom edge back inside', () => {
    expect(clampRectToArea({ x: 100, y: 600, width: 400, height: 300 }, area)).toEqual({
      x: 100,
      y: 500,
      width: 400,
      height: 300,
    });
  });

  it('shrinks a window larger than the area to the whole area', () => {
    expect(clampRectToArea({ x: -50, y: -50, width: 3000, height: 2000 }, area)).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
    });
  });

  it('shrinks only the axis that overflows', () => {
    expect(clampRectToArea({ x: 10, y: 10, width: 3000, height: 200 }, area)).toEqual({
      x: 0,
      y: 10,
      width: 1280,
      height: 200,
    });
  });

  it('collapses to an empty rect at the area origin for a zero-size area', () => {
    const empty: Rect = { x: 50, y: 60, width: 0, height: 0 };
    expect(clampRectToArea({ x: -100, y: -100, width: 400, height: 300 }, empty)).toEqual({
      x: 50,
      y: 60,
      width: 0,
      height: 0,
    });
  });

  it('never returns a negative width or height', () => {
    expect(clampRectToArea({ x: 10, y: 10, width: -40, height: -30 }, area)).toEqual({
      x: 10,
      y: 10,
      width: 0,
      height: 0,
    });
  });

  it('rounds an adjusted rect to integer coordinates', () => {
    expect(clampRectToArea({ x: -10.4, y: 20.6, width: 300.5, height: 200.5 }, area)).toEqual({
      x: 0,
      y: 21,
      width: 301,
      height: 201,
    });
  });

  it('accounts for a monitor that does not start at the origin', () => {
    const offset: Rect = { x: 1920, y: 0, width: 1280, height: 800 };
    expect(clampRectToArea({ x: 1800, y: 50, width: 400, height: 300 }, offset)).toEqual({
      x: 1920,
      y: 50,
      width: 400,
      height: 300,
    });
  });

  it('leaves a rect that pokes out by no more than the tolerance alone', () => {
    // The compositor reports a frame that includes the toplevel's invisible
    // border, so a window placed exactly in its slot reads back a couple of
    // pixels larger. Clamping that would resize the window on every pass.
    const work: Rect = { x: 0, y: 34, width: 1920, height: 1166 };
    const frame = { x: 962, y: 34, width: 960, height: 1167 };
    expect(clampRectToArea(frame, work)).not.toEqual(frame);
    expect(clampRectToArea(frame, work, 4)).toEqual(frame);
  });

  it('still clamps a rect that is really outside the area', () => {
    const work: Rect = { x: 0, y: 34, width: 1920, height: 1166 };
    const off = { x: 2000, y: 34, width: 400, height: 300 };
    expect(clampRectToArea(off, work, 4)).toEqual({ x: 1520, y: 34, width: 400, height: 300 });
  });
});
