// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §9: the display controller.
 *
 * Owns the persisted display memory (keyed by connector), the previous screen
 * list, and the display plan application: rescuing windows off a removed
 * monitor, replaying them to a reconnected connector, the primary-change swap,
 * and the float stacking restore. The pure plan comes from `core/displays`; the
 * live window map, the apply paths and the screen class stay in the session and
 * are reached through `DisplayHost`, so no window policy lives here.
 */

import type { MetaWindow } from 'gi://Meta';

import type { DisplayMove, DisplayState, DisplayWorkspace, MemoryEntry, NewWorkspace } from '../../core/displays.js';
import { displayPlan } from '../../core/displays.js';
import type { ScreenClass } from '../../core/placement.js';
import type { Rect, Screen } from '../../core/types.js';
import * as compat from './compat.js';
import type { GnomeHost } from './host.js';
import type { History } from './history.js';
import type { GnomeSettings } from './settings.js';
import type { Tiling } from './tiling.js';
import type { TrackedWindow } from './tracked-window.js';
import type { WorkspaceController } from './workspace.js';

/** The slice of session state the display controller needs. */
export interface DisplayHost {
  readonly host: GnomeHost;
  readonly history: History;
  readonly settings: GnomeSettings;
  readonly tiling: Tiling;
  readonly workspaces: WorkspaceController;
  /** Every tracked window id (the display plan's aliveness check). */
  windowIds(): number[];
  /** Every tracked window. */
  allWindows(): Iterable<TrackedWindow>;
  /** The tracked window with this id, if any. */
  window(id: number): TrackedWindow | undefined;
  /** §1: the screen class of a screen index. */
  screenClass(screenId: number): ScreenClass;
  /** The window's classification (only `tileable` is read). */
  classify(tracked: TrackedWindow): { tileable: boolean };
  /** §12: the slot the window occupies, or null. */
  slotFor(tracked: TrackedWindow): 0 | 1 | null;
  /** §6: float a window, optionally at a remembered rect. */
  floatWindow(tracked: TrackedWindow, rect?: Rect): void;
  /** §12: record the window's placement under its app entry. */
  recordPlacement(tracked: TrackedWindow, connectorOverride?: string, slotOverride?: number): void;
  /** §3: pin the pair's slots so the tiler honours the chosen side. */
  pinSlots(workspaceId: number, tracked: TrackedWindow, slot: 0 | 1): void;
  /** §3/§5: unmaximize the occupants that must share the workspace. */
  unmaximizeOccupants(workspaceId: number, exceptId: number): void;
  /** Drop every cached plan signature. */
  clearSignatures(): void;
  /** Debounced reconcile, never synchronous from a signal handler. */
  scheduleReconcile(reason: string): void;
  /** §9: display memory changed and should be persisted. */
  onDisplayMemoryChanged(): void;
  /** Format a caught unknown for the diagnostics. */
  errorText(error: unknown): string;
}

export class DisplayController {
  /** §9: display memory keyed by connector, plus the previous screen list. */
  private displayMemory: MemoryEntry[] = [];
  private lastScreens: readonly Screen[] | null = null;

  constructor(private readonly host: DisplayHost) {}

  /** §9: persisted display memory (keyed by connector). */
  setDisplayMemory(memory: MemoryEntry[]): void {
    this.displayMemory = Array.isArray(memory) ? memory : [];
  }

  /** Read-only: the caller must copy to modify, never mutate session state. */
  getDisplayMemory(): readonly MemoryEntry[] {
    return this.displayMemory;
  }

  /** §9 display plan: rescue, replay and primary-change handling. */
  applyDisplayChange(): void {
    const screens = this.host.host.screens();
    // `prev` is the arrangement that was on screen *before* this change,
    // rebuilt from the live windows against the previous screen list. Storing a
    // full arrangement snapshot would miss windows that opened since.
    const next = this.buildDisplayState(screens);
    const prev = this.buildDisplayState(this.lastScreens ?? screens);
    const ttlMs = Math.max(1, this.host.settings.int('display-memory-minutes', 30)) * 60 * 1000;
    const classes: Record<string, ScreenClass> = {};
    for (const screen of screens) classes[screen.connector] = this.host.screenClass(screen.index);
    let plan;
    try {
      plan = displayPlan(prev, next, this.displayMemory, { now: Date.now(), ttlMs, classes, alive: this.host.windowIds() });
    } catch (e) {
      this.host.history.log('error', { reason: 'display-plan', error: (e as Error).message });
      return;
    }
    if (plan.moves.length > 0 || plan.remember.length > 0 || plan.forget.length > 0) {
      this.host.history.log('screens_changed', {
        moves: plan.moves.length,
        remember: plan.remember.map((entry) => entry.connector),
        forget: plan.forget,
      });
    }
    // §9: a float's stacking is restored exactly. `floatWindow` raises on apply,
    // so applying the remembered floats bottom-to-top (ascending z) reproduces
    // their relative order; a float with no remembered z keeps its plan order.
    const floats = plan.moves
      .filter((move) => move.float === true && move.z !== undefined)
      .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    const restored = new Set(floats);
    // Every move that shares a `create.key` must land on the SAME created
    // workspace: the group is the pair (or single) the source workspace held, and
    // creating one per move split the pair across two workspaces (A110).
    const createdByKey = new Map<number, number>();
    for (const move of plan.moves) if (!restored.has(move)) this.applyDisplayMove(move, createdByKey);
    for (const move of floats) this.applyDisplayMove(move, createdByKey);
    for (const entry of plan.remember) {
      const at = this.displayMemory.findIndex((candidate) => candidate.connector === entry.connector);
      if (at >= 0) this.displayMemory[at] = entry;
      else this.displayMemory.push(entry);
    }
    if (plan.forget.length > 0) {
      this.displayMemory = this.displayMemory.filter((entry) => !plan.forget.includes(entry.connector));
    }
    this.lastScreens = screens;
    this.host.onDisplayMemoryChanged();
    if (plan.moves.length > 0) {
      this.host.clearSignatures();
      this.host.scheduleReconcile('display-plan');
    }
  }

