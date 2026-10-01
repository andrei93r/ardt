// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Replay (§11, §22, §23.19 / Stage 6). A recorded session is the initial model
 * state plus the ordered journal entries and the decisions that were logged
 * alongside them. `replay` feeds the events back through the **pure** planners
 * (`routeNewWindow`, `unmaximizeWindow`, `maximizeWindow`, `reapPlan`,
 * `computePlans`) and returns the decisions the run produced, so a test can
 * assert that a trace replays to **identical** decisions.
 *
 * Determinism is the point (no learned geometry, no timing dependence):
 *
 *   * the events are ordered by their monotonic `seq` alone — `at` is never
 *     read, so a trace retimed or reordered on the wire replays the same;
 *   * every decision is derived from the model, never from a clock;
 *   * `sameDecisions` compares two decision runs field by field, ignoring only
 *     the `at` timestamp, so "differs only in timing" is a checkable property.
 *
 * The trace format is deliberately small and explicit — it mirrors the journal
 * shape (`{ seq, source, event, at, ...fields }`, `adapters/gnome/journal.ts`)
 * so a real recording is a projection of the journal, and it is reducer-shaped
 * so a hand-written fixture is a few lines.
 */

import type { Axis, Direction, Placement, ScreenClass, State, Win, Ws } from './placement.js';
import { maximizeWindow, routeNewWindow, unmaximizeWindow, windowCount } from './placement.js';
import type { ReapPlan } from './workspaces.js';
import { reapPlan } from './workspaces.js';
import type { TilerConfig, TilerWindow } from './tiler.js';
import { computePlans } from './tiler.js';
import type { Rect, Screen, Size } from './types.js';
import { SurfaceKind } from './types.js';

/** One workspace of the initial state: the visible slots and the hidden windows. */
export interface TraceWorkspace {
  id: number;
  slots: [number | null, number | null];
  /** Window ids hidden in this workspace, in order. */
  minimized?: number[];
  /** Window ids floating on this workspace (§6). A float pins it (§5). */
  floats?: number[];
}

/**
 * One window of the initial state, or the payload of a `window-opened` event:
 * its identity, its screen and its geometry. Placement is expressed by the
 * workspace that references it; `maximized`/`fullscreen` are the §4 flags the
 * planners read.
 */
export interface TraceWindow {
  id: number;
  appId: string;
  title?: string;
  kind?: SurfaceKind;
  screenId: number;
  rect: Rect;
  min?: Size;
  max?: Size;
  maximized?: boolean;
  fullscreen?: boolean;
}

export interface TraceInitial {
  /** The workspace the user is on. */
  viewed: number;
  workspaces: TraceWorkspace[];
  windows: TraceWindow[];
}

/** A journal entry: raw platform event or a decision (mirrors `journal.ts`). */
export interface TraceEntry {
  seq: number;
  source: string;
  event: string;
  at: number;
  [field: string]: unknown;
}

/** A recorded session: the initial state, the ordered events and the decisions. */
export interface Trace {
  version: number;
  initial: TraceInitial;
  events: TraceEntry[];
  /** The decisions logged alongside the events, when the trace is a recording. */
  decisions?: TraceEntry[];
}

export interface ReplayEnv {
  screen: ScreenClass;
  axis: Axis;
  /** The monitor the planners size against (`Screen` geometry/work area/scale). */
  monitor: Screen;
  /** Tiler config for geometry plans; gaps and ratios default to the model's. */
  config?: TilerConfig;
}

/** A decision is a journal entry with `source: 'decision'`. */
export type Decision = TraceEntry;

const DEFAULT_CONFIG: TilerConfig = {
  gapBase: 0,
  gapPortrait: -1,
  gapLandscape: -1,
  minSizePolicy: 'respect',
  primaryApps: [],
  primaryAppRatio: 0.5,
  ratios: {},
  swapPairs: new Set(),
  rules: [],
};

interface Runtime {
  workspaces: Ws[];
  viewed: number;
  windows: Map<number, TraceWindow>;
}

function stateOf(runtime: Runtime): State {
  return { workspaces: runtime.workspaces, viewed: runtime.viewed };
}

function envOf(env: ReplayEnv): { screen: ScreenClass; axis: Axis } {
  return { screen: env.screen, axis: env.axis };
}

function readNumber(entry: TraceEntry, key: string): number | null {
  const value = entry[key];
  return typeof value === 'number' ? value : null;
}

function readString(entry: TraceEntry, key: string): string | null {
  const value = entry[key];
  return typeof value === 'string' ? value : null;
}

function readRect(entry: TraceEntry, key: string): Rect | null {
  const value = entry[key];
  if (typeof value !== 'object' || value === null) return null;
  const rect = value as Partial<Rect>;
  if (
    typeof rect.x === 'number' &&
    typeof rect.y === 'number' &&
    typeof rect.width === 'number' &&
    typeof rect.height === 'number'
  ) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  return null;
}

