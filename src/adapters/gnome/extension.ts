// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Extension entry point (§2.1). Constructs nothing in the constructor; every
 * object is created in `enable()` and destroyed in `disable()` (§4.1).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import type { Variant } from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { notify, overview, wm } from 'resource:///org/gnome/shell/ui/main.js';

import { BorderState } from '../../core/border.js';
import type { SuppressionReason } from '../../core/border.js';
import { SessionMachine } from '../../core/session.js';
import { ChangeLog } from '../../core/undo.js';
import { NoticeGate, isAlwaysNotice, noticeTitle } from '../../core/notify.js';
import { TRIGGERS, buildDispatch } from '../../core/triggers.js';
import { clamp, Layer } from '../../core/types.js';
import type { Rect } from '../../core/types.js';
import { PLATFORM_EVENT_TYPES } from '../../platform/events.js';
import { dataDir, readJson } from './adapt.js';
import * as compat from './compat.js';
import { ConfigTransfer } from './config-transfer.js';
import { Diagnostics } from './dump-state.js';
import { GnomeDbus } from './dbus.js';
import { createAnimationLedger } from './frame-clock.js';
import type { Animator } from './frame-clock.js';
import { GestureInput } from './gesture-input.js';
import { Harness } from './harness.js';
import type { Handlers, WorkspaceAnimationController } from './harness.js';
import { GnomeHost } from './host.js';
import { History } from './history.js';
import { GnomeIndicator } from './indicator.js';
import { EventJournal } from './journal.js';
import { PerfProbe } from './perf.js';
import { Persistence } from './persistence.js';
import { Recovery } from './recovery.js';
import { SignalRegistry, TimeoutRegistry } from './lifecycle.js';
import { Recorder } from './recorder.js';
import { RecordingPrompt } from './recording-prompt.js';
import { RegistryStore } from './registry.js';
import { WindowSession } from './session.js';
import { ShellTracker } from './shell-tracker.js';
import type { ShellTrackerEvent } from './shell-tracker.js';
import type { TrackedWindow } from './tracked-window.js';
import { GnomeSettings } from './settings.js';
import { SessionModeController } from './session-mode.js';
import { GnomeTiming } from './timing.js';
import { Tiling } from './tiling.js';


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

/**
 * Structural views of the GJS/Shell surfaces `extension.ts` reads. `gi.d.ts`
 * declares these namespaces as `any`, so each view names only the members the
 * code uses and marks optional exactly what the code probes — the same pattern
 * as `compat.ts`/`host.ts`, one structural boundary per API.
 */

/** The private `path` GNOME Shell assigns to an `Extension` instance. */
interface ShellExtensionPath {
  path?: string;
}

/**
 * A `Clutter.Seat` used for the §17 input injection. `compat.defaultSeat()`
 * types `create_virtual_device` as optional because it probes for it; the
 * injection path only runs once that probe passed, so it is required here.
 */
interface InjectionSeat {
  create_virtual_device(type: number): InjectedVirtualDevice;
}

/** A Clutter virtual input device, as driven by the §17 injection harness. */
interface InjectedVirtualDevice {
  notify_absolute_motion(time: number, x: number, y: number): void;
  notify_button(time: number, button: number, state: unknown): void;
  notify_keyval(time: number, keyval: number, state: unknown): void;
}

/** A window in the compositor stacking order, read only for its id. */
interface IdentifiedWindow {
  get_id(): number;
}

/**
 * The id of a window returned by `compat.sortByStacking`. That API types its
 * elements by the probe surface it needs (which omits `get_id`); the objects it
 * returns are the Mutter windows it was given, so the id is read through this
 * one structural view rather than an `any`.
 */
function stackingId(win: unknown): number {
  return (win as IdentifiedWindow).get_id();
}

export default class AdrtExtension extends Extension {
  private settings!: GnomeSettings;
  private host!: GnomeHost;
  private timing!: GnomeTiming;
  private registry!: RegistryStore;
  private history!: History;
  private journal!: EventJournal;
  /** §9/§12: state.json, display memory and the one-shot migrations. */
  private persistence!: Persistence;
  private changes!: ChangeLog;
  /** §12: ExportConfig/ImportConfig over the live settings and registry. */
  private configTransfer!: ConfigTransfer;
  /** §40.4: the probe, the state dump and the replayable trace snapshot. */
  private diagnostics!: Diagnostics;
  /** §22/§40.4: the D-Bus handler map and the harness/test utilities. */
  private harness!: Harness;
  private indicator!: GnomeIndicator;
  private animator!: Animator;
  private tiling!: Tiling;
  private session!: WindowSession;
  /** P6e: dev-gated section profiler, enabled from `trace-enabled` at enable. */
  private probe!: PerfProbe;
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
  /** §19: the session-mode/pause policy and the test-injected mode. */
  private mode!: SessionModeController;

