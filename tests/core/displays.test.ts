// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { displayPlan, holdsWindows, rescueSide, visibleCount } from '../../src/core/displays.js';
import type {
  DisplayState,
  DisplayWindow,
  DisplayWorkspace,
  MemoryEntry,
} from '../../src/core/displays.js';
import type { Screen } from '../../src/core/types.js';
import { rect, screen } from './helpers.js';

const primary = screen({ index: 0, connector: 'eDP-1', isPrimary: true, geometry: rect(0, 0, 1920, 1080) });
const right = screen({ index: 1, connector: 'DP-1', isPrimary: false, geometry: rect(1920, 0, 1920, 1080) });
const left = screen({ index: 1, connector: 'DP-1', isPrimary: false, geometry: rect(-1920, 0, 1920, 1080) });
const above = screen({ index: 1, connector: 'DP-1', isPrimary: false, geometry: rect(0, -1080, 1920, 1080) });
const below = screen({ index: 1, connector: 'DP-1', isPrimary: false, geometry: rect(0, 1080, 1920, 1080) });

const win = (id: number, extra: Partial<DisplayWindow> = {}): DisplayWindow => ({ id, ...extra });
const ws = (
  id: number,
  onScreen: number,
  slots: [DisplayWindow | null, DisplayWindow | null] = [null, null],
  minimized: DisplayWindow[] = [],
  floats: DisplayWindow[] = [],
): DisplayWorkspace => ({ id, screen: onScreen, slots, minimized, floats });
const state = (screens: Screen[], workspaces: DisplayWorkspace[], viewed: number): DisplayState =>
  ({ screens, workspaces, viewed });

const remembered = (
  id: number,
  extra: Partial<MemoryEntry['windows'][number]> = {},
): MemoryEntry['windows'][number] => ({
  id,
  workspace: 0,
  minimized: false,
  floating: false,
  maximized: false,
  fullscreen: false,
  rect: rect(0, 0, 0, 0),
  ...extra,
});

const entry = (connector: string, at: number, windows: MemoryEntry['windows']): MemoryEntry =>
  ({ connector, at, windows });

const NO_TTL = { now: 1000, ttlMs: 30 * 60 * 1000 } as const;

describe('holdsWindows / visibleCount', () => {
  it('counts visible, minimized and floating windows', () => {
    expect(holdsWindows(ws(1, 0))).toBe(false);
    expect(holdsWindows(ws(1, 0, [win(1), null]))).toBe(true);
    expect(holdsWindows(ws(1, 0, [null, null], [win(1)]))).toBe(true);
    expect(holdsWindows(ws(1, 0, [null, null], [], [win(1)]))).toBe(true);
    expect(visibleCount(ws(1, 0, [win(1), win(2)], [win(3)]))).toBe(2);
    expect(visibleCount(ws(1, 0, [null, null], [win(3)]))).toBe(0);
  });
});

describe('rescueSide (§9)', () => {
  it('a screen to the right rescues to the right', () => {
    expect(rescueSide(right, primary, [primary, right])).toEqual({ side: 'right', leftmost: false });
  });
  it('a screen to the left rescues to the left', () => {
    expect(rescueSide(left, primary, [primary, left])).toEqual({ side: 'left', leftmost: false });
  });
  it('a screen above is treated as left', () => {
    expect(rescueSide(above, primary, [primary, above]).side).toBe('left');
  });
  it('a screen below is treated as left', () => {
    expect(rescueSide(below, primary, [primary, below]).side).toBe('left');
  });
  it('goes leftmost when other screens were already to the left', () => {
    const far = screen({ index: 2, connector: 'HDMI-1', isPrimary: false, geometry: rect(-3840, 0, 1920, 1080) });
    const near = screen({ index: 1, connector: 'DP-1', isPrimary: false, geometry: rect(-1920, 0, 1920, 1080) });
    expect(rescueSide(far, primary, [primary, near, far])).toEqual({ side: 'left', leftmost: true });
  });
});

