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
import { layoutManager, notify, overview, sessionMode, wm } from 'resource:///org/gnome/shell/ui/main.js';

import type { AdaptationRecord, Bundle, ImportMode } from '../../core/config.js';
import { BUNDLE_FORMAT, BUNDLE_VERSION, normalizeBundle, serializeBundle } from '../../core/config.js';
import { BorderState } from '../../core/border.js';
import type { SuppressionReason } from '../../core/border.js';
import { SessionMachine } from '../../core/session.js';
import type { SessionMode } from '../../core/session.js';
import { ChangeLog } from '../../core/undo.js';
import type { SplitAxis } from '../../core/tiler.js';
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
import { FrameClockAnimator } from './frame-clock.js';
import { GestureInput } from './gesture-input.js';
import { GnomeHost } from './host.js';
import { History } from './history.js';
import { GnomeIndicator } from './indicator.js';
import { EventJournal } from './journal.js';
import { RegistryStore } from './registry.js';
import { WindowSession } from './session.js';
import type { TrackedWindow } from './tracked-window.js';
import { GnomeSettings } from './settings.js';
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
/** §23.2: how often the focused actor's position is sampled, and how many
 * stable samples end a transition. */
const MOTION_POLL_MS = 50;
const MOTION_STABLE_SAMPLES = 3;
/** §35: every N motion ticks (~500 ms) re-run the tiling plan as a safety net,
 * so a layout that drifted without a usable signal heals on its own. */
const MOTION_RETILE_TICKS = 10;
/** Ignore movement for this long after we applied a plan ourselves. */
const MOTION_SELF_MS = 200;
/** §35: how often the coherence sweep guarantees every window is tiled. */
const COHERENCE_SWEEP_MS = 700;

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
  SpawnWindow(command: string): number;
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
}

type Handlers = DbusHandlers & ExtraHandlers;

export default class AdrtExtension extends Extension {
  private settings!: GnomeSettings;
  private host!: GnomeHost;
  private registry!: RegistryStore;
  private history!: History;
  private journal!: EventJournal;
  private changes!: ChangeLog;
  private indicator!: GnomeIndicator;
  private animator!: FrameClockAnimator;
  private tiling!: Tiling;
  private session!: WindowSession;
  private gestures!: GestureInput;
  private dbus!: GnomeDbus;
  private border!: BorderState;
  private sessionMachine = new SessionMachine();

  private readonly notices = new NoticeGate();
  /** Why focus last moved, as far as adrt knows (the shell moves it itself). */
  private focusReason = 'shell';
  private injectionEnabled = false;
  private injectSeat: any = null;
  private injectPointer: any = null;
  private injectKeyboard: any = null;
  private sessionModeId = 0;
  private overviewSignals: number[] = [];
  private swipeSignalIds: number[] = [];
  private workspaceActorSignals: { actor: any; id: number }[] = [];
  private layoutSignals: number[] = [];
  private motionSource: number | null = null;
  private coherenceSource: number | null = null;
  /** What build is actually running (set at enable). */
  private buildDirMtimeMs = 0;
  private motionActor: any = null;
  private motionLastX = Number.NaN;
  private motionLastY = Number.NaN;
  private motionStable = 0;
  private motionTicks = 0;
  private motionRetiles = 0;
  private motionSkip = '';
  private occluded = false;
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
    this.changes = new ChangeLog();
    this.border = new BorderState();

    this.host = new GnomeHost();
    this.host.enable();

    this.indicator = new GnomeIndicator(this.settings);
    this.animator = new FrameClockAnimator({
      isAlive: (id) => this.session.windows.has(id),
      apply: (id, rect) => this.host.applyFrame(id, rect),
      onFrame: (id, rect) => this.onAnimatedFrame(id, rect),
    });

