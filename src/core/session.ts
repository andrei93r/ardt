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
  /** True when tiling, retiles and the scan tick must stop. */
  paused: boolean;
  /** Whether the border may be shown (before other suppressions). */
  indicatorVisible: boolean;
  /** Suppression to add to the border while in this mode, if any. */
  indicatorSuppression: 'pause' | null;
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

  constructor(mode: SessionMode = 'user') {
    this.mode = mode;
  }

  get state(): SessionState {
    return { mode: this.mode, paused: this.isPaused };
  }

  get isPaused(): boolean {
    return this.mode === 'unlock-dialog';
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
    return {
      paused: mode === 'unlock-dialog',
      indicatorVisible: mode === 'user',
      indicatorSuppression: mode === 'unlock-dialog' ? 'pause' : null,
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
}
