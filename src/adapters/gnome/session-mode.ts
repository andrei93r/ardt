// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §19: the session-mode and pause policy.
 *
 * Owns the derived pause predicate (lock / manual pause / opt-in sharing
 * pause), the mode effects on the border suppression and scanning, the
 * re-derivation on the periodic pass, the user pause and the test-injected
 * mode. The live machine, session, settings and border are reached through
 * `SessionModeDeps`; the indicator/motion policy stays in the extension and is
 * called back.
 */

import { sessionMode } from 'resource:///org/gnome/shell/ui/main.js';

import type { BorderState } from '../../core/border.js';
import type { SessionMachine } from '../../core/session.js';
import type { SessionMode } from '../../core/session.js';
import type { History } from './history.js';
import type { WindowSession } from './session.js';
import type { GnomeSettings } from './settings.js';

/** The slice of extension state the session-mode policy needs. */
export interface SessionModeDeps {
  readonly settings: GnomeSettings;
  readonly session: WindowSession;
  readonly sessionMachine: SessionMachine;
  readonly border: BorderState;
  readonly history: History;
  stopMotionWatch(): void;
  suppressBorder(reason: 'pause' | 'sharing'): void;
  unsuppressBorder(reason: 'pause' | 'sharing'): void;
  syncIndicator(): void;
  syncPreview(): void;
}

export class SessionModeController {
  /** A mode injected by the test trigger, overriding the live session mode. */
  private injectedMode: SessionMode | null = null;

  constructor(private readonly deps: SessionModeDeps) {}

  currentMode(): SessionMode {
    return sessionMode.currentMode as SessionMode;
  }

  isPaused(): boolean {
    const { session, sessionMachine } = this.deps;
    // §19: while the drain finishes the backlog a pause caught, policy runs as
    // if unpaused; new work is still refused where it is pushed.
    if (session.isDrainingBacklog()) return false;
    // The one pause predicate: the session machine (lock or a manual pause) and
    // — only when the user opted in — screen sharing. Sharing is re-derived from
    // the live mode plus the setting on every call (this is the drain's gate),
    // never latched by a signal handler, so a missed transition cannot strand it.
    if (sessionMachine.isPaused) return true;
    return sessionMachine.state.mode === 'screen-sharing' && this.pauseDuringSharing();
  }

  /** §19: whether the user asked adrt to pause while sharing/remote desktop. */
  pauseDuringSharing(): boolean {
    return this.deps.settings.boolean('pause-during-sharing', false);
  }

  /**
   * §19: the user pause (`kb-toggle-pause` and the `TogglePause` trigger). It
   * lives in the session machine (folded into `isPaused`), so the tiling engine,
   * the drain and the indicator all see it with no extra plumbing. Resuming asks
   * for one reconcile so windows that moved while paused are re-tiled.
   */
  setTilingPaused(paused: boolean): void {
    const { session, sessionMachine } = this.deps;
    if (sessionMachine.manualPause === paused) {
      return;
    }
    sessionMachine.setManualPause(paused);
    if (paused) {
      this.deps.stopMotionWatch();
      // Reuse the session pause suppression so the border state and every
      // `border_visible` reader see a manual pause exactly like a locked session.
      this.deps.suppressBorder('pause');
    } else {
      this.deps.unsuppressBorder('pause');
      session.scheduleReconcile('manual-resume');
    }
    this.deps.syncIndicator();
    this.deps.syncPreview();
    this.deps.history.log('session_mode', { mode: sessionMachine.state.mode, paused: this.isPaused(), manualPaused: paused });
  }

  applySessionMode(mode: SessionMode, initial = false): void {
    const { session, sessionMachine } = this.deps;
    // §19: read the pre-transition sharing-pause before the machine moves, so
    // resuming retiles exactly when the mode we are leaving was actually paused.
    const leftSharingPaused = sessionMachine.state.mode === 'screen-sharing' && this.pauseDuringSharing();
    const effects = sessionMachine.setMode(mode);
    // Gate the sharing suppression on the setting: with it off, sharing is
    // ignored entirely (no highlight suppression, tiling continues); with it on,
    // the highlight hides and `isPaused()` stops reflowing.
    const suppression = effects.indicatorSuppression === 'sharing' && !this.pauseDuringSharing()
      ? null
      : effects.indicatorSuppression;
    if (suppression !== null) {
      this.deps.suppressBorder(suppression);
    } else {
      this.deps.unsuppressBorder('sharing');
      // A manual pause is a suppression of its own; do not clear it on an
      // unrelated session transition.
      if (sessionMachine.manualPause) this.deps.suppressBorder('pause');
      else this.deps.unsuppressBorder('pause');
    }
    session.setScanning(effects.scanTickRunning);
    this.deps.syncIndicator();
    if (!initial && (effects.retileOnResume || (mode === 'user' && leftSharingPaused))) {
      session.scheduleReconcile('session-resume');
    }
    this.deps.history.log('session_mode', { mode, paused: effects.paused, sharingPaused: leftSharingPaused });
  }

  /**
   * §19: the sharing suppression is a property of the mode and the setting, not
   * of the signal that entered it. Re-derived on the periodic pass so a missed
   * transition (or a setting flip while already sharing) cannot leave it stale.
   */
  refreshSharingSuppression(): void {
    const { sessionMachine, border } = this.deps;
    const want = sessionMachine.state.mode === 'screen-sharing' && this.pauseDuringSharing();
    const active = border.isSuppressed('sharing');
    if (want === active) return;
    if (want) this.deps.suppressBorder('sharing');
    else this.deps.unsuppressBorder('sharing');
    this.deps.syncIndicator();
  }

  /**
   * §19: re-derive the session-mode property from the live `sessionMode` on the
   * periodic pass. The `notify::current-mode` signal is the primary path, but a
   * missed or raced transition (a lock during a Shell restart) must not leave
   * adrt unpaused while the session is locked. Reads only; `applySessionMode`
   * runs the effects on a real change.
   */
  refreshSessionMode(): void {
    // A test-injected mode (SimulateSessionMode) owns the state until a real
    // session transition clears it; re-deriving would revert the injection.
    if (this.injectedMode !== null) return;
    const mode = this.currentMode();
    if (mode === this.deps.sessionMachine.state.mode) return;
    this.applySessionMode(mode);
  }

  /** A live session transition always wins over a test-injected mode. */
  onLiveTransition(): void {
    this.injectedMode = null;
    this.applySessionMode(this.currentMode());
  }

  /** Test trigger `SimulateSessionMode`. */
  simulate(mode: string): boolean {
    if (mode !== 'user' && mode !== 'unlock-dialog' && mode !== 'screen-sharing' && mode !== 'suspend') return false;
    // §19: suspend is treated as lock. The injected mode overrides the live one
    // until a real `notify::current-mode` transition clears it.
    const resolved: SessionMode = mode === 'suspend' ? 'unlock-dialog' : mode;
    this.injectedMode = resolved;
    this.applySessionMode(resolved);
    return true;
  }
}
