// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { dragIsWindowMove } from '../../src/core/windowmove.js';

describe('dragIsWindowMove (§6/§11)', () => {
  it('a grab on a placed, routed window is a window move', () => {
    expect(dragIsWindowMove({ ready: true, routePending: false })).toBe(true);
  });

  it('a grab on a window adrt has not adopted yet is a tab tear-off', () => {
    // The live Chrome tear-off: `grab-op-begin` on the window the app created
    // during the gesture, before its first frame. It has no slot to swap out
    // of, so its drop must not be interpreted as a window move.
    expect(dragIsWindowMove({ ready: false, routePending: false })).toBe(false);
  });

  it('a grab on a ready window whose routing is still pending is a tear-off', () => {
    expect(dragIsWindowMove({ ready: true, routePending: true })).toBe(false);
  });

  it('a grab before adoption and before routing is a tear-off', () => {
    expect(dragIsWindowMove({ ready: false, routePending: true })).toBe(false);
  });
});
