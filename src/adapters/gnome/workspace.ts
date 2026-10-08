// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §5/§7/§16: the workspace lifecycle controller.
 *
 * Owns the create/reap/reorder/move cluster and the nearest-workspace scanners.
 * The live `Map<number, TrackedWindow>` and the pure placement state stay in the
 * session; this module reaches them through `WorkspaceHost`, so it holds no
 * window policy of its own. Every public session method that used to live here
 * now delegates.
 */

import type { MetaWindow, MetaWorkspace } from 'gi://Meta';

import { windowCount } from '../../core/placement.js';
import type { State } from '../../core/placement.js';
import { reapPlan } from '../../core/workspaces.js';
import type { TrackedWindow } from './tracked-window.js';

/** Two settle passes after an action, so reaping sees the final state. */
const PRUNE_FIRST_MS = 300;
const PRUNE_SECOND_MS = 900;

/** The slice of session state the workspace controller needs. */
export interface WorkspaceHost {
  /** Every tracked window. */
  allWindows(): Iterable<TrackedWindow>;
  /** The tracked window with this id, if any. */
  window(id: number): TrackedWindow | undefined;
  /** Whether a live Mutter window is one we track. */
  hasWindow(id: number): boolean;
  /** The pure placement state used to plan a reap. */
  placementState(): State;
  /** §13/§16: the expected workspace echo, so the later signal is cancelled. */
  noteSelfEcho(id: number, expected: { workspace: number }): void;
  /** The tiler's self-apply bookkeeping. */
  noteSelfApply(): void;
  /** Cancel an in-flight tiler animation for a window. */
  cancelApply(id: number): void;
  /** Move a window to a workspace through the compositor host. */
  applyWorkspace(id: number, index: number): void;
  /** The window is being moved: hide the border now. */
  onWindowMoving(): void;
  /** Journal one workspace event (§22). */
  log(event: string, fields: Record<string, unknown>): void;
  /** Ratios move with the workspaces when one is reaped. */
  reindexRatiosAfterReap(removed: readonly number[]): void;
  /** Activate a workspace by index. */
  activateWorkspace(index: number): void;
  /** Drop every cached plan signature. */
  clearSignatures(): void;
  /** Debounced reconcile, never synchronous from a signal handler. */
  scheduleReconcile(reason: string): void;
  /** Register a GLib timeout owned by the session's source registry. */
  addTimeout(ms: number, cb: () => void): void;
  isPaused(): boolean;
  isSuspended(): boolean;
  /** §7.6: whether reorder diagnostics are enabled. */
  reorderLoggingEnabled(): boolean;
}

export class WorkspaceController {
  /** Set by a reorder signal; the drain re-derives every index from Mutter. */
  private reorderPending = false;

  constructor(private readonly host: WorkspaceHost) {}

  /**
   * §7.6: the user reordered workspaces; every index moved. No policy here —
   * the handler runs inside Mutter's signal emission, so it only records the
   * intent and asks the drain to re-derive it.
   */
  onReordered(): void {
    this.reorderPending = true;
    this.host.clearSignatures();
    if (this.host.reorderLoggingEnabled()) {
      this.host.log('ws_removed', { reason: 'reorder' });
    }
    this.host.scheduleReconcile('workspace-reorder');
  }

  /** Apply a pending reorder in the drain; true when one was waiting. */
  flushPendingReorder(): boolean {
    if (!this.reorderPending) return false;
    this.reorderPending = false;
    this.realign();
    return true;
  }

  /** Re-derive every tracked window's workspace index from Mutter. */
  realign(): void {
    for (const tracked of this.host.allWindows()) {
      const workspace = tracked.win.get_workspace();
      if (workspace === null) continue;
      tracked.surface.workspaceId = workspace.index();
      tracked.lastWorkspaceIdx = workspace.index();
    }
  }

  /** Create a workspace immediately right of `after`, pushing the spare right. */
  createRight(after: number): number | null {
    const manager = global.workspace_manager;
    const target = after + 1;
    if (target < manager.get_n_workspaces()) {
      const existing = manager.get_workspace_by_index(target);
      if (existing !== null && this.workspaceIsEmpty(existing)) return target;
    }
    const appended = manager.get_n_workspaces();
    manager.append_new_workspace(false, global.get_current_time());
    const created = manager.get_workspace_by_index(appended);
    if (created !== null && target < appended) manager.reorder_workspace(created, target);
    return Math.min(target, manager.get_n_workspaces() - 1);
  }

  /** Move one tracked window to a workspace; the echo cancels the resulting signal. */
  moveWindow(tracked: TrackedWindow, index: number): void {
    this.host.noteSelfEcho(tracked.id, { workspace: index });
    this.host.noteSelfApply();
    this.host.onWindowMoving();
    this.host.cancelApply(tracked.id);
    this.host.applyWorkspace(tracked.id, index);
    tracked.surface.workspaceId = index;
    tracked.lastWorkspaceIdx = index;
    this.host.clearSignatures();
  }

  private workspaceIsEmpty(workspace: MetaWorkspace): boolean {
    return workspace.list_windows().filter((win: MetaWindow) => this.host.hasWindow(win.get_id())).length === 0;
  }

