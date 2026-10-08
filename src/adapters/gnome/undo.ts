// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §13: undo coordination.
 *
 * Captures one change (per window instance: workspace, slot, rect, maximized,
 * floating — plus the ratios) before a user action, and restores it as a whole.
 * The policy is all-or-nothing: `validateChange` runs against the live state
 * first, so a partial restore never happens. This module owns the capture and
 * restore logic; the live window state and the apply paths stay in the session
 * and are reached through `UndoHost`.
 */

import { validateChange } from '../../core/undo.js';
import type { Change, ChangeLog, InstanceConfig, LiveInstance } from '../../core/undo.js';
import { Layer } from '../../core/types.js';
import type { Screen } from '../../core/types.js';
import * as compat from './compat.js';
import type { GnomeHost } from './host.js';
import type { History } from './history.js';
import type { Tiling } from './tiling.js';
import type { TrackedWindow } from './tracked-window.js';

/** Ignore plan-mismatch re-applies for this long after Undo (internal). */
const MISMATCH_SUPPRESSION_MS = 4000;

/**
 * The slice of session state the undo coordinator needs. Every member is
 * provided by the session; nothing here re-implements policy that lives there.
 */
export interface UndoHost {
  readonly changes: ChangeLog;
  readonly tiling: Tiling;
  readonly host: GnomeHost;
  readonly history: History;
  /** Raise a decision notification (§21); the extension owns the gate. */
  onNotice?(key: string, subject: string): void;
  /** The tiled windows on a workspace (plane capture). */
  tileables(workspaceId: number): readonly TrackedWindow[];
  /** The tracked window with this id, if any. */
  window(id: number): TrackedWindow | undefined;
  /** Every tracked window. */
  allWindows(): Iterable<TrackedWindow>;
  /** Resolve a screen by index. */
  screenFor(index: number): Screen | null;
  /** The slot a window holds: its pin, else read from its rect and screen axis. */
  slotFor(tracked: TrackedWindow): 0 | 1 | null;
  /** Move a window to a workspace. */
  moveWindowToWorkspace(tracked: TrackedWindow, index: number): void;
  /** Run one of our own unmaximizes under the self-apply echo. */
  withSelfUnmaximize(tracked: TrackedWindow, fn: () => void): void;
  /** Activate a workspace by index. */
  activateWorkspace(index: number): void;
  /** The active workspace index. */
  activeWorkspaceId(): number;
  /** Drop cached plan signatures. */
  clearSignatures(): void;
  /** Suppress plan-mismatch re-applies until this epoch-ms time. */
  suppressMismatchUntil(until: number): void;
}

export class UndoCoordinator {
  constructor(private readonly host: UndoHost) {}

  /** §13: capture the pair's current configuration before a user ratio change. */
  capturePairChange(a: number, b: number): void {
    this.captureChange([a, b]);
  }