describe('disconnect: rescue to the primary (§9)', () => {
  it('moves a vanished pair to one fresh workspace, adjacent right, view unchanged', () => {
    const prev = state(
      [primary, right],
      [ws(10, 0, [win(1), null]), ws(11, 0), ws(20, 1, [win(2), win(3)])],
      10,
    );
    const next = state([primary], [ws(10, 0, [win(1), null]), ws(11, 0)], 10);

    const plan = displayPlan(prev, next, [], NO_TTL);

    expect(plan.moves).toEqual([
      { id: 2, create: { key: -1, anchor: 10, side: 'right', screen: 0 }, slot: 0 },
      { id: 3, create: { key: -1, anchor: 10, side: 'right', screen: 0 }, slot: 1 },
    ]);
    expect(plan.remember).toEqual([
      {
        connector: 'DP-1',
        at: 1000,
        windows: [
          remembered(2, { workspace: 0, slot: 0 }),
          remembered(3, { workspace: 0, slot: 1 }),
        ],
      },
    ]);
    expect(plan.forget).toEqual([]);
  });

  it('creates exactly two fresh workspaces for a pair plus a single, keeping the order', () => {
    const prev = state(
      [primary, right],
      [
        ws(10, 0, [win(1), null]),
        ws(20, 1, [win(2), win(3)]),
        ws(21, 1, [win(4), null]),
      ],
      10,
    );
    const next = state([primary], [ws(10, 0, [win(1), null]), ws(11, 0)], 10);

    const plan = displayPlan(prev, next, [], NO_TTL);

    expect(plan.moves.map((move) => ({ id: move.id, key: move.create?.key }))).toEqual([
      { id: 2, key: -1 },
      { id: 3, key: -1 },
      { id: 4, key: -2 },
    ]);
    // A single stays a single: the lone rescued window is maximized.
    expect(plan.moves[2]).toMatchObject({ id: 4, slot: 0, maximize: true });
    // Two windows per workspace, both groups on the same physical side.
    expect(plan.moves.every((move) => move.create?.side === 'right')).toBe(true);
  });

  it('rescues to the left when the vanished screen sat on the left', () => {
    const prev = state([primary, left], [ws(10, 0, [win(1), null]), ws(20, 1, [win(2), win(3)])], 10);
    const next = state([primary], [ws(10, 0, [win(1), null]), ws(11, 0)], 10);

    const plan = displayPlan(prev, next, [], NO_TTL);

    expect(plan.moves.every((move) => move.create?.side === 'left')).toBe(true);
    expect(plan.moves.every((move) => move.create?.leftmost !== true)).toBe(true);
  });

  it('treats above and below as left', () => {
    for (const geometry of [above, below]) {
      const prev = state([primary, geometry], [ws(10, 0, [win(1), null]), ws(20, 1, [win(2), win(3)])], 10);
      const next = state([primary], [ws(10, 0, [win(1), null]), ws(11, 0)], 10);
      const plan = displayPlan(prev, next, [], NO_TTL);
      expect(plan.moves.every((move) => move.create?.side === 'left')).toBe(true);
    }
  });

  it('inserts leftmost when other screens were already to the left', () => {
    const far = screen({ index: 2, connector: 'HDMI-1', isPrimary: false, geometry: rect(-3840, 0, 1920, 1080) });
    const near = screen({ index: 1, connector: 'DP-1', isPrimary: false, geometry: rect(-1920, 0, 1920, 1080) });
    const prev = state([primary, near, far], [ws(10, 0, [win(1), null]), ws(20, 2, [win(2), win(3)])], 10);
    const next = state([primary, near], [ws(10, 0, [win(1), null]), ws(11, 0), ws(30, 1)], 10);

    const plan = displayPlan(prev, next, [], NO_TTL);

    expect(plan.moves).toHaveLength(2);
    expect(plan.moves[0]?.create).toMatchObject({ side: 'left', leftmost: true });
  });

  it('gives two vanished screens distinct created-workspace keys', () => {
    const second = screen({ index: 2, connector: 'HDMI-1', isPrimary: false, geometry: rect(3840, 0, 1920, 1080) });
    const prev = state(
      [primary, right, second],
      [ws(10, 0, [win(1), null]), ws(20, 1, [win(2), null]), ws(30, 2, [win(3), null])],
      10,
    );
    const next = state([primary], [ws(10, 0, [win(1), null]), ws(11, 0)], 10);

    const plan = displayPlan(prev, next, [], NO_TTL);

    expect(plan.moves.map((move) => move.create?.key)).toEqual([-1, -2]);
    expect(plan.remember.map((record) => record.connector)).toEqual(['DP-1', 'HDMI-1']);
  });

  it('never scavenges a free slot on a workspace that was not the vanished screen\u2019s', () => {
    const prev = state(
      [primary, right],
      [ws(10, 0, [win(1), null]), ws(20, 1, [win(2), win(3)])],
      10,
    );
    // Workspace 10 has a free slot on the primary, but the pair must not use it.
    const next = state([primary], [ws(10, 0, [win(1), null]), ws(11, 0)], 10);

    const plan = displayPlan(prev, next, [], NO_TTL);

    expect(plan.moves).toHaveLength(2);
    expect(plan.moves.every((move) => move.create !== undefined && move.workspace === undefined)).toBe(true);
  });

  it('preserves minimized, floats and fullscreen and records them in memory', () => {
    const prev = state(
      [primary, right],
      [
        ws(10, 0, [win(1), null]),
        ws(20, 1, [win(2, { fullscreen: true }), null], [win(3)], [win(4, { rect: rect(10, 20, 300, 200) })]),
      ],
      10,
    );
    const next = state([primary], [ws(10, 0, [win(1), null]), ws(11, 0)], 10);

    const plan = displayPlan(prev, next, [], NO_TTL);

    expect(plan.moves).toEqual([
      { id: 2, create: { key: -1, anchor: 10, side: 'right', screen: 0 }, slot: 0, maximize: true, fullscreen: true },
      { id: 3, create: { key: -1, anchor: 10, side: 'right', screen: 0 }, minimize: true },
      { id: 4, create: { key: -1, anchor: 10, side: 'right', screen: 0 }, float: true, rect: rect(10, 20, 300, 200) },
    ]);
    expect(plan.remember[0]?.windows).toEqual([
      remembered(2, { workspace: 0, slot: 0, maximized: false, fullscreen: true }),
      remembered(3, { workspace: 0, minimized: true }),
      remembered(4, { workspace: 0, floating: true, rect: rect(10, 20, 300, 200) }),
    ]);
  });

  it('carries a rescued float frame and stacking into the plan and memory', () => {
    const prev = state(
      [primary, right],
      [
        ws(10, 0, [win(1), null]),
        ws(20, 1, [null, null], [], [win(4, { rect: rect(10, 20, 300, 200), z: 5 })]),
      ],
      10,
    );
    const next = state([primary], [ws(10, 0, [win(1), null]), ws(11, 0)], 10);

    const plan = displayPlan(prev, next, [], NO_TTL);

    // A float's frame and stacking travel with the rescue move, exactly.
    expect(plan.moves).toEqual([
      { id: 4, create: { key: -1, anchor: 10, side: 'right', screen: 0 }, float: true, rect: rect(10, 20, 300, 200), z: 5 },
    ]);
    expect(plan.remember[0]?.windows).toEqual([
      remembered(4, { workspace: 0, floating: true, rect: rect(10, 20, 300, 200), z: 5 }),
    ]);
  });

  it('does not reroute a rescued window a surviving screen already displays', () => {
    const prev = state([primary, right], [ws(10, 0, [win(1), null]), ws(20, 1, [win(2), win(3)])], 10);
    // Mutter already migrated window 2 onto the primary; adrt routes only 3.
    const next = state([primary], [ws(10, 0, [win(2), null]), ws(11, 0)], 10);

    const plan = displayPlan(prev, next, [], NO_TTL);

    expect(plan.moves.map((move) => move.id)).toEqual([3]);
    expect(plan.remember[0]?.windows.map((w) => w.id)).toEqual([2, 3]);
  });

  it('rescues to the new primary when the vanished screen was the primary', () => {
    const prev = state(
      [primary, right],
      [ws(10, 0, [win(1), null]), ws(20, 1, [win(2), win(3)])],
      10,
    );
    const newPrimary = screen({ index: 0, connector: 'DP-1', isPrimary: true, geometry: rect(1920, 0, 1920, 1080) });
    const next = state([newPrimary], [ws(20, 0, [win(2), win(3)]), ws(21, 0)], 20);

    const plan = displayPlan(prev, next, [], NO_TTL);

    expect(plan.moves.every((move) => move.create?.screen === 0)).toBe(true);
    expect(plan.moves.every((move) => move.create?.side === 'left')).toBe(true);
  });

  it('does not create workspaces when the primary cannot (class is read from GNOME)', () => {
    const prev = state([primary, right], [ws(10, 0, [win(1), null]), ws(20, 1, [win(2), win(3)])], 10);
    const next = state([primary], [ws(10, 0, [win(1), null]), ws(11, 0)], 10);

    const plan = displayPlan(prev, next, [], { ...NO_TTL, classes: { 'eDP-1': 'single' } });

    expect(plan.moves).toEqual([]);
    expect(plan.remember[0]?.connector).toBe('DP-1');
  });
});

