// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §6/§11: the one drag decision, pure. Given the drag state and the live
 * geometry it returns where the dragged window will land — the same result the
 * drop applies, so the drop-assist preview can never disagree with the drop.
 *
 * A same-plane move that crosses a sibling swaps; one that crosses nothing
 * returns to its own tile. A cross-plane drop follows `dropPlacement`. The target
 * rect is the tiler's own layout for the hypothetical post-drop workspace, so
 * the outline is exactly the rect the window lands in.
 */

import { dropPlacement, swappedSides } from './placement.js';
import type { Direction, Env, State } from './placement.js';
import { computePlans } from './tiler.js';
import type { TilerConfig, TilerWindow } from './tiler.js';
import type { Rect, Screen } from './types.js';

export type DragOutcome =
  | { kind: 'slot'; workspace: number; slot: 0 | 1; rect: Rect }
  | { kind: 'maximize'; workspace: number; rect: Rect }
  | { kind: 'swap'; workspace: number; with: number; rect: Rect }
  | { kind: 'float'; workspace: number; rect: Rect }
  | { kind: 'none'; workspace: number; rect: Rect };

export interface DragInput {
  state: State;
  env: Env;
  id: number;
  workspace: number;
  from: Direction | null;
  crossed: number | null;
  /**
   * §6: whether the dragged window is a *managed* window — one that can occupy
   * a tile. A drag of a window that cannot (a dialog, a popup, a skip-taskbar
   * utility, an always-on-top widget, a fixed-size client, an exception app, or
   * a window the user floated) has no landing decision at all.
   */
  managed: boolean;
  /** The drag has stayed on its own workspace and screen (§6). */
  samePlane: boolean;
  /** The screen receiving the drop. */
  screen: Screen;
  config: TilerConfig;
  /** The dragged window's own description, including its current side. */
  dragged: TilerWindow;
  /** The other tileable windows on that screen, keyed by workspace. */
  othersByWorkspace: ReadonlyMap<number, readonly TilerWindow[]>;
  /** The dragged window's rect as dropped. */
  dropped: Rect;
}

/**
 * The rect the dragged window takes after `decision` is applied, or `null` when
 * the drag has no landing decision at all (§6).
 */
export function dragOutcome(input: DragInput): DragOutcome | null {
  // §6: only a *managed* window crosses and swaps. A window that cannot occupy
  // a tile has no landing: no drop-assist highlight (the overlay hides on a
  // `null` target) and no swap/slot/maximize on the drop. Dragging it is a
  // plain move. A free slot or a crossing must never be offered for it.
  if (!input.managed) return null;
  const result = (windows: readonly TilerWindow[]): Rect => {
    const plan = computePlans(windows, input.screen, input.config);
    return plan.placements.find((placement) => placement.surfaceId === input.id)?.rect ?? input.dropped;
  };
  const others = (workspace: number): readonly TilerWindow[] => input.othersByWorkspace.get(workspace) ?? [];
  const dragged = (slot?: 0 | 1): TilerWindow => (slot === undefined ? input.dragged : { ...input.dragged, slot });
  const swap = (workspace: number, withId: number): Rect => {
    const partner = others(workspace).find((w) => w.id === withId);
    const [draggedSlot, partnerSlot] = swappedSides(input.id, input.dragged.slot ?? null, withId, partner?.slot ?? null);
    const list = others(workspace).map((w) => (w.id === withId ? { ...w, slot: partnerSlot } : w));
    return result([...list, dragged(draggedSlot)]);
  };

  if (input.samePlane) {
    if (input.crossed !== null) {
      return { kind: 'swap', workspace: input.workspace, with: input.crossed, rect: swap(input.workspace, input.crossed) };
    }
    return { kind: 'none', workspace: input.workspace, rect: result([...others(input.workspace), dragged()]) };
  }

  const decision = dropPlacement(input.state, input.env, input.id, input.workspace, input.from, input.crossed);
  switch (decision.kind) {
    case 'slot': {
      // The free slot wins: the resident takes the other side of the pair.
      const partnerSlot: 0 | 1 = decision.slot === 0 ? 1 : 0;
      const list = others(decision.workspace).map((w, index) => (index === 0 ? { ...w, slot: partnerSlot } : w));
      return {
        kind: 'slot', workspace: decision.workspace, slot: decision.slot,
        rect: result([...list, dragged(decision.slot)]),
      };
    }
    case 'maximize':
      return { kind: 'maximize', workspace: decision.workspace, rect: result([dragged()]) };
    case 'swap':
      return { kind: 'swap', workspace: decision.workspace, with: decision.with, rect: swap(decision.workspace, decision.with) };
    case 'float':
      return { kind: 'float', workspace: decision.workspace, rect: input.dropped };
  }
}
