// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { classifyAdjust } from '../../src/core/adjust.js';
import { rect } from './helpers.js';

describe('classifyAdjust', () => {
  const start = rect(8, 40, 628, 752);

  it('reads a horizontal inner-edge drag as a resize', () => {
    // Right (inner) edge moved, everything else stayed.
    expect(classifyAdjust(start, rect(8, 40, 700, 752))).toBe('resize');
    // Left edge moved with the width; the right edge stayed put.
    expect(classifyAdjust(rect(100, 40, 500, 752), rect(8, 40, 592, 752))).toBe('resize');
  });

  it('reads a vertical inner-edge drag as a resize', () => {
    expect(classifyAdjust(rect(8, 40, 628, 752), rect(8, 40, 628, 900))).toBe('resize');
  });

  it('reads a pure translation as a move', () => {
    expect(classifyAdjust(start, rect(300, 200, 628, 752))).toBe('move');
  });

  it('reads an overview drop that scales the window as a move', () => {
    // Both axes changed size: the compositor scaled the window to its target.
    // Saving that as a split ratio would skew the pair permanently.
    expect(classifyAdjust(start, rect(100, 100, 400, 480))).toBe('move');
  });

  it('reads a compositor-clamped move as a move', () => {
    // The move hit the screen edge: the position was constrained, the size kept.
    expect(classifyAdjust(start, rect(-40, 40, 628, 752))).toBe('move');
  });

  it('reads a no-op as a move', () => {
    expect(classifyAdjust(start, rect(8, 40, 628, 752))).toBe('move');
    // Sub-tolerance drift stays a no-op.
    expect(classifyAdjust(start, rect(10, 42, 630, 754))).toBe('move');
  });
});