  private readonly notices = new NoticeGate();
  /** Why focus last moved, as far as adrt knows (the shell moves it itself). */
  private focusReason = 'shell';
  private injectionEnabled = false;
  private injectSeat: InjectionSeat | null = null;
  private injectPointer: InjectedVirtualDevice | null = null;
  private injectKeyboard: InjectedVirtualDevice | null = null;
  /** Errors caught by the outer boundaries (enable, signal handlers). */
  private errorCount = 0;
  /** §Self-heal: the caught-error restart policy (created on first `enable`). */
  private recovery: Recovery | undefined;
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

  enable(): void {
    const started = GLib.get_monotonic_time();
    // §Self-heal: the recovery policy is created once and survives re-enables,
    // so its cumulative counters stay; a real enable only resets its per-enable
    // state.
    const recovery = (this.recovery ??= new Recovery({
      history: () => this.history,
      journal: () => this.journal,
      interactionActive: () => this.interactionActive(),
      teardown: () => this.disableWith(),
      reinitialize: () => this.enableWith(GLib.get_monotonic_time()),
      reportError: (context, error) => this.reportError(context, error),
    }));
    recovery.resetForEnable();
    // §36/§Self-heal (1.11): the entry point is the most important boundary; a
    // throw here is routed through the recovery policy in the catch below,
    // never allowed to escape unhandled into the Shell.
    try {
      this.enableWith(started);
    } catch (error) {
      this.reportError('enable', error);
      // §Self-heal (1.11): a failed enable is already a half-built extension, so
      // it counts as the *first* recovery signal instead of waiting for the
      // usual 3-error burst. `considerRecovery` still schedules on idle and
      // still honours the restart cap and any in-flight interaction (nothing
      // restarts inline). Only when recovery is impossible — self-disabled,
      // GNOME already disabling us, or the restart cap reached — do we rethrow,
      // so GNOME calls `disable()` and removes the half-built extension instead
      // of leaving it "enabled".
      if (!recovery.considerRecovery('enable')) throw error;
    }
  }

