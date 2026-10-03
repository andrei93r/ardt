// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Extension entry point (§2.1). Constructs nothing in the constructor; every
 * object is created in `enable()` and destroyed in `disable()` (§4.1).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { notify, overview, sessionMode, wm } from 'resource:///org/gnome/shell/ui/main.js';

import type { AdaptationRecord, Bundle, ImportMode } from '../../core/config.js';
import { BUNDLE_FORMAT, BUNDLE_VERSION, normalizeBundle, serializeBundle } from '../../core/config.js';
import { BorderState } from '../../core/border.js';
import type { SuppressionReason } from '../../core/border.js';
import { SessionMachine } from '../../core/session.js';
import type { SessionMode } from '../../core/session.js';
import { ChangeLog } from '../../core/undo.js';
import { migrateRulesJson } from '../../core/rules.js';
import type { SplitAxis } from '../../core/tiler.js';
import { ratioKey } from '../../core/tiler.js';
import type { MemoryEntry } from '../../core/displays.js';
import { NoticeGate, isAlwaysNotice, noticeTitle } from '../../core/notify.js';
import { clamp, Layer } from '../../core/types.js';
import type { Rect, Screen } from '../../core/types.js';
import type { GestureKind } from '../../core/gestures.js';
import type { DbusHandlers } from '../../platform/dbus.js';
import { PLATFORM_EVENT_TYPES } from '../../platform/events.js';
import { dataDir, readJson, readText, writeAtomic } from './adapt.js';
import * as compat from './compat.js';
import { GnomeDbus } from './dbus.js';
import { createAnimationLedger } from './frame-clock.js';
import type { Animator } from './frame-clock.js';
import { GestureInput } from './gesture-input.js';
import { GnomeHost } from './host.js';
import { History } from './history.js';
import { GnomeIndicator } from './indicator.js';
import { EventJournal } from './journal.js';
import { SignalRegistry, TimeoutRegistry } from './lifecycle.js';
import { Recorder } from './recorder.js';
import { RecordingPrompt } from './recording-prompt.js';
import { RegistryStore } from './registry.js';
import { WindowSession } from './session.js';
import { ShellTracker } from './shell-tracker.js';
import type { ShellTrackerEvent } from './shell-tracker.js';
import type { TrackedWindow } from './tracked-window.js';
import { GnomeSettings } from './settings.js';
import { GnomeTiming } from './timing.js';
import { Tiling } from './tiling.js';
import type { TraceInitial, TraceWorkspace, TraceEntry } from '../../core/replay.js';

/**
 * The release version the user sees (metadata.json / package.json). Distinct
 * from `EXTENSION_VERSION`, which is the *settings and state format* version the
 * migration gate compares against — the two must not be conflated in DumpState.
 */
const RELEASE_VERSION = '0.2.0';
/** The settings/state format version (the migration gate). */
const EXTENSION_VERSION = 1;
/** §23.2: how many compositor frames between focused-actor position samples.
 * The wall-clock interval is derived from the screen's refresh rate (or the
 * measured interval under adaptive sync), never a fixed 50 ms. */
const MOTION_POLL_FRAMES = 3;
const MOTION_STABLE_SAMPLES = 3;
/** §35: at least this long between safety-net retiles, measured in frames. */
const MOTION_RETILE_MS = 500;
/** Ignore movement for this long after we applied a plan ourselves. Internal
 * signal-latency guard, not a frame cadence. */
const MOTION_SELF_MS = 200;
/** §35: how often the coherence sweep guarantees every window is tiled. Internal
 * safety cadence. */
const COHERENCE_SWEEP_MS = 700;
/** Startup settle before normalising existing workspaces (adoption is async). */
const NORMALIZE_ON_ENABLE_MS = 400;
/** §23.2: a workspace-switch animation still running after this is torn down. */
const SWITCH_WATCHDOG_MS = 1500;
/** §Self-heal: N caught errors inside this window triggers one in-place restart. */
const RECOVERY_WINDOW_MS = 60_000;
/** §Self-heal: the error burst size that asks for a restart. */
const RECOVERY_THRESHOLD = 3;
/** §Self-heal: restarts are capped per window, so a persistent fault cannot loop. */
const RESTART_WINDOW_MS = 10 * 60_000;
/** §Self-heal: beyond this many restarts the extension self-disables instead. */
const RESTART_CAP = 3;

/**
 * Parse the `SpawnWindow` argv argument. A JSON array is the supported form; a
 * plain string keeps the original single-string trigger working (split on
 * spaces, no shell — exactly the old behaviour).
 */
function parseSpawnArgv(argvJson: string): string[] {
  const text = argvJson.trim();
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((part) => String(part)).filter((part) => part.length > 0);
    } catch {
      /* fall through to the legacy split */
    }
  }
  return text.split(' ').filter((part) => part.length > 0);
}

/**
 * Parse the `SpawnWindow` env argument: a JSON object of `KEY: value`, or a
 * JSON array of `KEY=value` strings. Empty / `null` / `[]` means inherit only.
 */
function parseSpawnEnv(envJson: string): [string, string][] {
  const text = envJson.trim();
  if (text.length === 0 || text === 'null' || text === '{}' || text === '[]') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const out: [string, string][] = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const equals = String(item).indexOf('=');
      if (equals > 0) out.push([String(item).slice(0, equals), String(item).slice(equals + 1)]);
    }
  } else if (parsed !== null && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) out.push([key, String(value)]);
  }
  return out;
}

interface ExtraHandlers {
  ActivateWindow(id: number): boolean;
  ActivateWorkspace(index: number): boolean;
  ToggleFloat(id: number): boolean;
  SimulateResize(a: number, b: number, ratio: number): boolean;
  SwapPair(a: number, b: number): boolean;
  InjectVerifyFailure(id: number, count: number): boolean;
  FocusDirection(direction: string): boolean;
  FocusCycle(): boolean;
  MoveToward(direction: string): boolean;
  CloseWindow(id: number): boolean;
  BeginDrag(id: number): boolean;
  EndDrag(id: number): boolean;
  MoveWindow(id: number, x: number, y: number, width: number, height: number): boolean;
  MinimizeWindow(id: number): boolean;
  MaximizeWindow(id: number): boolean;
  UnmaximizeWindow(id: number): boolean;
  ResetLayoutState(): boolean;
  SimulateOverview(visible: boolean): boolean;
  SimulateWorkspaceSwitch(holdMs: number): boolean;
  MoveToWorkspace(id: number, index: number): boolean;
  MarkWorkspaceCached(id: number, index: number): boolean;
  MoveDirection(direction: string): boolean;
  ToggleFullscreen(id: number): boolean;
  QuitFocused(): boolean;
  SimulateAbove(id: number): boolean;
  SimulateSticky(id: number, sticky: boolean): boolean;
  SimulateWorkspaceReorder(from: number, to: number): boolean;
  SimulateWorkspaceOrientation(vertical: boolean): boolean;
  CursorToCentre(): boolean;
  TogglePause(): boolean;
  InjectFault(context: string): boolean;
  SimulateChromeTeardown(): boolean;
  StartFrameRecording(): boolean;
  StopFrameRecording(): boolean;
}

type Handlers = DbusHandlers & ExtraHandlers;

export default class AdrtExtension extends Extension {
  private settings!: GnomeSettings;
  private host!: GnomeHost;
  private timing!: GnomeTiming;
  private registry!: RegistryStore;
  private history!: History;
  private journal!: EventJournal;
  private changes!: ChangeLog;
  private indicator!: GnomeIndicator;
  private animator!: Animator;
  private tiling!: Tiling;
  private session!: WindowSession;
  private gestures!: GestureInput;
  private dbus!: GnomeDbus;
  /** Shell-chrome subscriptions; emits events, keeps no policy (§11). */
  private tracker!: ShellTracker;
  private border!: BorderState;
  private sessionMachine = new SessionMachine();
  /** The start/stop bug recorder; inert until a `StartRecording` request. */
  private recorder: Recorder | null = null;
  /** The observation prompt shown after a user stop; null outside `enable()`. */
  private recordingPrompt: RecordingPrompt | null = null;
  /** A mode injected by the test trigger, overriding the live session mode. */
  private injectedMode: SessionMode | null = null;

  private readonly notices = new NoticeGate();
  /** Why focus last moved, as far as adrt knows (the shell moves it itself). */
  private focusReason = 'shell';
  private injectionEnabled = false;
  private injectSeat: any = null;
  private injectPointer: any = null;
  private injectKeyboard: any = null;
  /** Errors caught by the outer boundaries (enable, signal handlers). */
  private errorCount = 0;
  /**
   * §Self-heal: caught errors never propagate into the Shell; when they come
   * in bursts the extension restarts itself in place, and when a persistent
   * fault outlives the restart cap it self-disables and leaves the Shell
   * running. Hard truth: a JS try/catch cannot catch the failures that
   * actually take GNOME down (`already disposed`, `clutter_actor_remove_child`,
   * `g_closure_unref`, Mutter monitor assertions are C-level) — that is what
   * the dispose-safe teardown and the monitor-index bounds prevent. This
   * machinery recovers from what JS *can* catch, and never claims more.
   */
  /** Timestamps of caught errors inside the current window. */
  private recoveryErrors: number[] = [];
  /** Timestamps of in-place restarts, for the per-window cap. */
  private restartTimes: number[] = [];
  private restartPending = false;
  private restarting = false;
  private restartDeferred = false;
  private selfDisabled = false;
  /** True while GNOME itself is disabling the extension (never restart then). */
  private gnomeDisable = false;
  private restarts = 0;
  private selfDisables = 0;
  private lastErrorAt = 0;
  /** Owns every compositor/shell signal connection, per teardown group (§36). */
  private signals!: SignalRegistry;
  /** Owns every GLib timer, per teardown name (§36). */
  private timers!: TimeoutRegistry;
  /** True once `disable()` has run; a second disable is a no-op (§36). */
  private disabled = false;
  /** What build is actually running (set at enable). */
  private buildDirMtimeMs = 0;
  private motionLastX = Number.NaN;
  private motionLastY = Number.NaN;
  private motionStable = 0;
  private motionTicks = 0;
  private motionRetiles = 0;
  private motionSkip = '';
  /** The interval the motion sampler is currently armed with, in ms. */
  private motionPollMs = 0;
  /** Ticks per safety-net retile, re-derived from the sampler interval. */
  private motionRetileTicks = 10;
  /** The last observed frame timestamp, for VRR measurement (µs). */
  private lastFrameUs = 0;
  /**
   * GNOME's animation state as found at enable. adrt does not write it, so
   * `disable()` restores exactly this (a no-op unless a future path mutates).
   */
  private animationsBaseline: { enableAnimations: boolean | null; slowDownFactor: number | null } = {
    enableAnimations: null,
    slowDownFactor: null,
  };
  /** Set only if adrt ever writes GNOME's animation state (never today). */
  private animationsMutated = false;
  private occluded = false;
  /** Last `(visible,id,rect)` the border was drawn at, so `border focus` logs only on change (§22). */
  private lastBorderDraw = '';
  /** Last drop-assist overlay, so `preview_show`/`preview_hide` log only on change (§22). */
  private lastPreviewDraw = '';
  private wsSwitchEvents = 0;
  private motionSuppressions = 0;
  private settingWatchers: (() => void)[] = [];
  private keybindings: string[] = [];
  private hostUnsubscribers: (() => void)[] = [];
  private frameSamples = 0;
  /** §22/Stage 6: the model state recording started from, for a replayable trace. */
  private recordInitial: TraceInitial | null = null;

  enable(): void {
    const started = GLib.get_monotonic_time();
    // §Self-heal: a real enable (GNOME entry point) resets the recovery state —
    // a re-enabled extension is a fresh start. The cumulative counters stay
    // (add-only diagnostics).
    this.gnomeDisable = false;
    this.selfDisabled = false;
    this.restartPending = false;
    this.restarting = false;
    this.restartDeferred = false;
    this.recoveryErrors = [];
    // §36: the entry point is the most important boundary — a throw here makes
    // GNOME disable the extension (and can cascade in the Shell). Catch it, log
    // it, and let `disable()` clean up whatever was half-built.
    try {
      this.enableWith(started);
    } catch (error) {
      this.reportError('enable', error);
    }
  }

