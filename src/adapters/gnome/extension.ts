// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Extension entry point (§2.1). Constructs nothing in the constructor; every
 * object is created in `enable()` and destroyed in `disable()` (§4.1).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { layoutManager, notify, overview, sessionMode, wm } from 'resource:///org/gnome/shell/ui/main.js';

import type { AdaptationRecord, Bundle, ImportMode } from '../../core/config.js';
import { BUNDLE_FORMAT, BUNDLE_VERSION, mergeAdaptations, normalizeBundle, serializeBundle } from '../../core/config.js';
import { BorderState } from '../../core/border.js';
import { SessionMachine } from '../../core/session.js';
import type { SessionMode } from '../../core/session.js';
import type { SplitAxis } from '../../core/tiler.js';
import { clamp } from '../../core/types.js';
import type { Rect } from '../../core/types.js';
import type { GestureKind } from '../../core/gestures.js';
import type { DbusHandlers } from '../../platform/dbus.js';
import { AdaptationStore, FloatStore, dataDir, readText, writeAtomic } from './adapt.js';
import * as compat from './compat.js';
import { GnomeDbus } from './dbus.js';
import { FrameClockAnimator } from './frame-clock.js';
import { GestureInput } from './gesture-input.js';
import { GnomeHost } from './host.js';
import { History, UndoStack } from './history.js';
import { GnomeIndicator } from './indicator.js';
import { WindowSession } from './session.js';
import { GnomeSettings } from './settings.js';
import { Tiling } from './tiling.js';

const EXTENSION_VERSION = 1;
/** §23.2: how often the focused actor's position is sampled, and how many
 * stable samples end a transition. */
const MOTION_POLL_MS = 32;
const MOTION_STABLE_SAMPLES = 3;
/** Ignore movement for this long after we applied a plan ourselves. */
const MOTION_SELF_MS = 200;

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
}

type Handlers = DbusHandlers & ExtraHandlers;

export default class AdrtExtension extends Extension {
  private settings!: GnomeSettings;
  private host!: GnomeHost;
  private adaptation!: AdaptationStore;
  private floats!: FloatStore;
  private history!: History;
  private undo!: UndoStack;
  private indicator!: GnomeIndicator;
  private animator!: FrameClockAnimator;
  private tiling!: Tiling;
  private session!: WindowSession;
  private gestures!: GestureInput;
  private dbus!: GnomeDbus;
  private border!: BorderState;
  private sessionMachine = new SessionMachine();

  private sessionModeId = 0;
  private overviewSignals: number[] = [];
  private workspaceActorSignals: { actor: any; id: number }[] = [];
  private layoutSignals: number[] = [];
  private motionSource: number | null = null;
  private motionActor: any = null;
  private motionLastX = Number.NaN;
  private motionLastY = Number.NaN;
  private motionStable = 0;
  private wsSwitchEvents = 0;
  private motionSuppressions = 0;
  private settingWatchers: (() => void)[] = [];
  private keybindings: string[] = [];
  private hostUnsubscribers: (() => void)[] = [];
  private frameSamples = 0;

