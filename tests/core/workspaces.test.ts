// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { holdsWindows, reapPlan, spareIndex } from '../../src/core/workspaces.js';
import type { State, Win, Ws } from '../../src/core/placement.js';

const win = (id: number, extra: Partial<Win> = {}): Win => ({ id, ...extra });
const ws = (id: number, slots: [Win | null, Win | null] = [null, null], minimized: Win[] = [], floats: Win[] = []): Ws =>
  ({ id, slots, minimized, floats });
const state = (workspaces: Ws[], viewed = 0): State => ({ workspaces, viewed });

describe('holdsWindows', () => {
  it('is true for a visible window, a minimized one or a float', () => {
    expect(holdsWindows(ws(0, [win(1), null]))).toBe(true);
    expect(holdsWindows(ws(0, [null, null], [win(1)]))).toBe(true);
    expect(holdsWindows(ws(0, [null, null], [], [win(1)]))).toBe(true);
  });
  it('is false for an empty workspace', () => {
    expect(holdsWindows(ws(0))).toBe(false);
  });
});

describe('spareIndex', () => {
  it('is the trailing empty workspace', () => {
    expect(spareIndex(state([ws(0, [win(1), null]), ws(1)]))).toBe(1);
  });
  it('is the last workspace even when it is occupied (GNOME then adds another)', () => {
    expect(spareIndex(state([ws(0, [win(1), null]), ws(1, [win(2), null])]))).toBe(1);
  });
});

describe('reapPlan (§5)', () => {
  it('reaps an empty workspace that is not the spare', () => {
    const plan = reapPlan(state([ws(0), ws(1, [win(1), null]), ws(2)]));
    expect(plan.reap).toEqual([0]);
  });
  it('never reaps the spare', () => {
    const plan = reapPlan(state([ws(0, [win(1), null]), ws(1)]));
    expect(plan.reap).toEqual([]);
  });
  it('relocates the occupant of a workspace that holds only minimized windows, into the left', () => {
    const plan = reapPlan(state([ws(0, [win(1), null]), ws(1, [null, null], [win(2)]), ws(2)]));
    expect(plan.relocate).toEqual([{ id: 2, to: 0 }]);
    expect(plan.reap).toEqual([1]);
  });
  it('relocates it to the right when the left holds nothing', () => {
    const plan = reapPlan(state([ws(0, [null, null], [win(2)]), ws(1, [win(3), null]), ws(2)]));
    expect(plan.relocate).toEqual([{ id: 2, to: 1 }]);
  });
  it('leaves the last workspace as it is when no neighbour holds windows', () => {
    const plan = reapPlan(state([ws(0, [null, null], [win(2)])]));
    expect(plan.relocate).toEqual([]);
    expect(plan.reap).toEqual([]);
  });
  it('keeps a workspace alive when a float pins it', () => {
    const plan = reapPlan(state([ws(0, [null, null], [], [win(2)]), ws(1)]));
    expect(plan.reap).toEqual([]);
  });
  it('reaps every empty workspace wherever it sits, leaving one spare', () => {
    const plan = reapPlan(state([ws(0), ws(1, [win(1), null]), ws(2), ws(3)]));
    expect(plan.reap).toEqual([0, 2]);
  });
});