describe('reconnect: replay a remembered connector (§9, decision 66)', () => {
  const prev = state([primary], [ws(10, 0, [win(1), null])], 10);
  const next = state([primary, right], [ws(10, 0, [win(1), null]), ws(20, 1)], 10);

  it('puts remembered windows back into their slots, minimized, floating and fullscreen', () => {
    const memory = [
      entry('DP-1', 0, [
        remembered(2, { slot: 0 }),
        remembered(3, { slot: 1, fullscreen: true }),
        remembered(4, { minimized: true }),
        remembered(5, { floating: true, rect: rect(100, 100, 400, 300) }),
      ]),
    ];

    const plan = displayPlan(prev, next, memory, { now: 500, ttlMs: 30 * 60 * 1000, alive: [2, 3, 4, 5] });

    expect(plan.moves).toEqual([
      { id: 2, workspace: 20, screen: 1, slot: 0 },
      { id: 3, workspace: 20, screen: 1, slot: 1, fullscreen: true },
      { id: 4, workspace: 20, screen: 1, minimize: true },
      { id: 5, workspace: 20, screen: 1, float: true, rect: rect(100, 100, 400, 300) },
    ]);
    // Never floats a window that was not floating, never creates.
    expect(plan.moves.some((move) => move.create !== undefined)).toBe(false);
    expect(plan.remember).toEqual([
      { connector: 'DP-1', at: 500, windows: memory[0]!.windows },
    ]);
  });

  it('leaves a window opened while the screen was away exactly where it is', () => {
    const withNewcomer = state(
      [primary, right],
      [ws(10, 0, [win(9), null]), ws(20, 1)],
      10,
    );
    const memory = [entry('DP-1', 0, [remembered(2, { slot: 0 })])];

    const plan = displayPlan(prev, withNewcomer, memory, { now: 500, ttlMs: 30 * 60 * 1000, alive: [2, 9] });

    expect(plan.moves.map((move) => move.id)).toEqual([2]);
    expect(plan.moves.some((move) => move.id === 9)).toBe(false);
  });

  it('replays partially when the remembered slot has since been taken', () => {
    const taken = state([primary, right], [ws(10, 0, [win(1), null]), ws(20, 1, [win(9), null])], 10);
    const memory = [entry('DP-1', 0, [remembered(2, { slot: 0 })])];

    const plan = displayPlan(prev, taken, memory, { now: 500, ttlMs: 30 * 60 * 1000, alive: [2, 9] });

    expect(plan.moves).toEqual([]);
    // Still remembered: it is alive, it just found no room.
    expect(plan.remember[0]?.windows.map((w) => w.id)).toEqual([2]);
  });

  it('drops windows that no longer exist from memory', () => {
    const memory = [entry('DP-1', 0, [remembered(2, { slot: 0 }), remembered(7, { slot: 1 })])];

    const plan = displayPlan(prev, next, memory, { now: 500, ttlMs: 30 * 60 * 1000, alive: [2] });

    expect(plan.moves.map((move) => move.id)).toEqual([2]);
    expect(plan.remember[0]?.windows.map((w) => w.id)).toEqual([2]);
  });

  it('never creates beyond the memory: a remembered workspace that does not exist is left alone', () => {
    const memory = [entry('DP-1', 0, [remembered(2, { workspace: 1, slot: 0 })])];

    const plan = displayPlan(prev, next, memory, { now: 500, ttlMs: 30 * 60 * 1000, alive: [2] });

    expect(plan.moves).toEqual([]);
  });

  it('replays a float to its exact frame and stacking, on the reconnected screen', () => {
    const memory = [
      entry('DP-1', 0, [remembered(5, { floating: true, rect: rect(100, 100, 400, 300), z: 7 })]),
    ];

    const plan = displayPlan(prev, next, memory, { now: 500, ttlMs: 30 * 60 * 1000, alive: [5] });

    // The frame and stacking are carried verbatim; `screen` routes it back onto
    // the connector that reconnected, never onto the primary.
    expect(plan.moves).toEqual([
      { id: 5, workspace: 20, screen: 1, float: true, rect: rect(100, 100, 400, 300), z: 7 },
    ]);
  });
});

