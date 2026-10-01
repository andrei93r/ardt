// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Displays and docking (§9, decisions 17/36/40/66/67).
 *
 * Pure: it compares the screen list and workspace arrangements before and after
 * a hardware/primary change and returns a decision — which windows to move
 * where, which screen memory to (re)write, and which memory to drop. The adapter
 * turns that into Mutter calls.
 *
 * The rules, in one place:
 *   * **Disconnect** — a vanished screen's windows move to the primary, grouped
 *     into as many fresh workspaces as the source workspaces need (two windows
 *     per workspace), inserted adjacent to the current workspace on the physical
 *     side the screen was on (right → right; left, above, below → left, leftmost
 *     when other screens were already to the left). The arrangement is kept: a
 *     pair stays a pair, a single stays a single, minimized stays minimized, a
 *     float stays a float, fullscreen is preserved. It never scavenges a free
 *     slot on a workspace that was not the vanished screen's, and the view never
 *     moves.
 *   * **Reconnect** — a remembered connector replays its previous state: slots,
 *     minimized, floats and fullscreen, matched by instance id, clamped by the
 *     adapter into the fresh work area. It never floats a window and never
 *     creates beyond what memory holds; a window opened while the screen was
 *     away is not in memory and is left alone.
 *   * **Memory** is keyed by connector, with a TTL (`forget`).
 *   * **Primary** — adrt never sets it; a primary change is followed, not
 *     caused. It moves no window between screens: the screen that loses
 *     workspace capability shows everything it held at once, and the extra
 *     windows from its other workspaces become **floats** over the pair that
 *     stays (decision 67).
 *   * The screen class (dynamic / single / fixed) is read from GNOME
 *     (`env.classes`), never inferred from internal vs external.
 */

import type { Rect, Screen } from './types.js';
import type { ScreenClass } from './placement.js';

/** The physical side a rescued workspace is inserted on. */
export type DisplaySide = 'left' | 'right';

/** One window as the arrangement records it (only what §9 needs). */
export interface DisplayWindow {
  id: number;
  maximized?: boolean;
  fullscreen?: boolean;
  /** Last known rect; used by the memory and by float replay. */
  rect?: Rect;
}

/** One workspace of a screen: visible slots plus hidden windows. */
export interface DisplayWorkspace {
  id: number;
  /** Index of the screen displaying this workspace. */
  screen: number;
  slots: [DisplayWindow | null, DisplayWindow | null];
  minimized: DisplayWindow[];
  floats?: DisplayWindow[];
}

/** A snapshot of the displays: the screens and every workspace's arrangement. */
export interface DisplayState {
  screens: Screen[];
  workspaces: DisplayWorkspace[];
  /** Id of the workspace the user is viewing (never changed here). */
  viewed: number;
}

/** A window §9 remembers, keyed by the connector entry that holds it. */
export interface RememberedWindow {
  id: number;
  /** Ordinal of the workspace within the connector's workspace list. */
  workspace: number;
  /** The slot it held while visible; absent for a minimized window. */
  slot?: 0 | 1;
  minimized: boolean;
  floating: boolean;
  maximized: boolean;
  fullscreen: boolean;
  rect: Rect;
}

/** The remembered arrangement of one connector. */
export interface MemoryEntry {
  connector: string;
  /** Timestamp the entry was last written, for the TTL. */
  at: number;
  windows: RememberedWindow[];
}

export type DisplayMemory = readonly MemoryEntry[];

/**
 * A workspace the plan asks to create. Windows that share a `key` share the
 * workspace; the plan emits them in source order.
 */
export interface NewWorkspace {
  /** Placeholder id (negative, unique within the plan) grouping its windows. */
  key: number;
  /** Insert relative to this existing workspace id (the current one). */
  anchor: number;
  side: DisplaySide;
  /** Insert before every other workspace, not merely left of the anchor. */
  leftmost?: boolean;
  /** Index of the screen that creates it (the primary). */
  screen: number;
}

/** One window the drain should move. */
export interface DisplayMove {
  id: number;
  /** Target workspace id, when it already exists. */
  workspace?: number;
  /** A workspace to create for this window. */
  create?: NewWorkspace;
  slot?: 0 | 1;
  /** Arrive minimized (a rescued or replayed minimized window). */
  minimize?: boolean;
  /** Arrive as a float (a primary change's extra window, or a float replay). */
  float?: boolean;
  /** Keep the window fullscreen on arrival (decision 88). */
  fullscreen?: boolean;
  /** Arrive alone on its workspace, so it is maximized. */
  maximize?: boolean;
}

/** Read-from-GNOME context the policy needs but the arrangement does not hold. */
export interface DisplayEnv {
  /** Wall clock used for the memory TTL. */
  now: number;
  /** How long a remembered connector survives (§9, default 30 min). */
  ttlMs: number;
  /**
   * GNOME's class per connector (§1). Defaults to the GNOME default of
   * `dynamic` on the primary screen and `single` elsewhere; adrt never infers
   * the class itself.
   */
  classes?: Readonly<Record<string, ScreenClass>>;
  /**
   * Instance ids that still exist in the session. Memory windows that are gone
   * are dropped; omitted means "every remembered window still exists".
   */
  alive?: readonly number[];
}