  private applyDisplayMove(
    move: DisplayMove,
    createdByKey: Map<number, number>,
  ): void {
    const tracked = this.host.window(move.id);
    if (tracked === undefined) return;
    // §Shell stability: re-read the window's *live* monitor at use, never trust
    // the cached screenId. While Mutter is still migrating a window off a
    // removed monitor, `get_monitor()` reports the stale index, and any Mutter
    // window call here (change_workspace, maximize, move_to_monitor) makes the
    // compositor re-derive the work area for a monitor that no longer exists —
    // which asserts in C, outside anything JS can catch. Skip the whole move:
    // Mutter migrates the window itself and the next screens-changed pass
    // re-plans it.
    if (!this.host.host.isLiveMonitorIndex(this.liveMonitorOf(tracked.win))) return;
    let workspaceIndex = move.workspace ?? tracked.surface.workspaceId;
    let targetConnector: string | undefined;
    if (move.create !== undefined) {
      // One workspace per key: every window of a rescued pair or single shares it.
      let created = createdByKey.get(move.create.key);
      if (created === undefined) {
        const workspace = this.createWorkspaceForDisplay(move.create);
        if (workspace === null) return;
        created = workspace;
        createdByKey.set(move.create.key, created);
      }
      workspaceIndex = created;
    }
    // Move the workspace first, then route the screen. With
    // `workspaces-only-on-primary`, a workspace change can drag a window back to
    // the primary; doing it before the monitor move lets the monitor move win
    // (a replay to the reconnected connector must end there, not on the primary).
    if (workspaceIndex !== tracked.surface.workspaceId) this.host.workspaces.moveWindow(tracked, workspaceIndex);
    // §9: a routed window lands on the screen the plan names — the primary on a
    // rescue, the reconnected connector on a replay. Without this a replay only
    // reassigned the workspace and the pair never left the primary.
    const targetScreen = move.create?.screen ?? move.screen;
    if (targetScreen !== undefined) {
      const target = this.host.host.screenByIndex(targetScreen);
      if (target !== null) {
        targetConnector = target.connector;
        tracked.surface.screenId = target.index;
        this.host.tiling.noteSelfApply();
        // §Shell stability: the plan's screen comes from the (possibly raced)
        // screen list; never pass an out-of-range index to Mutter. A window on
        // a removed monitor stays on its compositor monitor until Mutter
        // migrates it — the policy move above still stands either way.
        if (this.host.host.isLiveMonitorIndex(target.index)) {
          try {
            tracked.win.move_to_monitor?.(target.index);
          } catch (error) {
            // The policy move still stands (a simulated screen has no Mutter
            // monitor to move to); report the failed compositor call.
            this.host.history.log('error', {
              reason: 'move-to-monitor',
              id: tracked.id,
              monitor: target.index,
              error: this.host.errorText(error),
            });
          }
        }
      }
    }
    this.host.history.log('display_move', {
      id: move.id,
      workspace: workspaceIndex,
      create: move.create?.key ?? null,
      screen: targetScreen ?? null,
      float: move.float === true,
      minimize: move.minimize === true,
      maximize: move.maximize === true,
      slot: move.slot ?? null,
    });
    if (move.float === true) {
      this.host.floatWindow(tracked, move.rect);
      this.host.recordPlacement(tracked, targetConnector, move.slot);
      return;
    }
    if (move.minimize === true) {
      this.host.tiling.noteSelfApply();
      this.host.host.minimize(tracked.id);
      this.host.recordPlacement(tracked, targetConnector, move.slot);
      return;
    }
    if (move.maximize === true) {
      this.host.tiling.noteSelfApply();
      this.host.tiling.noteSelfMaximize();
      this.host.host.maximize(tracked.id);
    } else if (move.slot !== undefined) {
      tracked.pendingSlot = move.slot;
      this.host.pinSlots(workspaceIndex, tracked, move.slot);
      this.host.unmaximizeOccupants(workspaceIndex, tracked.id);
    }
    if (move.fullscreen === true) tracked.fullscreenApplied = true;
    // §12: the routed placement is what display memory and a restart replay.
    this.host.recordPlacement(tracked, targetConnector, move.slot);
  }