function readSize(entry: TraceEntry, key: string): Size | null {
  const value = entry[key];
  if (typeof value !== 'object' || value === null) return null;
  const size = value as Partial<Size>;
  if (typeof size.width === 'number' && typeof size.height === 'number') {
    return { width: size.width, height: size.height };
  }
  return null;
}

function readDirection(entry: TraceEntry): Direction | null {
  const value = entry['from'];
  if (value === 'left' || value === 'right' || value === 'above' || value === 'below') return value;
  return null;
}

function readKind(entry: TraceEntry, fallback: SurfaceKind): SurfaceKind {
  const value = entry['kind'];
  if (typeof value === 'string' && (Object.values(SurfaceKind) as string[]).includes(value)) {
    return value as SurfaceKind;
  }
  return fallback;
}

function toWin(record: TraceWindow | undefined, id: number, extra: Partial<Win> = {}): Win {
  return {
    id,
    maximized: record?.maximized ?? false,
    fullscreen: record?.fullscreen ?? false,
    ...extra,
  };
}

function buildRuntime(initial: TraceInitial): Runtime {
  const windows = new Map<number, TraceWindow>();
  for (const record of initial.windows) windows.set(record.id, record);
  const workspaces: Ws[] = initial.workspaces.map((workspace) => ({
    id: workspace.id,
    slots: [
      workspace.slots[0] === null ? null : toWin(windows.get(workspace.slots[0]), workspace.slots[0]),
      workspace.slots[1] === null ? null : toWin(windows.get(workspace.slots[1]), workspace.slots[1]),
    ],
    minimized: (workspace.minimized ?? []).map((id) => toWin(windows.get(id), id, { minimized: true })),
    floats: (workspace.floats ?? []).map((id) => toWin(windows.get(id), id, { floating: true })),
  }));
  return { workspaces, viewed: initial.viewed, windows };
}

/** Merge a `window-opened` payload into the window table, keeping prior fields. */
function upsertWindow(runtime: Runtime, id: number, entry: TraceEntry): TraceWindow {
  const existing = runtime.windows.get(id);
  const record: TraceWindow = {
    id,
    appId: readString(entry, 'appId') ?? existing?.appId ?? `window:${id}`,
    title: readString(entry, 'title') ?? existing?.title,
    kind: readKind(entry, existing?.kind ?? SurfaceKind.NORMAL),
    screenId: readNumber(entry, 'screenId') ?? existing?.screenId ?? 0,
    rect: readRect(entry, 'rect') ?? existing?.rect ?? { x: 0, y: 0, width: 0, height: 0 },
    min: readSize(entry, 'min') ?? existing?.min,
    max: readSize(entry, 'max') ?? existing?.max,
    maximized: existing?.maximized ?? false,
    fullscreen: existing?.fullscreen ?? false,
  };
  runtime.windows.set(id, record);
  return record;
}

type Location =
  | { ws: number; where: 'slot'; slot: 0 | 1 }
  | { ws: number; where: 'minimized' }
  | { ws: number; where: 'float' };

function locate(runtime: Runtime, id: number): Location | null {
  for (let index = 0; index < runtime.workspaces.length; index++) {
    const workspace = runtime.workspaces[index];
    if (workspace.slots[0]?.id === id) return { ws: index, where: 'slot', slot: 0 };
    if (workspace.slots[1]?.id === id) return { ws: index, where: 'slot', slot: 1 };
    if (workspace.minimized.some((win) => win.id === id)) return { ws: index, where: 'minimized' };
    if (workspace.floats?.some((win) => win.id === id) === true) return { ws: index, where: 'float' };
  }
  return null;
}

/** Remove a window from wherever it sits and return its record. */
function takeWin(runtime: Runtime, id: number): Win | null {
  const location = locate(runtime, id);
  if (location === null) return null;
  const workspace = runtime.workspaces[location.ws];
  if (location.where === 'slot') {
    const win = workspace.slots[location.slot];
    workspace.slots[location.slot] = null;
    return win;
  }
  if (location.where === 'minimized') {
    const index = workspace.minimized.findIndex((win) => win.id === id);
    return index >= 0 ? workspace.minimized.splice(index, 1)[0] : null;
  }
  if (workspace.floats === undefined) return null;
  const index = workspace.floats.findIndex((win) => win.id === id);
  return index >= 0 ? workspace.floats.splice(index, 1)[0] : null;
}

/** Minimize a visible window in place (§4): it releases its slot (§5). */
function minimizeInPlace(runtime: Runtime, id: number): void {
  const location = locate(runtime, id);
  if (location === null || location.where !== 'slot') return;
  const win = takeWin(runtime, id);
  if (win === null) return;
  runtime.workspaces[location.ws].minimized.push({ ...win, minimized: true });
}