  /** The enable body, guarded by `enable()` so one error cannot disable adrt. */
  private enableWith(started: number): void {
    // The journal comes first: everything below it may log a decision.
    this.journal = new EventJournal(30);
    this.journal.prune();
    this.injectionEnabled = GLib.getenv('ADRT_INJECT') === '1';
    // Record which build is loaded: on Wayland a logout is needed to reload, so
    // "is the running module the one I installed?" must be answerable at a glance.
    try {
      const dir = (this as unknown as { path?: string }).path;
      if (typeof dir === 'string' && dir.length > 0) {
        const info = Gio.File.new_for_path(dir).query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
        const when = info.get_modification_date_time();
        this.buildDirMtimeMs = when === null ? 0 : when.to_unix() * 1000;
      }
    } catch {
      this.buildDirMtimeMs = 0;
    }
    this.settings = new GnomeSettings(this.getSettings());
    this.signals = new SignalRegistry();
    this.timers = new TimeoutRegistry();
    this.disabled = false;
    this.timing = new GnomeTiming({
      screens: () => this.host?.screens() ?? [],
      animationsDisabled: () => this.settings.boolean('disable-animations', false),
      adaptiveSync: () => this.host?.adaptiveSyncSupported() ?? false,
      onChanged: () => undefined,
    });
    this.captureAnimationBaseline();
    this.applyAnimationSetting();

    this.history = new History(
      this.settings.boolean('history-enabled', true),
      this.settings.int('history-retention-days', 30),
      this.settings.boolean('history-daily-folders', false),
      this.settings.int('history-max-bytes', 8388608),
    );
    this.history.setSink((event) => this.journal.decide(event.ev, event as unknown as Record<string, unknown>));
    this.migrate();
    this.registry = new RegistryStore();
    this.registry.load();
    // §12: fold the legacy stores in exactly once (copy-verify-delete).
    this.registry.migrateLegacy({
      adaptation: readJson(`${dataDir()}/adaptation.json`),
      behavior: readJson(`${dataDir()}/behavior.json`),
      exceptionApps: this.settings.strv('exception-apps'),
    });
    this.registry.setEnabled(this.settings.boolean('adaptation-enabled', true));
    // §23: fold legacy rule floats into the Never-tile list once, before any
    // window is classified, and drop the dead global gate.
    this.migrateRuleFloats();
    this.changes = new ChangeLog();
    this.border = new BorderState();

    this.host = new GnomeHost((context, error) => this.reportError(context, error));
    this.host.enable();

    this.indicator = new GnomeIndicator(this.settings, this.timing);
    this.animator = createAnimationLedger({
      isAlive: (id) => this.session.windows.has(id),
      // §Self-heal containment: these run inside Clutter timeline signal
      // emissions — a throw must never propagate out of them.
      apply: (id, rect) => this.guard('animator-apply', () => this.host.applyFrame(id, rect))(),
      onFrame: (id, rect) => this.guard('animator-frame', () => this.onAnimatedFrame(id, rect))(),
    });

    this.tiling = new Tiling({
      host: this.host,
      settings: this.settings,
      timing: this.timing,
      history: this.history,
      registry: this.registry,
      animator: this.animator,
      changes: this.changes,
      windows: () => this.session.windows,
      isPaused: () => this.isPaused(),
      onRatiosChanged: () => this.saveState(),
      onStubborn: (appId) => this.onStubborn(appId),
    });

    this.session = new WindowSession({
      host: this.host,
      settings: this.settings,
      timing: this.timing,
      tiling: this.tiling,
      history: this.history,
      registry: this.registry,
      changes: this.changes,
      isPaused: () => this.isPaused(),
      onStateChanged: () => this.onStateChanged(),
      onStubborn: (appId) => this.onStubborn(appId),
      onClosed: (id, rect) => this.onWindowClosed(id, rect),
      onDragChanged: (dragging) => this.onDragChanged(dragging),
      onWindowMoving: () => this.suppressForWorkspaceSwitch(),
      onNotice: (key, subject) => {
        this.toast(key, subject);
      },
      onModelEvent: (event, fields) => this.onModelEvent(event, fields),
      onDisplayMemoryChanged: () => this.saveDisplayMemory(),
      isAnimating: () => this.animator.activeCount > 0,
    });

    // §22 extension: the bug recorder. Constructed inert: it attaches no
    // journal sink and arms no timer until `StartRecording`.
    this.recorder = new Recorder({
      journal: this.journal,
      build: () => ({ version: RELEASE_VERSION, dirMtimeMs: this.buildDirMtimeMs }),
      mode: () => this.sessionMachine.state.mode,
      paused: () => this.isPaused(),
      monitors: () => this.host.screens().map((screen) => ({ ...screen })),
      settings: () => this.settings.snapshot(),
      snapshot: () => this.recordSnapshot(),
      onChanged: () => undefined,
    });
    // §22 extension: the observation prompt. Built empty; `show()` is lazy so
    // no Shell chrome exists until a user stop actually needs it.
    this.recordingPrompt = new RecordingPrompt();

    const injectedFailures = this.settings.int('debug-inject-verify-failure', 0);
    if (injectedFailures > 0) this.tiling.injectVerifyFailures(injectedFailures);

    this.gestures = new GestureInput(this.settings, this.history, {
      // §Self-heal containment: these run inside stage signal emissions.
      switchWorkspace: (direction) => this.guard('gesture:switch-workspace', () => this.switchWorkspace(direction))(),
      toggleOverview: () => this.guard('gesture:overview', () => overview.toggle())(),
      showDesktop: () => this.guard('gesture:show-desktop', () => overview.toggle())(),
      swapPair: (direction) => this.guard('gesture:swap-pair', () => this.session.moveToward(direction))(),
      custom: (action) => this.guard('gesture:custom', () => this.history.log('gesture', { custom: action }))(),
    });

    this.restoreState();
    this.restoreDisplayMemory();
    this.subscribeHost();
    this.watchSettings();

    // §22: the trace's initial state is the model before any window is adopted.
    this.captureRecordInitial();
    for (const win of global.display.list_all_windows()) this.session.register(win);
    // §20: every enable normalises the existing workspaces. Adoption finishes on
    // the first ready timeout, so normalisation is deferred just past it; the
    // pass itself is idempotent.
    this.timers.add('normalize-enable', NORMALIZE_ON_ENABLE_MS, this.guard('normalize-enable', () => {
      this.session?.normalizeOnEnable();
    }));

    this.gestures.configure();
    if (this.settings.boolean('dbus-enabled', true)) {
      this.dbus = new GnomeDbus();
      // §Self-heal containment: every D-Bus trigger runs inside the boundary,
      // so a throw in one method reports and returns instead of escaping into
      // the caller (or GJS's unhandled-exception path).
      this.dbus.expose(this.guardedHandlers());
    }

    // §11: shell-chrome subscriptions live in the tracker, which only emits;
    // every policy branch below stays here.
    this.tracker = new ShellTracker({
      signals: this.signals,
      guard: (context, cb) => this.guard(context, cb),
      emit: (event) => this.onTrackerEvent(event),
    });
    this.tracker.enable();
    this.applySessionMode(this.currentMode(), true);
    // §23: hide the border if the extension is enabled while the overview is
    // already open (e.g. a headless shell that starts in it); the `showing`
    // signal has already fired by then. Tiling itself keeps running.
    if (overview.visible) this.onOverviewChanged(true);
    this.registerKeybindings();
    this.session.setScanning(true);
    // §35: a periodic guarantee, independent of signals: a normal window must
    // never be left untiled next to a sibling.
    this.timers.addInterval('coherence', COHERENCE_SWEEP_MS, this.guard('coherence-sweep', () => {
      this.session.coherenceSweep();
      this.refreshSessionMode();
      this.watchWorkspaceAnimation();
      this.refreshWorkspaceSwitchSuppression();
      this.refreshSharingSuppression();
    }));

    this.onStateChanged();
    this.firstRun();
    // Swap pairs are keyed by window id, which does not survive a restart.
    this.tiling.pruneSwapPairs(new Set(this.session.windows.keys()));
    this.history.log('tile', {
      event: 'enable',
      ms: Math.round((GLib.get_monotonic_time() - started) / 1000),
      version: EXTENSION_VERSION,
      buildDirMtimeMs: this.buildDirMtimeMs,
    });
  }

  disable(): void {
    // §19: `metadata.json` declares `session-modes: [user, unlock-dialog]`, so
    // the Shell keeps adrt *resident* while the screen is locked instead of
    // tearing it down. `disable()` therefore runs on logout/extension removal,
    // not on lock; the lock transition is handled by `applySessionMode`.
    // §Self-heal: a GNOME-initiated disable is never a moment to restart; mark
    // it so the recovery policy stays quiet through the teardown below.
    this.gnomeDisable = true;
    // §36: idempotent — a second disable is a no-op, so a re-entrant teardown
    // can never re-destroy a disposed actor.
    if (this.disabled) return;
    this.disabled = true;
    try {
      this.disableWith();
    } catch (error) {
      this.reportError('disable', error);
    }
  }

  /** The teardown body, shared by `disable()`, the in-place restart and the
   * self-disable. Idempotent: every step guards its own resource, so a second
   * run (or a run over a half-built enable) tears down what exists and skips
   * the rest. */
  private disableWith(): void {
    // §36: every teardown step is independent and guarded — if `enable()` threw
    // half-built, or one resource misbehaves, the rest still tears down cleanly.
    this.teardown('journal', () => this.journal?.destroy());
    this.teardown('log-disable', () => this.history?.log('disable', {}));
    this.teardown('motion', () => this.stopMotionWatch());
    this.teardown('coherence', () => this.timers.clear('coherence'));
    this.teardown('normalize', () => this.timers.clear('normalize-enable'));
    this.teardown('shell-tracker', () => this.tracker?.disable());
    this.teardown('simulate-workspace-switch', () => this.timers.clear('simulate-workspace-switch'));
    this.teardown('keybindings', () => this.unregisterKeybindings());
    this.teardown('setting-watchers', () => {
      for (const unsubscribe of this.settingWatchers) unsubscribe();
      this.settingWatchers = [];
      this.signals.disconnect('settings');
    });
    this.teardown('host-watchers', () => {
      for (const unsubscribe of this.hostUnsubscribers) unsubscribe();
      this.hostUnsubscribers = [];
    });
    this.teardown('dbus', () => {
      if (this.dbus !== undefined) this.dbus.unexpose();
    });
    this.teardown('recording-prompt', () => {
      this.recordingPrompt?.close();
      this.recordingPrompt = null;
    });
    this.teardown('recorder', () => {
      this.recorder?.destroy('disable');
      this.recorder = null;
    });
    this.teardown('gestures', () => this.gestures?.disable());
    this.teardown('session', () => this.session?.destroy());
    this.teardown('tiling', () => this.tiling?.destroy());
    this.teardown('animator', () => this.animator?.destroy());
    this.teardown('indicator', () => this.indicator?.destroy());
    this.teardown('host', () => this.host?.disable());
    this.teardown('registry', () => this.registry?.flush());
    this.teardown('display-memory', () => this.saveDisplayMemory());
    this.teardown('history', () => this.history?.destroy());
    this.teardown('state', () => this.saveState());
    // §18: restore GNOME's animations to what we found, never force them on for
    // a user who had turned them off.
    this.teardown('animation-baseline', () => this.restoreAnimationSetting());
    this.teardown('timing', () => this.timing?.destroy());
  }

