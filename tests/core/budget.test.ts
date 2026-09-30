// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { RateBudget } from '../../src/core/budget.js';

describe('RateBudget', () => {
  it('allows up to the limit inside the window', () => {
    const budget = new RateBudget(3, 1000);
    expect(budget.take(0)).toBe(true);
    expect(budget.take(1)).toBe(true);
    expect(budget.take(2)).toBe(true);
    expect(budget.take(3)).toBe(false);
    expect(budget.used).toBe(3);
  });

  it('slides the window forward', () => {
    const budget = new RateBudget(2, 1000);
    expect(budget.take(0)).toBe(true);
    expect(budget.take(500)).toBe(true);
    expect(budget.take(900)).toBe(false);
    // 0 has aged out by 1001.
    expect(budget.take(1001)).toBe(true);
    expect(budget.take(1100)).toBe(false);
    // 500 ages out at 1501.
    expect(budget.take(1502)).toBe(true);
  });

  it('is exact at the window boundary', () => {
    const budget = new RateBudget(1, 100);
    expect(budget.take(0)).toBe(true);
    // Exactly 100 ms later is still inside the window.
    expect(budget.take(100)).toBe(false);
    expect(budget.take(101)).toBe(true);
  });

  it('never records a refused event', () => {
    const budget = new RateBudget(1, 1000);
    budget.take(0);
    for (let i = 0; i < 50; i++) budget.take(10 + i);
    expect(budget.used).toBe(1);
  });

  it('resets', () => {
    const budget = new RateBudget(1, 1000);
    expect(budget.take(0)).toBe(true);
    expect(budget.take(1)).toBe(false);
    budget.reset();
    expect(budget.take(2)).toBe(true);
  });
});
