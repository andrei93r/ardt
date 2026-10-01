// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand this code.

import { describe, expect, it } from 'vitest';

import { ChangeLog, validateChange } from '../../src/core/undo.js';
import type { Change, LiveInstance } from '../../src/core/undo.js';
import { rect } from './helpers.js';

function instance(id: number, over: Partial<Change['instances'][number]> = {}): Change['instances'][number] {
  return { id, workspace: 0, slot: null, rect: rect(0, 0, 100, 100), maximized: false, floating: false, ...over };
}

describe('ChangeLog — exactly one in-memory change (§13)', () => {
  it('holds one change and consuming it leaves nothing', () => {
    const log = new ChangeLog();
    expect(log.size).toBe(0);
    expect(log.set({ instances: [instance(1)] })).toBe(true);
    expect(log.size).toBe(1);
    expect(log.take()?.instances[0].id).toBe(1);
    expect(log.take()).toBeNull();
    expect(log.size).toBe(0);
  });

  it('overwrites the previous change: there is never a stack', () => {
    const log = new ChangeLog();
    log.set({ instances: [instance(1)] });
    log.set({ instances: [instance(2)] });
    expect(log.take()?.instances[0].id).toBe(2);
    expect(log.take()).toBeNull();
  });

  it('ignores an empty change so it cannot mask the real one', () => {
    const log = new ChangeLog();
    log.set({ instances: [instance(1)] });
    expect(log.set({ instances: [] })).toBe(false);
    expect(log.take()?.instances[0].id).toBe(1);
  });

  it('copies the change and its ratios', () => {
    const log = new ChangeLog();
    const source = { instances: [instance(1)], ratios: { 'a|b|horizontal': 0.25 } };
    log.set(source);
    source.ratios['a|b|horizontal'] = 0.9;
    source.instances[0].rect.x = 999;
    const taken = log.take();
    expect(taken?.ratios?.['a|b|horizontal']).toBe(0.25);
    expect(taken?.instances[0].rect.x).toBe(0);
  });
});

describe('validateChange — validate everything before applying (§13)', () => {
  const live = (entries: [number, number, 0 | 1 | null][]): LiveInstance[] =>
    entries.map(([id, workspace, slot]) => ({ id, workspace, slot }));

  it('accepts a change whose instances all still exist', () => {
    const change: Change = { instances: [instance(1, { slot: 0 }), instance(2, { slot: 1 })] };
    expect(validateChange(change, live([[1, 0, 0], [2, 0, 1]]))).toEqual({ ok: true, problem: null });
  });

  it('refuses when an instance is gone', () => {
    const change: Change = { instances: [instance(1), instance(2)] };
    expect(validateChange(change, live([[1, 0, null]]))).toEqual({ ok: false, problem: 'instance-gone' });
  });

  it('refuses when a slot it needs is taken by an outsider', () => {
    const change: Change = { instances: [instance(1, { slot: 0 })] };
    expect(validateChange(change, live([[1, 0, 1], [9, 0, 0]]))).toEqual({ ok: false, problem: 'slot-taken' });
  });

  it('allows a swap: the other slot is held by the change itself', () => {
    const change: Change = { instances: [instance(1, { slot: 1, workspace: 0 }), instance(2, { slot: 0, workspace: 0 })] };
    expect(validateChange(change, live([[1, 0, 1], [2, 0, 0]]))).toEqual({ ok: true, problem: null });
  });

  it('ignores a slot on a different workspace', () => {
    const change: Change = { instances: [instance(1, { slot: 0, workspace: 0 })] };
    expect(validateChange(change, live([[1, 0, null], [9, 1, 0]]))).toEqual({ ok: true, problem: null });
  });
});
