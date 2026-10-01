// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { dragOutcome } from '../../src/core/drag.js';
import type { DragInput } from '../../src/core/drag.js';
import { swappedSides } from '../../src/core/placement.js';
import type { State, Win, Ws } from '../../src/core/placement.js';
import type { TilerConfig, TilerWindow } from '../../src/core/tiler.js';
import type { Rect, Screen } from '../../src/core/types.js';

import { rect, screen, size, window } from './helpers.js';

const win = (id: number, extra: Partial<Win> = {}): Win => ({ id, ...extra });
const ws = (id: number, slots: [Win | null, Win | null] = [null, null], minimized: Win[] = []): Ws => ({ id, slots, minimized });
const state = (workspaces: Ws[], viewed = 0): State => ({ workspaces, viewed });

const AREA: Rect = rect(0, 0, 1200, 800);
const ENV = { screen: 'dynamic', axis: 'horizontal' } as const;
const CONFIG: TilerConfig = {
  gapBase: 0,
  gapPortrait: -1,
  gapLandscape: -1,
  minSizePolicy: 'respect',
  primaryApps: [],
  primaryAppRatio: 0.5,
  ratios: {},
  swapPairs: new Set<string>(),
  rules: [],
};
const SCREEN: Screen = screen({ geometry: AREA });

const twin = (id: number, appId: string, placed: Rect, slot?: 0 | 1): TilerWindow =>
  window({ id, appId, rect: placed, min: size(0, 0), max: size(0, 0), slot });

const input = (overrides: Partial<DragInput> & Pick<DragInput, 'dragged' | 'othersByWorkspace' | 'dropped' | 'workspace' | 'from' | 'crossed' | 'samePlane'>): DragInput => ({
  state: state([ws(0), ws(1)]),
  env: ENV,
  id: overrides.dragged.id,
  screen: SCREEN,
  config: CONFIG,
  ...overrides,
});

describe('swappedSides (§13)', () => {
  it('trades two known, different sides', () => {
    expect(swappedSides(1, 0, 2, 1)).toEqual([1, 0]);
  });
  it('reverses the id order when the sides are equal or unknown', () => {
    expect(swappedSides(1, 1, 2, 1)).toEqual([1, 0]);
    expect(swappedSides(2, null, 1, null)).toEqual([0, 1]);
  });
});

describe('dragOutcome (the one drag decision, §6/§11)', () => {
  it('a cross-plane free slot takes the side it came from (slot 1 here)', () => {
    const dragged = twin(2, 'b', rect(700, 0, 600, 800));
    const resident = twin(1, 'a', rect(0, 0, 600, 800), 0);
    const out = dragOutcome(input({
      dragged,
      othersByWorkspace: new Map([[0, [resident]]]),
      dropped: rect(700, 0, 600, 800),
      workspace: 0,
      from: 'right',
      crossed: null,
      samePlane: false,
      state: state([ws(0, [win(1), null]), ws(1)]),
    }));
    expect(out).toMatchObject({ kind: 'slot', workspace: 0, slot: 1 });
    expect(out.rect).toEqual(rect(600, 0, 600, 800));
  });

  it('a free slot from the left takes slot 0', () => {
    const dragged = twin(2, 'b', rect(50, 0, 600, 800));
    const resident = twin(1, 'a', rect(600, 0, 600, 800), 1);
    const out = dragOutcome(input({
      dragged,
      othersByWorkspace: new Map([[0, [resident]]]),
      dropped: rect(50, 0, 600, 800),
      workspace: 0,
      from: 'left',
      crossed: null,
      samePlane: false,
      state: state([ws(0, [null, win(1)]), ws(1)]),
    }));
    expect(out).toMatchObject({ kind: 'slot', slot: 0 });
    expect(out.rect).toEqual(rect(0, 0, 600, 800));
  });

  it('a same-plane move that crosses its sibling swaps and lands on the crossed tile', () => {
    // Both rects report the right slot, so the swap falls back to the id order:
    // the low id ends on the right, which is the crossed window's tile.
    const dragged = twin(1, 'a', rect(700, 0, 600, 800), 1);
    const sibling = twin(2, 'b', rect(600, 0, 600, 800), 1);
    const out = dragOutcome(input({
      dragged,
      othersByWorkspace: new Map([[0, [sibling]]]),
      dropped: rect(596, 0, 600, 800),
      workspace: 0,
      from: null,
      crossed: 2,
      samePlane: true,
    }));
    expect(out).toMatchObject({ kind: 'swap', with: 2 });
    expect(out.rect).toEqual(rect(600, 0, 600, 800));
  });

  it('an explicit swap trades two known sides', () => {
    const dragged = twin(1, 'a', rect(0, 0, 600, 800), 0);
    const sibling = twin(2, 'b', rect(600, 0, 600, 800), 1);
    const out = dragOutcome(input({
      dragged,
      othersByWorkspace: new Map([[0, [sibling]]]),
      dropped: rect(600, 0, 600, 800),
      workspace: 0,
      from: null,
      crossed: 2,
      samePlane: true,
    }));
    expect(out.rect).toEqual(rect(600, 0, 600, 800));
  });

  it('maximises alone on the empty target workspace', () => {
    const dragged = twin(2, 'b', rect(300, 300, 600, 400));
    const out = dragOutcome(input({
      dragged,
      othersByWorkspace: new Map([[1, []]]),
      dropped: rect(300, 300, 600, 400),
      workspace: 1,
      from: 'right',
      crossed: null,
      samePlane: false,
      state: state([ws(0, [win(1), win(3)]), ws(1)]),
    }));
    expect(out).toMatchObject({ kind: 'maximize', workspace: 1 });
    expect(out.rect).toEqual(AREA);
  });

  it('floats where dropped when the full target has nothing to cross', () => {
    const dropped = rect(260, 140, 500, 420);
    const dragged = twin(3, 'c', dropped);
    const out = dragOutcome(input({
      dragged,
      othersByWorkspace: new Map([[0, [twin(1, 'a', rect(0, 0, 600, 800), 0), twin(2, 'b', rect(600, 0, 600, 800), 1)]]]),
      dropped,
      workspace: 0,
      from: 'left',
      crossed: null,
      samePlane: false,
      state: state([ws(0, [win(1), win(2)]), ws(1)]),
    }));
    expect(out).toMatchObject({ kind: 'float', workspace: 0 });
    expect(out.rect).toEqual(dropped);
  });

  it('returns to its own tile when a same-plane move crosses nothing (no-op)', () => {
    const dragged = twin(2, 'b', rect(612, 0, 590, 800), 1);
    const sibling = twin(1, 'a', rect(0, 0, 600, 800), 0);
    const out = dragOutcome(input({
      dragged,
      othersByWorkspace: new Map([[0, [sibling]]]),
      dropped: rect(612, 0, 590, 800),
      workspace: 0,
      from: null,
      crossed: null,
      samePlane: true,
    }));
    expect(out).toMatchObject({ kind: 'none', workspace: 0 });
    expect(out.rect).toEqual(rect(600, 0, 600, 800));
  });
});