  /** The enable body. `enable()` contains its throw and decides between an
   * in-place restart and letting GNOME disable the half-built extension. */
  private enableWith(started: number): void {
    // The journal comes first: everything below it may log a decision.
    this.journal = new EventJournal(30);
    this.journal.prune();
    this.injectionEnabled = GLib.getenv('ADRT_INJECT') === '1';
    // Record which build is loaded: on Wayland a logout is needed to reload, so
    // "is the running module the one I installed?" must be answerable at a glance.
    try {
      const dir = (this as ShellExtensionPath).path;
      if (typeof dir === 'string' && dir.length > 0) {
        const info = Gio.File.new_for_path(dir).query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
        const when = info.get_modification_date_time();
        this.buildDirMtimeMs = when === null ? 0 : when.to_unix() * 1000;
      }
    } catch {
      this.buildDirMtimeMs = 0;
    }
    this.settings = new GnomeSettings(this.getSettings());
    // P6e: the section profiler is gated on the existing trace setting, read
    // once here (it is not among the watched settings), so no gschema key is
    // added and no watcher is needed. Every section site guards on `.enabled`.
    this.probe = new PerfProbe();
    this.probe.enabled = this.settings.boolean('trace-enabled', false);
    // 1.3: `surface-frame-changed` fires per animated frame; persist it only
    // when tracing (or while the recorder's sink is attached).
    this.journal.setNoisyWrites(this.settings.boolean('trace-enabled', false));
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
    this.history.setSink((event) => this.journal.decide(event.ev, event));
    this.history.prune();
    this.persistence = new Persistence({
      settings: this.settings,
      history: this.history,
      journal: this.journal,
      tiling: () => this.tiling,
      session: () => this.session,
    });
    this.persistence.migrate(EXTENSION_VERSION);
    this.registry = new RegistryStore({ onError: (context, error) => this.reportError(context, error) });
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
    this.persistence.migrateRuleFloats();
    this.changes = new ChangeLog();
    this.border = new BorderState();

    this.host = new GnomeHost((context, error) => this.reportError(context, error));
    this.host.enable();

    this.indicator = new GnomeIndicator(this.settings, this.timing);
    this.animator = createAnimationLedger({
      isAlive: (id) => this.session.windows.has(id),
      // §Self-heal containment: these run inside Clutter timeline signal
      // emissions — a throw must never propagate out of them. Bound once (2.1).
      apply: this.onAnimatorApply,
      onFrame: this.onAnimatorFrame,
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
      isPaused: () => this.mode.isPaused(),
      onRatiosChanged: () => this.persistence.saveState(),
      onStubborn: (appId) => this.onStubborn(appId),
      noteSelfUnmaximize: (id) => this.session.noteSelfUnmaximize(id),
    });

    this.session = new WindowSession({
      host: this.host,
      settings: this.settings,
      timing: this.timing,
      tiling: this.tiling,
      history: this.history,
      registry: this.registry,
      changes: this.changes,
      probe: this.probe,
      isPaused: () => this.mode.isPaused(),
      onStateChanged: () => this.onStateChanged(),
      onStubborn: (appId) => this.onStubborn(appId),
      onClosed: (id, rect) => this.onWindowClosed(id, rect),
      onDragChanged: (dragging) => this.onDragChanged(dragging),
      onWindowMoving: () => this.suppressForWorkspaceSwitch(),
      onNotice: (key, subject) => {
        this.toast(key, subject);
      },
      onModelEvent: (event, fields) => this.onModelEvent(event, fields),
      onDisplayMemoryChanged: () => this.persistence.saveDisplayMemory(),
      isAnimating: () => this.animator.activeCount > 0,
    });
    this.configTransfer = new ConfigTransfer({
      settings: this.settings,
      registry: this.registry,
      history: this.history,
      session: this.session,
      floatingWindows: () => this.floatingWindows(),
    });
    // §19: the session-mode/pause policy, constructed with the session it gates.
    this.mode = new SessionModeController({
      settings: this.settings,
      session: this.session,
      sessionMachine: this.sessionMachine,
      border: this.border,
      history: this.history,
      stopMotionWatch: () => this.stopMotionWatch(),
      suppressBorder: (reason) => this.suppressBorder(reason),
      unsuppressBorder: (reason) => this.unsuppressBorder(reason),
      syncIndicator: () => this.syncIndicator(),
      syncPreview: () => this.syncPreview(),
    });
    // §40.4: the diagnostics/probe/trace snapshot owner. Constructed after the
    // live objects it reads; the scalar readers are lazy (they change over time).
    this.diagnostics = new Diagnostics({
      settings: this.settings,
      host: this.host,
      timing: this.timing,
      history: this.history,
      registry: this.registry,
      tiling: this.tiling,
      session: this.session,
      indicator: this.indicator,
      animator: this.animator,
      signals: this.signals,
      border: this.border,
      probe: this.probe,
      journal: this.journal,
      sessionMachine: this.sessionMachine,
      releaseVersion: RELEASE_VERSION,
      extensionVersion: EXTENSION_VERSION,
      normalizeOnEnableMs: NORMALIZE_ON_ENABLE_MS,
      coherenceSweepMs: COHERENCE_SWEEP_MS,
      switchWatchdogMs: SWITCH_WATCHDOG_MS,
      motionSelfMs: MOTION_SELF_MS,
      recorder: () => this.recorder,
      injectionEnabled: () => this.injectionEnabled,
      isPaused: () => this.mode.isPaused(),
      pauseDuringSharing: () => this.mode.pauseDuringSharing(),
      derivedMotionPollMs: () => this.derivedMotionPollMs(),
      derivedMotionRetileTicks: () => this.derivedMotionRetileTicks(),
      workspaceAnimationActive: () => this.workspaceAnimationActive(),
      focusReason: () => this.focusReason,
      errorCount: () => this.errorCount,
      restarts: () => this.recovery?.restartCount ?? 0,
      selfDisables: () => this.recovery?.selfDisableCount ?? 0,
      lastErrorAt: () => this.lastErrorAt,
      buildDirMtimeMs: () => this.buildDirMtimeMs,
      animationsBaseline: () => this.animationsBaseline,
      animationsMutated: () => this.animationsMutated,
      wsSwitchEvents: () => this.wsSwitchEvents,
      motionSuppressions: () => this.motionSuppressions,
      motionRetiles: () => this.motionRetiles,
      motionTicks: () => this.motionTicks,
      motionSkip: () => this.motionSkip,
    });

    // §22 extension: the bug recorder. Constructed inert: it attaches no
    // journal sink and arms no timer until `StartRecording`.
    this.recorder = new Recorder({
      journal: this.journal,
      build: () => ({ version: RELEASE_VERSION, dirMtimeMs: this.buildDirMtimeMs }),
      mode: () => this.sessionMachine.state.mode,
      paused: () => this.mode.isPaused(),
      monitors: () => this.host.screens().map((screen) => ({ ...screen })),
      settings: () => this.settings.snapshot(),
      snapshot: () => this.diagnostics.recordSnapshot(),
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
    // §22/§40.4: the D-Bus dispatch + harness utilities, built from the one
    // trigger table. Constructed once all the live objects it reads exist.
    this.harness = new Harness({
      settings: this.settings,
      host: this.host,
      session: this.session,
      registry: this.registry,
      tiling: this.tiling,
      history: this.history,
      journal: this.journal,
      animator: this.animator,
      gestures: this.gestures,
      changes: this.changes,
      diagnostics: this.diagnostics,
      configTransfer: this.configTransfer,
      persistence: this.persistence,
      sessionMachine: this.sessionMachine,
      timers: this.timers,
      indicator: this.indicator,
      recorder: () => this.recorder,
      recordingPrompt: () => this.recordingPrompt,
      floatingWindows: () => this.floatingWindows(),
      toast: (key, subject) => this.toast(key, subject),
      setFocusReason: (reason) => this.noteFocus(reason),
      setTilingPaused: (paused) => this.mode.setTilingPaused(paused),
      unsuppressBorder: (reason) => this.unsuppressBorder(reason),
      syncIndicator: () => this.syncIndicator(),
      onOverviewChanged: (visible) => this.onOverviewChanged(visible),
      onFocusChanged: (id) => this.onFocusChanged(id),
      onWorkspaceSwitched: (payload) => this.onWorkspaceSwitched(payload),
      onStateChanged: () => this.onStateChanged(),
      workspaceAnimation: () => this.workspaceAnimation(),
      writeSetting: (schema, key, value) => this.writeSetting(schema, key, value),
      reportError: (context, error) => this.reportError(context, error),
      injectPointerMove: (x, y) => this.injectPointerMove(x, y),
      injectPointerButton: (button, pressed) => this.injectPointerButton(button, pressed),
      injectKey: (keyval, pressed) => this.injectKey(keyval, pressed),
      injectFault: (context) => this.simulateFault(context),
      simulateChromeTeardown: () => this.simulateChromeTeardown(),
      simulateSessionMode: (mode) => this.mode.simulate(mode),
    });

    this.persistence.restoreState();
    this.persistence.restoreDisplayMemory();
    this.subscribeHost();
    this.watchSettings();

    // §22: the trace's initial state is the model before any window is adopted.
    this.diagnostics.captureRecordInitial();
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
    this.mode.applySessionMode(this.mode.currentMode(), true);
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
      this.mode.refreshSessionMode();
      this.watchWorkspaceAnimation();
      this.refreshWorkspaceSwitchSuppression();
      this.mode.refreshSharingSuppression();
    }));

