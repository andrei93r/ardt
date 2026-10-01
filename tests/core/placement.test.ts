// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import {
  dropPlacement, escapeSize, freeSlot, impossibleSplit, minimizeRelocation, refusalLadder, routeNewWindow,
  sideSlot, unmaximizeWindow,
} from '../../src/core/placement.js';
import type { State, Win, Ws } from '../../src/core/placement.js';

const win = (id: number, extra: Partial<Win> = {}): Win => ({ id, ...extra });
const ws = (id: number, slots: [Win | null, Win | null] = [null, null], minimized: Win[] = []): Ws => ({ id, slots, minimized });
const state = (workspaces: Ws[], viewed = 0): State => ({ workspaces, viewed });

describe('freeSlot', () => {
  it('reports 0 when only the second slot is taken', () => {
    expect(freeSlot(ws(0, [null, win(2)]))).toBe(0);
  });
  it('reports 1 when the first slot is taken', () => {
    expect(freeSlot(ws(0, [win(1), null]))).toBe(1);
  });
  it('reports null when both slots are taken', () => {
    expect(freeSlot(ws(0, [win(1), win(2)]))).toBeNull();
  });
  it('ignores minimized windows: they hold no slot (§5)', () => {
    expect(freeSlot(ws(0, [win(1), null], [win(9)]))).toBe(1);
  });
});

describe('sideSlot (the arrival side rule, §3)', () => {
  it('a window from the left takes slot 0', () => {
    expect(sideSlot('left')).toBe(0);
  });
  it('a window from the right takes slot 1', () => {
    expect(sideSlot('right')).toBe(1);
  });
  it('a window from above takes slot 0 (the top)', () => {
    expect(sideSlot('above')).toBe(0);
  });
  it('a window from below takes slot 1 (the bottom)', () => {
    expect(sideSlot('below')).toBe(1);
  });
  it('no direction means slot 1 (the arrival default)', () => {
    expect(sideSlot(null)).toBe(1);
  });
});

describe('routeNewWindow (§3)', () => {
  const env = { screen: 'dynamic' as const, axis: 'horizontal' as const };

  it('splits a maximized single: the newcomer takes slot 1', () => {
    const s = state([ws(0, [win(1), null]), ws(1)]);
    expect(routeNewWindow(s, env, win(2))).toMatchObject({ workspace: 0, slot: 1 });
  });

  it('takes the free slot when the workspace holds one window', () => {
    const s = state([ws(0, [null, win(1)]), ws(1)]);
    expect(routeNewWindow(s, env, win(2))).toMatchObject({ workspace: 0, slot: 0 });
  });

  it('lands alone on an empty viewed workspace, maximized', () => {
    const s = state([ws(0), ws(1)]);
    expect(routeNewWindow(s, env, win(2))).toMatchObject({ workspace: 0, slot: 1, maximize: true });
  });

  it('maximizes a newcomer on a workspace that only looks empty (§5)', () => {
    const s = state([ws(0, [null, null], [win(9)]), ws(1)]);
    expect(routeNewWindow(s, env, win(2))).toMatchObject({ workspace: 0, maximize: true });
  });

  it('creates a workspace immediately right when the viewed one is full', () => {
    const s = state([ws(0, [win(1), win(2)]), ws(1)]);
    expect(routeNewWindow(s, env, win(3))).toMatchObject({ workspace: 0, slot: 1, createRight: true, maximize: true });
  });

  it('never scans neighbours: a free slot to the right does not attract it', () => {
    const s = state([ws(0, [win(1), win(2)]), ws(1, [win(9), null])]);
    expect(routeNewWindow(s, env, win(3))).toMatchObject({ createRight: true, maximize: true });
  });

  it('routes on the window own workspace when it opens off-view (§3, §20)', () => {
    const s = state([ws(0, [win(1), win(2)]), ws(1)], 1);
    expect(routeNewWindow(s, env, win(3), null, 0)).toMatchObject({ workspace: 0, createRight: true, maximize: true });
  });

  it('overflows to a float on a single-workspace screen', () => {
    const s = state([ws(0, [win(1), win(2)])]);
    expect(routeNewWindow(s, { screen: 'single', axis: 'horizontal' }, win(3))).toMatchObject({ workspace: 0, float: true });
  });

  it('fills an existing workspace on a fixed screen, right first', () => {
    const s = state([ws(0, [win(1), win(2)]), ws(1, [win(9), null]), ws(2)]);
    expect(routeNewWindow(s, { screen: 'fixed', axis: 'horizontal' }, win(3))).toMatchObject({ workspace: 1, slot: 1 });
  });

  it('floats on a fixed screen when every workspace is full', () => {
    const s = state([ws(0, [win(1), win(2)]), ws(1, [win(9), win(10)])]);
    expect(routeNewWindow(s, { screen: 'fixed', axis: 'horizontal' }, win(3))).toMatchObject({ float: true });
  });

  it('gives a window that cannot fit a share its own workspace (the escape, §16)', () => {
    const s = state([ws(0, [win(1), null]), ws(1)]);
    expect(routeNewWindow(s, env, win(2), null, null, true)).toMatchObject({ workspace: 0, slot: 0, createRight: true });
  });

  it('lets the trigger keep a single-workspace screen and minimizes the rest (§10 step 4)', () => {
    const s = state([ws(0, [win(1), win(2)])]);
    expect(routeNewWindow(s, { screen: 'single', axis: 'horizontal' }, win(3), null, null, true))
      .toMatchObject({ workspace: 0, inPlace: true, maximize: true, minimize: [1, 2] });
  });
});

