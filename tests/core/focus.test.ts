// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import type { FocusCandidate } from '../../src/core/focus.js';
import { cycleOrder, cycleSequence, pickDirectional } from '../../src/core/focus.js';
import { rect } from './helpers.js';

// A 1920x1080 screen split in two ways, plus a second 1920x1080 monitor.
const left = rect(0, 0, 960, 1080);
const right = rect(960, 0, 960, 1080);
const top = rect(0, 0, 1920, 540);
const bottom = rect(0, 540, 1920, 540);
const otherMonitor = rect(1920, 0, 960, 1080);

const ids: Record<string, FocusCandidate> = {
  left: { id: 1, rect: left },
  right: { id: 2, rect: right },
  top: { id: 3, rect: top },
  bottom: { id: 4, rect: bottom },
  far: { id: 5, rect: otherMonitor },
};

describe('pickDirectional', () => {
  it('follows a side-by-side pair', () => {
    const candidates = [ids.right, ids.far];
    expect(pickDirectional(left, candidates, 'right')).toBe(2);
    expect(pickDirectional(right, [ids.left, ids.far], 'left')).toBe(1);
    // Nothing above or below a side-by-side pair.
    expect(pickDirectional(left, [ids.right], 'up')).toBeNull();
    expect(pickDirectional(left, [ids.right], 'down')).toBeNull();
  });

  it('follows a stacked pair', () => {
    expect(pickDirectional(top, [ids.bottom], 'down')).toBe(4);
    expect(pickDirectional(bottom, [ids.top], 'up')).toBe(3);
    expect(pickDirectional(top, [ids.bottom], 'left')).toBeNull();
  });

  it('reaches a window on another monitor', () => {
    expect(pickDirectional(right, [ids.far], 'right')).toBe(5);
    expect(pickDirectional(ids.far.rect, [ids.right], 'left')).toBe(2);
  });

  it('prefers the candidate that overlaps on the perpendicular axis', () => {
    const current = rect(0, 0, 960, 540);
    const aligned = { id: 10, rect: rect(960, 0, 960, 540) };
    const offset = { id: 11, rect: rect(960, 900, 960, 180) };
    // Both are to the right; only `aligned` shares the vertical span.
    expect(pickDirectional(current, [offset, aligned], 'right')).toBe(10);
  });

  it('falls back to a diagonal candidate when nothing overlaps', () => {
    const diagonal = { id: 12, rect: rect(1200, 1200, 400, 300) };
    expect(pickDirectional(left, [diagonal], 'right')).toBe(12);
  });

  it('ignores candidates behind the current window', () => {
    expect(pickDirectional(right, [ids.left], 'right')).toBeNull();
  });
});

describe('cycleOrder — the focus cycle (§6/§17)', () => {
  const managed = (id: number, slot: 0 | 1) => ({ id, kind: 'managed' as const, slot });
  const float = (id: number, x: number, y: number, z = 0) => ({
    id,
    kind: 'float' as const,
    rect: rect(x, y, 200, 150),
    z,
  });

  it('walks managed windows in slot order, then floats left to right', () => {
    const entries = [managed(5, 1), float(9, 100, 0), managed(4, 0), float(8, 10, 0)];
    expect(cycleOrder(null, entries)).toBe(4);
    expect(cycleOrder(4, entries)).toBe(5);
    expect(cycleOrder(5, entries)).toBe(8);
    expect(cycleOrder(8, entries)).toBe(9);
  });

  it('wraps around and skips minimized windows', () => {
    const entries = [managed(1, 0), { ...managed(2, 1), minimized: true }, float(3, 0, 0)];
    expect(cycleOrder(1, entries)).toBe(3);
    expect(cycleOrder(3, entries)).toBe(1);
  });

  it('breaks a perfect overlap by stacking order when a lap starts', () => {
    const entries = [float(1, 0, 0, 5), float(2, 0, 0, 1)];
    expect(cycleSequence(entries)).toEqual([2, 1]);
    // Equal stacking positions fall back to the stable id.
    expect(cycleSequence([float(1, 0, 0, 3), float(2, 0, 0, 3)])).toEqual([1, 2]);
  });

  it('keeps a lap fixed when focusing a float raises it', () => {
    // The lap is built once from the live stacking order, then kept for the
    // whole lap, so focusing a float (which raises it) cannot skip the other.
    const start = [managed(4, 0), float(1, 0, 0, 5), float(2, 0, 0, 1)];
    const order = cycleSequence(start);
    expect(order).toEqual([4, 2, 1]);
    expect(cycleOrder(4, start, order)).toBe(2);
    const raised = [managed(4, 0), float(1, 0, 0, 5), float(2, 0, 0, 9)];
    expect(cycleOrder(2, raised, order)).toBe(1);
    expect(cycleOrder(1, raised, order)).toBe(4);
  });

  it('does not change the rest of the lap when focus raises a float', () => {
    const before = [float(1, 0, 0, 1), float(2, 0, 0, 5), float(3, 300, 0, 2)];
    const order = cycleSequence(before);
    expect(order).toEqual([1, 2, 3]);
    expect(cycleOrder(1, before, order)).toBe(2);
    // Focusing 1 raises it; a fresh build would now put 2 first and so skip it
    // from 1's step, but the lap snapshot still visits 2, then 3.
    const after = [float(1, 0, 0, 9), float(2, 0, 0, 5), float(3, 300, 0, 2)]; // 1 raised
    expect(cycleSequence(after)).toEqual([2, 1, 3]);
    expect(cycleOrder(1, after, order)).toBe(2);
    expect(cycleOrder(2, after, order)).toBe(3);
  });

  it('keeps managed windows first in slot order regardless of float stacking', () => {
    const entries = [float(1, 0, 0, 9), managed(2, 1), managed(3, 0)];
    expect(cycleOrder(null, entries)).toBe(3);
    expect(cycleOrder(3, entries)).toBe(2);
    expect(cycleOrder(2, entries)).toBe(1);
  });

  it('skips a minimized float', () => {
    const entries = [managed(1, 0), { ...float(2, 0, 0, 1), minimized: true }, float(3, 0, 0, 5)];
    expect(cycleOrder(1, entries)).toBe(3);
    expect(cycleOrder(3, entries)).toBe(1);
  });

  it('returns null when there is nothing to cycle', () => {
    expect(cycleOrder(null, [])).toBeNull();
    expect(cycleOrder(1, [{ ...managed(1, 0), minimized: true }])).toBeNull();
  });

  it('starts at the first entry when the current window is not in the cycle', () => {
    expect(cycleOrder(99, [managed(1, 0), managed(2, 1)])).toBe(1);
  });
});