describe('memory TTL (§9)', () => {
  const prev = state([primary], [ws(10, 0, [win(1), null])], 10);
  const next = prev;
  const memory = [entry('DP-1', 0, [remembered(2, { slot: 0 })])];

  it('forgets a connector whose memory has expired', () => {
    const plan = displayPlan(prev, next, memory, { now: 10_000, ttlMs: 1000 });
    expect(plan.forget).toEqual(['DP-1']);
    expect(plan.moves).toEqual([]);
  });

  it('keeps a connector whose memory is still fresh', () => {
    const plan = displayPlan(prev, next, memory, { now: 500, ttlMs: 1000 });
    expect(plan.forget).toEqual([]);
  });

  it('does not replay or keep an expired reconnect', () => {
    const reconnected = state([primary, right], [ws(10, 0, [win(1), null]), ws(20, 1)], 10);
    const plan = displayPlan(prev, reconnected, memory, { now: 10_000, ttlMs: 1000, alive: [2] });
    expect(plan.moves).toEqual([]);
    expect(plan.forget).toEqual(['DP-1']);
  });

  it('never forgets a connector it is remembering in the same pass', () => {
    const vanished = state([primary, right], [ws(10, 0, [win(1), null]), ws(20, 1, [win(2), win(3)])], 10);
    const after = state([primary], [ws(10, 0, [win(1), null]), ws(11, 0)], 10);
    const stale = [entry('DP-1', 0, [])];

    const plan = displayPlan(vanished, after, stale, { now: 10_000, ttlMs: 1000 });
    expect(plan.forget).toEqual([]);
    expect(plan.remember[0]?.connector).toBe('DP-1');
  });
});

