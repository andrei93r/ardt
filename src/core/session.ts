// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Session-mode state machine (§18). The adapter's single
 * `_onSessionModeChanged()` handler drives this and applies the emitted
 * effects; nothing else inspects the session mode.
 */

export type SessionMode = 'user' | 'unlock-dialog' | 'screen-sharing';

export interface SessionEffects {
  /**
   * True when tiling, retiles and the drain must stop: a locked session or a
   * manual pause (`isPaused`). The scan tick is governed separately by
   * `scanTickRunning`, so the two fields can disagree during a manual pause.
   */
  paused: boolean;
  /** Whether the border may be shown (before other suppressions). */
  indicatorVisible: boolean;
  /** Suppression to add to the border while in this mode, if any. */
  indicatorSuppression: 'pause' | 'sharing' | null;
  scanTickRunning: boolean;
  /** True exactly once when leaving the paused mode for `user`. */
  retileOnResume: boolean;
}

export interface SessionState {
  mode: SessionMode;
  paused: boolean;
}

export class SessionMachine {
  private mode: SessionMode;
  private retilePending = false;
  /**
   * A user-requested pause (the panel's Pause/Resume). It is not a session
   * *mode*: locking or sharing still pause on their own, and clearing this flag
   * never overrides them. Folded into the one `isPaused` predicate so every
   * existing pause consumer (tiling, the drain, the indicator) sees it.
   */
  private manualPaused = false;
  /**
   * A stable, frozen snapshot of the two public fields. The getter returns this
   * object by reference, so a poll does not allocate per read; every transition
   * that can change it (`setMode`, `setManualPause`) rebuilds it once.
   */
  private stateView: SessionState;

  constructor(mode: SessionMode = 'user') {
    this.mode = mode;
    this.stateView = Object.freeze({ mode, paused: this.isPaused });
  }

  get state(): SessionState {
    return this.stateView;
  }

  /** The one pause predicate: a locked session or a manual user pause. */
  get isPaused(): boolean {
    return this.mode === 'unlock-dialog' || this.manualPaused;
  }

  /** Whether the user paused tiling manually (as opposed to a session mode). */
  get manualPause(): boolean {
    return this.manualPaused;
  }

  /** Set the user-requested pause. Idempotent; never touches the session mode. */
  setManualPause(paused: boolean): void {
    if (this.manualPaused === paused) return;
    this.manualPaused = paused;
    this.refreshStateView();
  }

  get indicatorVisible(): boolean {
    return this.mode === 'user';
  }

  /**
   * Move to a new mode and return the effects to apply. `retileOnResume` is
   * true on the transition out of `unlock-dialog` back to `user`, and is
   * cleared by the next call so the active workspace retiles exactly once.
   */
  setMode(mode: SessionMode): SessionEffects {
    const previous = this.mode;
    this.mode = mode;
    const retileOnResume = previous === 'unlock-dialog' && mode === 'user' && !this.retilePending;
    this.retilePending = retileOnResume;
    this.refreshStateView();
    return {
      // The same combined predicate `state.paused` exposes, so the two answers
      // cannot diverge: a manual pause keeps tiling stopped across a transition.
      paused: this.isPaused,
      indicatorVisible: mode === 'user',
      indicatorSuppression: mode === 'unlock-dialog' ? 'pause' : mode === 'screen-sharing' ? 'sharing' : null,
      scanTickRunning: mode !== 'unlock-dialog',
      retileOnResume,
    };
  }

  /** Consume a pending resume retile. */
  consumeRetile(): boolean {
    const pending = this.retilePending;
    this.retilePending = false;
    return pending;
  }

  /** Rebuild the frozen `state` snapshot after a field it exposes changed. */
  private refreshStateView(): void {
    this.stateView = Object.freeze({ mode: this.mode, paused: this.isPaused });
  }
}
