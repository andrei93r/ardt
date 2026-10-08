// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §Self-heal: the extension-level restart policy.
 *
 * Caught errors (fed in by the extension's error boundary) are counted in a
 * sliding window; a burst triggers one in-place restart on idle, and a fault
 * that outlives the per-window restart cap self-disables the extension and
 * leaves the Shell running. The lifecycle (`enableWith`/`disableWith`), the
 * journal, the history and the interaction check stay in the extension and are
 * reached through `RecoveryDeps`.
 *
 * Hard truth: a JS try/catch cannot catch the failures that actually take GNOME
 * down (`already disposed`, `clutter_actor_remove_child`, `g_closure_unref`,
 * Mutter monitor assertions are C-level) — that is what the dispose-safe
 * teardown and the monitor-index bounds prevent. This machinery recovers from
 * what JS *can* catch, and never claims more.
 */

import GLib from 'gi://GLib';
import { notify } from 'resource:///org/gnome/shell/ui/main.js';

import type { History } from './history.js';
import type { EventJournal } from './journal.js';

/** §Self-heal: N caught errors inside this window triggers one in-place restart. */
const RECOVERY_WINDOW_MS = 60_000;
/** §Self-heal: the error burst size that asks for a restart. */
const RECOVERY_THRESHOLD = 3;
/** §Self-heal: restarts are capped per window, so a persistent fault cannot loop. */
const RESTART_WINDOW_MS = 10 * 60_000;
/** §Self-heal: beyond this many restarts the extension self-disables instead. */
const RESTART_CAP = 3;

/** The slice of extension state the recovery policy needs. */
export interface RecoveryDeps {
  history(): History | undefined;
  journal(): EventJournal | undefined;
  /** Whether a user interaction is in flight: a restart must never cut it. */
  interactionActive(): boolean;
  /** The extension's teardown body (`disableWith`). */
  teardown(): void;
  /** The extension's enable body (`enableWith`), run with a fresh start time. */
  reinitialize(): void;
  /** The extension's error boundary, for logging a failed restart step. */
  reportError(context: string, error: unknown): void;
}

export class Recovery {
  /** Timestamps of caught errors inside the current window. */
  private recoveryErrors: number[] = [];
  /** Timestamps of in-place restarts, for the per-window cap. */
  private restartTimes: number[] = [];
  private restartPending = false;
  private restarting = false;
  private restartDeferred = false;
  private selfDisabled = false;
  /** True while GNOME itself is disabling the extension (never restart then). */
  private gnomeDisabled = false;
  private restarts = 0;
  private selfDisables = 0;

  constructor(private readonly deps: RecoveryDeps) {}

  /** Cumulative in-place restarts (add-only diagnostics). */
  get restartCount(): number {
    return this.restarts;
  }

  /** Cumulative self-disables (add-only diagnostics). */
  get selfDisableCount(): number {
    return this.selfDisables;
  }

  /**
   * A real enable resets the per-enable recovery state; the cumulative counters
   * stay (add-only diagnostics).
   */
  resetForEnable(): void {
    this.gnomeDisabled = false;
    this.selfDisabled = false;
    this.restartPending = false;
    this.restarting = false;
    this.restartDeferred = false;
    this.recoveryErrors = [];
  }

  /** §Self-heal: a GNOME-initiated disable is never a moment to restart. */
  markGnomeDisable(): void {
    this.gnomeDisabled = true;
  }

  /** Feed one caught error into the sliding recovery window. */
  noteError(context: string): void {
    if (this.selfDisabled || this.gnomeDisabled) return;
    const now = Date.now();
    this.recoveryErrors = this.recoveryErrors.filter((t) => now - t < RECOVERY_WINDOW_MS);
    this.recoveryErrors.push(now);
    if (this.recoveryErrors.length >= RECOVERY_THRESHOLD) this.considerRecovery(context);
  }

  /**
   * The recovery policy. Runs whenever the error window fills, and again when
   * a deferred restart's obstacle (a drag, a transition) clears. Never restarts
   * inline: the work is scheduled on idle, always outside the emission that
   * caught the error.
   *
   * Returns true when a restart is pending, scheduled or deferred; false only
   * when recovery is impossible (self-disabled, GNOME disable, or the cap
   * reached) — `enable()` uses that to rethrow so GNOME disables cleanly (1.11).
   */
  considerRecovery(context: string): boolean {
    if (this.selfDisabled || this.gnomeDisabled) return false;
    if (this.restarting || this.restartPending) return true;
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restartTimes.length >= RESTART_CAP) {
      this.selfDisable(context);
      return false;
    }
    // Never restart mid-gesture or mid-transition; defer until it ends (the
    // drag-end path and the motion tick re-run this check).
    if (this.deps.interactionActive()) {
      this.restartDeferred = true;
      return true;
    }
    this.restartPending = true;
    this.restartTimes.push(now);
    this.recoveryErrors = [];
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.restartPending = false;
      this.restartDeferred = false;
      this.restartInPlace(context);
      return GLib.SOURCE_REMOVE;
    });
    return true;
  }

  /**
   * Re-check a deferred restart once the interaction that blocked it has
   * ended (a released drag). The threshold was already met; this only waits
   * for the obstacle to clear.
   */
  reconsiderDeferredRestart(): void {
    if (!this.restartDeferred || this.deps.interactionActive()) return;
    this.restartDeferred = false;
    this.considerRecovery('interaction-ended');
  }

  /**
   * The in-process restart: a full internal teardown and re-init inside the
   * same loaded extension — never `Main.extensionManager` reload/enable (that
   * unloads and reloads modules mid-signal). Runs on idle, never inline, and
   * is visible: a log line, a history entry and a DumpState counter.
   */
  private restartInPlace(context: string): void {
    if (this.selfDisabled || this.gnomeDisabled) return;
    this.restarting = true;
    try {
      this.deps.history()?.log('extension_restart', { reason: context, at: Date.now(), restarts: this.restarts + 1 });
      this.deps.journal()?.record('model', 'extension_restart', { reason: context });
    } catch {
      /* the journal may be gone already; the restart itself is the fix */
    }
    console.warn(`[adrt] restarting in place after repeated caught errors (${context})`);
    this.restarts += 1;
    try {
      this.deps.teardown();
    } catch (error) {
      this.deps.reportError('restart-teardown', error);
    }
    try {
      this.deps.reinitialize();
    } catch (error) {
      this.deps.reportError('restart-enable', error);
    } finally {
      this.restarting = false;
    }
  }

  /**
   * The last resort: the fault outlived the restart cap. Tear everything down
   * and leave the Shell running, with a toast pointing the user at Extensions.
   * The Shell still sees the extension as enabled; the next `enable()` (from
   * Extensions, or the harness) starts fresh.
   */
  private selfDisable(context: string): void {
    if (this.selfDisabled) return;
    this.selfDisabled = true;
    this.restartPending = false;
    this.restartDeferred = false;
    console.warn(`[adrt] self-disabling after repeated caught errors (${context}); re-enable from Extensions`);
    try {
      this.deps.history()?.log('extension_self_disable', { reason: context, at: Date.now() });
      this.deps.journal()?.record('model', 'extension_self_disable', { reason: context });
    } catch {
      /* journal gone: the counters still record it */
    }
    try {
      notify('Adrt', 'Adrt stopped itself after repeated internal errors. Re-enable it from the Extensions app.');
    } catch {
      /* no notification tray mid-shutdown */
    }
    this.selfDisables += 1;
    try {
      this.deps.teardown();
    } catch (error) {
      this.deps.reportError('self-disable', error);
    }
  }
}
