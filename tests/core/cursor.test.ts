// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { centreInWorkArea, rectCentre } from '../../src/core/cursor.js';
import { rect } from './helpers.js';

// The 1920x1080 work area on the primary, and a second screen offset to its
// right, so the clamp is exercised with a non-zero origin too.
const workArea = rect(0, 0, 1920, 1080);
const secondWorkArea = rect(1920, 0, 1280, 800);

describe('rectCentre', () => {
  it('is the midpoint of an even-sized rect', () => {
    expect(rectCentre(rect(0, 0, 960, 1080))).toEqual({ x: 480, y: 540 });
  });

  it('rounds an odd-sized rect to the nearer pixel', () => {
    expect(rectCentre(rect(0, 0, 961, 541))).toEqual({ x: 481, y: 271 });
  });

  it('respects a non-zero origin', () => {
    expect(rectCentre(rect(1920, 0, 1280, 800))).toEqual({ x: 2560, y: 400 });
  });
});

describe('centreInWorkArea', () => {
  it('returns the centre of a window inside the work area', () => {
    expect(centreInWorkArea(rect(960, 0, 960, 1080), workArea)).toEqual({ x: 1440, y: 540 });
  });

  it('clamps the target inside the work area when the rect hangs off it', () => {
    // A window half off the right edge: the centre would be x=2400, outside.
    expect(centreInWorkArea(rect(1680, 900, 1440, 1080), workArea)).toEqual({ x: 1919, y: 1079 });
  });

  it('clamps to the area origin for a rect entirely before it', () => {
    expect(centreInWorkArea(rect(-500, -400, 200, 200), workArea)).toEqual({ x: 0, y: 0 });
  });

  it('clamps inside a work area with a non-zero origin', () => {
    // A window on the second screen whose centre falls past its bottom edge.
    expect(centreInWorkArea(rect(2880, 900, 400, 400), secondWorkArea)).toEqual({ x: 3080, y: 799 });
  });

  it('leaves a point in a non-positive area unclamped', () => {
    expect(centreInWorkArea(rect(10, 10, 100, 100), rect(0, 0, 0, 0))).toEqual({ x: 60, y: 60 });
  });
});
