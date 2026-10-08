// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { RingBuffer } from '../../src/core/ringbuffer.js';

describe('RingBuffer', () => {
  it('starts empty', () => {
    const ring = new RingBuffer<number>(3);
    expect(ring.length).toBe(0);
    expect(ring.tail(5)).toEqual([]);
    expect(ring.tailWhere(() => true, 5)).toEqual([]);
    expect(ring.tail(0)).toEqual([]);
  });

  it('keeps insertion order while below capacity', () => {
    const ring = new RingBuffer<number>(5);
    for (const n of [1, 2, 3]) ring.push(n);
    expect(ring.length).toBe(3);
    expect(ring.tail(10)).toEqual([1, 2, 3]);
  });

  it('overwrites the oldest item once full, preserving order', () => {
    const ring = new RingBuffer<number>(3);
    for (const n of [1, 2, 3, 4, 5]) ring.push(n);
    expect(ring.length).toBe(3);
    expect(ring.tail(10)).toEqual([3, 4, 5]);
  });

  it('returns the last N items, oldest first', () => {
    const ring = new RingBuffer<number>(5);
    for (const n of [1, 2, 3, 4, 5]) ring.push(n);
    expect(ring.tail(2)).toEqual([4, 5]);
    expect(ring.tail(1)).toEqual([5]);
    expect(ring.tail(99)).toEqual([1, 2, 3, 4, 5]);
  });

  it('wraps around many times without growing', () => {
    const ring = new RingBuffer<number>(4);
    for (let n = 0; n < 1000; n++) ring.push(n);
    expect(ring.length).toBe(4);
    expect(ring.tail(4)).toEqual([996, 997, 998, 999]);
  });

  it('filters and keeps the last N matches in order', () => {
    const ring = new RingBuffer<number>(5);
    for (const n of [1, 2, 3, 4, 5, 6]) ring.push(n);
    const even = (n: number): boolean => n % 2 === 0;
    expect(ring.tailWhere(even, 10)).toEqual([2, 4, 6]);
    expect(ring.tailWhere(even, 2)).toEqual([4, 6]);
    expect(ring.tailWhere(even, 0)).toEqual([]);
    expect(ring.tailWhere(() => false, 2)).toEqual([]);
  });

  it('clears every item', () => {
    const ring = new RingBuffer<string>(3);
    ring.push('a');
    ring.push('b');
    ring.clear();
    expect(ring.length).toBe(0);
    expect(ring.tail(10)).toEqual([]);
    ring.push('c');
    expect(ring.tail(10)).toEqual(['c']);
  });

  it('is inert at a zero or negative capacity', () => {
    for (const capacity of [0, -3]) {
      const ring = new RingBuffer<number>(capacity);
      ring.push(1);
      expect(ring.length).toBe(0);
      expect(ring.tail(10)).toEqual([]);
    }
  });
});
