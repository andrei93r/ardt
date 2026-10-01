// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Placement policy (§3–§7, §10, §16). Pure: it takes a description of the
 * workspaces and returns a decision — which workspace, which slot, what to
 * minimize, whether a workspace must be created. The adapter turns that into
 * Mutter calls, in the drain.
 *
 * The rules, in one place:
 *   * a slot is held only while its window is visible; a minimized window holds
 *     none (§5);
 *   * a newcomer takes slot 1 unless a direction says otherwise, and a lone
 *     arrival is maximized;
 *   * when the workspace has no room, a workspace is created immediately right;
 *   * unmaximizing joins a neighbour that holds **exactly one** window (left
 *     first, then right); otherwise the window is parked minimized in the left
 *     neighbour that holds windows, else the right one, else it stays;
 *   * a window that cannot fit a share gets its own workspace (the escape);
 *   * when a split cannot exist, the window the action is about keeps the screen
 *     and the reactor gives way: its own workspace, or minimized on a screen
 *     that cannot create one.
 */

export type Axis = 'horizontal' | 'vertical';
export type ScreenClass = 'dynamic' | 'single' | 'fixed';
export type Direction = 'left' | 'right' | 'above' | 'below';

export interface Win {
  id: number;
  minimized?: boolean;
  floating?: boolean;
  maximized?: boolean;
  fullscreen?: boolean;
}

/** One workspace: the two slot occupants (visible only) plus hidden windows. */
export interface Ws {
  id: number;
  slots: [Win | null, Win | null];
  minimized: Win[];
  floats?: Win[];
}

export interface State {
  workspaces: Ws[];
  /** The workspace the user is looking at. */
  viewed: number;
}

export interface Env {
  screen: ScreenClass;
  axis: Axis;
}

export interface Placement {
  /** Index of the target workspace in `state.workspaces`. */
  workspace: number;
  /** The slot the window takes, when it lands in one. */
  slot?: 0 | 1;
  /** A workspace must be created immediately to the right of this one. */
  createRight?: boolean;
  /** These windows must be minimized. */
  minimize?: number[];
  /** The window takes the whole workspace (a lone arrival, or the escape). */
  maximize?: boolean;
  /** Maximize where the window is instead of moving it (§4, §7). */
  inPlace?: boolean;
  /** The window floats: no room, and this screen cannot create one (§6). */
  float?: boolean;
  /** The decision, for the notification catalogue (§21). */
  note?: string;
}

/** The free slot in a workspace, or null when both are taken (§5). */
export function freeSlot(ws: Ws): 0 | 1 | null {
  if (ws.slots[0] === null) return 0;
  if (ws.slots[1] === null) return 1;
  return null;
}

/**
 * The slot an arrival takes: the right one (slot 1) when it is free, else the
 * left — and when the arrival has a side, that side first (§3).
 */
export function arrivalSlot(ws: Ws, from: Direction | null = null): 0 | 1 | null {
  if (freeSlot(ws) === null) return null;
  if (from !== null) {
    const wanted = sideSlot(from);
    if (ws.slots[wanted] === null) return wanted;
    return wanted === 0 ? 1 : 0;
  }
  return ws.slots[1] === null ? 1 : 0;
}

/** How many windows are visible in a workspace's two slots (§5). */
export function visibleCount(ws: Ws): number {
  return (ws.slots[0] === null ? 0 : 1) + (ws.slots[1] === null ? 0 : 1);
}

/** The visible window ids of a workspace, in slot order. */
export function visibleIds(ws: Ws): number[] {
  const ids: number[] = [];
  if (ws.slots[0] !== null) ids.push(ws.slots[0].id);
  if (ws.slots[1] !== null) ids.push(ws.slots[1].id);
  return ids;
}

/** How many windows a workspace holds, counting minimized and floating ones. */
export function windowCount(ws: Ws): number {
  let count = (ws.slots[0] === null ? 0 : 1) + (ws.slots[1] === null ? 0 : 1) + ws.minimized.length;
  count += ws.floats?.length ?? 0;
  return count;
}

/** The slot on the side a window came from (§3); no direction means slot 1. */
export function sideSlot(from: Direction | null | undefined): 0 | 1 {
  if (from === 'left' || from === 'above') return 0;
  return 1;
}

/**
 * Where a newly opened (or routed) window goes (§3). `ownWorkspace` is the
 * workspace it opens on; `from` is the direction it arrived from, when known;
 * `doesNotFit` is the escape rule's trigger (§16).
 */