describe('primary change (§9, decision 67)', () => {
  it('moves no window between screens; the extra window becomes a float', () => {
    const prev = state(
      [primary, right],
      [
        ws(10, 0, [win(1), win(2)]),
        ws(11, 0, [win(3), null]),
        ws(20, 1, [win(4), null]),
      ],
      10,
    );
    const next = state(
      [screen({ ...primary, isPrimary: false }), screen({ ...right, isPrimary: true })],
      [
        ws(10, 0, [win(1), win(2)]),
        ws(11, 0, [win(3), null]),
        ws(20, 1, [win(4), null]),
      ],
      10,
    );

    const plan = displayPlan(prev, next, [], NO_TTL);

    expect(plan.moves).toEqual([{ id: 3, workspace: 10, float: true }]);
    expect(plan.moves.some((move) => move.id === 1 || move.id === 2 || move.id === 4)).toBe(false);
  });

  it('moves nothing when the old primary had only its surviving workspace', () => {
    const prev = state([primary, right], [ws(10, 0, [win(1), win(2)]), ws(20, 1, [win(4), null])], 10);
    const next = state(
      [screen({ ...primary, isPrimary: false }), screen({ ...right, isPrimary: true })],
      [ws(10, 0, [win(1), win(2)]), ws(20, 1, [win(4), null])],
      10,
    );

    const plan = displayPlan(prev, next, [], NO_TTL);

    expect(plan.moves).toEqual([]);
  });

  it('an unchanged primary produces no plan', () => {
    const prev = state([primary, right], [ws(10, 0, [win(1), win(2)]), ws(20, 1, [win(4), null])], 10);
    const plan = displayPlan(prev, prev, [], NO_TTL);
    expect(plan).toEqual({ moves: [], remember: [], forget: [] });
  });
});