  enable(): void {
    const started = GLib.get_monotonic_time();
    this.settings = new GnomeSettings(this.getSettings());

    this.history = new History(
      this.settings.boolean('history-enabled', true),
      this.settings.int('history-retention-days', 30),
      this.settings.boolean('history-daily-folders', false),
    );
    this.migrate();
    this.adaptation = new AdaptationStore(this.settings.boolean('adaptation-enabled', true));
    this.adaptation.load();
    this.floats = new FloatStore(this.settings.boolean('float-persistence', false));
    this.floats.load();
    this.undo = new UndoStack(this.settings.int('undo-stack-size', 20));
    this.border = new BorderState();

    this.host = new GnomeHost();
    this.host.enable();

    this.indicator = new GnomeIndicator(this.settings);
    this.animator = new FrameClockAnimator({
      isAlive: (id) => this.session.windows.has(id),
      apply: (id, rect) => this.host.applyFrame(id, rect),
      onFrame: () => this.onFrameSample(),
    });

    this.tiling = new Tiling({
      host: this.host,
      settings: this.settings,
      history: this.history,
      adaptation: this.adaptation,
      animator: this.animator,
      undo: this.undo,
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
      adaptation: this.adaptation,
      floats: this.floats,
      undo: this.undo,
      isPaused: () => this.isPaused(),
      onStateChanged: () => this.onStateChanged(),
      onStubborn: (appId) => this.onStubborn(appId),
      onClosed: (id, rect) => this.onWindowClosed(id, rect),
      onDragChanged: (dragging) => this.onDragChanged(dragging),
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
    this.subscribeHost();
    this.watchSettings();

    for (const win of global.display.list_all_windows()) this.session.register(win);

    this.gestures.configure();
    if (this.settings.boolean('dbus-enabled', true)) {
      this.dbus = new GnomeDbus();
      this.dbus.expose(this.handlers());
    }

    this.sessionModeId = sessionMode.connect('notify::current-mode', () => this.applySessionMode(this.currentMode()));
    this.overviewSignals.push(overview.connect('showing', () => this.onOverviewChanged(true)));
    this.overviewSignals.push(overview.connect('hidden', () => this.onOverviewChanged(false)));
    this.refreshWorkspaceActors();
    this.layoutSignals.push(global.workspace_manager.connect('workspace-added', () => this.refreshWorkspaceActors()));
    this.layoutSignals.push(global.workspace_manager.connect('workspace-removed', () => this.refreshWorkspaceActors()));
    this.applySessionMode(this.currentMode(), true);
    this.registerKeybindings();
    this.session.setScanning(true);

    this.onStateChanged();
    this.firstRun();
    this.history.log('tile', { event: 'enable', ms: Math.round((GLib.get_monotonic_time() - started) / 1000) });
  }

  disable(): void {
    this.history.log('disable', {});
    this.stopMotionWatch();
    if (this.sessionModeId !== 0) {
      sessionMode.disconnect(this.sessionModeId);
      this.sessionModeId = 0;
    }
    for (const id of this.overviewSignals) overview.disconnect(id);
    this.overviewSignals = [];
    for (const entry of this.workspaceActorSignals) entry.actor.disconnect(entry.id);
    this.workspaceActorSignals = [];
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
    this.adaptation.flush();
    this.floats.flush();
    this.history.destroy();
    this.saveState();
  }

  // ---------------------------------------------------------------- session

  private currentMode(): SessionMode {
    return sessionMode.currentMode as SessionMode;
  }

  private isPaused(): boolean {
    return this.sessionMachine.isPaused;
  }

  private applySessionMode(mode: SessionMode, initial = false): void {
    const effects = this.sessionMachine.setMode(mode);
    if (effects.indicatorSuppression !== null) {
      this.border.suppress(effects.indicatorSuppression);
    } else {
      this.border.unsuppress('pause');
      this.border.unsuppress('sharing');
    }
    this.session.setScanning(effects.scanTickRunning);
    this.syncIndicator();
    if (!initial && effects.retileOnResume) this.session.retileAll('session-resume');
    this.history.log('session_mode', { mode, paused: effects.paused });
  }

  private subscribeHost(): void {
    this.hostUnsubscribers.push(
      this.host.on('surface-created', (payload) => {
        const surfaceId = (payload as { surface: { id: number } }).surface.id;
        const win = this.host.windowFor(surfaceId);
        if (win !== null) this.session.register(win);
      }),
      this.host.on('focus-changed', (payload) => this.onFocusChanged((payload as { id: number | null }).id)),
      this.host.on('workspace-switched', (payload) => this.onWorkspaceSwitched(payload as { from: number; to: number })),
      this.host.on('screens-changed', () => {
        this.session.clearSignatures();
        this.session.retileAll('screens-changed');
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
    this.border.suppress('workspace-switch');
    this.startMotionWatch();
    this.syncIndicator();
    this.history.log('ws_switch_empty', { from: payload.from, to: payload.to, reason: 'switch' });
  }

  /** §23.1: the user is dragging; hide the border and stop reflowing. */
  private onDragChanged(dragging: boolean): void {
    if (dragging) {
      this.border.suppress('drag');
      this.stopMotionWatch();
    } else {
      this.border.unsuppress('drag');
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
      if (actor !== null) this.motionActor = actor;
    }
    const actor = this.motionActor;
    if (actor === null || actor === undefined) {
      this.stopMotionWatch();
      return GLib.SOURCE_REMOVE;
    }

    // Stage-space, so a sliding workspace (moving parent actor) is detected.
    const [x, y] = compat.actorStagePosition(actor);
    // Movement we caused ourselves is not a transition.
    if (this.animator.activeCount > 0 || Date.now() - this.session.perf().lastApplyAtMs < MOTION_SELF_MS) {
      this.motionLastX = x;
      this.motionLastY = y;
      this.motionStable = 0;
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
      if (!this.border.isSuppressed('workspace-switch')) {
        this.border.suppress('workspace-switch');
        this.motionSuppressions += 1;
        this.syncIndicator();
      }
    } else {
      this.motionStable += 1;
      if (this.motionStable >= MOTION_STABLE_SAMPLES && this.border.isSuppressed('workspace-switch')) {
        this.border.unsuppress('workspace-switch');
        this.syncIndicator();
      }
    }
    return GLib.SOURCE_CONTINUE;
  }

  private syncIndicator(): void {
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
    this.motionSuppressions += 1;
    this.border.suppress('workspace-switch');
    this.startMotionWatch();
    this.syncIndicator();
  }

  /** §23: chrome must not show over the overview or the app grid. */
  private onOverviewChanged(visible: boolean): void {
    if (visible) this.border.suppress('overview');
    else this.border.unsuppress('overview');
    // Tiling during the overview cannot converge and just burns CPU.
    this.session.setSuspended(visible);
    this.syncIndicator();
  }

  private onStateChanged(): void {
    const focused = this.session.focused();
    if (focused !== null) {
      this.border.setFocus(focused.id, focused.surface.frame);
      this.startMotionWatch();
    }
    this.syncIndicator();
  }

  private onStubborn(_appId: string): void {
    this.history.log('stubborn', { cooldownMs: this.adaptation.cooldownRemainingMs() });
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
      ['adaptation-enabled', () => this.adaptation.setEnabled(this.settings.boolean('adaptation-enabled', true))],
      ['float-persistence', () => this.floats.setEnabled(this.settings.boolean('float-persistence', false))],
      ['reflow-keeps-edges', () => this.session.invalidateAll()],
      ['respect-user-workspace-move', () => this.session.invalidateAll()],
      ['indicator-color', () => this.syncIndicator()],
      ['indicator-width', () => this.syncIndicator()],
      ['indicator-opacity', () => this.syncIndicator()],
      ['indicator-corner-radius', () => this.syncIndicator()],
      ['indicator-animated-pulse', () => this.syncIndicator()],
      ['history-enabled', () => this.history.setEnabled(this.settings.boolean('history-enabled', true))],
      ['undo-stack-size', () => this.undo.setMaxSize(this.settings.int('undo-stack-size', 20))],
    ];
    for (const [key, cb] of reactive) this.settingWatchers.push(this.settings.onChanged(key, cb));
  }

  private registerKeybindings(): void {
    const names = [
      'kb-undo',
      'kb-focus-next',
      'kb-focus-left',
      'kb-focus-right',
      'kb-focus-up',
      'kb-focus-down',
      'kb-toggle-float',
      'kb-nudge-left',
      'kb-nudge-right',
      'kb-move-left',
      'kb-move-right',
    ];
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
        this.nudgeFocused('left', -1);
        break;
      case 'kb-nudge-right':
        this.nudgeFocused('right', 1);
        break;
      case 'kb-move-left':
        this.session.moveToward('left');
        break;
      case 'kb-move-right':
        this.session.moveToward('right');
        break;
      default:
        break;
    }
  }

  private unregisterKeybindings(): void {
    for (const name of this.keybindings) wm.removeKeybinding(name);
    this.keybindings = [];
  }

  private toggleFocusedFloat(): void {
    const focused = this.session.focused();
    if (focused !== null) this.session.toggleFloat(focused.id);
  }

  private nudgeFocused(direction: string, sign: number): void {
    const focused = this.session.focused();
    if (focused === null) return;
    const step = this.settings.int('nudge-step', 5) * sign;
    this.tiling.nudgeSplit(focused.id, direction, Math.abs(step));
    this.session.clearSignatures();
    this.session.retile(focused.surface.workspaceId, 'nudge');
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
    if (Array.isArray(raw.undo)) this.undo.restore(raw.undo);
  }

  private saveState(): void {
    if (this.tiling === undefined) return;
    const payload = {
      version: 1,
      ratios: this.tiling.getRatios(),
      swapPairs: this.tiling.getSwapPairs(),
      undo: this.undo.toJSON(),
    };
    writeAtomic(this.stateFile(), JSON.stringify(payload));
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

  // --------------------------------------------------------------- D-Bus

  private handlers(): Handlers {
    return {
      DumpState: () => this.dumpState(),
      LookupWindow: (id) => this.lookupWindow(id),
      ListWindows: () => JSON.stringify(this.listWindows()),
      ListMonitors: () => JSON.stringify(this.host.screens().map((screen) => screen.connector)),
      GetSplitRatio: (workspace, monitor, axis) => this.tiling.getSplitRatioFor(workspace, monitor, axis as SplitAxis),
      SetSplitRatio: (workspace, monitor, axis, ratio) => this.tiling.setSplitRatioFor(workspace, monitor, axis as SplitAxis, ratio),
      Undo: () => this.session.undo(),
      NudgeSplit: (direction, step) => {
        const focused = this.session.focused();
        if (focused === null) return false;
        return this.tiling.nudgeSplit(focused.id, direction, step);
      },
      ReloadRules: () => {
        this.session.invalidateAll();
        return true;
      },
      ResetPerApp: (appId) => this.adaptation.forget(appId),
      GetAdaptations: () => JSON.stringify(this.adaptation.list()),
      ForgetAdaptation: (appId) => this.adaptation.forget(appId),
      GetFloats: () => JSON.stringify(this.floatState()),
      ForgetFloat: (appId) => this.forgetFloat(appId),
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
      ActivateWindow: (id) => {
        this.session.focus(id);
        return true;
      },
      ActivateWorkspace: (index) => {
        this.session.activateWorkspace(index);
        return true;
      },
      ToggleFloat: (id) => this.session.toggleFloat(id),
      SimulateResize: (a, b, ratio) => this.simulateResize(a, b, ratio),
      SwapPair: (a, b) => {
        this.tiling.toggleSwap(a, b);
        this.session.clearSignatures();
        this.session.retile(this.session.windows.get(a)?.surface.workspaceId ?? 0, 'swap');
        return true;
      },
      InjectVerifyFailure: (id, count) => this.injectVerifyFailure(id, count),
      FocusDirection: (direction) => {
        this.session.focusDirection(direction);
        return true;
      },
      FocusCycle: () => {
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
        this.saveState();
        this.session.clearSignatures();
        this.session.retileAll('reset-layout');
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
    tracked.win.delete(global.get_current_time());
    return true;
  }

  /** Test trigger: place a window directly, to emulate a drag. */
  private moveWindow(id: number, x: number, y: number, width: number, height: number): boolean {
    if (!this.session.windows.has(id)) return false;
    this.host.applyFrame(id, { x, y, width, height });
    return true;
  }

  private dumpState(): string {
    const monitors = this.host.screens().map((screen) => ({ ...screen }));
    const windows = [...this.session.windows.values()].map((tracked) => {
      tracked.surface.refresh();
      tracked.surface.captureZ();
      return {
        id: tracked.id,
        cls: tracked.surface.appId,
        title: tracked.surface.title,
        version: tracked.surface.appVersion,
        workspace: tracked.surface.workspaceId,
        monitor: tracked.surface.screenId,
        rect: tracked.surface.frame,
        layer: tracked.surface.layer,
        z: tracked.surface.zPosition,
        maximized: tracked.surface.flags.maximized,
        minimized: tracked.surface.flags.minimized,
        tileable: this.session.classify(tracked).tileable,
        reason: this.session.classify(tracked).reason,
        profile: tracked.profile.name,
        stubborn: tracked.stubborn,
      };
    });
    return JSON.stringify({
      format: 'adrt.state',
      version: EXTENSION_VERSION,
      platform: 'gnome',
      paused: this.isPaused(),
      mode: this.sessionMachine.state.mode,
      activeWorkspace: this.host.activeWorkspaceId(),
      workspaces: this.session.countWorkspaces(),
      monitors,
      windows,
      ratios: this.tiling.getRatios(),
      swapPairs: this.tiling.getSwapPairs(),
      border: this.border.snapshot(),
      indicator: { ...this.indicator.describe(), visible: this.indicator.isVisible, ghosts: this.indicator.ghostCount, suppressed: this.border.activeSuppressions },
      overview: overview.visible,
      workspaceActors: this.workspaceActorSignals.length / 2,
      wsSwitchEvents: this.wsSwitchEvents,
      motionSuppressions: this.motionSuppressions,
      adaptations: this.adaptation.size,
      perf: this.session.perf(),
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

  /** Current floating windows plus any persisted app classes. */
  private floatState(): { windows: Record<string, number[]>; persisted: string[] } {
    return { windows: this.floatingWindows(), persisted: this.floats.list() };
  }

  private forgetFloat(appId: string): boolean {
    const removed = this.floats.forget(appId);
    let found = removed;
    for (const tracked of this.session.windows.values()) {
      if (tracked.surface.appId !== appId || !tracked.surface.flags.floating) continue;
      this.session.toggleFloat(tracked.id);
      found = true;
    }
    return found;
  }

  private exportConfig(): string {
    const settings: Record<string, unknown> = {};
    for (const key of this.settings.keys()) settings[key] = this.settings.read(key);
    const adaptations: Record<string, AdaptationRecord> = {};
    for (const record of this.adaptation.list()) adaptations[record.appId] = record;
    const bundle: Bundle = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      settings: settings as Bundle['settings'],
      tracked: { adaptations, behavior: { floats: this.floatingWindows() } },
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
    const merged = mergeAdaptations(
      Object.fromEntries(this.adaptation.list().map((record) => [record.appId, record])),
      incoming.tracked.adaptations,
      mode,
    );
    this.adaptation.replaceAll(Object.values(merged.record));
    const importedFloats = incoming.tracked.behavior.floats;
    if (importedFloats !== null && typeof importedFloats === 'object') {
      const appIds = Object.keys(importedFloats as Record<string, unknown>);
      if (mode === 'replace') this.floats.replace(appIds);
      else for (const appId of appIds) this.floats.set(appId, true);
    }
    this.session.invalidateAll();
    this.history.log('config_imported', { mode, applied: merged.report.applied.length, skipped: merged.report.skipped.length });
    return JSON.stringify({ ok: true, applied: merged.report.applied, skipped: merged.report.skipped });
  }

  private simulateResize(a: number, b: number, ratio: number): boolean {
    const first = this.session.windows.get(a);
    const second = this.session.windows.get(b);
    if (first === undefined || second === undefined) return false;
    const screen = this.host.screens().find((s) => s.index === first.surface.screenId);
    if (screen === undefined) return false;
    const axis = screen.geometry.width >= screen.geometry.height ? 'horizontal' : 'vertical';
    const key = [first.surface.appId, second.surface.appId].sort();
    this.tiling.setRatio(`${key[0]}|${key[1]}|${axis}`, ratio);
    this.session.clearSignatures();
    this.session.retile(first.surface.workspaceId, 'simulate-resize');
    if (this.settings.boolean('dry-run-mode', false)) this.history.log('dry_run', { ratio });
    return true;
  }

  private injectVerifyFailure(id: number, count: number): boolean {
    if (!this.session.windows.has(id)) return false;
    this.tiling.injectVerifyFailures(count);
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
          tracked.surface.refreshFrame();
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
    if (mode !== 'user' && mode !== 'unlock-dialog' && mode !== 'screen-sharing') return false;
    this.applySessionMode(mode);
    return true;
  }
}