export function routeNewWindow(
  state: State,
  env: Env,
  _rec: Win,
  from: Direction | null = null,
  ownWorkspace: number | null = null,
  doesNotFit = false,
): Placement {
  const target = ownWorkspace ?? state.viewed;
  const ws = state.workspaces[target];
  if (ws === undefined) return { workspace: target, slot: 1, maximize: true, note: 'no-workspace' };

  if (env.screen === 'single') {
    // §10 step 4 / §16: no workspace to give, so the trigger keeps the screen
    // maximized and the windows already there are minimized.
    if (doesNotFit) {
      return { workspace: target, slot: 1, inPlace: true, maximize: true, minimize: visibleIds(ws), note: 'trigger-wins' };
    }
    const free = arrivalSlot(ws, from);
    if (free !== null) return { workspace: target, slot: free, maximize: visibleCount(ws) === 0 };
    return { workspace: target, slot: 1, float: true, note: 'no-room-floats' };
  }
  if (env.screen === 'fixed') {
    const free = arrivalSlot(ws, from);
    if (free !== null && !doesNotFit) return { workspace: target, slot: free };
    const next = nearestWithRoom(state, target);
    if (next !== null) return { workspace: next, slot: freeSlot(state.workspaces[next]) ?? 1 };
    return { workspace: target, slot: 1, float: true, note: 'no-room-floats' };
  }

  // A workspace-capable screen: the right slot, else split a maximized single,
  // else a new workspace immediately right.
  if (doesNotFit) {
    // §16: its own workspace, sized to itself (the adapter clamps it).
    return { workspace: target, slot: 0, createRight: true, note: 'did-not-fit' };
  }
  const free = arrivalSlot(ws, from);
  if (free !== null) {
    if (visibleCount(ws) === 0) {
      // Alone among the visible windows (a workspace that only *looks* empty,
      // §5): it maximizes. Minimized windows keep their place.
      return { workspace: target, slot: free, maximize: true };
    }
    return { workspace: target, slot: free, note: 'right-slot' };
  }
  return { workspace: target, slot: 1, createRight: true, maximize: true, note: 'workspace-created' };
}

/**
 * §6: the outcome of a user drop (a drag or an overview drop) on a target
 * workspace. The ladder, in order:
 *   * a **free slot wins**, on the side the window came from;
 *   * otherwise a window whose perimeter was crossed is **swapped** with;
 *   * otherwise the window **floats** where it was dropped.
 * A drop onto the empty trailing workspace maximises there (a lone arrival);
 * the single-workspace screen never swaps — with no free slot it floats.
 */
export type DropResult =
  | { kind: 'slot'; workspace: number; slot: 0 | 1 }
  | { kind: 'maximize'; workspace: number }
  | { kind: 'swap'; workspace: number; with: number }
  | { kind: 'float'; workspace: number };

export function dropPlacement(
  state: State,
  env: Env,
  _id: number,
  workspace: number,
  from: Direction | null = null,
  crossed: number | null = null,
): DropResult {
  const ws = state.workspaces[workspace];
  if (ws === undefined) return { kind: 'float', workspace };
  const free = arrivalSlot(ws, from);
  if (env.screen === 'single') {
    // §7: a single-workspace screen never swaps; overflow floats.
    if (free === null) return { kind: 'float', workspace };
    return visibleCount(ws) === 0 ? { kind: 'maximize', workspace } : { kind: 'slot', workspace, slot: free };
  }
  if (env.screen === 'fixed' && free === null) {
    // §7: fixed screens route to the nearest existing workspace with room.
    const next = nearestWithRoom(state, workspace);
    if (next === null) return { kind: 'float', workspace };
    return { kind: 'slot', workspace: next, slot: freeSlot(state.workspaces[next]) ?? 1 };
  }
  if (free !== null) {
    // A workspace that only looks empty hosts the drop alone → it maximises.
    return visibleCount(ws) === 0 ? { kind: 'maximize', workspace } : { kind: 'slot', workspace, slot: free };
  }
  if (crossed !== null && visibleIds(ws).includes(crossed)) {
    return { kind: 'swap', workspace, with: crossed };
  }
  return { kind: 'float', workspace };
}

/** The nearest workspace with a free slot, right first, then left (§7). */
export function nearestWithRoom(state: State, from: number): number | null {
  for (let index = from + 1; index < state.workspaces.length; index++) {
    if (freeSlot(state.workspaces[index]) !== null) return index;
  }
  for (let index = from - 1; index >= 0; index--) {
    if (freeSlot(state.workspaces[index]) !== null) return index;
  }
  return null;
}

