// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { replay, sameDecisions } from '../../src/core/replay.js';
import type { ReplayEnv, Trace, TraceEntry, TraceWindow, TraceWorkspace } from '../../src/core/replay.js';
import type { ScreenClass } from '../../src/core/placement.js';
import type { TilerConfig } from '../../src/core/tiler.js';
import { SurfaceKind } from '../../src/core/types.js';
import { rect, screen, size } from './helpers.js';

function config(overrides: Partial<TilerConfig> = {}): TilerConfig {
  return {
    gapBase: 0,
    gapPortrait: -1,
    gapLandscape: -1,
    minSizePolicy: 'respect',
    primaryApps: [],
    primaryAppRatio: 0.5,
    ratios: {},
    swapPairs: new Set(),
    rules: [],
    ...overrides,
  };
}

const monitor = screen({ geometry: rect(0, 0, 1920, 1080) });

function env(screenClass: ScreenClass = 'dynamic'): ReplayEnv {
  return { screen: screenClass, axis: 'horizontal', monitor, config: config({ gapBase: 8 }) };
}

function win(id: number, over: Partial<TraceWindow> = {}): TraceWindow {
  return {
    id,
    appId: `app${id}`,
    title: `window ${id}`,
    kind: SurfaceKind.NORMAL,
    screenId: 0,
    rect: rect(0, 0, 800, 600),
    min: size(100, 100),
    max: size(10000, 10000),
    ...over,
  };
}

function ws(
  id: number,
  slots: [number | null, number | null] = [null, null],
  minimized: number[] = [],
  floats: number[] = [],
): TraceWorkspace {
  return { id, slots, minimized, floats };
}

function event(seq: number, name: string, fields: Record<string, unknown> = {}, at = seq * 1000): TraceEntry {
  return { seq, source: 'gnome', event: name, at, ...fields };
}

function trace(initial: Trace['initial'], events: TraceEntry[], decisions?: TraceEntry[]): Trace {
  return { version: 1, initial, events, decisions };
}

describe('replay — routing (§3)', () => {
  it('routes two windows as a split and creates a workspace to the right for the third', () => {
    const t = trace(
      { viewed: 0, workspaces: [ws(0, [1, null]), ws(1)], windows: [win(1, { maximized: true })] },
      [
        event(1, 'window-opened', { id: 2, workspace: 0 }),
        event(2, 'layout'),
        event(3, 'window-opened', { id: 3, workspace: 0 }),
        event(4, 'layout'),
      ],
    );

    const decisions = replay(t, env());
    expect(decisions.map((d) => d.event)).toEqual([
      'routeNewWindow',
      'computePlans',
      'routeNewWindow',
      'computePlans',
      'computePlans',
    ]);

    // The second window splits the maximized single into slot 1.
    expect(decisions[0]).toMatchObject({ window: 2, workspace: 0, slot: 1, note: 'right-slot' });
    // The pair is then a real two-window plan.
    expect((decisions[1]['plan'] as { placements: unknown[] }).placements).toHaveLength(2);

    // The third finds both slots taken: its own workspace immediately right,
    // maximized there, and the view follows it.
    expect(decisions[2]).toMatchObject({
      window: 3,
      workspace: 0,
      slot: 1,
      createRight: true,
      maximize: true,
      note: 'workspace-created',
      view: 1,
    });

    // The new workspace (id 2, pushed in before the spare) holds window 3 alone.
    const newWorkspace = decisions[4];
    expect(newWorkspace).toMatchObject({ event: 'computePlans', workspace: 2 });
    expect((newWorkspace['plan'] as { placements: { surfaceId: number }[] }).placements.map((p) => p.surfaceId)).toEqual([3]);
  });

  it('maximizes a lone arrival on an empty viewed workspace (§4 lone law)', () => {
    const t = trace(
      { viewed: 0, workspaces: [ws(0), ws(1)], windows: [] },
      [event(1, 'window-opened', { id: 1, workspace: 0 })],
    );
    const [decision] = replay(t, env());
    expect(decision).toMatchObject({ event: 'routeNewWindow', window: 1, workspace: 0, slot: 1, maximize: true });
  });
});

describe('replay — emptiness and reaping (§5)', () => {
  it('reaps an emptied workspace and moves the view to the nearest one that holds windows', () => {
    const t = trace(
      { viewed: 1, workspaces: [ws(0, [1, null]), ws(1, [2, null]), ws(2)], windows: [win(1), win(2, { maximized: true })] },
      [event(1, 'window-closed', { id: 2 }), event(2, 'layout')],
    );

    const decisions = replay(t, env());
    expect(decisions[0]).toMatchObject({ event: 'reapPlan', reap: [1], view: 0 });
    // Only window 1 is left, alone, so the layout is a single placement.
    expect(decisions[1]).toMatchObject({ event: 'computePlans', workspace: 0 });
    expect((decisions[1]['plan'] as { placements: unknown[] }).placements).toHaveLength(1);
  });

  it('keeps a workspace that still holds a survivor, and reaps nothing', () => {
    const t = trace(
      { viewed: 0, workspaces: [ws(0, [1, 2]), ws(1)], windows: [win(1), win(2)] },
      [event(1, 'window-closed', { id: 2 }), event(2, 'layout')],
    );
    const decisions = replay(t, env());
    expect(decisions.map((d) => d.event)).toEqual(['computePlans']);
    expect((decisions[0]['plan'] as { placements: unknown[] }).placements).toHaveLength(1);
  });

  it('relocates the occupant of a workspace that only holds a minimized window, then reaps it', () => {
    const t = trace(
      { viewed: 1, workspaces: [ws(0, [1, null]), ws(1, [2, null]), ws(2)], windows: [win(1), win(2)] },
      [event(1, 'window-minimized', { id: 2 })],
    );
    const [decision] = replay(t, env());
    expect(decision).toMatchObject({ event: 'reapPlan', reap: [1], relocate: [{ id: 2, to: 0 }], view: 0 });
  });
});

