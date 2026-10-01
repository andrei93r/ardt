// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { RetileScheduler, SignatureCache, planSignature, shouldApplyPlan } from '../../src/core/scheduler.js';

describe('RetileScheduler', () => {
  it('coalesces duplicate schedules', () => {
    const scheduler = new RetileScheduler();
    expect(scheduler.schedule('ws:0')).toBe(true);
    expect(scheduler.schedule('ws:0')).toBe(false);
    expect(scheduler.size).toBe(1);
  });

  it('drains pending keys in one take', () => {
    const scheduler = new RetileScheduler();
    scheduler.schedule('a');
    scheduler.schedule('b');
    expect(scheduler.take().sort()).toEqual(['a', 'b']);
    expect(scheduler.size).toBe(0);
  });

  it('clears a single key', () => {
    const scheduler = new RetileScheduler();
    scheduler.schedule('a');
    scheduler.clear('a');
    expect(scheduler.has('a')).toBe(false);
  });
});

describe('SignatureCache', () => {
  it('reports a change only when the signature differs', () => {
    const cache = new SignatureCache();
    expect(cache.changed('ws:0', 'sig-1')).toBe(true);
    expect(cache.changed('ws:0', 'sig-1')).toBe(false);
    expect(cache.changed('ws:0', 'sig-2')).toBe(true);
  });

  it('clears per key and globally', () => {
    const cache = new SignatureCache();
    cache.changed('a', '1');
    cache.changed('b', '2');
    cache.clear('a');
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.size).toBe(1);
    cache.clearAll();
    expect(cache.size).toBe(0);
  });
});

describe('planSignature', () => {
  it('is stable for equal geometry and changes when moved', () => {
    const a = planSignature([{ surfaceId: 1, rect: { x: 0, y: 0, width: 10, height: 10 } }]);
    const b = planSignature([{ surfaceId: 1, rect: { x: 0, y: 0, width: 10, height: 10 } }]);
    const c = planSignature([{ surfaceId: 1, rect: { x: 1, y: 0, width: 10, height: 10 } }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('shouldApplyPlan', () => {
  it('does nothing when the plan is unchanged and the windows are in place', () => {
    expect(shouldApplyPlan({ mismatch: false, changed: false, alreadyTargeted: true })).toBe(false);
    expect(shouldApplyPlan({ mismatch: false, changed: false, alreadyTargeted: false })).toBe(false);
  });

  it('does not re-apply a plan the windows already aim at', () => {
    // A signal cleared the cache mid-transition: `changed` is true for the plan
    // already applied, and Mutter has not handed the window back yet. Applying
    // it again would restart the animation (the overshoot-then-correct bug).
    expect(shouldApplyPlan({ mismatch: false, changed: true, alreadyTargeted: true })).toBe(false);
  });

  it('applies a genuinely changed plan', () => {
    expect(shouldApplyPlan({ mismatch: false, changed: true, alreadyTargeted: false })).toBe(true);
  });

  it('applies on a real drift even when the plan is unchanged', () => {
    expect(shouldApplyPlan({ mismatch: true, changed: false, alreadyTargeted: true })).toBe(true);
    expect(shouldApplyPlan({ mismatch: true, changed: true, alreadyTargeted: true })).toBe(true);
  });
});