  /**
   * §5: reaping is a property. At every drain any empty workspace other than
   * GNOME's trailing spare is removed, wherever it sits; a workspace holding
   * only minimized windows relocates its occupant first (left, else right, else
   * it stays, the one legal look-empty workspace); a float pins its workspace.
   */
  reapEmpty(): void {
    if (this.host.isPaused() || this.host.isSuspended()) return;
    const manager = global.workspace_manager;
    if (manager.get_n_workspaces() <= 1) return;
    const state = this.host.placementState();
    const plan = reapPlan(state);
    if (plan.reap.length === 0 && plan.relocate.length === 0) return;
    for (const move of plan.relocate) {
      const tracked = this.host.window(move.id);
      if (tracked === undefined) continue;
      this.moveWindow(tracked, move.to);
      this.host.log('new_ws', { id: move.id, workspaceId: move.to, reason: 'minimized-relocation' });
    }
    const reapSet = new Set(plan.reap);
    if (reapSet.has(manager.get_active_workspace_index())) {
      const target = this.nearestIndexHoldingWindows(state, manager.get_active_workspace_index(), reapSet);
      if (target >= 0) this.host.activateWorkspace(target);
    }
    const removed: number[] = [];
    for (const index of [...plan.reap].sort((a, b) => b - a)) {
      if (manager.get_n_workspaces() <= 1) break;
      const workspace = manager.get_workspace_by_index(index);
      if (workspace === null) continue;
      // Never reap a workspace that still holds any window, tracked or not.
      if (workspace.list_windows().length > 0) continue;
      if (manager.get_active_workspace_index() === index) continue;
      manager.remove_workspace(workspace, global.get_current_time());
      removed.push(index);
      this.host.log('ws_removed', { workspaceId: index, reason: 'reaped' });
    }
    // §10: a reaped workspace's ratio goes with it, and the workspaces to its
    // right shift down an index, so their ratios move too.
    this.host.reindexRatiosAfterReap(removed);
    this.realign();
    this.host.clearSignatures();
  }

  /**
   * §5/P4: the one nearest-workspace walk behind the live manager and the pure
   * placement state. Scan indices from `from` in `step` direction over `count`
   * slots and return the first that `matches`; if none does and `fallback` is
   * given, return the first that `fallback` accepts instead. `count` is the
   * source's own length, so the live and dry scans share the loop. -1 when
   * nothing matches.
   */
  private scanWorkspaceIndices(
    from: number,
    step: number,
    count: number,
    matches: (index: number) => boolean,
    fallback?: (index: number) => boolean,
  ): number {
    const passes = fallback === undefined ? [matches] : [matches, fallback];
    for (const predicate of passes) {
      for (let index = from + step; index >= 0 && index < count; index += step) {
        if (predicate(index)) return index;
      }
    }
    return -1;
  }

  /** Nearest non-reaped workspace that holds windows, left first (§5). */
  private nearestIndexHoldingWindows(state: State, from: number, exclude: Set<number>): number {
    const count = state.workspaces.length;
    const holdsWindows = (index: number): boolean => !exclude.has(index) && windowCount(state.workspaces[index]) > 0;
    const exists = (index: number): boolean => !exclude.has(index);
    let target = this.scanWorkspaceIndices(from, -1, count, holdsWindows);
    if (target < 0) target = this.scanWorkspaceIndices(from, 1, count, holdsWindows);
    if (target < 0) target = this.scanWorkspaceIndices(from, -1, count, exists);
    return target;
  }

  /** Reap empty workspaces shortly after an action, once state has settled. */
  schedulePrune(): void {
    this.host.addTimeout(PRUNE_FIRST_MS, () => this.reapEmpty());
    this.host.addTimeout(PRUNE_SECOND_MS, () => this.reapEmpty());
  }

  /** §7.5 close: leave an empty workspace, then reap it (§16). */
  switchAwayIfEmpty(workspaceId: number): void {
    const manager = global.workspace_manager;
    if (manager.get_n_workspaces() <= 1) return;
    const workspace = manager.get_workspace_by_index(workspaceId);
    if (workspace === null) return;
    const remaining = workspace.list_windows().filter((win: MetaWindow) => this.host.hasWindow(win.get_id()));
    if (remaining.length > 0) return;

    if (manager.get_active_workspace_index() === workspaceId) {
      // "Done" takes you back to the left — the nearest left workspace that
      // still exists and holds windows. If the left one was removed (or is
      // empty), fall forward to the right instead.
      let target = this.nearestWorkspaceWithWindows(workspaceId, -1);
      if (target < 0) target = this.nearestWorkspaceWithWindows(workspaceId, 1);
      if (target < 0) target = this.nearestExistingWorkspace(workspaceId, -1);
      if (target < 0) target = this.nearestExistingWorkspace(workspaceId, 1);
      if (target >= 0 && target !== workspaceId) {
        this.host.log('ws_switch_empty', { from: workspaceId, to: target });
        this.host.activateWorkspace(target);
      }
    }
    this.schedulePrune();
  }

  /** Nearest workspace in `step` direction that holds one of our windows. */
  private nearestWorkspaceWithWindows(from: number, step: number): number {
    const manager = global.workspace_manager;
    return this.scanWorkspaceIndices(from, step, manager.get_n_workspaces(), (index) => {
      const workspace = manager.get_workspace_by_index(index);
      return workspace !== null && workspace.list_windows().some((win: MetaWindow) => this.host.hasWindow(win.get_id()));
    });
  }

  /** Nearest workspace in `step` direction that exists at all. */
  private nearestExistingWorkspace(from: number, step: number): number {
    const manager = global.workspace_manager;
    return this.scanWorkspaceIndices(from, step, manager.get_n_workspaces(), (index) => manager.get_workspace_by_index(index) !== null);
  }
}
