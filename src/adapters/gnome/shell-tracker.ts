// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §11: the shell tracker — window tracking decoupled from policy.
 *
 * Every compositor/shell-chrome subscription that is *not* window lifecycle
 * (session mode, overview, workspace-manager layout, workspace actors, the
 * swipe tracker, system workspace-mode settings) lives here. The tracker only
 * **emits events**; the extension subscribes and keeps all policy. No policy
 * runs inside a signal handler — the handler emits, the drain/subscriber
 * decides.
 *
 * Window lifecycle itself (`surface-created`, per-window signals) stays where
 * it is: `GnomeHost` already emits those as platform events and `WindowSession`
 * owns the window table. This module covers the shell chrome around them.
 */

import Gio from 'gi://Gio';
import { layoutManager, overview, sessionMode, wm } from 'resource:///org/gnome/shell/ui/main.js';

import type { SignalRegistry } from './lifecycle.js';

/**
 * Structural views of the private Shell chrome `main.js` exposes as `any`.
 * Each names only the members read here, optional exactly where the code probes
 * — the same boundary `extension.ts` uses for `wm._workspaceAnimation`.
 */

/** One `layoutManager._workspaces` actor, watched for a transitioning position. */
interface WorkspaceActorLike {
  connect(signal: string, callback: (...args: never[]) => void): number;
  disconnect(id: number): void;
}

/** The private `layoutManager._workspaces` field. */
interface LayoutManagerLike {
  _workspaces?: unknown;
}

/** The swipe tracker behind the private `Main.wm._workspaceAnimation`. */
interface SwipeTrackerLike {
  connect(signal: string, callback: (...args: never[]) => void): number;
  disconnect(id: number): void;
}

/** The private `layoutManager._workspaces` actor array, or null when the field
 * is absent or not an array. `layoutManager` is declared `any` by `main.js`. */
function layoutWorkspaces(): readonly (WorkspaceActorLike | null | undefined)[] | null {
  const workspaces = (layoutManager as LayoutManagerLike)._workspaces;
  if (!Array.isArray(workspaces)) return null;
  const actors: readonly (WorkspaceActorLike | null | undefined)[] = workspaces;
  return actors;
}

/** The swipe tracker behind `Main.wm._workspaceAnimation`, or null when the
 * controller or tracker is absent. `wm` is declared `any` by `main.js`. */
function workspaceAnimationTracker(): SwipeTrackerLike | null {
  const animation = (wm as { _workspaceAnimation?: { _swipeTracker?: SwipeTrackerLike | null } | null })._workspaceAnimation;
  return animation?._swipeTracker ?? null;
}

/** The shell-chrome events the tracker emits. Layout changes need no event:
 * the tracker re-reads the actors itself. */
export type ShellTrackerEvent =
  | { type: 'session-mode' }
  | { type: 'overview'; visible: boolean }
  | { type: 'workspace-actor-moved' }
  | { type: 'workspace-animation' }
  | { type: 'workspace-mode'; key: string };

export interface ShellTrackerDeps {
  signals: SignalRegistry;
  guard: (context: string, cb: () => void) => () => void;
  emit: (event: ShellTrackerEvent) => void;
}

export class ShellTracker {
  constructor(private readonly deps: ShellTrackerDeps) {}

  /** Subscribe to every shell-chrome source and take the initial actor read. */
  enable(): void {
    const { signals, guard, emit } = this.deps;
    signals.add('session-mode', sessionMode, 'notify::current-mode', guard('session-mode', () => {
      emit({ type: 'session-mode' });
    }));
    signals.add('overview', overview, 'showing', guard('overview-showing', () => {
      emit({ type: 'overview', visible: true });
    }));
    signals.add('overview', overview, 'hidden', guard('overview-hidden', () => {
      emit({ type: 'overview', visible: false });
    }));
    signals.add('layout', global.workspace_manager, 'workspace-added', guard('workspace-added', () => {
      this.refreshWorkspaceActors();
    }));
    signals.add('layout', global.workspace_manager, 'workspace-removed', guard('workspace-removed', () => {
      this.refreshWorkspaceActors();
    }));
    this.refreshWorkspaceActors();
    this.connectWorkspaceAnimation();
    this.watchWorkspaceModeSettings();
  }

  /** Disconnect every group this tracker subscribed. Idempotent. */
  disable(): void {
    const { signals } = this.deps;
    signals.disconnect('session-mode');
    signals.disconnect('overview');
    signals.disconnect('layout');
    signals.disconnect('workspace-actors');
    signals.disconnect('workspace-animation');
    signals.disconnect('settings');
  }

  /**
   * Workspace actors translate during a workspace switch — keyboard or
   * touchpad gesture — and never move when we tile a window. Watching their
   * position is therefore a precise, focus-independent transition signal.
   */
  refreshWorkspaceActors(): void {
    const { signals, guard, emit } = this.deps;
    signals.disconnect('workspace-actors');
    const workspaces = layoutWorkspaces();
    if (workspaces === null) return;
    for (const actor of workspaces) {
      if (actor === null || actor === undefined) continue;
      signals.add('workspace-actors', actor, 'notify::x', guard('workspace-actor-x', () => {
        emit({ type: 'workspace-actor-moved' });
      }));
      signals.add('workspace-actors', actor, 'notify::y', guard('workspace-actor-y', () => {
        emit({ type: 'workspace-actor-moved' });
      }));
    }
  }

  /**
   * §23.2: GNOME's WorkspaceAnimationController slides clones of the windows
   * while a switch runs, so the real window actors never move. The controller
   * emits no signal, but its swipe tracker does; attach to it so the border
   * hides the instant a gesture starts.
   */
  connectWorkspaceAnimation(): void {
    const { signals, guard, emit } = this.deps;
    const tracker = workspaceAnimationTracker();
    if (tracker === null || typeof tracker.connect !== 'function') return;
    signals.add('workspace-animation', tracker, 'begin', guard('workspace-animation-begin', () => {
      emit({ type: 'workspace-animation' });
    }));
    signals.add('workspace-animation', tracker, 'update', guard('workspace-animation-update', () => {
      emit({ type: 'workspace-animation' });
    }));
  }

  /**
   * §1: `dynamic-workspaces`, `workspaces-only-on-primary` and `num-workspaces`
   * live on system schemas and decide each screen's class and slot routing, but
   * were read per drain with no subscription — a flip in Tweaks left the class
   * stale until an unrelated Mutter signal. Watch them like the other reactive
   * settings and re-derive the placement state.
   */
  private watchWorkspaceModeSettings(): void {
    const { signals, guard, emit } = this.deps;
    const watch = (schema: string, key: string): void => {
      try {
        const store = new Gio.Settings({ schema_id: schema });
        signals.add('settings', store, `changed::${key}`, guard(`workspace-mode:${key}`, () => {
          emit({ type: 'workspace-mode', key });
        }));
      } catch {
        /* the schema is unavailable in this shell: nothing to watch */
      }
    };
    watch('org.gnome.mutter', 'dynamic-workspaces');
    watch('org.gnome.mutter', 'workspaces-only-on-primary');
    watch('org.gnome.desktop.wm.preferences', 'num-workspaces');
  }
}
