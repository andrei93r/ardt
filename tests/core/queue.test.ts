// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { EventQueue } from '../../src/core/queue.js';

describe('EventQueue', () => {
  it('hands a pushed event back on the next drain', () => {
    const q = new EventQueue();
    q.push(2, 'win-1', 'retile', { reason: 'test' });
    const drained = q.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({ lane: 2, key: 'win-1', kind: 'retile' });
    expect(drained[0].data).toEqual({ reason: 'test' });
  });

  it('coalesces the same key into one entry, keeping the earliest position', () => {
    const q = new EventQueue();
    q.push(2, 'a', 'first', { n: 1 });
    q.push(2, 'b', 'other', { n: 2 });
    q.push(2, 'a', 'second', { n: 3 });
    const drained = q.drain();
    expect(drained.map((e) => e.key)).toEqual(['a', 'b']);
    expect(drained[0].kind).toBe('second');
    expect(drained[0].data).toEqual({ n: 3 });
  });

  it('keeps different keys apart', () => {
    const q = new EventQueue();
    q.push(2, 'a', 'x');
    q.push(2, 'b', 'y');
    q.push(2, 'c', 'z');
    expect(q.pending).toBe(3);
    expect(q.drain().map((e) => e.key)).toEqual(['a', 'b', 'c']);
  });

  it('drains lane 1 before lane 2 before lane 3', () => {
    const q = new EventQueue();
    q.push(3, 'c', 'maintenance');
    q.push(1, 'a', 'feedback');
    q.push(2, 'b', 'layout');
    expect(q.drain().map((e) => e.lane)).toEqual([1, 2, 3]);
  });

  it('keeps insertion order inside one lane', () => {
    const q = new EventQueue();
    q.push(2, 'z', 'first');
    q.push(2, 'y', 'second');
    q.push(2, 'x', 'third');
    expect(q.drain().map((e) => e.key)).toEqual(['z', 'y', 'x']);
  });

  it('treats the same key in two lanes as two events', () => {
    const q = new EventQueue();
    q.push(1, 'same', 'feedback');
    q.push(2, 'same', 'layout');
    const drained = q.drain();
    expect(drained).toHaveLength(2);
    expect(drained.map((e) => e.lane)).toEqual([1, 2]);
  });

  it('empties on drain, and draining again gives nothing', () => {
    const q = new EventQueue();
    q.push(2, 'a', 'x');
    expect(q.drain()).toHaveLength(1);
    expect(q.drain()).toEqual([]);
    expect(q.pending).toBe(0);
  });

  it('reports whether a push needs the drain to be armed', () => {
    const q = new EventQueue();
    expect(q.push(2, 'a', 'x')).toBe(true); // was empty: arm the later
    expect(q.push(2, 'b', 'y')).toBe(false); // already armed
    q.drain();
    expect(q.push(2, 'c', 'z')).toBe(true);
  });

  it('counts per lane and picks the highest non-empty lane', () => {
    const q = new EventQueue();
    q.push(1, 'a', 'x');
    q.push(1, 'b', 'y');
    q.push(3, 'c', 'z');
    expect(q.depth(1)).toBe(2);
    expect(q.depth(2)).toBe(0);
    expect(q.depth(3)).toBe(1);
    expect(q.highestLane()).toBe(1);
    q.drain();
    expect(q.highestLane()).toBe(null);
  });

  it('answers whether a key is already queued', () => {
    const q = new EventQueue();
    q.push(2, 'a', 'x');
    expect(q.has('a')).toBe(true);
    expect(q.has('aims')).toBe(false);
  });

  it('stamps each event from the injected clock', () => {
    let now = 1000;
    const q = new EventQueue(() => now);
    q.push(2, 'a', 'x');
    now = 1500;
    q.push(2, 'b', 'y');
    const drained = q.drain();
    expect(drained[0].at).toBe(1000);
    expect(drained[1].at).toBe(1500);
    expect(q.drainAge(2000, drained)).toBeGreaterThan(0);
  });

  it('clears everything without draining', () => {
    const q = new EventQueue();
    q.push(1, 'a', 'x');
    q.push(2, 'b', 'y');
    q.clear();
    expect(q.pending).toBe(0);
    expect(q.drain()).toEqual([]);
  });

  it('drains a burst of many keys exactly once each', () => {
    const q = new EventQueue();
    for (let i = 0; i < 500; i += 1) q.push(2, `w${i}`, 'retile', { i });
    for (let i = 0; i < 500; i += 1) q.push(2, `w${i}`, 'retile', { i: i + 1000 });
    const drained = q.drain();
    expect(drained).toHaveLength(500);
    expect(drained[0].data).toEqual({ i: 1000 });
    expect(q.pending).toBe(0);
  });
});