    this.tiling = new Tiling({
      host: this.host,
      settings: this.settings,
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

    const injectedFailures = this.settings.int('debug-inject-verify-failure', 0);
    if (injectedFailures > 0) this.tiling.injectVerifyFailures(injectedFailures);

    this.gestures = new GestureInput(this.settings, this.history, {
      switchWorkspace: (direction) => this.switchWorkspace(direction),
      toggleOverview: () => overview.toggle(),
      showDesktop: () => overview.toggle(),
      swapPair: (direction) => this.session.moveToward(direction),
      custom: (action) => this.history.log('gesture', { custom: action }),
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
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
      this.session?.normalizeOnEnable();
      return GLib.SOURCE_REMOVE;
    });

    this.gestures.configure();
    if (this.settings.boolean('dbus-enabled', true)) {
      this.dbus = new GnomeDbus();
      this.dbus.expose(this.handlers());
    }

    this.sessionModeId = sessionMode.connect('notify::current-mode', () => this.applySessionMode(this.currentMode()));
    this.overviewSignals.push(overview.connect('showing', () => this.onOverviewChanged(true)));
    this.overviewSignals.push(overview.connect('hidden', () => this.onOverviewChanged(false)));
    this.refreshWorkspaceActors();
    this.connectWorkspaceAnimation();
    this.layoutSignals.push(global.workspace_manager.connect('workspace-added', () => this.refreshWorkspaceActors()));
    this.layoutSignals.push(global.workspace_manager.connect('workspace-removed', () => this.refreshWorkspaceActors()));
    this.applySessionMode(this.currentMode(), true);
    // §23: hide the border if the extension is enabled while the overview is
    // already open (e.g. a headless shell that starts in it); the `showing`
    // signal has already fired by then. Tiling itself keeps running.
    if (overview.visible) this.onOverviewChanged(true);
    this.registerKeybindings();
    this.session.setScanning(true);
    // §35: a periodic guarantee, independent of signals: a normal window must
    // never be left untiled next to a sibling.
    this.coherenceSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, COHERENCE_SWEEP_MS, () => {
      this.session.coherenceSweep();
      this.watchWorkspaceAnimation();
      this.refreshWorkspaceSwitchSuppression();
      return GLib.SOURCE_CONTINUE;
    });

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
    this.journal?.destroy();
    this.history.log('disable', {});
    this.stopMotionWatch();
    if (this.coherenceSource !== null) {
      GLib.source_remove(this.coherenceSource);
      this.coherenceSource = null;
    }
    if (this.sessionModeId !== 0) {
      sessionMode.disconnect(this.sessionModeId);
      this.sessionModeId = 0;
    }
    for (const id of this.overviewSignals) overview.disconnect(id);
    this.overviewSignals = [];
    for (const entry of this.workspaceActorSignals) entry.actor.disconnect(entry.id);
    this.workspaceActorSignals = [];
    this.disconnectWorkspaceAnimation();
    for (const id of this.layoutSignals) global.workspace_manager.disconnect(id);
    this.layoutSignals = [];
    this.unregisterKeybindings();
    for (const unsubscribe of this.settingWatchers) unsubscribe();
    this.settingWatchers = [];
    for (const unsubscribe of this.hostUnsubscribers) unsubscribe();
    this.hostUnsubscribers = [];
    if (this.dbus !== undefined) this.dbus.unexpose();
    this.gestures.disable();
    this.session.destroy();
    this.tiling.destroy();
    this.animator.destroy();
    this.indicator.destroy();
    this.host.disable();
    this.registry.flush();
    this.saveDisplayMemory();
    this.history.destroy();
    this.saveState();
    // §18: leave GNOME's animations as we found them.
    try {
      St.Settings.get().enable_animations = true;
    } catch {
      /* no St.Settings */
    }
  }

  // ---------------------------------------------------------------- session

  private currentMode(): SessionMode {
    return sessionMode.currentMode as SessionMode;
  }

  private isPaused(): boolean {
    // §19: while the drain finishes the backlog a pause caught, policy runs as
    // if unpaused; new work is still refused where it is pushed.
    return this.sessionMachine.isPaused && !(this.session?.isDrainingBacklog() ?? false);
  }

  private applySessionMode(mode: SessionMode, initial = false): void {
    const effects = this.sessionMachine.setMode(mode);
    if (effects.indicatorSuppression !== null) {
      this.suppressBorder(effects.indicatorSuppression);
    } else {
      this.unsuppressBorder('pause');
      this.unsuppressBorder('sharing');
    }
    this.session.setScanning(effects.scanTickRunning);
    this.syncIndicator();
    if (!initial && effects.retileOnResume) this.session.scheduleReconcile('session-resume');
    this.history.log('session_mode', { mode, paused: effects.paused });
  }