    this.onStateChanged();
    this.persistence.firstRun();
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
    this.recovery?.markGnomeDisable();
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
    this.teardown('registry', () => this.registry?.destroy());
    this.teardown('display-memory', () => this.persistence.saveDisplayMemory());
    this.teardown('state', () => this.persistence.saveState());
    // §18: restore GNOME's animations to what we found, never force them on for
    // a user who had turned them off.
    this.teardown('animation-baseline', () => this.restoreAnimationSetting());
    this.teardown('timing', () => this.timing?.destroy());
    // The buffered stores flush last, after every step that can still log, and
    // cancel their one-shot flush timers here (1.3).
    this.teardown('history', () => this.history?.destroy());
    this.teardown('journal', () => this.journal?.destroy());
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
   * §2.1/§Self-heal: the animation-frame hooks, bound once at construction so a
   * compositor frame allocates no `guard()` closure. They run inside Clutter
   * timeline emissions, so each keeps a direct boundary and reports with the
   * same `[adrt] ERROR` marker `guard` would have used.
   */
  private readonly onAnimatorApply = (id: number, rect: Rect): void => {
    try {
      this.host.applyFrame(id, rect);
    } catch (error) {
      this.reportError('animator-apply', error);
    }
  };

  private readonly onAnimatorFrame = (id: number, rect: Rect): void => {
    try {
      this.onAnimatedFrame(id, rect);
    } catch (error) {
      this.reportError('animator-frame', error);
    }
  };

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
    this.recovery?.noteError(context);
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

