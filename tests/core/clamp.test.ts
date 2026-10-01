// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { shouldClampWindow } from '../../src/core/clamp.js';
import type { ClampCandidate } from '../../src/core/clamp.js';

function candidate(overrides: Partial<ClampCandidate> = {}): ClampCandidate {
  return {
    ready: true,
    routePending: false,
    fullscreen: false,
    minimized: false,
    stubborn: false,
    frame: { x: -200, y: -150, width: 400, height: 300 },
    ...overrides,
  };
}

describe('shouldClampWindow', () => {
  it('clamps an adopted float that hangs off the screen', () => {
    expect(shouldClampWindow(candidate())).toBe(true);
  });

  it('never clamps a window that is not adopted yet', () => {
    // A Wayland newcomer registers with a 0x0 frame and only becomes `ready`
    // once its first frame commits; clamping it writes a zero-sized rect at the
    // work-area origin and races the tile that is routing it.
    expect(shouldClampWindow(candidate({ ready: false, frame: { x: 0, y: 0, width: 0, height: 0 } }))).toBe(false);
  });

  it('never clamps a newcomer whose placement is still pending', () => {
    expect(shouldClampWindow(candidate({ routePending: true }))).toBe(false);
  });

  it('never clamps a degenerate (not yet committed) frame', () => {
    expect(shouldClampWindow(candidate({ frame: { x: 0, y: 0, width: 0, height: 0 } }))).toBe(false);
    expect(shouldClampWindow(candidate({ frame: { x: 100, y: 100, width: 0, height: 300 } }))).toBe(false);
    expect(shouldClampWindow(candidate({ frame: { x: 100, y: 100, width: 400, height: 0 } }))).toBe(false);
  });

  it('leaves fullscreen, minimized and stubborn windows alone', () => {
    expect(shouldClampWindow(candidate({ fullscreen: true }))).toBe(false);
    expect(shouldClampWindow(candidate({ minimized: true }))).toBe(false);
    expect(shouldClampWindow(candidate({ stubborn: true }))).toBe(false);
  });
});