function tilerWindow(runtime: Runtime, workspaceIndex: number, id: number, slot: 0 | 1): TilerWindow {
  const record = runtime.windows.get(id);
  return {
    id,
    appId: record?.appId ?? `window:${id}`,
    title: record?.title ?? '',
    kind: record?.kind ?? SurfaceKind.NORMAL,
    rect: record?.rect ?? { x: 0, y: 0, width: 0, height: 0 },
    min: record?.min ?? { width: 0, height: 0 },
    max: record?.max ?? { width: 0, height: 0 },
    screenId: record?.screenId ?? 0,
    workspaceId: runtime.workspaces[workspaceIndex].id,
    slot,
  };
}

/** Create an empty workspace at `at` (the trailing spare is pushed right, §3). */
function insertWorkspace(runtime: Runtime, at: number): number {
  const id = runtime.workspaces.reduce((max, workspace) => Math.max(max, workspace.id), -1) + 1;
  const index = Math.max(0, Math.min(at, runtime.workspaces.length));
  runtime.workspaces.splice(index, 0, { id, slots: [null, null], minimized: [], floats: [] });
  return index;
}

/**
 * Apply a placement to the runtime model. The view policy is here too (§3): a
 * workspace created for the viewed workspace moves the view onto it; one created
 * elsewhere only shifts the viewed index.
 */
function applyPlacement(runtime: Runtime, placement: Placement, id: number): void {
  const preView = runtime.viewed;
  const target = placement.workspace;
  let index = target;
  if (placement.createRight === true) index = insertWorkspace(runtime, target + 1);
  const workspace = runtime.workspaces[index];
  if (workspace === undefined) return;
  takeWin(runtime, id);
  const record = runtime.windows.get(id);
  if (placement.float === true) {
    (workspace.floats ??= []).push({
      id,
      minimized: false,
      floating: true,
      maximized: record?.maximized ?? false,
      fullscreen: record?.fullscreen ?? false,
    });
  } else {
    if (placement.minimize !== undefined) {
      for (const victim of placement.minimize) if (victim !== id) minimizeInPlace(runtime, victim);
    }
    if (placement.minimize?.includes(id) === true) {
      workspace.minimized.push({ id, minimized: true });
    } else {
      const slot = placement.slot ?? 0;
      workspace.slots[slot] = { id, maximized: placement.maximize === true };
    }
  }
  if (placement.createRight === true) {
    if (target === preView) runtime.viewed = index;
    else if (index <= preView) runtime.viewed = preView + 1;
  }
}

/** The nearest workspace left first, then right, that still holds windows (§5). */
function nearestLoaded(runtime: Runtime, from: number, reaped: Set<number>): number | null {
  for (let index = from - 1; index >= 0; index--) {
    if (!reaped.has(index) && windowCount(runtime.workspaces[index]) > 0) return index;
  }
  for (let index = from + 1; index < runtime.workspaces.length; index++) {
    if (!reaped.has(index) && windowCount(runtime.workspaces[index]) > 0) return index;
  }
  return null;
}

/** An index in the old list, remapped after the reaped indexes are removed. */
function remap(index: number, reaped: Set<number>): number {
  let shift = 0;
  for (let i = 0; i < index; i++) if (reaped.has(i)) shift++;
  return index - shift;
}

/**
 * Reaping is a property, not an event (§5): after every mutation, any empty
 * workspace other than the spare is removed and a workspace holding only
 * minimized windows relocates its occupant first. If the viewed workspace is
 * reaped, the view moves to the nearest workspace that holds windows.
 */
function reap(runtime: Runtime, event: TraceEntry, decisions: Decision[]): void {
  const plan: ReapPlan = reapPlan(stateOf(runtime));
  if (plan.reap.length === 0 && plan.relocate.length === 0) return;
  const preView = runtime.viewed;
  const reaped = new Set(plan.reap);
  let newView = preView;
  if (reaped.has(preView)) {
    const nearest = nearestLoaded(runtime, preView, reaped);
    if (nearest !== null) newView = nearest;
  }
  const relocate: { id: number; to: number }[] = [];
  for (const move of plan.relocate) {
    const win = takeWin(runtime, move.id);
    const target = runtime.workspaces[move.to];
    if (win === null || target === undefined) continue;
    target.minimized.push({ ...win, minimized: true });
    relocate.push(move);
  }
  for (let index = plan.reap.length - 1; index >= 0; index--) runtime.workspaces.splice(plan.reap[index], 1);
  runtime.viewed = remap(newView, reaped);
  const fields: Record<string, unknown> = { reap: plan.reap, relocate };
  if (runtime.viewed !== preView) fields.view = runtime.viewed;
  decisions.push(decision(event, 'reapPlan', fields));
}