  /**
   * §13 Undo: revert the one change — every instance's workspace, slot, rect,
   * maximized and floating state, plus the ratios. Everything is validated
   * before anything is applied; an impossible undo is announced and changes
   * nothing.
   */
  undo(): boolean {
    const change = this.host.changes.take();
    if (change === null) {
      // §13: an undo with nothing to revert is announced, never silent.
      this.host.onNotice?.('nothing-to-undo', 'undo');
      return false;
    }
    const live: LiveInstance[] = [];
    for (const tracked of this.host.allWindows()) {
      live.push({ id: tracked.id, workspace: tracked.surface.workspaceId, slot: this.host.slotFor(tracked) });
    }
    const check = validateChange(change, live);
    if (!check.ok) {
      this.host.history.log('undo_impossible', { problem: check.problem, instances: change.instances.map((instance) => instance.id) });
      this.host.onNotice?.('undo-impossible', check.problem ?? 'unknown');
      return false;
    }
    // Ratios first, so the retile that follows agrees with the restored rects.
    if (change.ratios !== undefined) this.host.tiling.restoreRatios(change.ratios);
    for (const instance of change.instances) {
      const tracked = this.host.window(instance.id);
      if (tracked === undefined) continue;
      // Workspace.
      if (tracked.surface.workspaceId !== instance.workspace) {
        this.host.moveWindowToWorkspace(tracked, instance.workspace);
      }
      // Floated flag (§6): undoing an un-float puts the window back in tiling.
      if (tracked.surface.flags.floating !== instance.floating) {
        tracked.autoFloated = false;
        tracked.surface.setFloating(instance.floating);
        this.host.tiling.noteSelfApply();
        this.host.host.applyLayer(tracked.id, instance.floating ? Layer.FLOATING : Layer.TILED);
        tracked.invalidateClassification();
      }
      // Maximized (§4).
      if (instance.maximized !== compat.isMaximized(tracked.win)) {
        this.host.tiling.noteSelfApply();
        if (instance.maximized) {
          this.host.host.maximize(tracked.id);
        } else {
          this.host.withSelfUnmaximize(tracked, () => this.host.host.unmaximize(tracked.id));
        }
      }
      tracked.refreshFrame();
    }
    // Slots: clear stale pins on the workspaces involved, then set the change's.
    const touched = new Set<number>();
    for (const instance of change.instances) touched.add(instance.workspace);
    for (const other of this.host.allWindows()) {
      if (touched.has(other.surface.workspaceId) && !change.instances.some((instance) => instance.id === other.id)) {
        other.pendingSlot = null;
      }
    }
    for (const instance of change.instances) {
      const tracked = this.host.window(instance.id);
      if (tracked !== undefined) tracked.pendingSlot = instance.slot;
    }
    // Geometry last, from the rects captured before the change.
    for (const instance of change.instances) {
      const tracked = this.host.window(instance.id);
      if (tracked === undefined) continue;
      // §10: the screen is read fresh; a vanished screen is not invented. A
      // window with no screen cannot be given a frame — the retile that follows
      // re-homes it.
      const screen = this.host.screenFor(tracked.surface.screenId);
      if (screen === null) continue;
      this.host.tiling.applyFrame(tracked, instance.rect, screen, false, 'undo', 0);
    }
    if (change.instances.length > 0 && this.host.activeWorkspaceId() !== change.instances[0].workspace) {
      this.host.activateWorkspace(change.instances[0].workspace);
    }
    this.host.history.log('undo', { instances: change.instances.map((instance) => instance.id) });
    // Do not immediately re-tile over the restored rects.
    this.host.suppressMismatchUntil(Date.now() + MISMATCH_SUPPRESSION_MS);
    this.host.clearSignatures();
    return true;
  }

  /** Capture every tiled window on the given workspaces of one screen. */
  capturePlane(workspaceIds: readonly number[], screenId: number): void {
    const ids: number[] = [];
    for (const workspaceId of workspaceIds) {
      for (const tracked of this.host.tileables(workspaceId)) {
        if (tracked.surface.screenId === screenId) ids.push(tracked.id);
      }
    }
    if (ids.length > 0) this.captureChange(ids);
  }

  /** Snapshot the current configuration of `ids` as the single undo change. */
  captureChange(ids: readonly number[], workspaceOverride?: number): void {
    const instances: InstanceConfig[] = [];
    for (const id of ids) {
      const tracked = this.host.window(id);
      if (tracked === undefined) continue;
      tracked.refreshFrame();
      instances.push({
        id,
        workspace: workspaceOverride ?? tracked.surface.workspaceId,
        slot: this.host.slotFor(tracked),
        rect: { ...tracked.surface.frame },
        maximized: compat.isMaximized(tracked.win),
        floating: tracked.surface.flags.floating,
      });
    }
    if (instances.length === 0) return;
    const ratios: Record<string, number> = this.host.tiling.getRatios();
    this.host.changes.set({ instances, ratios } satisfies Change);
    this.host.history.log('undo_captured', { instances: instances.map((instance) => instance.id) });
  }
}