/** What the drain should do after a display change (§9). */
export interface DisplayPlan {
  moves: DisplayMove[];
  /** Memory entries to write (upsert), keyed by connector. */
  remember: MemoryEntry[];
  /** Connectors whose memory is gone (TTL, or nothing left to replay). */
  forget: string[];
}

/** Whether a workspace holds anything at all (visible, minimized or floating). */
export function holdsWindows(ws: DisplayWorkspace): boolean {
  return (
    ws.slots[0] !== null ||
    ws.slots[1] !== null ||
    ws.minimized.length > 0 ||
    (ws.floats?.length ?? 0) > 0
  );
}

/** Every window of a workspace, visible first, then minimized, then floats. */
export function workspaceWindows(ws: DisplayWorkspace): DisplayWindow[] {
  const windows: DisplayWindow[] = [];
  for (const slot of ws.slots) if (slot !== null) windows.push(slot);
  windows.push(...ws.minimized);
  windows.push(...(ws.floats ?? []));
  return windows;
}

/** How many windows are visible in a workspace's two slots (§5). */
export function visibleCount(ws: DisplayWorkspace): number {
  return (ws.slots[0] === null ? 0 : 1) + (ws.slots[1] === null ? 0 : 1);
}

/** The workspaces a screen displays, in order. */
export function screenWorkspaces(state: DisplayState, screen: number): DisplayWorkspace[] {
  return state.workspaces.filter((ws) => ws.screen === screen);
}

function primaryOf(state: DisplayState): Screen | null {
  return state.screens.find((screen) => screen.isPrimary) ?? null;
}

function classOf(screen: Screen, env: DisplayEnv): ScreenClass {
  return env.classes?.[screen.connector] ?? (screen.isPrimary ? 'dynamic' : 'single');
}

/** Every connector in a screen list. */
function connectors(screens: readonly Screen[]): Set<string> {
  const set = new Set<string>();
  for (const screen of screens) set.add(screen.connector);
  return set;
}

/** Every window id the arrangement currently displays. */
function displayedIds(state: DisplayState): Set<number> {
  const ids = new Set<number>();
  for (const ws of state.workspaces) {
    for (const win of workspaceWindows(ws)) ids.add(win.id);
  }
  return ids;
}

/** The physical side the vanished screen sat on, and whether to insert leftmost. */
export function rescueSide(
  vanished: Screen,
  primary: Screen,
  screens: readonly Screen[],
): { side: DisplaySide; leftmost: boolean } {
  const vanishedX = vanished.geometry.x + vanished.geometry.width / 2;
  const primaryX = primary.geometry.x + primary.geometry.width / 2;
  if (vanishedX > primaryX) return { side: 'right', leftmost: false };
  const leftmost = screens.some(
    (screen) => screen !== vanished && screen !== primary && screen.geometry.x + screen.geometry.width / 2 < primaryX,
  );
  return { side: 'left', leftmost };
}

/** The remembered arrangement of one screen. */
function snapshot(connector: string, state: DisplayState, screen: number, at: number): MemoryEntry {
  const windows: RememberedWindow[] = [];
  screenWorkspaces(state, screen).forEach((ws, ordinal) => {
    ws.slots.forEach((win, slot) => {
      if (win === null) return;
      windows.push({
        id: win.id,
        workspace: ordinal,
        slot: slot as 0 | 1,
        minimized: false,
        floating: false,
        maximized: win.maximized === true,
        fullscreen: win.fullscreen === true,
        rect: win.rect ?? { x: 0, y: 0, width: 0, height: 0 },
      });
    });
    for (const win of ws.minimized) {
      windows.push({
        id: win.id,
        workspace: ordinal,
        minimized: true,
        floating: false,
        maximized: win.maximized === true,
        fullscreen: win.fullscreen === true,
        rect: win.rect ?? { x: 0, y: 0, width: 0, height: 0 },
      });
    }
    for (const win of ws.floats ?? []) {
      windows.push({
        id: win.id,
        workspace: ordinal,
        minimized: false,
        floating: true,
        maximized: win.maximized === true,
        fullscreen: win.fullscreen === true,
        rect: win.rect ?? { x: 0, y: 0, width: 0, height: 0 },
      });
    }
  });
  return { connector, at, windows };
}

/** The move a replayed remembered window gets, or null when it cannot land. */
function replayMove(rw: RememberedWindow, target: DisplayWorkspace): DisplayMove | null {
  if (rw.floating) {
    return {
      id: rw.id,
      workspace: target.id,
      float: true,
      ...(rw.fullscreen ? { fullscreen: true } : {}),
    };
  }
  if (rw.minimized) {
    return {
      id: rw.id,
      workspace: target.id,
      minimize: true,
      ...(rw.fullscreen ? { fullscreen: true } : {}),
    };
  }
  const slot: 0 | 1 = rw.slot === 0 ? 0 : 1;
  const occupant = target.slots[slot];
  if (occupant !== null) return null; // the slot was taken meanwhile; partial replay
  return {
    id: rw.id,
    workspace: target.id,
    slot,
    ...(rw.fullscreen ? { fullscreen: true } : {}),
  };
}