  /**
   * §Shell stability: the window's monitor index read from the compositor at
   * this very moment, or -1 when the window is gone. Never the cached
   * `surface.screenId`, which can name a monitor that was just removed.
   */
  private liveMonitorOf(win: MetaWindow): number {
    try {
      const index: unknown = win.get_monitor?.();
      return typeof index === 'number' ? index : -1;
    } catch (error) {
      // The window is gone: -1 still lets the caller skip the move, but the
      // failed compositor read is worth a diagnostic.
      this.host.history.log('error', { reason: 'live-monitor', error: this.host.errorText(error) });
      return -1;
    }
  }

  /**
   * §9: the workspaces a screen displays (the primary shows them all).
   */
  private workspacesForScreen(screen: Screen): number[] {
    const manager = global.workspace_manager;
    const count = manager.get_n_workspaces();
    if (screen.isPrimary) {
      const all: number[] = [];
      for (let index = 0; index < count; index++) all.push(index);
      return all;
    }
    return [manager.get_active_workspace_index()];
  }

  /** A snapshot of the display arrangement for the pure plan (§9). */
  private buildDisplayState(screens: readonly Screen[]): DisplayState {
    const manager = global.workspace_manager;
    const entries = new Map<string, DisplayWorkspace>();
    const ensure = (screen: number, workspace: number): DisplayWorkspace => {
      const key = `${screen}:${workspace}`;
      let entry = entries.get(key);
      if (entry === undefined) {
        entry = { id: workspace, screen, slots: [null, null], minimized: [], floats: [] };
        entries.set(key, entry);
      }
      return entry;
    };
    for (const screen of screens) {
      for (const workspace of this.workspacesForScreen(screen)) ensure(screen.index, workspace);
    }
    const known = new Set(screens.map((screen) => screen.index));
    for (const tracked of [...this.host.allWindows()].sort((a, b) => a.id - b.id)) {
      if (!tracked.ready) continue;
      // A window on a screen that is no longer present is exactly the one a
      // disconnect plan must route; it is not part of the new arrangement.
      if (!known.has(tracked.surface.screenId)) continue;
      const managed = this.host.classify(tracked).tileable;
      const floating = tracked.surface.flags.floating || tracked.autoFloated || tracked.escaped;
      if (!managed && !floating) continue;
      const workspace = ensure(tracked.surface.screenId, tracked.surface.workspaceId);
      const win = {
        id: tracked.id,
        maximized: tracked.surface.flags.maximized || compat.isMaximized(tracked.win),
        fullscreen: tracked.surface.flags.fullscreen,
        rect: { ...tracked.surface.frame },
      };
      if (tracked.surface.flags.minimized) {
        workspace.minimized.push(win);
        continue;
      }
      if (floating) {
        // §9: a float's stacking is restored exactly, so capture it with the rect.
        tracked.surface.captureZ();
        (workspace.floats ??= []).push({ ...win, z: tracked.surface.zPosition });
        continue;
      }
      const slot = this.host.slotFor(tracked);
      if (slot !== null && workspace.slots[slot] === null) {
        workspace.slots[slot] = win;
      } else if (workspace.slots[0] === null) {
        workspace.slots[0] = win;
      } else {
        (workspace.floats ??= []).push(win);
      }
    }
    // `DisplayState.screens` is a mutable `Screen[]` in core; copy the readonly
    // cache once per display pass (rare) rather than handing core our own array.
    return { screens: [...screens], workspaces: [...entries.values()], viewed: manager.get_active_workspace_index() };
  }

  /** §9: create a rescued workspace on the physical side the screen was on. */
  private createWorkspaceForDisplay(create: NewWorkspace): number | null {
    const manager = global.workspace_manager;
    if (create.side === 'right') return this.host.workspaces.createRight(create.anchor);
    const target = create.leftmost === true ? 0 : Math.max(0, create.anchor - 1);
    const appended = manager.get_n_workspaces();
    manager.append_new_workspace(false, global.get_current_time());
    const created = manager.get_workspace_by_index(appended);
    if (created !== null && target < appended) manager.reorder_workspace(created, target);
    return Math.min(target, manager.get_n_workspaces() - 1);
  }
}