  private subscribeHost(): void {
    // Every platform event goes into the journal, whatever consumes it (§22).
    for (const type of PLATFORM_EVENT_TYPES) {
      this.hostUnsubscribers.push(this.host.on(type, (payload) => this.guard(`host:${type}`, () => {
        this.journal.record('host', type, payload);
      })()));
    }
    this.hostUnsubscribers.push(
      this.host.on('surface-created', (payload) => this.guard('host:surface-created', () => {
        const win = this.host.windowFor(payload.surface.id);
        if (win !== null) this.session.register(win);
      })()),
      this.host.on('focus-changed', (payload) => this.guard('host:focus-changed', () => this.onFocusChanged(payload.id))()),
      this.host.on('workspace-switched', (payload) => this.guard('host:workspace-switched', () => this.onWorkspaceSwitched(payload))()),
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
  /**
   * `Main.wm._workspaceAnimation`, a private Shell field. `wm` has no public
   * type, so it is read through one structural view here; every member of the
   * controller is optional because Shell internals move between releases.
   */
  private workspaceAnimation(): WorkspaceAnimationController | null {
    const controller = (wm as { _workspaceAnimation?: WorkspaceAnimationController | null })._workspaceAnimation;
    return controller ?? null;
  }

  private watchWorkspaceAnimation(): void {
    const controller = this.workspaceAnimation();
    if (controller === null) return;
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
        this.mode.onLiveTransition();
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
    if (this.mode.isPaused()) return;
    this.suppressForWorkspaceSwitch();
  }

  /** True while GNOME is sliding workspaces (animation or live gesture). */
  private workspaceAnimationActive(): boolean {
    const controller = this.workspaceAnimation();
    return controller !== null && controller._switchData != null;
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
      this.recovery?.reconsiderDeferredRestart();
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
    this.recovery?.reconsiderDeferredRestart();
    // §22 extension: the recorder's ~20 Hz state sample rides this existing tick
    // (a no-op with no recording). It runs before the pause/park returns below so
    // a still recording still sees the state that changed.
    this.recorder?.tick();
    if (this.mode.isPaused()) {
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
      .map(stackingId);
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
    if (this.mode.isPaused()) {
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
    const visible = snapshot.visible && snapshot.rect !== null && !this.mode.isPaused() && !overview.visible;
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
    const hidden = target === null || this.mode.isPaused() || overview.visible;
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
    if (this.mode.isPaused()) return;
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
    if (target !== current) manager.get_workspace_by_index(target)?.activate(global.get_current_time());
  }

  // ------------------------------------------------------------- settings

  private watchSettings(): void {
    // Any setting change drops the memoised classifier config: it is read per
    // window per pass, and a stale config would be a correctness bug, not a perf
    // win, so the invalidation is blanket.
    this.settingWatchers.push(this.settings.onAnyChange(this.guard('setting:all', () => undefined)));
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
      // §12: the prefs Apps page writes registry.json directly; the revision
      // bump is the signal for the running Shell to drop its in-memory copy
      // (and the timing learned with it) and re-read the file it just wrote.
      ['registry-revision', () => {
        this.registry.reload();
        this.session.invalidateAll();
      }],
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
      // §P6e: the dev-gated section profiler and the journal's noisy-write
      // switch follow `trace-enabled` live, so a debug session does not need a
      // re-enable to arm them.
      ['trace-enabled', () => {
        const on = this.settings.boolean('trace-enabled', false);
        this.probe.enabled = on;
        this.journal.setNoisyWrites(on);
      }],
      // §19: flipping the sharing option re-derives the suppression at once
      // (on or off) without waiting for a session transition.
      ['pause-during-sharing', () => this.mode.refreshSharingSuppression()],
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
      'kb-increase-window',
      'kb-decrease-window',
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
        this.harness.toggleRecording();
        break;
      case 'kb-toggle-pause':
        // The user's pause home: the same predicate the old panel row and the
        // D-Bus TogglePause trigger drive.
        this.mode.setTilingPaused(!this.sessionMachine.manualPause);
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
      case 'kb-increase-window':
        this.resizeFocused('increase');
        break;
      case 'kb-decrease-window':
        this.resizeFocused('decrease');
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
    this.session.nudgeFocused(direction, this.settings.int('nudge-step', 10));
  }

  private resizeFocused(grow: 'increase' | 'decrease'): void {
    // Same step as the nudge on the perpendicular axis (§17).
    this.session.resizeFocused(grow, this.settings.int('nudge-step', 10));
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

  // --------------------------------------------------- trace (Stage 6, §22)

  /** Journal one model-level event for the replayable trace. */
  private onModelEvent(event: string, fields: Record<string, unknown>): void {
    this.journal.record('model', event, fields);
  }

  // ----------------------------------------------------- input injection

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

  /**
   * Ensure the virtual pointer/keyboard exist, returning them together so the
   * callers below need no null check after a truthy result. A missing seat or
   * device throws here, exactly as the old direct call did, and the boundary
   * disables injection for the session.
   */
  private ensureInjection(): { pointer: InjectedVirtualDevice; keyboard: InjectedVirtualDevice } | null {
    if (!this.injectionEnabled) return null;
    try {
      // The one cast: `compat.defaultSeat()` returns its probe view, where the
      // device factory is optional; injection only runs after that probe passed.
      if (this.injectSeat === null) this.injectSeat = compat.defaultSeat() as InjectionSeat | null;
      if (this.injectSeat === null) throw new Error('no Clutter seat for input injection');
      if (this.injectPointer === null) {
        this.injectPointer = this.injectSeat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
      }
      if (this.injectKeyboard === null) {
        this.injectKeyboard = this.injectSeat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
      }
      if (this.injectPointer === null || this.injectKeyboard === null) return null;
      return { pointer: this.injectPointer, keyboard: this.injectKeyboard };
    } catch (error) {
      console.warn(`[adrt] input injection unavailable: ${(error as Error).message}`);
      this.injectionEnabled = false;
      return null;
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
    const injection = this.ensureInjection();
    if (injection === null) return false;
    try {
      injection.pointer.notify_absolute_motion(this.eventTime(), Math.trunc(x), Math.trunc(y));
      this.journal.record('inject', 'pointer-move', { x, y });
      return true;
    } catch {
      return false;
    }
  }

  private injectPointerButton(button: number, pressed: boolean): boolean {
    const injection = this.ensureInjection();
    if (injection === null) return false;
    try {
      const state = pressed ? Clutter.ButtonState.PRESSED : Clutter.ButtonState.RELEASED;
      injection.pointer.notify_button(this.eventTime(), button, state);
      this.journal.record('inject', 'pointer-button', { button, pressed });
      return true;
    } catch {
      return false;
    }
  }

  private injectKey(keyval: number, pressed: boolean): boolean {
    const injection = this.ensureInjection();
    if (injection === null) return false;
    try {
      const state = pressed ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED;
      injection.keyboard.notify_keyval(this.eventTime(), keyval, state);
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
        let parsed: Variant;
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
   *
   * The map is built from the one trigger table (`core/triggers.ts`, P6a), so
   * the XML `dbus.ts` exports and this dispatch map always agree. A table entry
   * with no implementation, or an implementation with no table entry, throws
   * here — inside `enable()` — rather than silently dropping a method.
   *
   * Each method has its own signature, so a reflective walk cannot keep those
   * signatures: `Object.keys` erases them. The handler types are aliases (not
   * interfaces), so the table is assignable to a string-keyed function map
   * without a double cast; `guardValue` forwards every argument unchanged, so
   * the arities still hold.
   */
  private guardedHandlers(): Handlers {
    const raw: Record<string, (...args: never[]) => unknown> = this.harness.handlers();
    const dispatch = buildDispatch(TRIGGERS, raw, (name, handler) => this.guardValue(`dbus:${name}`, handler));
    return Object.assign({} as Handlers, dispatch);
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
}