  /** Run one teardown step; a failure is logged and never stops the rest. */
  private teardown(context: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.reportError(`disable:${context}`, error);
    }
  }

  /**
   * §36: guard a signal/actor callback so a throw is logged, never propagated
   * into the compositor's emission (which would disable adrt or crash the
   * Shell). One closure and one try/catch per event is the whole cost.
   */
  private guard(context: string, cb: () => void, marker = '[adrt] ERROR'): () => void {
    return (): void => {
      try {
        cb();
      } catch (error) {
        this.reportError(context, error, marker);
      }
    };
  }

  /**
   * §Self-heal containment: like `guard`, but for callbacks whose return value
   * matters (D-Bus method handlers). A contained throw still reports through
   * the boundary; the caller sees `undefined`.
   */
  private guardValue<A extends unknown[]>(context: string, cb: (...args: A) => unknown): (...args: A) => unknown {
    return (...args: A): unknown => {
      try {
        return cb(...args);
      } catch (error) {
        this.reportError(context, error);
        return undefined;
      }
    };
  }

  /**
   * §Self-heal containment: like `guard`, but for GLib source callbacks whose
   * boolean return arms the next tick. A contained throw ends the source —
   * the periodic safety nets re-arm on their own schedule.
   */
  private guardSource(context: string, cb: () => boolean): () => boolean {
    return (): boolean => {
      try {
        return cb();
      } catch (error) {
        this.reportError(context, error);
        return GLib.SOURCE_REMOVE;
      }
    };
  }

  /**
   * Log a caught error (`[adrt] ERROR`-style) and journal it. It is deliberately
   * loud: the boundary stops propagation, never hides the fault. The marker is
   * overridable only for the injected-fault test, which must not trip the
   * harness's `[adrt] ERROR` journal gate.
   */
  private reportError(context: string, error: unknown, marker = '[adrt] ERROR'): void {
    const message = error instanceof Error ? error.message : String(error);
    this.errorCount += 1;
    this.lastErrorAt = Date.now();
    console.error(`${marker} ${context}: ${message}`);
    try {
      this.journal?.record('error', 'guarded', { context, error: message });
    } catch {
      /* logging must never rethrow out of the boundary */
    }
    // §Self-heal: a caught error is also a recovery signal. It is still an
    // error — the policy decides whether to restart, never whether to report.
    this.noteRecoveryError(context);
  }

  // -------------------------------------------------------------- self-heal

  /** Whether a user interaction is in flight: a restart must never cut it. */
  private interactionActive(): boolean {
    return (
      this.session?.isDragging === true ||
      this.session?.clientInteractionActive === true ||
      this.animator?.activeCount > 0 ||
      this.workspaceAnimationActive()
    );
  }

  /** Feed one caught error into the sliding recovery window. */
  private noteRecoveryError(context: string): void {
    if (this.selfDisabled || this.gnomeDisable) return;
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
   */
  private considerRecovery(context: string): void {
    if (this.selfDisabled || this.gnomeDisable || this.restarting || this.restartPending) return;
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restartTimes.length >= RESTART_CAP) {
      this.selfDisable(context);
      return;
    }
    // Never restart mid-gesture or mid-transition; defer until it ends (the
    // drag-end path and the motion tick re-run this check).
    if (this.interactionActive()) {
      this.restartDeferred = true;
      return;
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
  }

  /**
   * Re-check a deferred restart once the interaction that blocked it has
   * ended (a released drag). The threshold was already met; this only waits
   * for the obstacle to clear.
   */
  private reconsiderDeferredRestart(): void {
    if (!this.restartDeferred || this.interactionActive()) return;
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
    if (this.selfDisabled || this.gnomeDisable) return;
    this.restarting = true;
    try {
      this.history?.log('extension_restart', { reason: context, at: Date.now(), restarts: this.restarts + 1 });
      this.journal?.record('model', 'extension_restart', { reason: context });
    } catch {
      /* the journal may be gone already; the restart itself is the fix */
    }
    console.warn(`[adrt] restarting in place after repeated caught errors (${context})`);
    this.restarts += 1;
    try {
      this.disableWith();
    } catch (error) {
      this.reportError('restart-teardown', error);
    }
    try {
      this.enableWith(GLib.get_monotonic_time());
    } catch (error) {
      this.reportError('restart-enable', error);
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
      this.history?.log('extension_self_disable', { reason: context, at: Date.now() });
      this.journal?.record('model', 'extension_self_disable', { reason: context });
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
      this.disableWith();
    } catch (error) {
      this.reportError('self-disable', error);
    }
  }

  /**
   * Test trigger: run a real throw through the boundary and report whether it
   * was caught. Uses a test-only marker so the harness's `[adrt] ERROR` gate is
   * not tripped by an expected fault.
   */
  private simulateFault(context: string): boolean {
    const before = this.errorCount;
    this.guard(`fault-test:${context}`, () => {
      throw new Error(`injected fault (${context})`);
    }, '[adrt] guard-test')();
    return this.errorCount > before;
  }

  /**
   * §Shell-stability test trigger: destroy the chrome actors exactly the way
   * the Shell's session end does, then leave the extension running, so a
   * scenario can disable/reload against chrome the Shell has already torn
   * down. Gated on `ADRT_TEST_TRIGGERS=1`: never reachable in a production
   * session.
   */
  private simulateChromeTeardown(): boolean {
    if (GLib.getenv('ADRT_TEST_TRIGGERS') !== '1') return false;
    this.indicator?.destroyChromeActors();
    return true;
  }

  // ---------------------------------------------------------------- session

  private currentMode(): SessionMode {
    return sessionMode.currentMode as SessionMode;
  }

  private isPaused(): boolean {
    // §19: while the drain finishes the backlog a pause caught, policy runs as
    // if unpaused; new work is still refused where it is pushed.
    if (this.session?.isDrainingBacklog() ?? false) return false;
    // The one pause predicate: the session machine (lock or a manual pause) and
    // — only when the user opted in — screen sharing. Sharing is re-derived from
    // the live mode plus the setting on every call (this is the drain's gate),
    // never latched by a signal handler, so a missed transition cannot strand it.
    if (this.sessionMachine.isPaused) return true;
    return this.sessionMachine.state.mode === 'screen-sharing' && this.pauseDuringSharing();
  }

  /** §19: whether the user asked adrt to pause while sharing/remote desktop. */
  private pauseDuringSharing(): boolean {
    return this.settings.boolean('pause-during-sharing', false);
  }

  /**
   * §19: the user pause (`kb-toggle-pause` and the `TogglePause` trigger). It
   * lives in the session machine (folded into `isPaused`), so the tiling engine,
   * the drain and the indicator all see it with no extra plumbing. Resuming asks
   * for one reconcile so windows that moved while paused are re-tiled.
   */
  private setTilingPaused(paused: boolean): void {
    if (this.sessionMachine.manualPause === paused) {
      return;
    }
    this.sessionMachine.setManualPause(paused);
    if (paused) {
      this.stopMotionWatch();
      // Reuse the session pause suppression so the border state and every
      // `border_visible` reader see a manual pause exactly like a locked session.
      this.suppressBorder('pause');
    } else {
      this.unsuppressBorder('pause');
      this.session.scheduleReconcile('manual-resume');
    }
    this.syncIndicator();
    this.syncPreview();
    this.history.log('session_mode', { mode: this.sessionMachine.state.mode, paused: this.isPaused(), manualPaused: paused });
  }

  private applySessionMode(mode: SessionMode, initial = false): void {
    // §19: read the pre-transition sharing-pause before the machine moves, so
    // resuming retiles exactly when the mode we are leaving was actually paused.
    const leftSharingPaused = this.sessionMachine.state.mode === 'screen-sharing' && this.pauseDuringSharing();
    const effects = this.sessionMachine.setMode(mode);
    // Gate the sharing suppression on the setting: with it off, sharing is
    // ignored entirely (no highlight suppression, tiling continues); with it on,
    // the highlight hides and `isPaused()` stops reflowing.
    const suppression = effects.indicatorSuppression === 'sharing' && !this.pauseDuringSharing()
      ? null
      : effects.indicatorSuppression;
    if (suppression !== null) {
      this.suppressBorder(suppression);
    } else {
      this.unsuppressBorder('sharing');
      // A manual pause is a suppression of its own; do not clear it on an
      // unrelated session transition.
      if (this.sessionMachine.manualPause) this.suppressBorder('pause');
      else this.unsuppressBorder('pause');
    }
    this.session.setScanning(effects.scanTickRunning);
    this.syncIndicator();
    if (!initial && (effects.retileOnResume || (mode === 'user' && leftSharingPaused))) {
      this.session.scheduleReconcile('session-resume');
    }
    this.history.log('session_mode', { mode, paused: effects.paused, sharingPaused: leftSharingPaused });
  }

  /**
   * §19: the sharing suppression is a property of the mode and the setting, not
   * of the signal that entered it. Re-derived on the periodic pass so a missed
   * transition (or a setting flip while already sharing) cannot leave it stale.
   */
  private refreshSharingSuppression(): void {
    const want = this.sessionMachine.state.mode === 'screen-sharing' && this.pauseDuringSharing();
    const active = this.border.isSuppressed('sharing');
    if (want === active) return;
    if (want) this.suppressBorder('sharing');
    else this.unsuppressBorder('sharing');
    this.syncIndicator();
  }

  /**
   * §19: re-derive the session-mode property from the live `sessionMode` on the
   * periodic pass. The `notify::current-mode` signal is the primary path, but a
   * missed or raced transition (a lock during a Shell restart) must not leave
   * adrt unpaused while the session is locked. Reads only; `applySessionMode`
   * runs the effects on a real change.
   */
  private refreshSessionMode(): void {
    // A test-injected mode (SimulateSessionMode) owns the state until a real
    // session transition clears it; re-deriving would revert the injection.
    if (this.injectedMode !== null) return;
    const mode = this.currentMode();
    if (mode === this.sessionMachine.state.mode) return;
    this.applySessionMode(mode);
  }

  private subscribeHost(): void {
    // Every platform event goes into the journal, whatever consumes it (§22).
    for (const type of PLATFORM_EVENT_TYPES) {
      this.hostUnsubscribers.push(this.host.on(type, (payload) => this.guard(`host:${type}`, () => {
        this.journal.record('host', type, (payload ?? {}) as Record<string, unknown>);
      })()));
    }
    this.hostUnsubscribers.push(
      this.host.on('surface-created', (payload) => this.guard('host:surface-created', () => {
        const surfaceId = (payload as { surface: { id: number } }).surface.id;
        const win = this.host.windowFor(surfaceId);
        if (win !== null) this.session.register(win);
      })()),
      this.host.on('focus-changed', (payload) => this.guard('host:focus-changed', () => this.onFocusChanged((payload as { id: number | null }).id))()),
      this.host.on('workspace-switched', (payload) => this.guard('host:workspace-switched', () => this.onWorkspaceSwitched(payload as { from: number; to: number }))()),
      this.host.on('screens-changed', () => this.guard('host:screens-changed', () => {
        // §10: re-read every surface (monitor, frame, monitor-implied sticky,
        // size hints) and drop classification before the deferred replan.
        this.session.onScreensChanged();
        // §11.3: a refresh-rate change (or a VRR mode change) re-derives the
        // resolved timing here, as a read-only property refresh. Measured frame
        // intervals belong to the old topology, so drop them too.
        this.timing.resetObserved();
        this.timing.invalidate();
        if (this.settings.boolean('debug-displays', false)) {
          this.history.log('screens_changed', { monitors: this.host.screens().length });
        }
        // §11: no policy in a signal handler. The work-area change needs a
        // settle, so it is a maintenance pass; the retile rides the layout lane.
        this.session.scheduleReconcile('screens-changed');
        this.session.scheduleDisplayPass('screens-changed');
        this.session.scheduleMaintenance('work-area', { reason: 'screens-changed' });
      })()),
    );
  }

  private onFocusChanged(id: number | null): void {
    if (id === null) {
      this.border.clearFocus();
      this.stopMotionWatch();
      this.syncIndicator();
      return;
    }
    const tracked = this.session.windows.get(id);
    if (tracked === undefined || !this.session.classify(tracked).tileable) {
      this.border.clearFocus();
      this.stopMotionWatch();
      this.syncIndicator();
      return;
    }
    this.border.setFocus(id, tracked.surface.frame);
    this.startMotionWatch();
    this.syncIndicator();
  }

  private onWorkspaceSwitched(payload: { from: number; to: number }): void {
    this.wsSwitchEvents += 1;
    this.suppressForWorkspaceSwitch();
    this.history.log('ws_switch_empty', { from: payload.from, to: payload.to, reason: 'switch' });
  }

  /**
   * §23.2: a workspace-switch animation that never finishes leaves its clone
   * group on screen — the whole desktop appears doubled, frozen mid-slide.
   * A live swipe is left alone (it finishes when the fingers lift); anything
   * else still running after a second and a half is torn down.
   */
  private switchWatchStart = 0;
  private watchWorkspaceAnimation(): void {
    const controller = (wm as { _workspaceAnimation?: any })._workspaceAnimation;
    if (controller === undefined || controller === null) return;
    // A live gesture owns the animation: during the swipe `gestureActive` is
    // still false, so check the tracker's touchpad state too.
    const touchpadState = controller._swipeTracker?._touchpadGesture?._state;
    const gesturing = controller.gestureActive === true || touchpadState === 1 || touchpadState === 2;
    if (controller._switchData == null || gesturing) {
      this.switchWatchStart = 0;
      return;
    }
    if (this.switchWatchStart === 0) {
      this.switchWatchStart = Date.now();
      return;
    }
    if (Date.now() - this.switchWatchStart < SWITCH_WATCHDOG_MS) return;
    this.switchWatchStart = 0;
    try {
      controller.cancelSwitchAnimation();
      this.history.log('ws_removed', { reason: 'switch-watchdog' });
    } catch {
      /* private API changed: nothing to do */
    }
  }

  /** Policy for the shell tracker's events (§11): the tracker emits, this decides. */
  private onTrackerEvent(event: ShellTrackerEvent): void {
    switch (event.type) {
      case 'session-mode':
        // A live session transition always wins over a test-injected mode.
        this.injectedMode = null;
        this.applySessionMode(this.currentMode());
        break;
      case 'overview':
        this.onOverviewChanged(event.visible);
        break;
      case 'workspace-actor-moved':
        this.onWorkspaceActorMoved();
        break;
      case 'workspace-animation':
        this.onWorkspaceAnimation();
        break;
      case 'workspace-mode':
        this.onWorkspaceModeChanged(event.key);
        break;
    }
  }

  private onWorkspaceAnimation(): void {
    if (this.isPaused()) return;
    this.suppressForWorkspaceSwitch();
  }

  /** True while GNOME is sliding workspaces (animation or live gesture). */
  private workspaceAnimationActive(): boolean {
    const controller = (wm as any)?._workspaceAnimation;
    return controller !== null && controller !== undefined && controller._switchData != null;
  }

  /**
   * §23.2: the workspace-switch suppression is a property of the animation, not
   * of the paired signals that started it. The motion watcher clears it when it
   * settles, but that watcher stops whenever focus is lost or paused — and the
   * suppression then stays set, keeping the highlight hidden long after the
   * switch is over. Re-derive it on the periodic pass so a missed or raced
   * finish can never leave it stuck.
   */
  private refreshWorkspaceSwitchSuppression(): void {
    if (this.workspaceAnimationActive()) return;
    if (!this.border.isSuppressed('workspace-switch')) return;
    this.unsuppressBorder('workspace-switch');
    this.syncIndicator();
  }

  /** Hide the border for the duration of a workspace switch. */
  private suppressForWorkspaceSwitch(): void {
    // 'update' fires every frame during a gesture; keep this cheap.
    this.startMotionWatch();
    if (this.border.isSuppressed('workspace-switch')) return;
    this.motionSuppressions += 1;
    this.suppressBorder('workspace-switch');
    this.syncIndicator();
  }

  /** §23.1: the user is dragging; hide the border and stop reflowing. */
  private onDragChanged(dragging: boolean): void {
    if (dragging) {
      this.suppressBorder('drag');
      // Keep sampling while the drag is live so the motion tick can reposition
      // the drop preview (§6/§11); the border stays suppressed by `drag`.
      this.startMotionWatch();
    } else {
      this.unsuppressBorder('drag');
      this.startMotionWatch();
      // §Self-heal: the gesture a deferred restart was waiting for has ended.
      this.reconsiderDeferredRestart();
    }
    this.syncPreview();
    this.syncIndicator();
  }

  /**
   * §23.2: while a tileable window is focused, sample its compositor position.
   * A workspace switch (keyboard or touchpad) slides the actor, so the border
   * hides as soon as it moves and returns once it has been stable. This is what
   * covers gesture-driven switches, which emit no start signal.
   */
  private startMotionWatch(): void {
    if (this.timers.has('motion')) return;
    this.motionLastX = Number.NaN;
    this.motionLastY = Number.NaN;
    this.motionStable = 0;
    this.motionTicks = 0;
    this.armMotionWatch();
  }

  /**
   * Arm the position sampler for `MOTION_POLL_FRAMES` compositor frames. The
   * wall-clock interval is re-derived from the current frame interval, so a
   * 120/144 Hz screen (or a VRR panel) is sampled at its own rate.
   */
  private armMotionWatch(): void {
    this.motionPollMs = this.derivedMotionPollMs();
    this.motionRetileTicks = this.derivedMotionRetileTicks();
    // §Self-heal containment: a throw in a tick must never escape the GLib
    // source (it would log as an unhandled exception and could wedge the
    // compositor's dispatch); the boundary contains and reports it.
    this.timers.addInterval('motion', this.motionPollMs, this.guardSource('motion-tick', () => this.onMotionTick()));
  }

  /** The current motion sampler interval, derived from the frame interval. */
  private derivedMotionPollMs(): number {
    return this.timing.sampleIntervalMs(MOTION_POLL_FRAMES);
  }

  /** Ticks between safety-net retiles at the current sampler interval. */
  private derivedMotionRetileTicks(): number {
    return Math.max(1, Math.round(MOTION_RETILE_MS / this.derivedMotionPollMs()));
  }

  private stopMotionWatch(): void {
    if (!this.timers.has('motion')) return;
    this.timers.clear('motion');
  }

  private onMotionTick(): boolean {
    // §Self-heal: a restart deferred by a live interaction is re-checked here,
    // on the periodic tick, so it lands as soon as the obstacle clears.
    this.reconsiderDeferredRestart();
    // §22 extension: the recorder's ~20 Hz state sample rides this existing tick
    // (a no-op with no recording). It runs before the pause/park returns below so
    // a still recording still sees the state that changed.
    this.recorder?.tick();
    if (this.isPaused()) {
      this.stopMotionWatch();
      return GLib.SOURCE_REMOVE;
    }
    // §11.3: keep re-deriving the cadence. A refresh-rate change (plug/unplug,
    // VRR mode switch) must not leave the sampler on a stale interval.
    const desiredPollMs = this.timing.sampleIntervalMs(MOTION_POLL_FRAMES);
    if (desiredPollMs !== this.motionPollMs) {
      this.timers.clear('motion');
      this.armMotionWatch();
      return GLib.SOURCE_REMOVE;
    }
    // §6/§11: while a drag is live, the tick's only job is the drop preview —
    // the border is suppressed and reflow is frozen. Reposition it here, as a
    // derived property, never from a grab signal.
    if (this.session.isDragging) {
      this.syncPreview();
      return GLib.SOURCE_CONTINUE;
    }
    // Re-derive the actor from the focused window on every tick. A cached actor
    // can be disposed with its window, and the disposal check itself is the
    // touch that logs a Gjs CRITICAL ("MetaWindowActorWayland has been already
    // disposed") and can wedge the Shell, so a cached reference is never
    // re-checked. A tick without a live focused actor skips the sample and the
    // watcher stays armed, recovering on the next tick.
    const focused = this.session.focused();
    const actor = focused === null ? null : compat.compositorActor(focused.win);
    if (actor === null) {
      // A transient focus loss (mid-switch) or a closed window: keep the
      // watcher alive and re-anchor when an actor is available again.
      this.motionLastX = Number.NaN;
      this.motionLastY = Number.NaN;
      if (this.workspaceAnimationActive()) this.suppressForWorkspaceSwitch();
      return GLib.SOURCE_CONTINUE;
    }

    // Stage-space, so a sliding workspace (moving parent actor) is detected.
    const [x, y] = compat.actorStagePosition(actor);
    // A running workspace animation slides clones, not the real actor, so the
    // position check below cannot see it. Keep the border hidden until the
    // controller tears the animation down.
    if (this.workspaceAnimationActive()) {
      this.motionLastX = x;
      this.motionLastY = y;
      this.motionStable = 0;
      this.motionTicks = 0;
      this.suppressForWorkspaceSwitch();
      return GLib.SOURCE_CONTINUE;
    }
    // Movement we caused ourselves is not a transition.
    if (this.animator.activeCount > 0 || Date.now() - this.session.perf().lastApplyAtMs < MOTION_SELF_MS) {
      this.motionLastX = x;
      this.motionLastY = y;
      this.motionStable = 0;
      // A tile just happened: restart the periodic-pass countdown so we never
      // re-run the tiling logic right on top of a fresh apply.
      this.motionTicks = 0;
      return GLib.SOURCE_CONTINUE;
    }
    if (Number.isNaN(this.motionLastX)) {
      this.motionLastX = x;
      this.motionLastY = y;
      return GLib.SOURCE_CONTINUE;
    }

    const moved = Math.abs(x - this.motionLastX) > 1 || Math.abs(y - this.motionLastY) > 1;
    this.motionLastX = x;
    this.motionLastY = y;
    if (moved) {
      this.motionStable = 0;
      this.suppressForWorkspaceSwitch();
    } else {
      this.motionStable += 1;
      if (this.motionStable >= MOTION_STABLE_SAMPLES && this.border.isSuppressed('workspace-switch')) {
        this.unsuppressBorder('workspace-switch');
        this.syncIndicator();
      }
    }
    this.motionTicks += 1;
    if (this.motionTicks >= this.motionRetileTicks) {
      this.motionTicks = 0;
      this.periodicRetile();
    }
    this.refreshOcclusion();
    this.refreshFullscreen();
    return GLib.SOURCE_CONTINUE;
  }

  /**
   * §23.2/§11: the border must not be drawn over a window that is on top of the
   * focused one. Occlusion is a property of the compositor *stack* — anything
   * drawn above the focused window, a float, a dialog or an always-on-top
   * window — not of the session float flag, so it is re-derived from live
   * stacking order rather than a cached classification.
   */
  private refreshOcclusion(): void {
    const focused = this.session.focused();
    let occluded = false;
    if (focused !== null && this.session.classify(focused).tileable && !focused.surface.flags.floating) {
      occluded = this.isOccluded(focused);
    }
    if (occluded === this.occluded) return;
    this.occluded = occluded;
    if (occluded) this.suppressBorder('occluded');
    else this.unsuppressBorder('occluded');
    this.syncIndicator();
  }

  /**
   * Whether any visible window is stacked above `focused` and covers its centre.
   * The centre is the established "substantially covered" test; the change is
   * that the window above need not be a session float (A130).
   */
  private isOccluded(focused: TrackedWindow): boolean {
    const r = focused.surface.frame;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const others: TrackedWindow[] = [];
    for (const tracked of this.session.windows.values()) {
      if (tracked.id !== focused.id) others.push(tracked);
    }
    if (others.length === 0) return false;
    // Bottom-to-top order of the tracked windows, so "above" is read from the
    // compositor, never assumed from the layer.
    const order = compat
      .sortByStacking([focused.win, ...others.map((tracked) => tracked.win)])
      .map((win: any) => win.get_id());
    const focusIdx = order.indexOf(focused.id);
    for (const other of others) {
      if (other.surface.flags.minimized) continue;
      // A window on another workspace is not visible over this one; an
      // always-on-top or sticky window is.
      if (other.surface.workspaceId !== focused.surface.workspaceId && !other.surface.flags.sticky) continue;
      const idx = order.indexOf(other.id);
      // With a real stacking order, only a window after the focused one is
      // above it. If the order came back unsorted (API unavailable), fall back
      // to the layer: only a modal or floating layer can be over a tile.
      if (focusIdx >= 0 && idx >= 0) {
        if (idx <= focusIdx) continue;
      } else if (other.surface.layer === Layer.TILED) {
        continue;
      }
      const o = other.win.get_frame_rect();
      if (cx >= o.x && cx <= o.x + o.width && cy >= o.y && cy <= o.y + o.height) return true;
    }
    return false;
  }

  /**
   * §11/§16: a fullscreen window is not highlighted as active — it fills the
   * screen, so a marker drawn around it would sit over its own content. This is
   * re-derived from the focused window's own flag on the same pass as occlusion
   * (the lane-2 drain and the motion tick), never as a one-shot reaction to
   * `notify::fullscreen`, so a missed or raced signal cannot leave the border
   * on. It applies on any workspace and any screen, including the workspace our
   * own maximize/fullscreen policy moved the window to.
   */
  private refreshFullscreen(): void {
    const focused = this.session.focused();
    const fullscreen = focused !== null && focused.surface.flags.fullscreen === true;
    if (fullscreen === this.border.isSuppressed('fullscreen')) return;
    if (fullscreen) this.suppressBorder('fullscreen');
    else this.unsuppressBorder('fullscreen');
    this.syncIndicator();
  }

  /**
   * §35: re-run the tiling plan for the focused workspace on a slow cadence.
   * Signals cover most changes; this is the backstop for a layout that drifted
   * without one. `retile` is idempotent — when the windows already match the
   * plan it applies nothing.
   */
  private periodicRetile(): void {
    if (this.isPaused()) {
      this.motionSkip = 'paused';
      return;
    }
    if (this.session.isDragging || this.session.clientInteractionActive || this.animator.activeCount > 0) {
      this.motionSkip = this.session.isDragging
        ? 'dragging'
        : this.session.clientInteractionActive
          ? 'client-dnd'
          : 'animating';
      return;
    }
    if (this.workspaceAnimationActive()) {
      this.motionSkip = 'switch';
      return;
    }
    const focused = this.session.focused();
    if (focused === null || !this.session.classify(focused).tileable) {
      this.motionSkip = `focused=${focused === null ? 'null' : focused.id}`;
      return;
    }
    this.motionSkip = '';
    this.motionRetiles += 1;
    // §11: the gate decides here, the drain applies. A safety-net pass is not a
    // user action, so the queue's reconcile keeps its "no undo entry" default.
    this.session.scheduleReconcile('motion-tick');
  }

  private syncIndicator(): void {
    // The marker follows the focused window's current geometry, not a stale
    // rect captured when focus last changed.
    const focused = this.session.focused();
    if (focused !== null && this.border.focusedId === focused.id) {
      focused.refreshFrame();
      this.border.updateRect(focused.surface.frame);
    }
    const snapshot = this.border.snapshot();
    const visible = snapshot.visible && snapshot.rect !== null && !this.isPaused() && !overview.visible;
    if (visible && snapshot.rect !== null) {
      this.indicator.show(snapshot.rect);
    } else {
      this.indicator.hide();
    }
    // §22: record where the highlight is actually drawn, not only when it is
    // suppressed. A highlight at the wrong rect or on the wrong screen leaves no
    // other trace. One line per `(visible, id, rect)` change; nothing when the
    // redraw does not move it.
    const rect = visible ? snapshot.rect : null;
    const key = rect === null ? 'hidden' : `${this.border.focusedId}:${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (key !== this.lastBorderDraw) {
      this.lastBorderDraw = key;
      this.journal.record('border', 'focus', {
        id: visible ? this.border.focusedId : null,
        rect,
        monitor: rect === null ? null : (this.screenIndexForRect(rect) ?? null),
      });
    }
  }

  /**
   * §6/§11: the drop-assist overlay. The target is the model's own drag
   * decision (`WindowSession.previewTarget`), recomputed here while the drag is
   * live — the same decision the drop applies, so the outline is exact.
   *
   * A `kind: 'none'` decision is a no-op drop, but it is still a landing: the
   * window returns to its own tile, and `rect` is exactly that tile. Hiding it
   * left the origin slot without a hint when a window was dragged back over the
   * spot it came from. Only a `null` target (an inner-edge resize, which has no
   * landing rect) or a suppressed session hides the overlay.
   */
  private syncPreview(): void {
    const target = this.session.isDragging ? this.session.previewTarget() : null;
    const hidden = target === null || this.isPaused() || overview.visible;
    if (hidden) {
      this.indicator.hidePreview();
    } else {
      this.indicator.showPreview(target.rect);
    }
    // §22: the drop-assist overlay leaves no other trace, so log where it is
    // shown (and that it went away) on transitions only — a stale overlay after
    // the gesture ends is then visible in the journal.
    const drag = this.session.dragState();
    const id = drag.dragId ?? drag.adjustId;
    const key = hidden
      ? 'hidden'
      : `${id}:${target.kind}:${target.rect.x},${target.rect.y},${target.rect.width},${target.rect.height}`;
    if (key === this.lastPreviewDraw) return;
    this.lastPreviewDraw = key;
    if (hidden) {
      this.journal.record('border', 'preview_hide', { id });
    } else if (target !== null) {
      this.journal.record('border', 'preview_show', {
        id,
        kind: target.kind,
        rect: target.rect,
        monitor: this.screenIndexForRect(target.rect) ?? null,
      });
    }
  }

  private onWorkspaceActorMoved(): void {
    if (this.isPaused()) return;
    this.suppressForWorkspaceSwitch();
  }

  /** §23: chrome must not show over the overview or the app grid. Tiling keeps
   * running in the workspace — only the border is hidden. */
  private onOverviewChanged(visible: boolean): void {
    if (visible) this.suppressBorder('overview');
    else this.unsuppressBorder('overview');
    this.syncIndicator();
  }

  private onStateChanged(): void {
    const focused = this.session.focused();
    if (focused !== null) {
      this.border.setFocus(focused.id, focused.surface.frame);
      this.startMotionWatch();
    }
    this.refreshOcclusion();
    this.refreshFullscreen();
    this.syncIndicator();
    this.syncPreview();
  }

  private onStubborn(_appId: string): void {
    this.history.log('stubborn', { cooldownMs: this.registry.cooldownRemainingMs() });
  }

  /** Keep the active-window marker glued to the window as it animates. */
  private onAnimatedFrame(id: number, rect: Rect): void {
    this.onFrameSample();
    if (this.border.focusedId === id) {
      this.border.updateRect(rect);
      this.syncIndicator();
    }
  }

  private onFrameSample(): void {
    // §11.3: measure the *observed* frame interval on every animated frame, so
    // a variable-refresh display is followed and never assumed to be 60 Hz.
    const now = GLib.get_monotonic_time();
    if (this.lastFrameUs > 0) this.timing.observeFrame((now - this.lastFrameUs) / 1000);
    this.lastFrameUs = now;
    if (!this.settings.boolean('trace-enabled', false)) return;
    this.frameSamples += 1;
    if (this.frameSamples % 60 !== 0) return;
    this.history.log('frame_timing', {
      samples: this.frameSamples,
      budgetMs: this.timing.frameIntervalFor(),
      configuredMs: this.settings.int('max-frame-interval-ms', 16),
    });
  }

  /** §23: fade a ghost at the closing window's rect, on the right screen. */
  private onWindowClosed(_id: number, rect: Rect): void {
    const base = this.settings.int('close-animation-duration', 150);
    this.indicator.ghostClose(rect, this.timing.effectiveDuration(base, this.screenIndexForRect(rect)));
  }

  // ------------------------------------------------------------- workspace

  private switchWorkspace(direction: 'left' | 'right' | 'up' | 'down'): void {
    const manager = global.workspace_manager;
    const current = manager.get_active_workspace_index();
    const delta = direction === 'left' || direction === 'up' ? -1 : 1;
    const target = clamp(current + delta, 0, manager.get_n_workspaces() - 1);
    if (target !== current) manager.get_workspace_by_index(target).activate(global.get_current_time());
  }

  // ------------------------------------------------------------- settings

  private watchSettings(): void {
    // Any setting change drops the memoised classifier config: it is read per
    // window per pass, and a stale config would be a correctness bug, not a perf
    // win, so the invalidation is blanket.
    this.settingWatchers.push(this.settings.onAnyChange(this.guard('setting:any', () => undefined)));
    const reactive: [string, () => void][] = [
      ['exception-apps', () => this.session.invalidateAll()],
      ['rules-json', () => this.session.invalidateAll()],
      ['heuristic-modal-detect', () => this.session.invalidateAll()],
      ['min-size-policy', () => this.session.invalidateAll()],
      ['primary-apps', () => this.session.invalidateAll()],
      ['primary-app-ratio', () => this.session.invalidateAll()],
      // Live-toggled behaviour keys: without these a change only lands on the
      // next unrelated reconcile or the safety-net sweep (up to a minute).
      ['cursor-follows-focus', () => this.session.invalidateAll()],
      ['clamp-windows-to-screen', () => this.session.invalidateAll()],
      ['float-persistence', () => this.session.invalidateAll()],
      ['float-pins-workspace', () => this.session.invalidateAll()],
      ['follow-moved-window', () => this.session.invalidateAll()],
      ['gaps-base', () => this.session.invalidateAll()],
      ['gaps-portrait', () => this.session.invalidateAll()],
      ['gaps-landscape', () => this.session.invalidateAll()],
      ['gaps-left', () => this.session.invalidateAll()],
      ['gaps-right', () => this.session.invalidateAll()],
      ['gaps-top', () => this.session.invalidateAll()],
      ['gaps-bottom', () => this.session.invalidateAll()],
      ['gaps-between', () => this.session.invalidateAll()],
      ['active-window-indicator', () => {
        this.syncIndicator();
      }],
      ['gesture-enabled', () => this.gestures.configure()],
      ['gesture-sensitivity', () => this.gestures.configure()],
      ['gesture-3-swipe-action', () => this.gestures.configure()],
      ['gesture-3-vertical-action', () => this.gestures.configure()],
      ['gesture-4-swipe-action', () => this.gestures.configure()],
      ['gesture-4-vertical-action', () => this.gestures.configure()],
      ['gesture-pinch-action', () => this.gestures.configure()],
      ['adaptation-enabled', () => this.registry.setEnabled(this.settings.boolean('adaptation-enabled', true))],
      ['reflow-keeps-edges', () => this.session.invalidateAll()],
      ['indicator-color', () => this.syncIndicator()],
      ['indicator-width', () => this.syncIndicator()],
      ['indicator-opacity', () => this.syncIndicator()],
      ['indicator-corner-radius', () => this.syncIndicator()],
      ['indicator-animated-pulse', () => this.syncIndicator()],
      ['indicator-pulse-duration', () => this.syncIndicator()],
      ['history-enabled', () => this.history.setEnabled(this.settings.boolean('history-enabled', true))],
      ['history-max-bytes', () => this.history.setMaxBytes(this.settings.int('history-max-bytes', 8388608))],
      ['disable-animations', () => this.applyAnimationSetting()],
      // §19: flipping the sharing option re-derives the suppression at once
      // (on or off) without waiting for a session transition.
      ['pause-during-sharing', () => this.refreshSharingSuppression()],
      // Changing a shortcut re-registers the bindings so it takes effect at once.
      ...this.keybindingSettingNames().map((key): [string, () => void] => [key, () => {
        this.unregisterKeybindings();
        this.registerKeybindings();
      }]),
    ];
    // §Self-heal containment: settings watchers run inside GSettings signal
    // emissions; each is wrapped by the boundary.
    for (const [key, cb] of reactive) this.settingWatchers.push(this.settings.onChanged(key, this.guard(`setting:${key}`, cb)));
  }

  /** Re-derive the screen class and slot occupancy after a workspace-mode flip. */
  private onWorkspaceModeChanged(key: string): void {
    this.history.log('screens_changed', { reason: 'workspace-mode', key });
    this.session.invalidateAll();
    this.session.scheduleDisplayPass('workspace-mode');
    this.syncIndicator();
  }

  /**
   * §18: adrt's `disable-animations` is honoured **internally** by `GnomeTiming`
   * (`animationsDisabled`), so adrt skips its own animations without touching
   * GNOME's global accessibility state. A user who disabled animations for
   * accessibility keeps them disabled; adrt never flips the Shell setting.
   */
  private applyAnimationSetting(): void {
    this.timing?.invalidate();
  }

  /** Record GNOME's animation state at enable, so `disable()` can restore it. */
  private captureAnimationBaseline(): void {
    try {
      const st = St.Settings.get();
      this.animationsBaseline = {
        enableAnimations: typeof st.enable_animations === 'boolean' ? st.enable_animations : null,
        slowDownFactor: typeof st.slow_down_factor === 'number' ? st.slow_down_factor : null,
      };
    } catch {
      this.animationsBaseline = { enableAnimations: null, slowDownFactor: null };
    }
    this.animationsMutated = false;
  }

  /**
   * §18: restore GNOME's animation state to the pre-enable baseline. adrt never
   * writes it, so this is a no-op today; it exists so that if any path ever
   * mutates the global state, `disable()` leaves the session exactly as found.
   */
  private restoreAnimationSetting(): void {
    if (!this.animationsMutated) return;
    try {
      const st = St.Settings.get();
      if (this.animationsBaseline.enableAnimations !== null) st.enable_animations = this.animationsBaseline.enableAnimations;
      if (this.animationsBaseline.slowDownFactor !== null) st.slow_down_factor = this.animationsBaseline.slowDownFactor;
    } catch {
      /* no St.Settings */
    }
    this.animationsMutated = false;
  }

  /** The frozen v2 keybinding surface (§17): every name is one settings key. */
  private keybindingSettingNames(): string[] {
    return [
      'kb-undo',
      'kb-recording-toggle',
      'kb-toggle-pause',
      'kb-focus-next',
      'kb-focus-left',
      'kb-focus-right',
      'kb-focus-up',
      'kb-focus-down',
      'kb-toggle-float',
      'kb-nudge-left',
      'kb-nudge-right',
      'kb-nudge-up',
      'kb-nudge-down',
      'kb-move-left',
      'kb-move-right',
      'kb-move-up',
      'kb-move-down',
      'kb-move-workspace-next',
      'kb-move-workspace-prev',
      'kb-move-workspace-1',
      'kb-move-workspace-2',
      'kb-move-workspace-3',
      'kb-move-workspace-4',
      'kb-move-workspace-5',
      'kb-move-workspace-6',
      'kb-move-workspace-7',
      'kb-move-workspace-8',
      'kb-move-workspace-9',
      'kb-toggle-fullscreen',
      'kb-quit',
      'kb-cursor-centre',
    ];
  }

  private registerKeybindings(): void {
    const names = this.keybindingSettingNames();
    // §19.1 `keybindings`: "name=accelerator" entries override the defaults.
    for (const entry of this.settings.strv('keybindings')) {
      const eq = entry.indexOf('=');
      if (eq <= 0) continue;
      const name = entry.slice(0, eq).trim();
      const accelerator = entry.slice(eq + 1).trim();
      if (accelerator.length > 0 && names.includes(name) && this.settings.keys().includes(name)) {
        this.settings.write(name, [accelerator]);
      }
    }
    for (const name of names) {
      // A key with no accelerator (the by-index moves by default) is skipped:
      // an empty binding would otherwise be registered with no effect.
      if (this.settings.strv(name).length === 0) continue;
      wm.addKeybinding(name, this.getSettings(), Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, () =>
        this.guard(`keybinding:${name}`, () => this.dispatchKeybinding(name))(),
      );
      this.keybindings.push(name);
    }
  }

  private dispatchKeybinding(name: string): void {
    switch (name) {
      case 'kb-undo':
        this.session.undo();
        break;
      case 'kb-recording-toggle':
        // The hotkey goes through the same one action as the D-Bus trigger, so
        // both always agree.
        this.toggleRecording();
        break;
      case 'kb-toggle-pause':
        // The user's pause home: the same predicate the old panel row and the
        // D-Bus TogglePause trigger drive.
        this.setTilingPaused(!this.sessionMachine.manualPause);
        break;
      case 'kb-focus-next':
        this.session.focusCycle();
        break;
      case 'kb-focus-left':
      case 'kb-focus-right':
      case 'kb-focus-up':
      case 'kb-focus-down':
        this.session.focusDirection(name.slice('kb-focus-'.length));
        break;
      case 'kb-toggle-float':
        this.toggleFocusedFloat();
        break;
      case 'kb-nudge-left':
        this.nudgeFocused('left');
        break;
      case 'kb-nudge-right':
        this.nudgeFocused('right');
        break;
      case 'kb-nudge-up':
        this.nudgeFocused('up');
        break;
      case 'kb-nudge-down':
        this.nudgeFocused('down');
        break;
      case 'kb-move-workspace-next':
        this.session.moveFocusedToAdjacentWorkspace('next');
        break;
      case 'kb-move-workspace-prev':
        this.session.moveFocusedToAdjacentWorkspace('prev');
        break;
      case 'kb-move-left':
        this.session.moveToward('left');
        break;
      case 'kb-move-right':
        this.session.moveToward('right');
        break;
      case 'kb-move-up':
        this.session.moveToward('up');
        break;
      case 'kb-move-down':
        this.session.moveToward('down');
        break;
      case 'kb-toggle-fullscreen':
        this.toggleFocusedFullscreen();
        break;
      case 'kb-quit':
        this.session.closeFocused();
        break;
      case 'kb-cursor-centre':
        this.session.centreCursorNow();
        break;
      default:
        if (name.startsWith('kb-move-workspace-')) {
          const index = Number.parseInt(name.slice('kb-move-workspace-'.length), 10);
          if (Number.isFinite(index)) this.session.moveFocusedToWorkspace(index - 1);
        }
        break;
    }
  }

  private unregisterKeybindings(): void {
    for (const name of this.keybindings) wm.removeKeybinding(name);
    this.keybindings = [];
  }

  private toggleFocusedFullscreen(): void {
    const focused = this.session.focused();
    if (focused !== null) this.session.toggleFullscreen(focused.id);
  }

  private toggleFocusedFloat(): void {
    const focused = this.session.focused();
    if (focused !== null) this.session.toggleFloat(focused.id);
  }

  private nudgeFocused(direction: string): void {
    // §17: a nudge with nothing to split is announced rather than silent; the
    // session owns that decision and the toast.
    this.session.nudgeFocused(direction, this.settings.int('nudge-step', 5));
  }

  // ------------------------------------------------------------ persistence

  private stateFile(): string {
    return `${dataDir()}/state.json`;
  }

  private restoreState(): void {
    const text = readText(this.stateFile());
    if (text === null) return;
    let raw: any;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      console.error(`[adrt] state.json is corrupt: ${(e as Error).message}`);
      return;
    }
    if (raw.ratios !== undefined) this.tiling.loadRatios(raw.ratios, raw.swapPairs ?? []);
  }

  private saveState(): void {
    if (this.tiling === undefined) return;
    const payload = {
      version: 1,
      ratios: this.tiling.getRatios(),
      swapPairs: this.tiling.getSwapPairs(),
    };
    writeAtomic(this.stateFile(), JSON.stringify(payload));
  }

  /** §9: display memory keyed by connector, persisted beside the state. */
  private displayMemoryFile(): string {
    return `${dataDir()}/display-memory.json`;
  }

  private restoreDisplayMemory(): void {
    const raw = readJson(this.displayMemoryFile());
    if (raw === null || typeof raw !== 'object') return;
    const entries = (raw as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return;
    this.session.setDisplayMemory(entries as MemoryEntry[]);
  }

  private saveDisplayMemory(): void {
    if (this.session === undefined) return;
    writeAtomic(
      this.displayMemoryFile(),
      JSON.stringify({ version: 1, at: Date.now(), entries: this.session.getDisplayMemory() }),
    );
  }

  private migrate(): void {
    const current = this.settings.int('settings-version', 0);
    if (current >= EXTENSION_VERSION) return;
    this.settings.write('settings-version', EXTENSION_VERSION);
    this.history.log('config_imported', { migratedFrom: current, to: EXTENSION_VERSION });
  }

  /**
   * §23 decisions 91-93: fold legacy rule floats into the Never-tile list and
   * carry a legacy global `rules-enabled:false` over as per-rule
   * `enabled:false`. Idempotent: after the first run `rules-json` holds no
   * legacy flags and `changed` is false.
   */
  private migrateRuleFloats(): void {
    const migration = migrateRulesJson(
      this.settings.string('rules-json', '[]'),
      this.settings.boolean('rules-enabled', true),
    );
    if (migration.neverTile.length > 0) {
      const merged = [...this.settings.strv('exception-apps')];
      for (const glob of migration.neverTile) {
        if (!merged.includes(glob)) merged.push(glob);
      }
      this.settings.write('exception-apps', merged);
      this.history.log('rules_migrated', { neverTile: migration.neverTile });
    }
    if (migration.changed) this.settings.write('rules-json', JSON.stringify(migration.rules));
    if (migration.errors.length > 0) {
      this.journal.record('model', 'rules_invalid', { errors: migration.errors });
    }
  }

  private firstRun(): void {
    if (this.settings.boolean('first-run-complete', false)) return;
    this.settings.write('first-run-complete', true);
    notify('Adrt', 'Adrt tiles windows into pairs per monitor. Press Super+Z to undo a retile.');
  }

  // ------------------------------------------------------------ notifications

  /**
   * Raise a decision as a notification (§21). Every decision is journalled
   * whether or not the user opted into seeing it; the nothing-happened notices
   * are always shown, the rest follow the `debug-toasts` setting, and the gate
   * deduplicates and rate-limits whatever does get shown.
   */
  private toast(key: string, subject: string, fields: Record<string, unknown> = {}): boolean {
    const title = noticeTitle(key);
    if (title === null) {
      console.warn(`[adrt] unknown notice key: ${key}`);
      return false;
    }
    this.journal.decide('notice', { key, subject, ...fields });
    const wanted = isAlwaysNotice(key) || this.settings.strv('debug-toasts').includes(key);
    if (!wanted || !this.notices.allow(key, subject, Date.now())) return false;
    notify('Adrt', title);
    return true;
  }

  /** Harness trigger: exercise the catalogue and the gate end to end. */
  /**
   * Border suppression is a transient state that a loaded test can miss by
   * sampling; the journal keeps the event with its reason (§11), so a scenario
   * can assert what happened instead of catching it live.
   */
  private suppressBorder(reason: SuppressionReason): void {
    this.border.suppress(reason);
    this.journal.record('border', 'suppress', { reason, active: [...this.border.activeSuppressions] });
  }

  private unsuppressBorder(reason: SuppressionReason): void {
    this.border.unsuppress(reason);
    this.journal.record('border', 'release', { reason, active: [...this.border.activeSuppressions] });
  }

  /** The harness's focus triggers say why focus moved, for the dump. */
  private noteFocus(reason: string): void {
    this.focusReason = reason;
  }

  private simulateNotice(key: string, subject: string): boolean {
    return this.toast(key, subject);
  }

  // --------------------------------------------------- trace (Stage 6, §22)

  /** Journal one model-level event for the replayable trace. */
  private onModelEvent(event: string, fields: Record<string, unknown>): void {
    this.journal.record('model', event, fields);
  }

  /** The model state a trace replays from: the workspaces and their occupants. */
  private buildTraceInitial(): TraceInitial {
    const count = Math.max(1, this.session.countWorkspaces());
    const workspaces: TraceWorkspace[] = [];
    for (let index = 0; index < count; index++) {
      workspaces.push({ id: index, slots: [null, null], minimized: [], floats: [] });
    }
    const windows: TraceInitial['windows'] = [];
    const slots = new Map<number, 0 | 1>();
    for (const tracked of this.session.windows.values()) {
      const workspace = workspaces[tracked.surface.workspaceId];
      if (workspace === undefined) continue;
      tracked.surface.refresh();
      windows.push({
        id: tracked.id,
        appId: tracked.surface.appId,
        title: tracked.surface.title,
        screenId: tracked.surface.screenId,
        rect: tracked.surface.frame,
        min: tracked.minSize,
        max: tracked.maxSize,
        maximized: tracked.surface.flags.maximized,
      });
      if (tracked.surface.flags.minimized) {
        (workspace.minimized ??= []).push(tracked.id);
        continue;
      }
      if (tracked.surface.flags.floating) {
        (workspace.floats ??= []).push(tracked.id);
        continue;
      }
      const slot = this.slotOf(tracked.surface.frame, this.workAreaOf(tracked.surface.screenId), this.axisOf(tracked.surface.screenId));
      if ((slot === 0 || slot === 1) && workspace.slots[slot] === null && !slots.has(tracked.id)) {
        workspace.slots[slot] = tracked.id;
        slots.set(tracked.id, slot);
      } else {
        (workspace.floats ??= []).push(tracked.id);
      }
    }
    return { viewed: this.host.activeWorkspaceId(), workspaces, windows };
  }

  /** Capture the recording's initial model state (called at enable). */
  private captureRecordInitial(): void {
    this.recordInitial = this.buildTraceInitial();
  }

  /** §22/Stage 6: the recorded journal + decisions as a replayable trace. */
  private dumpTrace(limit: number): string {
    const initial = this.recordInitial ?? this.buildTraceInitial();
    const events = this.journal.tail(4000, 'model') as unknown as TraceEntry[];
    const decisions = this.journal.decisionsTail(limit) as unknown as TraceEntry[];
    return JSON.stringify({ version: 1, initial, events, decisions });
  }

  // ------------------------------------------------ platform probe, injection

  /** The capability JSON the harness depends on (§40.4, Stage 0). */
  /** The screen with this Mutter index, from the last screen read (§10). */
  private screenAt(monitor: number): Screen | undefined {
    return this.host.screens().find((screen) => screen.index === monitor);
  }

  /** The screen whose geometry contains a rect's centre, if any. */
  private screenIndexForRect(rect: Rect): number | undefined {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    for (const screen of this.host.screens()) {
      const g = screen.geometry;
      if (cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height) return screen.index;
    }
    return undefined;
  }

  /** The work area of one monitor, from the last screen read (§10). */
  private workAreaOf(monitor: number): Rect {
    const screen = this.screenAt(monitor);
    if (screen === undefined) return { x: 0, y: 0, width: 0, height: 0 };
    return screen.workArea ?? screen.geometry;
  }

  private probePlatform(): string {
    let virtualInput = false;
    try {
      // GNOME 51 removes Clutter.get_default_backend(); go through compat.
      const seat = compat.defaultSeat();
      virtualInput = typeof seat?.create_virtual_device === 'function';
    } catch {
      virtualInput = false;
    }
    let remoteDesktop = false;
    try {
      const reply = Gio.DBus.session.call_sync(
        'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner',
        new GLib.Variant('(s)', ['org.gnome.Mutter.RemoteDesktop']),
        new GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE, 200, null);
      remoteDesktop = (reply.deepUnpack() as [boolean])[0] === true;
    } catch {
      remoteDesktop = false;
    }
    let gnome = 'unknown';
    try {
      const config = (globalThis as any).imports?.misc?.config;
      if (typeof config?.PACKAGE_VERSION === 'string') gnome = config.PACKAGE_VERSION;
    } catch {
      gnome = 'unknown';
    }
    return JSON.stringify({
      format: 'adrt.probe',
      version: RELEASE_VERSION,
      platform: 'gnome',
      gnome,
      session: Meta.is_wayland_compositor?.() === true ? 'wayland' : 'x11',
      monitors: this.host.screens().length,
      layoutRows: global.workspace_manager.layout_rows,
      // §11.3: what the Shell exposes about refresh and adaptive sync, so a
      // diagnostic can see whether a fixed or variable mode is active.
      refresh: {
        source: this.host.refreshRateSource,
        screens: this.timing.screens().map((screen) => ({
          index: screen.index,
          refreshRate: screen.refreshRate,
          frameIntervalMs: screen.frameIntervalMs,
        })),
        observedFrameIntervalMs: this.timing.resolve().observedFrameIntervalMs,
        variableRefresh: this.timing.resolve().variableRefresh,
        adaptiveSyncSupported: this.host.adaptiveSyncSupported(),
        adaptiveSyncReason: this.host.adaptiveSyncSupported()
          ? 'org.gnome.mutter experimental-features includes variable-refresh-rate'
          : 'Mutter exposes no VRR capability and the experimental feature is off',
      },
      // §18: the OS animation state adrt reads (and never writes).
      animations: {
        enabled: this.timing.animationsEnabled(),
        reducedMotion: this.timing.reducedMotion(),
        slowDownFactor: this.timing.slowDownFactor(),
      },
      laters: {
        available: typeof global.compositor?.get_laters === 'function',
        beforeRedraw: true,
      },
      virtualInput,
      remoteDesktop,
      cursor: {
        ...compat.cursorCapabilities(),
        method: compat.cursorWarpMethod(),
      },
      injection: this.injectionEnabled,
      grabOp: this.host.canDetectUserGrab(),
      devkit: compat.hasDevkit(),
      paused: this.isPaused(),
      journal: this.journal.lastSeq,
    });
  }

  private ensureInjection(): boolean {
    if (!this.injectionEnabled) return false;
    try {
      if (this.injectSeat === null) this.injectSeat = compat.defaultSeat();
      if (this.injectPointer === null) {
        this.injectPointer = this.injectSeat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
      }
      if (this.injectKeyboard === null) {
        this.injectKeyboard = this.injectSeat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
      }
      return this.injectPointer !== null && this.injectKeyboard !== null;
    } catch (error) {
      console.warn(`[adrt] input injection unavailable: ${(error as Error).message}`);
      this.injectionEnabled = false;
      return false;
    }
  }

  private eventTime(): number {
    try {
      return Clutter.get_current_event_time() ?? 0;
    } catch {
      return 0;
    }
  }

  private injectPointerMove(x: number, y: number): boolean {
    if (!this.ensureInjection()) return false;
    try {
      this.injectPointer.notify_absolute_motion(this.eventTime(), Math.trunc(x), Math.trunc(y));
      this.journal.record('inject', 'pointer-move', { x, y });
      return true;
    } catch {
      return false;
    }
  }

  private injectPointerButton(button: number, pressed: boolean): boolean {
    if (!this.ensureInjection()) return false;
    try {
      const state = pressed ? Clutter.ButtonState.PRESSED : Clutter.ButtonState.RELEASED;
      this.injectPointer.notify_button(this.eventTime(), button, state);
      this.journal.record('inject', 'pointer-button', { button, pressed });
      return true;
    } catch {
      return false;
    }
  }

  private injectKey(keyval: number, pressed: boolean): boolean {
    if (!this.ensureInjection()) return false;
    try {
      const state = pressed ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED;
      this.injectKeyboard.notify_keyval(this.eventTime(), keyval, state);
      this.journal.record('inject', 'key', { keyval, pressed });
      return true;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------- D-Bus

  /**
   * §40.4 test-only settings writer. The nested harness runs the keyfile
   * GSettings backend, whose file monitor cannot be created when the host's
   * per-user inotify budget is exhausted; an external `gsettings set` is then
   * invisible to the running Shell and every settings-dependent scenario stalls.
   * Writing through a `Gio.Settings` in *this* process updates the shared
   * backend, so the reactive `changed::` handlers fire exactly as they would
   * for a real settings-daemon change. Gated on `ADRT_TEST_TRIGGERS=1` so a
   * production session can never reach it.
   */
  private writeSetting(schema: string, key: string, value: string): boolean {
    if (GLib.getenv('ADRT_TEST_TRIGGERS') !== '1') return false;
    try {
      // The extension's own schema is not in the Shell's default source, so it
      // must go through the settings instance GNOME Shell handed us.
      if (schema === 'org.gnome.shell.extensions.adrt') {
        if (!this.settings.writeSerialized(key, value)) return false;
      } else {
        const store = new Gio.Settings({ schema_id: schema });
        const type = store.get_default_value(key)?.get_type_string();
        if (type === undefined || type === null) return false;
        let parsed: any;
        try {
          parsed = GLib.Variant.parse(new GLib.VariantType(type), value, null, null);
        } catch {
          if (type !== 's') return false;
          parsed = new GLib.Variant('s', value);
        }
        store.set_value(key, parsed);
      }
      // Flush so a subsequent `gsettings get` from the harness sees the write.
      Gio.Settings.sync();
      return true;
    } catch (error) {
      this.reportError('set-setting', error);
      return false;
    }
  }

  /**
   * §Self-heal containment: every D-Bus method runs through the error boundary
   * with its return value preserved — a throw reports and returns `undefined`
   * to the caller instead of escaping the dispatch.
   */
  private guardedHandlers(): Handlers {
    const raw = this.handlers() as unknown as Record<string, (...args: unknown[]) => unknown>;
    const wrapped: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of Object.keys(raw)) {
      wrapped[name] = this.guardValue(`dbus:${name}`, raw[name]);
    }
    return wrapped as unknown as Handlers;
  }

  private handlers(): Handlers {
    return {
      DumpState: () => this.dumpState(),
      ProbePlatform: () => this.probePlatform(),
      DumpEvents: (limit, filter) => JSON.stringify(this.journal.tail(limit, filter)),
      DumpDecisions: (limit) => JSON.stringify(this.journal.decisionsTail(limit)),
      DumpTrace: (limit) => this.dumpTrace(limit),
      InjectPointerMove: (x, y) => this.injectPointerMove(x, y),
      InjectPointerButton: (button, pressed) => this.injectPointerButton(button, pressed),
      InjectKey: (keyval, pressed) => this.injectKey(keyval, pressed),
      SimulateNotice: (key, subject) => this.simulateNotice(key, subject),
      SimulateBurst: (count, reason) => this.session.simulateBurst(count, reason),
      LookupWindow: (id) => this.lookupWindow(id),
      ListWindows: () => JSON.stringify(this.listWindows()),
      ListMonitors: () => JSON.stringify(this.host.screens().map((screen) => screen.connector)),
      GetSplitRatio: (workspace, monitor, axis) => this.tiling.getSplitRatioFor(workspace, monitor, axis as SplitAxis),
      SetSplitRatio: (workspace, monitor, axis, ratio) => this.tiling.setSplitRatioFor(workspace, monitor, axis as SplitAxis, ratio),
      Undo: () => this.session.undo(),
      NudgeSplit: (direction, step) => this.session.nudgeFocused(direction, step),
      MoveFocusedToWorkspace: (index) => this.session.moveFocusedToWorkspace(index),
      ReloadRules: () => {
        this.session.invalidateAll();
        return true;
      },
      ResetPerApp: (appId) => this.session.forgetApp(appId),
      GetAdaptations: () => JSON.stringify(this.registry.legacyRows()),
      ForgetAdaptation: (appId) => this.session.forgetApp(appId),
      GetFloats: () => JSON.stringify(this.floatState()),
      ForgetFloat: (appId) => this.session.setNeverTile(appId, false),
      GetRegistry: () => JSON.stringify(this.registry.entries()),
      SetNeverTile: (appId, value) => this.session.setNeverTile(appId, value),
      ToggleNeverTile: (appId) => {
        const value = this.registry.toggleNeverTile(appId);
        this.session.setNeverTile(appId, value);
        return value;
      },
      ForgetApp: (appId) => this.session.forgetApp(appId),
      GetDisplayMemory: () => JSON.stringify(this.session.getDisplayMemory()),
      ForgetDisplayMemory: () => {
        this.session.setDisplayMemory([]);
        this.saveDisplayMemory();
        return true;
      },
      SimulateScreens: (json) => this.simulateScreens(json),
      SimulateWorkArea: (connector, x, y, width, height) =>
        this.host.setSimulatedWorkArea(connector, { x, y, width, height }),
      ExportConfig: () => this.exportConfig(),
      ImportConfig: (json, merge) => this.importConfig(json, merge ? 'merge' : 'replace'),
      ListHistoryDays: () => JSON.stringify(this.history.days()),
      SimulateGesture: (kind, dx, dy, points) => this.gestures.simulate(kind as GestureKind, dx, dy, points),
      InjectSignal: (type, payload) => this.injectSignal(type, payload),
      SimulateSessionMode: (mode) => this.simulateSessionMode(mode),
      SimulateOverview: (visible) => {
        if (overview.visible !== visible) {
          if (visible) overview.show();
          else overview.hide();
        }
        // Drive the same handler the overview signals use, so the state is
        // consistent even if the shell reports visibility inconsistently.
        this.onOverviewChanged(visible);
        return true;
      },
      SimulateWorkspaceSwitch: (holdMs) => this.simulateWorkspaceSwitch(holdMs),
      ActivateWindow: (id) => {
        this.noteFocus('activate-window');
        this.session.focus(id);
        return true;
      },
      ActivateWorkspace: (index) => {
        this.session.activateWorkspace(index);
        return true;
      },
      ToggleFloat: (id) => this.session.toggleFloat(id),
      SimulateResize: (a, b, ratio) => this.simulateResize(a, b, ratio),
      SwapPair: (a, b) => this.session.swapPair(a, b),
      InjectVerifyFailure: (id, count) => this.injectVerifyFailure(id, count),
      FocusDirection: (direction) => {
        this.noteFocus(`focus-${direction}`);
        this.session.focusDirection(direction);
        return true;
      },
      FocusCycle: () => {
        this.noteFocus('focus-cycle');
        this.session.focusCycle();
        return true;
      },
      MoveToward: (direction) => {
        this.session.moveToward(direction);
        return true;
      },
      SpawnWindow: (argvJson, envJson) => this.spawnWindow(argvJson, envJson),
      CloseWindow: (id) => this.closeWindow(id),
      BeginDrag: (id) => this.session.beginDrag(id),
      EndDrag: (id) => this.session.endDrag(id),
      MoveWindow: (id, x, y, width, height) => this.moveWindow(id, x, y, width, height),
      MoveToWorkspace: (id, index) => this.moveToWorkspace(id, index),
      MarkWorkspaceCached: (id, index) => this.session.markWorkspaceCached(id, index),
      MoveDirection: (direction) => {
        this.noteFocus(`move-${direction}`);
        this.session.moveToward(direction);
        return true;
      },
      ToggleFullscreen: (id) => this.session.toggleFullscreen(id),
      QuitFocused: () => this.session.closeFocused(),
      SimulateAbove: (id) => this.session.simulateAbove(id),
      SimulateSticky: (id, sticky) => this.session.simulateSticky(id, sticky),
      SimulateWorkspaceReorder: (from, to) => this.session.simulateWorkspaceReorder(from, to),
      SimulateWorkspaceOrientation: (vertical) => this.session.simulateWorkspaceOrientation(vertical),
      CursorToCentre: () => this.session.centreCursorNow(),
      TogglePause: () => {
        this.setTilingPaused(!this.sessionMachine.manualPause);
        return true;
      },
      InjectFault: (context) => this.simulateFault(context),
      SimulateChromeTeardown: () => this.simulateChromeTeardown(),
      StartFrameRecording: () => {
        this.animator.startRecording();
        return true;
      },
      StopFrameRecording: () => {
        this.animator.stopRecording();
        return true;
      },
      StartRecording: (maxSeconds) => this.startRecording(maxSeconds),
      StopRecording: () => this.stopRecording(),
      RecordingStatus: () => this.recordingStatus(),
      ToggleRecording: () => this.toggleRecordingState(),
      SubmitRecordingNote: (text) => this.submitRecordingNote(text),
      PromptSetText: (text) => this.recordingPrompt?.setText(text) ?? false,
      PromptPressSave: () => this.recordingPrompt?.pressSave() ?? false,
      PromptPressCancel: () => this.recordingPrompt?.pressCancel() ?? false,
      SetSetting: (key, value) => this.writeSetting('org.gnome.shell.extensions.adrt', key, value),
      SetSchemaSetting: (schema, key, value) => this.writeSetting(schema, key, value),
      MinimizeWindow: (id) => {
        if (!this.session.windows.has(id)) return false;
        this.host.minimize(id);
        return true;
      },
      MaximizeWindow: (id) => {
        if (!this.session.windows.has(id)) return false;
        this.host.maximize(id);
        return true;
      },
      UnmaximizeWindow: (id) => {
        if (!this.session.windows.has(id)) return false;
        this.host.unmaximize(id);
        return true;
      },
      ResetLayoutState: () => {
        this.tiling.loadRatios({}, []);
        this.changes.clear();
        this.saveState();
        this.session.clearSignatures();
        // Test isolation: a layout reset also clears a manual pause, so a
        // scenario that forgot to resume cannot leak a paused session into the
        // next one on the same worker.
        if (this.sessionMachine.manualPause) {
          this.sessionMachine.setManualPause(false);
          if (this.sessionMachine.state.mode === 'user') this.unsuppressBorder('pause');
          this.syncIndicator();
        }
        this.session.scheduleReconcile('reset-layout');
        return true;
      },
    };
  }

  /**
   * Test trigger (§40.4): open a client window from inside the shell.
   *
   * `argvJson` is a JSON array (or a legacy space-separated command string) and
   * `envJson` is a JSON object/array of extra environment variables. The
   * launcher inherits the Shell's environment (the nested Wayland socket, the
   * private session bus and the isolated XDG tree) and overlays the requested
   * entries, so a flatpak/snap/AppImage or an Electron client can be launched
   * with the flags it needs.
   */
  private spawnWindow(argvJson: string, envJson: string): number {
    const argv = parseSpawnArgv(argvJson);
    if (argv.length === 0) return 0;
    try {
      const launcher = Gio.SubprocessLauncher.new(Gio.SubprocessFlags.NONE);
      for (const [key, value] of parseSpawnEnv(envJson)) launcher.setenv(key, value, true);
      const process = launcher.spawnv(argv);
      const identifier = process.get_identifier();
      return identifier === null ? 0 : Number.parseInt(identifier, 10);
    } catch (e) {
      console.error(`[adrt] SpawnWindow failed: ${(e as Error).message}`);
      return 0;
    }
  }

  /** Test trigger (§40.4): close one window without killing its process. */
  private closeWindow(id: number): boolean {
    const tracked = this.session.windows.get(id);
    if (tracked === undefined) return false;
    // Never delete a popup: Mutter has no `close` vfunc for `xdg_popup`, so this
    // segfaults the Shell (the live crash). `register()` refuses them now; this
    // is the last line of defence.
    if (compat.isPopupWindow(tracked.win)) return false;
    tracked.win.delete(global.get_current_time());
    return true;
  }

  /** Test trigger: place a window directly, to emulate a drag. */
  private moveWindow(id: number, x: number, y: number, width: number, height: number): boolean {
    if (!this.session.windows.has(id)) return false;
    this.host.applyFrame(id, { x, y, width, height });
    return true;
  }

  /** Test trigger: move a window to another workspace the way the overview
   * does — straight through Mutter, so the session sees a `workspace-changed`
   * signal and must retile both the old and the new workspace. */
  private moveToWorkspace(id: number, index: number): boolean {
    if (!this.session.windows.has(id)) return false;
    if (index < 0 || index >= global.workspace_manager.get_n_workspaces()) return false;
    this.host.applyWorkspace(id, index);
    return true;
  }

  /** The pair axis of a monitor: portrait screens and vertical workspaces stack. */
  private axisOf(monitor: number): 'horizontal' | 'vertical' {
    const screen = this.screenAt(monitor);
    const rows = global.workspace_manager.layout_rows;
    if (rows === -1) return 'vertical';
    if (screen !== undefined && screen.geometry.height > screen.geometry.width) return 'vertical';
    return 'horizontal';
  }

  /**
   * Which slot a window occupies, derived from its rectangle: 0 for the first
   * half of the work area along the axis, 1 for the second, null when it spans
   * the middle (a maximized single, a float, a window that refuses to shrink).
   * Stage 2's placement module makes this authoritative; today it is a reading.
   */
  private slotOf(rect: Rect, area: Rect, axis: 'horizontal' | 'vertical'): number | null {
    const span = axis === 'vertical' ? area.height : area.width;
    if (span <= 0) return null;
    const start = (axis === 'vertical' ? rect.y - area.y : rect.x - area.x) + (axis === 'vertical' ? rect.height : rect.width) / 2;
    if (Math.abs(start - span / 2) < span * 0.1) return null;
    return start < span / 2 ? 0 : 1;
  }

  /** §1: the live workspace-mode settings, for diagnostics and the D-Bus test. */
  private readWorkspaceModeSettings(): { dynamic: boolean; onlyPrimary: boolean; numWorkspaces: number } {
    try {
      const mutter = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
      const wm = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
      return {
        dynamic: mutter.get_boolean('dynamic-workspaces'),
        onlyPrimary: mutter.get_boolean('workspaces-only-on-primary'),
        numWorkspaces: wm.get_int('num-workspaces'),
      };
    } catch {
      return { dynamic: true, onlyPrimary: true, numWorkspaces: 1 };
    }
  }

  // -------------------------------------------- bug recorder (§22 extension)

  /** Start the bug recorder; returns its file path or a clear error string. */
  private startRecording(maxSeconds: number): string {
    if (this.recorder === null) return 'error: recorder unavailable';
    try {
      return this.recorder.start(maxSeconds);
    } catch (error) {
      this.reportError('start-recording', error);
      return `error: ${(error as Error).message}`;
    }
  }

  /**
   * Stop the bug recorder (a user stop). Returns the path; the footer is
   * deferred so the observation prompt can write a note first.
   */
  private stopRecording(): string {
    if (this.recorder === null) return 'error: recorder unavailable';
    try {
      const path = this.recorder.stop('user', true);
      if (!path.startsWith('error:')) this.showRecordingPrompt();
      return path;
    } catch (error) {
      this.reportError('stop-recording', error);
      return `error: ${(error as Error).message}`;
    }
  }

  private recordingStatus(): string {
    if (this.recorder === null) {
      return '{"recording":false,"path":null,"elapsedMs":0,"bytes":0,"events":0,"snapshots":0,"stopReason":null,"promptOpen":false,"note":"","promptMechanism":null,"promptGrab":false,"promptFocus":false,"promptRect":null}';
    }
    // The prompt fields are the extension's view of the UI (add-only), so a test
    // can prove the modal grab, the key focus and the on-screen rect are real.
    return JSON.stringify({
      ...this.recorder.describe(),
      promptMechanism: this.recordingPrompt?.kind ?? null,
      promptGrab: this.recordingPrompt?.hasGrab ?? false,
      promptFocus: this.recordingPrompt?.hasKeyFocus ?? false,
      promptRect: this.recordingPrompt?.contentRect ?? null,
    });
  }

  /**
   * The one action shared by the Super+Shift+R hotkey and the D-Bus
   * `ToggleRecording` trigger: flip recording on/off in place. Stopping shows
   * the observation prompt; starting closes any prompt left from a previous
   * stop so its file is closed with no note.
   */
  private toggleRecording(): void {
    if (this.recorder === null) return;
    if (this.recorder.isRecording) {
      this.stopRecording();
      return;
    }
    this.recordingPrompt?.close();
    this.recorder.start(0);
  }

  /** The D-Bus `ToggleRecording` trigger: toggle, then return the new status. */
  private toggleRecordingState(): string {
    this.toggleRecording();
    return this.recordingStatus();
  }

  /** Show the observation prompt for a deferred user stop. */
  private showRecordingPrompt(): void {
    if (this.recordingPrompt === null) return;
    this.recordingPrompt.show({
      onSubmit: (text) => this.submitRecordingNote(text),
      onCancel: () => {
        this.recorder?.cancelNote();
      },
    });
  }

  /**
   * D-Bus `SubmitRecordingNote` and the prompt's Save: close the deferred stop
   * with the note. Returns false when no stop is awaiting one.
   */
  private submitRecordingNote(text: string): boolean {
    if (this.recorder === null || !this.recorder.isAwaitingNote) return false;
    this.recordingPrompt?.close();
    const path = this.recorder.finalizeNote(text);
    return !path.startsWith('error:');
  }

  /**
   * The model subset one `state` line carries: every window, the focused id, the
   * border, the drop preview, the drag state, the monitors and the counters.
   * Deliberately not the full `dumpState()` (z-order, registry, …), which would
   * be written 20 times a second.
   */
  private recordSnapshot(): Record<string, unknown> {
    const windows = [...this.session.windows.values()].map((tracked) => {
      tracked.surface.refresh();
      return {
        id: tracked.id,
        appId: tracked.surface.appId,
        monitor: tracked.surface.screenId,
        workspace: tracked.surface.workspaceId,
        rect: { ...tracked.surface.frame },
        layer: tracked.surface.layer,
        minimized: tracked.surface.flags.minimized,
        maximized: tracked.surface.flags.maximized,
        fullscreen: tracked.surface.flags.fullscreen,
        tileable: this.session.classify(tracked).tileable,
      };
    });
    const preview = this.indicator.describePreview();
    const target = this.session.isDragging ? this.session.previewTarget() : null;
    return {
      windows,
      focused: this.session.focused()?.id ?? null,
      border: this.border.snapshot(),
      preview: { visible: preview.visible, rect: preview.rect, kind: target?.kind ?? null },
      drag: this.session.dragState(),
      monitors: this.host.screens().map((screen) => ({ ...screen })),
      counters: this.session.counters(),
    };
  }

  private dumpState(): string {
    const monitors = this.host.screens().map((screen) => ({ ...screen }));
    // §23: the rules the tiler would use, with the parse errors surface — the
    // runtime never silently drops an invalid rule.
    const rulesParse = this.settings.rules();
    const windows = [...this.session.windows.values()].map((tracked) => {
      tracked.surface.refresh();
      tracked.surface.captureZ();
      return {
        id: tracked.id,
        windowType: tracked.win.get_window_type(),
        cls: tracked.surface.appId,
        identity: tracked.identityKey,
        identitySource: tracked.identitySource,
        provisional: tracked.provisional,
        instanceId: tracked.instanceId,
        ordinal: this.registry.ordinalFor(tracked.appKey, tracked.instanceId) ?? null,
        neverTile: this.registry.isNeverTile(tracked.appKey),
        title: tracked.surface.title,
        version: tracked.surface.appVersion,
        workspace: tracked.surface.workspaceId,
        monitor: tracked.surface.screenId,
        rect: tracked.surface.frame,
        layer: tracked.surface.layer,
        z: tracked.surface.zPosition,
        maximized: tracked.surface.flags.maximized,
        minimized: tracked.surface.flags.minimized,
        fullscreen: tracked.surface.flags.fullscreen,
        above: tracked.surface.flags.above,
        transient: tracked.surface.flags.transient,
        slot: this.slotOf(tracked.surface.frame, this.workAreaOf(tracked.surface.screenId), this.axisOf(tracked.surface.screenId)),
        axis: this.axisOf(tracked.surface.screenId),
        tileable: this.session.classify(tracked).tileable,
        reason: this.session.classify(tracked).reason,
        profile: tracked.profile.name,
        stubborn: tracked.stubborn,
        clamped: tracked.clamped,
        min: tracked.minSize,
        max: tracked.maxSize,
      };
    });
    return JSON.stringify({
      format: 'adrt.state',
      version: EXTENSION_VERSION,
      platform: 'gnome',
      paused: this.isPaused(),
      mode: this.sessionMachine.state.mode,
      userPaused: this.sessionMachine.manualPause,
      pauseDuringSharing: this.pauseDuringSharing(),
      panel: {
        present: false,
        paused: this.isPaused(),
        indicatorEnabled: this.settings.boolean('active-window-indicator', true),
        recording: this.recorder?.isRecording ?? false,
        pauseLabel: '',
        indicatorLabel: '',
        recordLabel: '',
      },
      rules: { count: rulesParse.rules.length, errors: rulesParse.errors },
      recording: this.recorder?.describe() ?? {
        recording: false,
        path: null,
        elapsedMs: 0,
        bytes: 0,
        events: 0,
        snapshots: 0,
        stopReason: null,
        promptOpen: false,
        note: '',
      },
      workspaceMode: this.readWorkspaceModeSettings(),
      errors: this.errorCount,
      // §Self-heal diagnostics (add-only): the recovery counters and the last
      // caught error, so a restart is never silent in DumpState.
      restarts: this.restarts,
      selfDisables: this.selfDisables,
      lastErrorAt: this.lastErrorAt,
      flags: {
        debug: {
          enabled: this.settings.boolean('debug-enabled', false),
          tiling: this.settings.boolean('debug-tiling', false),
          focus: this.settings.boolean('debug-focus', false),
          displays: this.settings.boolean('debug-displays', false),
          undo: this.settings.boolean('debug-undo', false),
          session: this.settings.boolean('debug-session', false),
        },
        record: this.settings.boolean('record', false),
        perf: this.settings.boolean('perf-enabled', true),
      },
      activeWorkspace: this.host.activeWorkspaceId(),
      workspaceLayoutRows: global.workspace_manager.layout_rows,
      build: { version: RELEASE_VERSION, dirMtimeMs: this.buildDirMtimeMs },
      timing: {
        ...this.timing.describe(),
        // The pre-enable accessibility state we found and never changed.
        baseline: {
          enableAnimations: this.animationsBaseline.enableAnimations,
          slowDownFactor: this.animationsBaseline.slowDownFactor,
        },
        mutated: this.animationsMutated,
        motionPollMs: this.derivedMotionPollMs(),
        motionRetileTicks: this.derivedMotionRetileTicks(),
        normaliseOnEnableMs: NORMALIZE_ON_ENABLE_MS,
        coherenceSweepMs: COHERENCE_SWEEP_MS,
        switchWatchdogMs: SWITCH_WATCHDOG_MS,
        motionSelfMs: MOTION_SELF_MS,
      },
      tileAxis: this.session.tileAxis(),
      focusedReason: this.focusReason,
      gaps: {
        base: this.settings.int('gaps-base', 8),
        landscape: this.settings.int('gaps-landscape', -1),
        portrait: this.settings.int('gaps-portrait', -1),
      },
      workspaceAnimating: this.workspaceAnimationActive(),
      focused: this.session.focused()?.id ?? null,
      pointer: (() => {
        try {
          const [px, py] = global.get_pointer();
          return { x: px, y: py };
        } catch {
          return null;
        }
      })(),
      workspaces: this.session.countWorkspaces(),
      monitors,
      windows,
      ratios: this.tiling.getRatios(),
      swapPairs: this.tiling.getSwapPairs(),
      border: this.border.snapshot(),
      indicator: {
        ...this.indicator.describe(),
        visible: this.indicator.isVisible,
        ghosts: this.indicator.ghostCount,
        suppressed: this.border.activeSuppressions,
        preview: this.indicator.describePreview(),
      },
      overview: overview.visible,
      workspaceActors: this.signals.groupSize('workspace-actors') / 2,
      coherenceSweeps: this.session.coherenceSweepCount(),
      coherenceFixes: this.session.coherenceFixCount(),
      wsSwitchEvents: this.wsSwitchEvents,
      motionSuppressions: this.motionSuppressions,
      motionRetiles: this.motionRetiles,
      motionTicks: this.motionTicks,
      motionSkip: this.motionSkip,
      drag: this.session.dragState(),
      adaptations: this.registry.size,
      registry: this.registry.entries(),
      registrySize: this.registry.size,
      neverTile: this.registry.entries().filter((entry) => entry.neverTile).map((entry) => entry.appId),
      displayMemory: this.session.getDisplayMemory().map((entry) => entry.connector),
      perf: this.session.perf(),
      perfStats: {
        queueDepth: this.session.counters().queuePending,
        drains: this.session.counters().drains,
        drainMsP50: this.session.counters().drainMsP50,
        drainMsP95: this.session.counters().drainMsP95,
        applyMsP50: this.session.counters().applyMsP50,
        applyMsP95: this.session.counters().applyMsP95,
      },
      counters: {
        ...this.session.counters(),
        configBuilds: this.settings.configBuilds,
        rulesParses: this.settings.rulesParses,
        plansApplied: this.tiling.plansApplied,
        hostLookups: this.host.hostLookups,
        hostScans: this.host.hostScans,
        logEvents: this.history.logEvents,
      },
      bounds: this.session.memoryBounds(),
      animRecords: this.animator.recordsSnapshot(),
    });
  }

  private lookupWindow(id: number): string {
    const tracked = this.session.windows.get(id);
    if (tracked === undefined) return 'null';
    return JSON.stringify({
      id,
      cls: tracked.surface.appId,
      title: tracked.surface.title,
      rect: tracked.surface.frame,
      workspace: tracked.surface.workspaceId,
      tileable: this.session.classify(tracked).tileable,
    });
  }

  private listWindows(): { id: number; cls: string; title: string }[] {
    return [...this.session.windows.values()].map((tracked) => ({
      id: tracked.id,
      cls: tracked.surface.appId,
      title: tracked.surface.title,
    }));
  }

  /** Current floating windows keyed by app class. */
  private floatingWindows(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const tracked of this.session.windows.values()) {
      if (!tracked.surface.flags.floating) continue;
      const list = out[tracked.surface.appId] ?? [];
      list.push(tracked.id);
      out[tracked.surface.appId] = list;
    }
    return out;
  }

  /** Current floating windows plus the durable neverTile app ids. */
  private floatState(): { windows: Record<string, number[]>; neverTile: string[] } {
    return {
      windows: this.floatingWindows(),
      neverTile: this.registry.entries().filter((entry) => entry.neverTile).map((entry) => entry.appId),
    };
  }

  private exportConfig(): string {
    const settings: Record<string, unknown> = {};
    for (const key of this.settings.keys()) settings[key] = this.settings.read(key);
    const adaptations: Record<string, AdaptationRecord> = {};
    for (const entry of this.registry.entries()) {
      if (Object.keys(entry.adapt).length === 0) continue;
      adaptations[entry.appId] = {
        appId: entry.appId,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        observations: entry.windowsSeen,
        unmaximizeDelayEma: entry.adapt.unmaximizeDelayMs,
        settleTimeEma: entry.adapt.settleMs,
        skipAnimation: entry.adapt.skipAnimation,
      };
    }
    const bundle: Bundle = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      settings: settings as Bundle['settings'],
      tracked: {
        adaptations,
        behavior: { floats: this.floatingWindows() },
        registry: this.registry.toJSON(),
      },
    };
    return serializeBundle(bundle);
  }

  private importConfig(json: string, mode: ImportMode): string {
    const errors: string[] = [];
    let incoming;
    try {
      incoming = normalizeBundle(JSON.parse(json), errors);
    } catch (e) {
      return JSON.stringify({ ok: false, errors: [(e as Error).message] });
    }
    if (incoming === null) return JSON.stringify({ ok: false, errors });
    for (const [key, value] of Object.entries(incoming.settings)) {
      if (this.settings.keys().includes(key)) this.settings.write(key, value);
    }
    const applied: string[] = [];
    const incomingRegistry = incoming.tracked.registry;
    if (mode === 'replace' && incomingRegistry !== undefined) {
      this.registry.adopt({ version: 1, entries: incomingRegistry.entries as never[] });
      applied.push(...this.registry.entries().map((entry) => entry.appId));
    } else {
      for (const [appId, record] of Object.entries(incoming.tracked.adaptations)) {
        // §12: only the timing fields survive; a legacy geometric field is
        // dropped by setAdapt, never imported.
        this.registry.setAdapt(appId, {
          unmaximizeDelayMs: record.unmaximizeDelayEma,
          settleMs: record.settleTimeEma,
          skipAnimation: record.skipAnimation,
        });
        applied.push(appId);
      }
      if (mode === 'replace' && incomingRegistry !== undefined) {
        for (const entry of incomingRegistry.entries as Array<{ appId?: unknown }>) {
          if (typeof entry.appId === 'string') this.registry.observe(entry.appId);
        }
      }
    }
    const importedFloats = incoming.tracked.behavior.floats;
    if (importedFloats !== null && typeof importedFloats === 'object') {
      const appIds = Object.keys(importedFloats as Record<string, unknown>);
      for (const appId of appIds) this.registry.setNeverTile(appId, true);
    }
    this.session.refreshIdentities();
    this.session.invalidateAll();
    this.history.log('config_imported', { mode, applied: applied.length });
    return JSON.stringify({ ok: true, applied, skipped: [] });
  }

  /** §9 `SimulateScreens`: hand the extension a fixture screen list, or clear it. */
  private simulateScreens(json: string): boolean {
    if (json.length === 0 || json === 'null') {
      this.host.setSimulatedScreens(null);
      return true;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return false;
    }
    if (!Array.isArray(raw)) return false;
    const screens: Screen[] = [];
    raw.forEach((item, position) => {
      if (typeof item !== 'object' || item === null) return;
      const m = item as Record<string, unknown>;
      const geometry = {
        x: Number(m.x ?? 0),
        y: Number(m.y ?? 0),
        width: Number(m.width ?? 0),
        height: Number(m.height ?? 0),
      };
      if (geometry.width <= 0 || geometry.height <= 0) return;
      const work = m.workArea;
      screens.push({
        index: typeof m.index === 'number' ? m.index : position,
        connector: typeof m.connector === 'string' ? m.connector : `M${position}`,
        geometry,
        workArea:
          typeof work === 'object' && work !== null
            ? {
                x: Number((work as Record<string, unknown>).x ?? 0),
                y: Number((work as Record<string, unknown>).y ?? 0),
                width: Number((work as Record<string, unknown>).width ?? 0),
                height: Number((work as Record<string, unknown>).height ?? 0),
              }
            : undefined,
        scale: typeof m.scale === 'number' ? m.scale : 1,
        refreshRate: typeof m.refreshRate === 'number' ? m.refreshRate : 60,
        isPrimary: m.isPrimary === true,
      });
    });
    if (screens.length > 0 && !screens.some((screen) => screen.isPrimary)) screens[0].isPrimary = true;
    this.host.setSimulatedScreens(screens.length > 0 ? screens : null);
    return true;
  }

  private simulateResize(a: number, b: number, ratio: number): boolean {
    const first = this.session.windows.get(a);
    const second = this.session.windows.get(b);
    if (first === undefined || second === undefined) return false;
    const screen = this.host.screens().find((s) => s.index === first.surface.screenId);
    if (screen === undefined) return false;
    const axis = screen.geometry.width >= screen.geometry.height ? 'horizontal' : 'vertical';
    this.session.capturePairChange(a, b);
    this.tiling.setRatio(ratioKey(screen.index, first.surface.workspaceId, axis), ratio);
    this.session.clearSignatures();
    this.session.retile(first.surface.workspaceId, 'simulate-resize');
    if (this.settings.boolean('dry-run-mode', false)) this.history.log('dry_run', { ratio });
    return true;
  }

  private injectVerifyFailure(id: number, count: number): boolean {
    if (!this.session.windows.has(id)) return false;
    // The id matters: a scenario that fails one window's applies must not make
    // every other window's applies look like a refusal too (that taught a bogus
    // minimum in A52).
    this.tiling.injectVerifyFailures(count, id);
    return true;
  }

  private injectSignal(type: string, payload: string): boolean {
    let data: Record<string, unknown> = {};
    if (payload.length > 0) {
      try {
        data = JSON.parse(payload) as Record<string, unknown>;
      } catch (e) {
        console.error(`[adrt] InjectSignal payload is not JSON: ${(e as Error).message}`);
        return false;
      }
    }
    switch (type) {
      case 'screens-changed':
        this.host.emit({ type: 'screens-changed' });
        break;
      case 'focus-changed':
        this.onFocusChanged(typeof data.id === 'number' ? data.id : null);
        break;
      case 'workspace-switched':
        this.onWorkspaceSwitched({ from: Number(data.from ?? 0), to: Number(data.to ?? 0) });
        break;
      case 'surface-frame-changed': {
        const tracked = this.session.windows.get(Number(data.id));
        if (tracked !== undefined) {
          tracked.refreshFrame();
          this.onStateChanged();
        }
        break;
      }
      default:
        return false;
    }
    this.history.log('lookup', { injected: type });
    return true;
  }
  private simulateSessionMode(mode: string): boolean {
    if (mode !== 'user' && mode !== 'unlock-dialog' && mode !== 'screen-sharing' && mode !== 'suspend') return false;
    // §19: suspend is treated as lock. The injected mode overrides the live one
    // until a real `notify::current-mode` transition clears it.
    const resolved: SessionMode = mode === 'suspend' ? 'unlock-dialog' : mode;
    this.injectedMode = resolved;
    this.applySessionMode(resolved);
    return true;
  }

  /**
   * Test hook: hold GNOME's workspace-switch state open for `holdMs`. This is
   * the exact path a touchpad gesture takes at its start
   * (`WorkspaceAnimationController._switchWorkspaceBegin`), so the border must
   * hide for the whole time, then come back.
   */
  private simulateWorkspaceSwitch(holdMs: number): boolean {
    const controller = (wm as any)?._workspaceAnimation;
    if (controller === null || controller === undefined || typeof controller._prepareWorkspaceSwitch !== 'function') return false;
    const hold = holdMs > 0 ? Math.min(holdMs, 5000) : 600;
    controller._prepareWorkspaceSwitch();
    this.timers.add('simulate-workspace-switch', hold, () => {
      const current = (wm as any)?._workspaceAnimation;
      if (current !== null && current !== undefined && current._switchData != null) {
        current._finishWorkspaceSwitch(current._switchData);
      }
    });
    return true;
  }
}