/** Whether a workspace holds exactly one window (minimized counts, §4). */
export function holdsExactlyOne(ws: Ws): boolean {
  return windowCount(ws) === 1;
}

/** §4: maximizing moves the window to its own workspace, or in place on `single`. */
export function maximizeWindow(state: State, env: Env, ownWorkspace: number): Placement {
  if (env.screen === 'single') {
    return { workspace: ownWorkspace, slot: state.workspaces[ownWorkspace]?.slots[0] === undefined ? 1 : 0, inPlace: true, maximize: true, note: 'maximize-in-place' };
  }
  if (env.screen === 'fixed') {
    const free = nearestWithRoom(state, ownWorkspace);
    if (free !== null) return { workspace: free, slot: freeSlot(state.workspaces[free]) ?? 1, maximize: true, note: 'maximize-moved' };
    return { workspace: ownWorkspace, slot: 0, inPlace: true, maximize: true, note: 'maximize-in-place' };
  }
  return { workspace: ownWorkspace, slot: 1, createRight: true, maximize: true, note: 'maximize-moved' };
}

/** §4: the unmaximize ladder. */
export function unmaximizeWindow(state: State, env: Env, ownWorkspace: number, id: number): Placement {
  if (env.screen === 'single') {
    return { workspace: ownWorkspace, slot: 1, inPlace: true, note: 'unmaximize-in-place' };
  }
  const left = state.workspaces[ownWorkspace - 1];
  const right = state.workspaces[ownWorkspace + 1];
  if (left !== undefined && holdsExactlyOne(left)) return { workspace: ownWorkspace - 1, slot: 1, note: 'unmaximize-joins-left' };
  if (right !== undefined && holdsExactlyOne(right)) return { workspace: ownWorkspace + 1, slot: 1, note: 'unmaximize-joins-right' };
  if (left !== undefined && windowCount(left) > 0) return { workspace: ownWorkspace - 1, minimize: [id], note: 'unmaximize-parks-left' };
  if (right !== undefined && windowCount(right) > 0) return { workspace: ownWorkspace + 1, minimize: [id], note: 'unmaximize-parks-right' };
  return { workspace: ownWorkspace, minimize: [id], note: 'unmaximize-stays' };
}

/** §4: where a workspace's only (minimized) window moves to, or null to stay. */
export function minimizeRelocation(state: State, ownWorkspace: number): { to: number } | null {
  const left = state.workspaces[ownWorkspace - 1];
  if (left !== undefined && windowCount(left) > 0) return { to: ownWorkspace - 1 };
  const right = state.workspaces[ownWorkspace + 1];
  if (right !== undefined && windowCount(right) > 0) return { to: ownWorkspace + 1 };
  return null;
}

export interface SplitOutcome {
  /** The window the action was about: it keeps the screen. */
  keep: number;
  /** The window that has to give way. */
  giveWay: number;
  giveWayTo: 'own-workspace' | 'minimized';
}

/** §10 steps 3–4: a split that cannot exist, so the trigger wins. */
export function impossibleSplit(env: Env, trigger: Win, reactor: Win): SplitOutcome {
  return {
    keep: trigger.id,
    giveWay: reactor.id,
    giveWayTo: env.screen === 'single' ? 'minimized' : 'own-workspace',
  };
}

/**
 * §10 step 3 / §16: the width (along the split axis) a window gets on its own
 * escape workspace — its own size, clamped between one sixth of the screen and
 * the whole screen. The escaping window keeps the slot-0 position.
 */
export function escapeSize(screen: number, requested: number): number {
  return Math.min(Math.max(requested, Math.round(screen / 6)), screen);
}

/**
 * §10 step 2: a client refuses the requested split, so the **sibling adapts** —
 * the refusing window keeps the size it insists on (`keepSize`) and the sibling
 * takes the remainder, clamped to its own minimum (`siblingMinimum`). `escaped`
 * is true only when the sibling cannot adapt either, so the pair cannot exist
 * and step 3's `impossibleSplit` decides who gives way. `screen` is the split
 * extent available to the pair (work area minus the gaps).
 */
export function refusalLadder(
  keepSize: number,
  siblingMinimum: number,
  screen: number,
): { sibling: number; escaped: boolean } {
  const sibling = Math.min(Math.max(screen - keepSize, siblingMinimum), screen);
  if (keepSize + sibling <= screen) return { sibling, escaped: false };
  return { sibling: screen, escaped: true };
}