/**
 * The display plan (§9). Pure: no compositor tokens, no side effects — the
 * adapter applies `moves`, persists `remember` and drops `forget`.
 */
export function displayPlan(
  prev: DisplayState,
  next: DisplayState,
  memory: DisplayMemory,
  env: DisplayEnv,
): DisplayPlan {
  const moves: DisplayMove[] = [];
  const remember: MemoryEntry[] = [];
  const forget: string[] = [];

  const prevConnectors = connectors(prev.screens);
  const nextConnectors = connectors(next.screens);
  const displayed = displayedIds(next);
  const aliveSet = env.alive === undefined ? null : new Set(env.alive);
  const isAlive = (id: number): boolean => aliveSet === null || aliveSet.has(id);

  // --- TTL: memory for a connector that is gone and has expired is dropped ----
  for (const entry of memory) {
    if (nextConnectors.has(entry.connector)) continue;
    if (env.now - entry.at > env.ttlMs) forget.push(entry.connector);
  }

  // --- Disconnect: rescue a vanished screen's windows to the primary ----------
  let createKey = -1; // plan-wide, so two vanished screens never share a key
  for (const screen of prev.screens) {
    if (nextConnectors.has(screen.connector)) continue;
    remember.push(snapshot(screen.connector, prev, screen.index, env.now));

    const primary = primaryOf(next);
    if (primary === null) continue;
    if (classOf(primary, env) !== 'dynamic') continue; // only a screen that can create

    const { side, leftmost } = rescueSide(screen, primary, prev.screens);
    const source = screenWorkspaces(prev, screen.index).filter(holdsWindows);
    for (const ws of source) {
      const create: NewWorkspace = {
        key: createKey,
        anchor: next.viewed,
        side,
        screen: primary.index,
        ...(leftmost ? { leftmost: true } : {}),
      };
      createKey -= 1;
      const lone = visibleCount(ws) === 1;

      ws.slots.forEach((win, slot) => {
        if (win === null) return;
        if (displayed.has(win.id)) return; // a surviving screen already shows it
        moves.push({
          id: win.id,
          create,
          slot: slot as 0 | 1,
          ...(lone ? { maximize: true } : {}),
          ...(win.fullscreen ? { fullscreen: true } : {}),
        });
      });
      for (const win of ws.minimized) {
        if (displayed.has(win.id)) continue;
        moves.push({
          id: win.id,
          create,
          minimize: true,
          ...(win.fullscreen ? { fullscreen: true } : {}),
        });
      }
      for (const win of ws.floats ?? []) {
        if (displayed.has(win.id)) continue;
        moves.push({
          id: win.id,
          create,
          float: true,
          ...(win.fullscreen ? { fullscreen: true } : {}),
        });
      }
    }
  }

  // --- Reconnect: replay a remembered connector's previous state --------------
  for (const entry of memory) {
    if (prevConnectors.has(entry.connector)) continue; // it stayed connected
    const screen = next.screens.find((candidate) => candidate.connector === entry.connector);
    if (screen === undefined) continue; // not reconnected
    if (env.now - entry.at > env.ttlMs) {
      forget.push(entry.connector); // expired: leave it alone and drop it
      continue;
    }

    const workspaces = screenWorkspaces(next, screen.index);
    const replayed: RememberedWindow[] = [];
    for (const rw of entry.windows) {
      if (!isAlive(rw.id)) continue; // the window is gone
      const target = workspaces[rw.workspace];
      if (target === undefined) continue; // never create beyond memory
      const move = replayMove(rw, target);
      if (move !== null) moves.push(move);
      replayed.push(rw);
    }
    if (replayed.length > 0) remember.push({ connector: entry.connector, at: env.now, windows: replayed });
    else forget.push(entry.connector);
  }

  // --- Primary change: follow it; move no window between screens ---------------
  const prevPrimary = primaryOf(prev);
  const nextPrimary = primaryOf(next);
  if (
    prevPrimary !== null &&
    nextPrimary !== null &&
    prevPrimary.connector !== nextPrimary.connector
  ) {
    const old = next.screens.find((candidate) => candidate.connector === prevPrimary.connector);
    if (old !== undefined) {
      const workspaces = screenWorkspaces(next, old.index);
      if (workspaces.length > 0) {
        const viewed = workspaces.find((ws) => ws.id === next.viewed);
        const surviving = viewed ?? workspaces.find(holdsWindows) ?? workspaces[0];
        for (const ws of workspaces) {
          if (ws.id === surviving.id) continue;
          for (const win of workspaceWindows(ws)) {
            moves.push({
              id: win.id,
              workspace: surviving.id,
              float: true,
              ...(win.fullscreen ? { fullscreen: true } : {}),
            });
          }
        }
      }
    }
  }

  // A connector that is being remembered is never also forgotten.
  const remembered = new Set(remember.map((entry) => entry.connector));
  return { moves, remember, forget: forget.filter((connector) => !remembered.has(connector)) };
}