describe('unmaximizeWindow (the ladder, §4)', () => {
  const env = { screen: 'dynamic' as const, axis: 'horizontal' as const };

  it('joins the left workspace when it holds exactly one window, into slot 1', () => {
    const s = state([ws(0, [win(1), null]), ws(1, [win(2), null])]);
    expect(unmaximizeWindow(s, env, 1, 2)).toMatchObject({ workspace: 0, slot: 1 });
  });

  it('joins the right one when the left cannot pair', () => {
    const s = state([ws(0, [win(1), win(3)]), ws(1, [win(2), null]), ws(2, [win(4), null])]);
    expect(unmaximizeWindow(s, env, 1, 2)).toMatchObject({ workspace: 2, slot: 1 });
  });

  it('parks minimized in the left when neither neighbour can pair (both full)', () => {
    const s = state([ws(0, [win(1), win(3)]), ws(1, [win(2), null]), ws(2, [win(4), win(5)])]);
    expect(unmaximizeWindow(s, env, 1, 2)).toMatchObject({ workspace: 0, minimize: [2] });
  });

  it('parks in the left when the right neighbour is empty (an empty target would leave it alone)', () => {
    const s = state([ws(0, [win(1), win(3)]), ws(1, [win(2), null]), ws(2)]);
    expect(unmaximizeWindow(s, env, 1, 2)).toMatchObject({ workspace: 0, minimize: [2] });
  });

  it('parks in the right when there is no left neighbour', () => {
    const s = state([ws(0, [win(2), null]), ws(1, [win(4), win(5)])]);
    expect(unmaximizeWindow(s, env, 0, 2)).toMatchObject({ workspace: 1, minimize: [2] });
  });

  it('stays where it is when no neighbour holds windows', () => {
    const s = state([ws(0, [win(2), null]), ws(1)]);
    expect(unmaximizeWindow(s, env, 0, 2)).toMatchObject({ workspace: 0, minimize: [2] });
  });

  it('joins a neighbour that holds only a minimized window (it counts as one window)', () => {
    const s = state([ws(0, [null, null], [win(1)]), ws(1, [win(2), null])]);
    expect(unmaximizeWindow(s, env, 1, 2)).toMatchObject({ workspace: 0, slot: 1 });
  });

  it('says to unmaximize in place on a single-workspace screen', () => {
    const s = state([ws(0, [win(1), win(2)])]);
    expect(unmaximizeWindow(s, { screen: 'single', axis: 'horizontal' }, 0, 2)).toMatchObject({ workspace: 0, inPlace: true });
  });
});

describe('minimizeRelocation (the alone-minimized rule, §4)', () => {
  it('moves it into the left neighbour when that holds windows', () => {
    const s = state([ws(0, [win(1), null]), ws(1, [null, null], [win(2)])]);
    expect(minimizeRelocation(s, 1)).toMatchObject({ to: 0 });
  });
  it('moves it right when the left holds nothing', () => {
    const s = state([ws(0, [null, null], [win(2)]), ws(1, [win(3), null])]);
    expect(minimizeRelocation(s, 0)).toMatchObject({ to: 1 });
  });
  it('leaves it alone when no neighbour holds windows', () => {
    const s = state([ws(0, [null, null], [win(2)])]);
    expect(minimizeRelocation(s, 0)).toBeNull();
  });
});

describe('escapeSize (the escape clamp, §10 step 3)', () => {
  it('keeps a window wider than a sixth at its own size', () => {
    expect(escapeSize(1200, 700)).toBe(700);
  });
  it('clamps a tiny window up to one sixth of the screen', () => {
    expect(escapeSize(1200, 80)).toBe(200);
  });
  it('clamps a huge window down to the full screen', () => {
    expect(escapeSize(1200, 2000)).toBe(1200);
  });
});