  private subscribeHost(): void {
    // Every platform event goes into the journal, whatever consumes it (§22).
    for (const type of PLATFORM_EVENT_TYPES) {
      this.hostUnsubscribers.push(this.host.on(type, (payload) => {
        this.journal.record('host', type, (payload ?? {}) as Record<string, unknown>);
      }));
    }
    this.hostUnsubscribers.push(
      this.host.on('surface-created', (payload) => {
        const surfaceId = (payload as { surface: { id: number } }).surface.id;
        const win = this.host.windowFor(surfaceId);
        if (win !== null) this.session.register(win);
      }),
      this.host.on('focus-changed', (payload) => this.onFocusChanged((payload as { id: number | null }).id)),
      this.host.on('workspace-switched', (payload) => this.onWorkspaceSwitched(payload as { from: number; to: number })),
      this.host.on('screens-changed', () => {
        // §10: re-read every surface (monitor, frame, monitor-implied sticky,
        // size hints) and drop classification before the deferred replan.
        this.session.onScreensChanged();
        if (this.settings.boolean('debug-displays', false)) {
          this.history.log('screens_changed', { monitors: this.host.screens().length });
        }
        // §11: no policy in a signal handler. The work-area change needs a
        // settle, so it is a maintenance pass; the retile rides the layout lane.
        this.session.scheduleReconcile('screens-changed');
        this.session.scheduleDisplayPass('screens-changed');
        this.session.scheduleMaintenance('work-area', { reason: 'screens-changed' });
      }),
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
    if (Date.now() - this.switchWatchStart < 1500) return;
    this.switchWatchStart = 0;
    try {
      controller.cancelSwitchAnimation();
      this.history.log('ws_removed', { reason: 'switch-watchdog' });
    } catch {
      /* private API changed: nothing to do */
    }
  }

  /**
   * §23.2: GNOME's WorkspaceAnimationController slides clones of the windows
   * while a switch runs (keyboard animation or touchpad gesture), so the real
   * window actors — and therefore the position watcher — never move. The
   * controller emits no signal, but its swipe tracker does; attach to it so the
   * border hides the instant a gesture starts.
   */
  private connectWorkspaceAnimation(): void {
    const tracker = (wm as any)?._workspaceAnimation?._swipeTracker;
    if (tracker === null || tracker === undefined || typeof tracker.connect !== 'function') return;
    this.swipeSignalIds.push(tracker.connect('begin', () => this.onWorkspaceAnimation()));
    this.swipeSignalIds.push(tracker.connect('update', () => this.onWorkspaceAnimation()));
  }

  private disconnectWorkspaceAnimation(): void {
    const tracker = (wm as any)?._workspaceAnimation?._swipeTracker;
    for (const id of this.swipeSignalIds) {
      if (tracker !== null && tracker !== undefined) tracker.disconnect(id);
    }
    this.swipeSignalIds = [];
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
      this.stopMotionWatch();
    } else {
      this.unsuppressBorder('drag');
      this.startMotionWatch();
    }
    this.syncIndicator();
  }

