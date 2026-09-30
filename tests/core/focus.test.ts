// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import type { FocusCandidate } from '../../src/core/focus.js';
import { pickDirectional } from '../../src/core/focus.js';
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