describe('impossibleSplit (the trigger wins, §10 step 3-4)', () => {
  it('on a dynamic screen the reactor takes its own workspace', () => {
    expect(impossibleSplit({ screen: 'dynamic', axis: 'horizontal' }, win(1), win(2)))
      .toMatchObject({ keep: 1, giveWay: 2, giveWayTo: 'own-workspace' });
  });
  it('on a single-workspace screen the reactor is minimized', () => {
    expect(impossibleSplit({ screen: 'single', axis: 'horizontal' }, win(1), win(2)))
      .toMatchObject({ keep: 1, giveWay: 2, giveWayTo: 'minimized' });
  });
});

describe('refusalLadder (the sibling adapts first, §10 step 2)', () => {
  it('lets the sibling adapt to the remainder', () => {
    expect(refusalLadder(700, 200, 1280)).toEqual({ sibling: 580, escaped: false });
  });
  it('gives the sibling at least its minimum when the remainder is smaller', () => {
    // The remainder would be 380, below the sibling's 500 minimum: it refuses.
    expect(refusalLadder(900, 500, 1280)).toMatchObject({ escaped: true });
  });
  it('hands the whole remainder to a sibling that can use it', () => {
    expect(refusalLadder(100, 200, 1280)).toEqual({ sibling: 1180, escaped: false });
  });
  it('escapes when the refusing window alone exceeds the split', () => {
    expect(refusalLadder(2000, 100, 1280)).toMatchObject({ escaped: true });
  });
});

describe('dropPlacement (the user drop ladder, §6)', () => {
  const env = { screen: 'dynamic' as const, axis: 'horizontal' as const };

  it('a cross-screen arrival takes the side it came from', () => {
    // The target single sits in slot 0; an arrival from its left lands in slot
    // 0 and the resident is pushed to slot 1 (A117's screen case).
    const s = state([ws(0, [win(1), null]), ws(1)]);
    expect(dropPlacement(s, env, 2, 0, 'left', null)).toEqual({ kind: 'slot', workspace: 0, slot: 0 });
    // From the right it takes slot 1 and the resident keeps slot 0.
    expect(dropPlacement(s, env, 2, 0, 'right', null)).toEqual({ kind: 'slot', workspace: 0, slot: 1 });
  });

  it('without a side, a free slot wins on the slot-1 default', () => {
    const s = state([ws(0, [null, win(1)]), ws(1)]);
    expect(dropPlacement(s, env, 2, 0, null, null)).toEqual({ kind: 'slot', workspace: 0, slot: 0 });
  });

  it('a free slot beats a crossing', () => {
    const s = state([ws(0, [null, win(1)]), ws(1)]);
    expect(dropPlacement(s, env, 2, 0, null, 1)).toEqual({ kind: 'slot', workspace: 0, slot: 0 });
  });

  it('swaps with a crossed window only when there is no free slot', () => {
    const s = state([ws(0, [win(1), win(2)]), ws(1)]);
    expect(dropPlacement(s, env, 9, 0, null, 2)).toEqual({ kind: 'swap', workspace: 0, with: 2 });
  });

  it('floats on a full workspace when nothing was crossed', () => {
    const s = state([ws(0, [win(1), win(2)]), ws(1)]);
    expect(dropPlacement(s, env, 9, 0, null, null)).toEqual({ kind: 'float', workspace: 0 });
  });

  it('maximises on the empty trailing workspace', () => {
    const s = state([ws(0, [win(1)]), ws(1)]);
    expect(dropPlacement(s, env, 2, 1, null, null)).toEqual({ kind: 'maximize', workspace: 1 });
  });

  it('never swaps on a single-workspace screen: a full target floats', () => {
    const single = { screen: 'single' as const, axis: 'horizontal' as const };
    const s = state([ws(0, [win(1), win(2)])]);
    expect(dropPlacement(s, single, 9, 0, null, 2)).toEqual({ kind: 'float', workspace: 0 });
  });

  it('routes a fixed screen to the nearest workspace with room', () => {
    const fixed = { screen: 'fixed' as const, axis: 'horizontal' as const };
    const s = state([ws(0, [win(1), win(2)]), ws(1, [win(3), null]), ws(2)]);
    expect(dropPlacement(s, fixed, 9, 0, null, 2)).toEqual({ kind: 'slot', workspace: 1, slot: 1 });
  });
});