  /**
   * §23.2: while a tileable window is focused, sample its compositor position.
   * A workspace switch (keyboard or touchpad) slides the actor, so the border
   * hides as soon as it moves and returns once it has been stable. This is what
   * covers gesture-driven switches, which emit no start signal.
   */
  private startMotionWatch(): void {
    if (this.motionSource !== null) return;
    this.motionLastX = Number.NaN;
    this.motionLastY = Number.NaN;
    this.motionStable = 0;
    this.motionTicks = 0;
    this.motionSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MOTION_POLL_MS, () => this.onMotionTick());
  }

  private stopMotionWatch(): void {
    if (this.motionSource === null) return;
    GLib.source_remove(this.motionSource);
    this.motionSource = null;
  }

  private onMotionTick(): boolean {
    if (this.isPaused()) {
      this.stopMotionWatch();
      return GLib.SOURCE_REMOVE;
    }
    // Remember the last window actor so a transient focus loss (mid-switch)
    // does not blind the watcher.
    const focused = this.session.focused();
    if (focused !== null) {
      const actor = compat.compositorActor(focused.win);
      if (actor !== null && compat.actorAlive(actor)) this.motionActor = actor;
    }
    const actor = this.motionActor;
    if (actor === null || actor === undefined || !compat.actorAlive(actor)) {
      // The cached actor was disposed (its window closed): stop watching
      // instead of throwing a stack trace on every tick.
      this.motionActor = null;
      this.stopMotionWatch();
      return GLib.SOURCE_REMOVE;
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
    if (this.motionTicks >= MOTION_RETILE_TICKS) {
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
    if (this.session.isDragging || this.animator.activeCount > 0) {
      this.motionSkip = this.session.isDragging ? 'dragging' : 'animating';
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
    if (snapshot.visible && snapshot.rect !== null && !this.isPaused() && !overview.visible) {
      this.indicator.show(snapshot.rect);
    } else {
      this.indicator.hide();
    }
  }

  /**
   * Workspace actors translate during a workspace switch — keyboard or
   * touchpad gesture — and never move when we tile a window. Watching their
   * position is therefore a precise, focus-independent transition signal.
   */
  private refreshWorkspaceActors(): void {
    for (const entry of this.workspaceActorSignals) entry.actor.disconnect(entry.id);
    this.workspaceActorSignals = [];
    const workspaces = (layoutManager as any)._workspaces;
    if (!Array.isArray(workspaces)) return;
    for (const actor of workspaces) {
      if (actor === null || actor === undefined) continue;
      this.workspaceActorSignals.push({ actor, id: actor.connect('notify::x', () => this.onWorkspaceActorMoved()) });
      this.workspaceActorSignals.push({ actor, id: actor.connect('notify::y', () => this.onWorkspaceActorMoved()) });
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
    if (!this.settings.boolean('trace-enabled', false)) return;
    this.frameSamples += 1;
    if (this.frameSamples % 60 !== 0) return;
    this.history.log('frame_timing', { samples: this.frameSamples, budgetMs: this.settings.int('max-frame-interval-ms', 16) });
  }

  /** §23: fade a ghost at the closing window's rect. */
  private onWindowClosed(_id: number, rect: Rect): void {
    this.indicator.ghostClose(rect, this.settings.int('close-animation-duration', 150));
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
    this.settingWatchers.push(this.settings.onAnyChange(() => undefined));
    const reactive: [string, () => void][] = [
      ['exception-apps', () => this.session.invalidateAll()],
      ['rules-json', () => this.session.invalidateAll()],
      ['rules-enabled', () => this.session.invalidateAll()],
      ['heuristic-modal-detect', () => this.session.invalidateAll()],
      ['min-size-policy', () => this.session.invalidateAll()],
      ['primary-apps', () => this.session.invalidateAll()],
      ['primary-app-ratio', () => this.session.invalidateAll()],
      ['gaps-base', () => this.session.invalidateAll()],
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
      ['history-enabled', () => this.history.setEnabled(this.settings.boolean('history-enabled', true))],
      ['history-max-bytes', () => this.history.setMaxBytes(this.settings.int('history-max-bytes', 8388608))],
      ['disable-animations', () => this.applyAnimationSetting()],
      // Changing a shortcut re-registers the bindings so it takes effect at once.
      ...this.keybindingSettingNames().map((key): [string, () => void] => [key, () => {
        this.unregisterKeybindings();
        this.registerKeybindings();
      }]),
    ];
    for (const [key, cb] of reactive) this.settingWatchers.push(this.settings.onChanged(key, cb));
  }

  /**
   * §18: `disable-animations` switches off *everything*, GNOME's own Shell
   * animations included, not just adrt's frame animations.
   */
  private applyAnimationSetting(): void {
    const enabled = !this.settings.boolean('disable-animations', false);
    try {
      St.Settings.get().enable_animations = enabled;
    } catch {
      /* St.Settings unavailable in a bare test shell: nothing to switch */
    }
  }

  /** The frozen v2 keybinding surface (§17): every name is one settings key. */
  private keybindingSettingNames(): string[] {
    return [
      'kb-undo',
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
        this.dispatchKeybinding(name),
      );
      this.keybindings.push(name);
    }
  }

  private dispatchKeybinding(name: string): void {
    switch (name) {
      case 'kb-undo':
        this.session.undo();
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

  /** The work area of one monitor, from the last screen read (§10). */
  private workAreaOf(monitor: number): Rect {
    const screen = this.screenAt(monitor);
    if (screen === undefined) return { x: 0, y: 0, width: 0, height: 0 };
    return screen.workArea ?? screen.geometry;
  }

  private probePlatform(): string {
    let virtualInput = false;
    try {
      const backend = Clutter.get_default_backend();
      const seat = backend.get_default_seat();
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
      if (this.injectSeat === null) this.injectSeat = Clutter.get_default_backend().get_default_seat();
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
      SpawnWindow: (command) => this.spawnWindow(command),
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
        this.session.scheduleReconcile('reset-layout');
        return true;
      },
    };
  }

  /** Test trigger (§40.4): open a client window from inside the shell. */
  private spawnWindow(command: string): number {
    const parts = command.split(' ').filter((part) => part.length > 0);
    if (parts.length === 0) return 0;
    try {
      const process = Gio.Subprocess.new(parts, Gio.SubprocessFlags.NONE);
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

  private dumpState(): string {
    const monitors = this.host.screens().map((screen) => ({ ...screen }));
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
      indicator: { ...this.indicator.describe(), visible: this.indicator.isVisible, ghosts: this.indicator.ghostCount, suppressed: this.border.activeSuppressions },
      overview: overview.visible,
      workspaceActors: this.workspaceActorSignals.length / 2,
      coherenceSweeps: this.session.coherenceSweepCount(),
      coherenceFixes: this.session.coherenceFixCount(),
      wsSwitchEvents: this.wsSwitchEvents,
      motionSuppressions: this.motionSuppressions,
      motionRetiles: this.motionRetiles,
      motionTicks: this.motionTicks,
      motionSkip: this.motionSkip,
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
    const key = [first.surface.appId, second.surface.appId].sort();
    this.session.capturePairChange(a, b);
    this.tiling.setRatio(`${key[0]}|${key[1]}|${axis}`, ratio);
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
    // §19: suspend is treated as lock.
    this.applySessionMode(mode === 'suspend' ? 'unlock-dialog' : mode);
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
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, hold, () => {
      const current = (wm as any)?._workspaceAnimation;
      if (current !== null && current !== undefined && current._switchData != null) {
        current._finishWorkspaceSwitch(current._switchData);
      }
      return GLib.SOURCE_REMOVE;
    });
    return true;
  }
}

