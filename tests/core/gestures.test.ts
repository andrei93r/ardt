// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import type { GestureAction, GestureActionType, GestureConfig, GestureKind } from '../../src/core/gestures.js';
import { feedGesture, gestureThreshold, initialGestureState } from '../../src/core/gestures.js';

function config(overrides: Partial<GestureConfig> = {}): GestureConfig {
  return {
    enabled: true,
    swipe3Horizontal: 'switch-workspace',
    swipe3Vertical: 'toggle-overview',
    swipe4Horizontal: 'switch-workspace',
    swipe4Vertical: 'none',
    pinchAction: 'show-desktop',
    sensitivity: 50,
    ...overrides,
  };
}

function event(kind: GestureKind, phase: 'begin' | 'update' | 'end' | 'cancel', deltaX = 0, deltaY = 0) {
  return { kind, phase, progress: 0, deltaX, deltaY, direction: null, touchPoints: 3, timestampUs: 1 };
}

/** Feed a whole swipe and return the resulting action. */
function swipe(kind: GestureKind, dx: number, dy: number, cfg: GestureConfig = config()): GestureAction | null {
  const state = initialGestureState();
  expect(feedGesture(state, event(kind, 'begin'), cfg)).toBeNull();
  expect(feedGesture(state, event(kind, 'update', dx, dy), cfg)).toBeNull();
  return feedGesture(state, event(kind, 'end'), cfg);
}

describe('feedGesture', () => {
  it('switches workspace left/right on a 3-finger horizontal swipe', () => {
    expect(swipe('swipe-3-horizontal', 300, 0)).toEqual({ type: 'switch-workspace', direction: 'right' });
    expect(swipe('swipe-3-horizontal', -300, 0)).toEqual({ type: 'switch-workspace', direction: 'left' });
  });

  it('toggles the overview on a 3-finger vertical swipe', () => {
    expect(swipe('swipe-3-vertical', 0, 300)).toEqual({ type: 'toggle-overview' });
  });

  it('returns none below the sensitivity threshold', () => {
    expect(swipe('swipe-3-horizontal', 10, 0)).toEqual({ type: 'none' });
  });

  it('resets state after completion', () => {
    const state = initialGestureState();
    const cfg = config();
    feedGesture(state, event('swipe-3-horizontal', 'begin'), cfg);
    feedGesture(state, event('swipe-3-horizontal', 'update', 300, 0), cfg);
    feedGesture(state, event('swipe-3-horizontal', 'end'), cfg);
    expect(state.activeKind).toBeNull();
    expect(state.accumulatedX).toBe(0);
    expect(state.phase).toBe('cancel');
  });

  it('hands out a frozen none-action no caller can corrupt for later calls', () => {
    const cancelled = feedGesture(initialGestureState(), event('swipe-3-horizontal', 'cancel'), config());
    expect(cancelled).toEqual({ type: 'none' });
    expect(Object.isFrozen(cancelled)).toBe(true);
    // A frozen ESM singleton rejects the write; the shared value the next call
    // reads is therefore untouched.
    expect(() => {
      (cancelled as { type: string }).type = 'custom';
    }).toThrow();
    const belowThreshold = swipe('swipe-3-horizontal', 5, 0);
    expect(belowThreshold).toEqual({ type: 'none' });
    expect(belowThreshold).toBe(cancelled);
  });

  it('returns none and resets on cancel', () => {
    const state = initialGestureState();
    const cfg = config();
    feedGesture(state, event('swipe-3-horizontal', 'begin'), cfg);
    feedGesture(state, event('swipe-3-horizontal', 'update', 250, 0), cfg);
    expect(feedGesture(state, event('swipe-3-horizontal', 'cancel'), cfg)).toEqual({ type: 'none' });
    expect(state.activeKind).toBeNull();
  });

  it('ignores a second overlapping gesture', () => {
    const state = initialGestureState();
    const cfg = config();
    feedGesture(state, event('swipe-3-horizontal', 'begin'), cfg);
    expect(feedGesture(state, event('swipe-3-vertical', 'begin'), cfg)).toBeNull();
    expect(state.activeKind).toBe('swipe-3-horizontal');
    // The overlapping vertical update/end is ignored too.
    expect(feedGesture(state, event('swipe-3-vertical', 'update', 0, 300), cfg)).toBeNull();
    expect(feedGesture(state, event('swipe-3-vertical', 'end'), cfg)).toBeNull();
    expect(feedGesture(state, event('swipe-3-horizontal', 'end', 300, 0), cfg)).toEqual({
      type: 'switch-workspace',
      direction: 'right',
    });
  });

  it('does nothing when disabled', () => {
    const state = initialGestureState();
    const cfg = config({ enabled: false });
    expect(feedGesture(state, event('swipe-3-horizontal', 'begin'), cfg)).toBeNull();
    expect(feedGesture(state, event('swipe-3-horizontal', 'update', 400, 0), cfg)).toBeNull();
    expect(feedGesture(state, event('swipe-3-horizontal', 'end', 400, 0), cfg)).toBeNull();
  });

  it('respects sensitivity', () => {
    expect(gestureThreshold(0)).toBe(200);
    expect(gestureThreshold(100)).toBe(40);
    expect(swipe('swipe-4-horizontal', 150, 0, config({ sensitivity: 0 }))).toEqual({ type: 'none' });
    expect(swipe('swipe-4-horizontal', 250, 0, config({ sensitivity: 100 }))).toEqual({
      type: 'switch-workspace',
      direction: 'right',
    });
  });

  it.each<[GestureKind, GestureActionType, string]>([
    ['swipe-3-horizontal', 'toggle-overview', 'toggle-overview'],
    ['swipe-3-vertical', 'show-desktop', 'show-desktop'],
    ['swipe-4-horizontal', 'swap-pair', 'swap-pair'],
    ['swipe-4-vertical', 'switch-workspace', 'switch-workspace'],
    ['pinch-in', 'show-desktop', 'show-desktop'],
    ['pinch-out', 'toggle-overview', 'toggle-overview'],
  ])('maps %s to the configured %s action', (kind, action, expectedType) => {
    const cfg =
      kind === 'swipe-3-horizontal'
        ? config({ swipe3Horizontal: action })
        : kind === 'swipe-3-vertical'
          ? config({ swipe3Vertical: action })
          : kind === 'swipe-4-horizontal'
            ? config({ swipe4Horizontal: action })
            : kind === 'swipe-4-vertical'
              ? config({ swipe4Vertical: action })
              : config({ pinchAction: action });
    const horizontal = kind.endsWith('horizontal');
    const vertical = kind.endsWith('vertical');
    const dx = kind.startsWith('pinch') ? (kind === 'pinch-out' ? 400 : -400) : horizontal ? -400 : 0;
    const dy = vertical ? 400 : 0;
    const result = swipe(kind, dx, dy, cfg);
    expect(result?.type).toBe(expectedType);
  });

  it('supports custom actions', () => {
    expect(swipe('swipe-3-horizontal', 300, 0, config({ swipe3Horizontal: 'custom:do-a-thing' }))).toEqual({
      type: 'custom',
      action: 'do-a-thing',
    });
  });

  it('handles an end without an active gesture', () => {
    expect(feedGesture(initialGestureState(), event('swipe-3-horizontal', 'end', 400, 0), config())).toBeNull();
  });
});