function decision(event: TraceEntry, name: string, fields: Record<string, unknown>): Decision {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) clean[key] = value;
  return { seq: event.seq, source: 'decision', event: name, at: event.at, ...clean };
}

function placementDecision(
  event: TraceEntry,
  name: string,
  id: number,
  placement: Placement,
  view: number | undefined,
): Decision {
  return decision(event, name, {
    window: id,
    workspace: placement.workspace,
    slot: placement.slot,
    createRight: placement.createRight,
    maximize: placement.maximize,
    inPlace: placement.inPlace,
    float: placement.float,
    minimize: placement.minimize,
    note: placement.note,
    view,
  });
}

function layout(runtime: Runtime, event: TraceEntry, env: ReplayEnv, config: TilerConfig, decisions: Decision[]): void {
  for (let index = 0; index < runtime.workspaces.length; index++) {
    const workspace = runtime.workspaces[index];
    const windows: TilerWindow[] = [];
    if (workspace.slots[0] !== null) windows.push(tilerWindow(runtime, index, workspace.slots[0].id, 0));
    if (workspace.slots[1] !== null) windows.push(tilerWindow(runtime, index, workspace.slots[1].id, 1));
    if (windows.length === 0) continue;
    const plan = computePlans(windows, env.monitor, config);
    decisions.push(decision(event, 'computePlans', { workspace: workspace.id, plan }));
  }
}

/**
 * Feed a recorded trace's events through the pure planners and return the
 * decisions. Events are ordered by `seq`; `at` is never consulted, and nothing
 * is learned, so the same trace always produces the same decisions.
 */
export function replay(trace: Trace, env: ReplayEnv): Decision[] {
  const runtime = buildRuntime(trace.initial);
  const config = env.config ?? DEFAULT_CONFIG;
  const decisions: Decision[] = [];
  const events = [...trace.events].sort((a, b) => a.seq - b.seq);
  for (const event of events) {
    const id = readNumber(event, 'id');
    switch (event.event) {
      case 'window-opened': {
        if (id === null) break;
        upsertWindow(runtime, id, event);
        const placement = routeNewWindow(
          stateOf(runtime),
          envOf(env),
          toWin(runtime.windows.get(id), id),
          readDirection(event),
          readNumber(event, 'workspace'),
          event['doesNotFit'] === true,
        );
        const preView = runtime.viewed;
        applyPlacement(runtime, placement, id);
        decisions.push(
          placementDecision(event, 'routeNewWindow', id, placement, runtime.viewed !== preView ? runtime.viewed : undefined),
        );
        reap(runtime, event, decisions);
        break;
      }
      case 'window-closed': {
        if (id === null) break;
        takeWin(runtime, id);
        runtime.windows.delete(id);
        reap(runtime, event, decisions);
        break;
      }
      case 'window-unmaximized': {
        if (id === null) break;
        const placement = unmaximizeWindow(
          stateOf(runtime),
          envOf(env),
          readNumber(event, 'workspace') ?? runtime.viewed,
          id,
        );
        const preView = runtime.viewed;
        applyPlacement(runtime, placement, id);
        decisions.push(
          placementDecision(event, 'unmaximizeWindow', id, placement, runtime.viewed !== preView ? runtime.viewed : undefined),
        );
        reap(runtime, event, decisions);
        break;
      }
      case 'window-maximized': {
        if (id === null) break;
        const placement = maximizeWindow(
          stateOf(runtime),
          envOf(env),
          readNumber(event, 'workspace') ?? runtime.viewed,
        );
        const preView = runtime.viewed;
        applyPlacement(runtime, placement, id);
        decisions.push(
          placementDecision(event, 'maximizeWindow', id, placement, runtime.viewed !== preView ? runtime.viewed : undefined),
        );
        reap(runtime, event, decisions);
        break;
      }
      case 'window-minimized': {
        if (id === null) break;
        minimizeInPlace(runtime, id);
        reap(runtime, event, decisions);
        break;
      }
      case 'layout': {
        layout(runtime, event, env, config, decisions);
        break;
      }
      default:
        // Unknown events are deterministically ignored.
        break;
    }
  }
  return decisions;
}

function stripAt(entry: TraceEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) if (key !== 'at') out[key] = value;
  return out;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).filter((key) => object[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

/**
 * Whether two decision runs are identical. Everything is compared — sequence,
 * planner, workspace, slots, notes, geometry — **except `at`**, because a
 * decision must not depend on when its event happened (§23.19).
 */
export function sameDecisions(a: readonly Decision[], b: readonly Decision[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (canonical(stripAt(a[index])) !== canonical(stripAt(b[index]))) return false;
  }
  return true;
}