describe('replay — unmaximize (§4)', () => {
  it('joins the left neighbour when it holds exactly one window, into slot 1', () => {
    const t = trace(
      { viewed: 1, workspaces: [ws(0, [1, null]), ws(1, [2, null]), ws(2)], windows: [win(1), win(2, { maximized: true })] },
      [event(1, 'window-unmaximized', { id: 2, workspace: 1 })],
    );
    const decisions = replay(t, env());
    expect(decisions[0]).toMatchObject({ event: 'unmaximizeWindow', window: 2, workspace: 0, slot: 1, note: 'unmaximize-joins-left' });
    // The workspace it left is empty and reaped, and the view moves onto the pair.
    expect(decisions[1]).toMatchObject({ event: 'reapPlan', reap: [1], view: 0 });
  });

  it('joins the right neighbour when the left cannot pair', () => {
    const t = trace(
      {
        viewed: 1,
        workspaces: [ws(0, [1, 3]), ws(1, [2, null]), ws(2, [4, null]), ws(3)],
        windows: [win(1), win(2, { maximized: true }), win(3), win(4)],
      },
      [event(1, 'window-unmaximized', { id: 2, workspace: 1 })],
    );
    const decisions = replay(t, env());
    expect(decisions[0]).toMatchObject({ event: 'unmaximizeWindow', window: 2, workspace: 2, slot: 1, note: 'unmaximize-joins-right' });
    expect(decisions[1]).toMatchObject({ event: 'reapPlan', reap: [1], view: 0 });
  });

  it('parks the window minimized in the left neighbour when neither neighbour can pair', () => {
    const t = trace(
      {
        viewed: 1,
        workspaces: [ws(0, [1, 3]), ws(1, [2, null]), ws(2, [4, 5]), ws(3)],
        windows: [win(1), win(2, { maximized: true }), win(3), win(4), win(5)],
      },
      [event(1, 'window-unmaximized', { id: 2, workspace: 1 })],
    );
    const decisions = replay(t, env());
    expect(decisions[0]).toMatchObject({ event: 'unmaximizeWindow', window: 2, workspace: 0, minimize: [2], note: 'unmaximize-parks-left' });
    expect(decisions[1]).toMatchObject({ event: 'reapPlan', reap: [1], view: 0 });
  });
});

describe('replay — determinism (§11, §23.19)', () => {
  const t = trace(
    { viewed: 0, workspaces: [ws(0, [1, null]), ws(1)], windows: [win(1, { maximized: true })] },
    [
      event(1, 'window-opened', { id: 2, workspace: 0 }),
      event(2, 'window-opened', { id: 3, workspace: 0 }),
      event(3, 'window-opened', { id: 4, workspace: 0 }),
      event(4, 'window-closed', { id: 2 }),
      event(5, 'window-unmaximized', { id: 4, workspace: 1 }),
      event(6, 'layout'),
    ],
  );

  it('replays a recorded trace to identical decisions', () => {
    const recorded = trace(t.initial, t.events, replay(t, env()));
    expect(sameDecisions(replay(recorded, env()), recorded.decisions ?? [])).toBe(true);
  });

  it('replays the same trace twice to the same decisions', () => {
    expect(sameDecisions(replay(t, env()), replay(t, env()))).toBe(true);
  });

  it('ignores timing: a trace differing only in its `at` fields (and order) replays the same', () => {
    const retimed = trace(
      t.initial,
      [...t.events].reverse().map((entry, index) => ({ ...entry, at: 9_000_000 - index * 7 })),
    );
    expect(sameDecisions(replay(t, env()), replay(retimed, env()))).toBe(true);
  });
});

describe('sameDecisions', () => {
  it('distinguishes runs on different screen classes', () => {
    const t = trace(
      { viewed: 0, workspaces: [ws(0, [1, null]), ws(1)], windows: [win(1, { maximized: true })] },
      [event(1, 'window-opened', { id: 2, workspace: 0 }), event(2, 'window-opened', { id: 3, workspace: 0 })],
    );
    // A dynamic screen creates a workspace; a single-workspace screen floats.
    expect(sameDecisions(replay(t, env('dynamic')), replay(t, env('single')))).toBe(false);
  });

  it('treats only the `at` field as insignificant', () => {
    const base = event(1, 'window-opened', { id: 2, workspace: 0 });
    const a = [base];
    const retimed = [{ ...base, at: base.at + 12345 }];
    expect(sameDecisions(a, retimed)).toBe(true);
    const changed = [{ ...base, slot: 0 }];
    expect(sameDecisions(a, changed)).toBe(false);
  });
});
