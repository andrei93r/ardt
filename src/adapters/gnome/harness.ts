// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §22/§40.4: the D-Bus trigger dispatch map and the harness/test utilities
 * behind it (spawn/close/move/workspace manipulation, the bug recorder and the
 * input/state simulations). The trigger table in `core/triggers.ts` drives the
 * wire surface; the handler names and signatures here must match it exactly.
 *
 * Everything reads the live extension state through `HarnessDeps`; no lifecycle
 * or policy lives here.
 */

import Gio from 'gi://Gio';
import { overview } from 'resource:///org/gnome/shell/ui/main.js';

import type { SuppressionReason } from '../../core/border.js';
import type { GestureKind } from '../../core/gestures.js';
import type { SessionMachine } from '../../core/session.js';
import { ratioKey } from '../../core/tiler.js';
import type { SplitAxis } from '../../core/tiler.js';
import type { Screen } from '../../core/types.js';
import type { ChangeLog } from '../../core/undo.js';
import type { DbusHandlers } from '../../platform/dbus.js';
import * as compat from './compat.js';
import type { ConfigTransfer } from './config-transfer.js';
import type { Diagnostics } from './dump-state.js';
import type { Animator } from './frame-clock.js';
import type { GestureInput } from './gesture-input.js';
import type { History } from './history.js';
import type { GnomeHost } from './host.js';
import type { GnomeIndicator } from './indicator.js';
import type { EventJournal } from './journal.js';
import type { TimeoutRegistry } from './lifecycle.js';
import type { Persistence } from './persistence.js';
import type { Recorder } from './recorder.js';
import type { RecordingPrompt } from './recording-prompt.js';
import type { RegistryStore } from './registry.js';
import type { WindowSession } from './session.js';
import type { GnomeSettings } from './settings.js';
import type { Tiling } from './tiling.js';

/** The private `WorkspaceAnimationController` behind `Main.wm._workspaceAnimation` (§23.2). */
export interface WorkspaceAnimationController {
  gestureActive?: boolean;
  _switchData?: unknown;
  _swipeTracker?: {
    _touchpadGesture?: { _state?: number };
  };
  cancelSwitchAnimation(): void;
  _prepareWorkspaceSwitch?(): void;
  _finishWorkspaceSwitch(data: unknown): void;
}

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

/** Extra test triggers the harness adds on top of the §22 surface. A type
 * alias for the same implicit-index-signature reason as `DbusHandlers`. */
type ExtraHandlers = {
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
  WarpPointerToMonitor(index: number): boolean;
  TogglePause(): boolean;
  InjectFault(context: string): boolean;
  SimulateChromeTeardown(): boolean;
  StartFrameRecording(): boolean;
  StopFrameRecording(): boolean;
}

export type Handlers = DbusHandlers & ExtraHandlers;

/** The slice of extension state the harness dispatch and its utilities need. */
export interface HarnessDeps {
  readonly settings: GnomeSettings;
  readonly host: GnomeHost;
  readonly session: WindowSession;
  readonly registry: RegistryStore;
  readonly tiling: Tiling;
  readonly history: History;
  readonly journal: EventJournal;
  readonly animator: Animator;
  readonly gestures: GestureInput;
  readonly changes: ChangeLog;
  readonly diagnostics: Diagnostics;
  readonly configTransfer: ConfigTransfer;
  readonly persistence: Persistence;
  readonly sessionMachine: SessionMachine;
  readonly timers: TimeoutRegistry;
  readonly indicator: GnomeIndicator;
  recorder(): Recorder | null;
  recordingPrompt(): RecordingPrompt | null;
  floatingWindows(): Record<string, number[]>;
  /* Callbacks into the extension's policy. */
  toast(key: string, subject: string): boolean;
  setFocusReason(reason: string): void;
  setTilingPaused(paused: boolean): void;
  unsuppressBorder(reason: SuppressionReason): void;
  syncIndicator(): void;
  onOverviewChanged(visible: boolean): void;
  onFocusChanged(id: number | null): void;
  onWorkspaceSwitched(payload: { from: number; to: number }): void;
  onStateChanged(): void;
  workspaceAnimation(): WorkspaceAnimationController | null;
  writeSetting(schema: string, key: string, value: string): boolean;
  reportError(context: string, error: unknown): void;
  injectPointerMove(x: number, y: number): boolean;
  injectPointerButton(button: number, pressed: boolean): boolean;
  injectKey(keyval: number, pressed: boolean): boolean;
  injectFault(context: string): boolean;
  simulateChromeTeardown(): boolean;
  simulateSessionMode(mode: string): boolean;
}

export class Harness {
  constructor(private readonly deps: HarnessDeps) {}

  handlers(): Handlers {
    const { deps } = this;
    return {
      DumpState: () => deps.diagnostics.dumpState(),
      ProbePlatform: () => deps.diagnostics.probePlatform(),
      DumpEvents: (limit, filter) => JSON.stringify(deps.journal.tail(limit, filter)),
      DumpDecisions: (limit) => JSON.stringify(deps.journal.decisionsTail(limit)),
      DumpTrace: (limit) => deps.diagnostics.dumpTrace(limit),
      InjectPointerMove: (x, y) => deps.injectPointerMove(x, y),
      InjectPointerButton: (button, pressed) => deps.injectPointerButton(button, pressed),
      InjectKey: (keyval, pressed) => deps.injectKey(keyval, pressed),
      SimulateNotice: (key, subject) => deps.toast(key, subject),
      SimulateBurst: (count, reason) => deps.session.simulateBurst(count, reason),
      LookupWindow: (id) => this.lookupWindow(id),
      ListWindows: () => JSON.stringify(this.listWindows()),
      ListMonitors: () => JSON.stringify(deps.host.screens().map((screen) => screen.connector)),
      GetSplitRatio: (workspace, monitor, axis) => deps.tiling.getSplitRatioFor(workspace, monitor, axis as SplitAxis),
      SetSplitRatio: (workspace, monitor, axis, ratio) => deps.tiling.setSplitRatioFor(workspace, monitor, axis as SplitAxis, ratio),
      Undo: () => deps.session.undo(),
      NudgeSplit: (direction, step) => deps.session.nudgeFocused(direction, step),
      MoveFocusedToWorkspace: (index) => deps.session.moveFocusedToWorkspace(index),
      ReloadRules: () => {
        deps.session.invalidateAll();
        return true;
      },
      ResetPerApp: (appId) => deps.session.forgetApp(appId),
      GetAdaptations: () => JSON.stringify(deps.registry.legacyRows()),
      ForgetAdaptation: (appId) => deps.session.forgetApp(appId),
      GetFloats: () => JSON.stringify(this.floatState()),
      ForgetFloat: (appId) => deps.session.setNeverTile(appId, false),
      GetRegistry: () => JSON.stringify(deps.registry.entries()),
      SetNeverTile: (appId, value) => deps.session.setNeverTile(appId, value),
      ToggleNeverTile: (appId) => {
        const value = deps.registry.toggleNeverTile(appId);
        deps.session.setNeverTile(appId, value);
        return value;
      },
      ForgetApp: (appId) => deps.session.forgetApp(appId),
      GetDisplayMemory: () => JSON.stringify(deps.session.getDisplayMemory()),
      ForgetDisplayMemory: () => {
        deps.session.setDisplayMemory([]);
        deps.persistence.saveDisplayMemory();
        return true;
      },
      SimulateScreens: (json) => this.simulateScreens(json),
      SimulateWorkArea: (connector, x, y, width, height) =>
        deps.host.setSimulatedWorkArea(connector, { x, y, width, height }),
      ExportConfig: () => deps.configTransfer.exportConfig(),
      ImportConfig: (json, merge) => deps.configTransfer.importConfig(json, merge ? 'merge' : 'replace'),
      ListHistoryDays: () => JSON.stringify(deps.history.days()),
      SimulateGesture: (kind, dx, dy, points) => deps.gestures.simulate(kind as GestureKind, dx, dy, points),
      InjectSignal: (type, payload) => this.injectSignal(type, payload),
      SimulateSessionMode: (mode) => deps.simulateSessionMode(mode),
      SimulateOverview: (visible) => {
        if (overview.visible !== visible) {
          if (visible) overview.show();
          else overview.hide();
        }
        // Drive the same handler the overview signals use, so the state is
        // consistent even if the shell reports visibility inconsistently.
        deps.onOverviewChanged(visible);
        return true;
      },
      SimulateWorkspaceSwitch: (holdMs) => this.simulateWorkspaceSwitch(holdMs),
      ActivateWindow: (id) => {
        deps.setFocusReason('activate-window');
        deps.session.focus(id);
        return true;
      },
      ActivateWorkspace: (index) => {
        deps.session.activateWorkspace(index);
        return true;
      },
      ToggleFloat: (id) => deps.session.toggleFloat(id),
      SimulateResize: (a, b, ratio) => this.simulateResize(a, b, ratio),
      SwapPair: (a, b) => deps.session.swapPair(a, b),
      InjectVerifyFailure: (id, count) => this.injectVerifyFailure(id, count),
      FocusDirection: (direction) => {
        deps.setFocusReason(`focus-${direction}`);
        deps.session.focusDirection(direction);
        return true;
      },
      FocusCycle: () => {
        deps.setFocusReason('focus-cycle');
        deps.session.focusCycle();
        return true;
      },
      MoveToward: (direction) => {
        deps.session.moveToward(direction);
        return true;
      },
      SpawnWindow: (argvJson, envJson) => this.spawnWindow(argvJson, envJson),
      CloseWindow: (id) => this.closeWindow(id),
      BeginDrag: (id) => deps.session.beginDrag(id),
      EndDrag: (id) => deps.session.endDrag(id),
      MoveWindow: (id, x, y, width, height) => this.moveWindow(id, x, y, width, height),
      MoveToWorkspace: (id, index) => this.moveToWorkspace(id, index),
      MarkWorkspaceCached: (id, index) => deps.session.markWorkspaceCached(id, index),
      MoveDirection: (direction) => {
        deps.setFocusReason(`move-${direction}`);
        deps.session.moveToward(direction);
        return true;
      },
      ToggleFullscreen: (id) => deps.session.toggleFullscreen(id),
      QuitFocused: () => deps.session.closeFocused(),
      SimulateAbove: (id) => deps.session.simulateAbove(id),
      SimulateSticky: (id, sticky) => deps.session.simulateSticky(id, sticky),
      SimulateWorkspaceReorder: (from, to) => deps.session.simulateWorkspaceReorder(from, to),
      SimulateWorkspaceOrientation: (vertical) => deps.session.simulateWorkspaceOrientation(vertical),
      CursorToCentre: () => deps.session.centreCursorNow(),
      WarpPointerToMonitor: (index) => this.warpPointerToMonitor(index),
      TogglePause: () => {
        deps.setTilingPaused(!deps.sessionMachine.manualPause);
        return true;
      },
      InjectFault: (context) => deps.injectFault(context),
      SimulateChromeTeardown: () => deps.simulateChromeTeardown(),
      StartFrameRecording: () => {
        deps.animator.startRecording();
        return true;
      },
      StopFrameRecording: () => {
        deps.animator.stopRecording();
        return true;
      },
      StartRecording: (maxSeconds) => this.startRecording(maxSeconds),
      StopRecording: () => this.stopRecording(),
      RecordingStatus: () => this.recordingStatus(),
      ToggleRecording: () => this.toggleRecordingState(),
      SubmitRecordingNote: (text) => this.submitRecordingNote(text),
      PromptSetText: (text) => deps.recordingPrompt()?.setText(text) ?? false,
      PromptPressSave: () => deps.recordingPrompt()?.pressSave() ?? false,
      PromptPressCancel: () => deps.recordingPrompt()?.pressCancel() ?? false,
      SetSetting: (key, value) => deps.writeSetting('org.gnome.shell.extensions.adrt', key, value),
      SetSchemaSetting: (schema, key, value) => deps.writeSetting(schema, key, value),
      MinimizeWindow: (id) => {
        if (!deps.session.windows.has(id)) return false;
        deps.host.minimize(id);
        return true;
      },
      MaximizeWindow: (id) => {
        if (!deps.session.windows.has(id)) return false;
        deps.host.maximize(id);
        return true;
      },
      UnmaximizeWindow: (id) => {
        if (!deps.session.windows.has(id)) return false;
        deps.host.unmaximize(id);
        return true;
      },
      ResetLayoutState: () => {
        deps.tiling.loadRatios({}, []);
        deps.changes.clear();
        deps.persistence.saveState();
        deps.session.clearSignatures();
        // Test isolation: a layout reset also clears a manual pause, so a
        // scenario that forgot to resume cannot leak a paused session into the
        // next one on the same worker.
        if (deps.sessionMachine.manualPause) {
          deps.sessionMachine.setManualPause(false);
          if (deps.sessionMachine.state.mode === 'user') deps.unsuppressBorder('pause');
          deps.syncIndicator();
        }
        deps.session.scheduleReconcile('reset-layout');
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
    const tracked = this.deps.session.windows.get(id);
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
    if (!this.deps.session.windows.has(id)) return false;
    this.deps.host.applyFrame(id, { x, y, width, height });
    return true;
  }

  /** Test trigger: move a window to another workspace the way the overview
   * does — straight through Mutter, so the session sees a `workspace-changed`
   * signal and must retile both the old and the new workspace. */
  private moveToWorkspace(id: number, index: number): boolean {
    if (!this.deps.session.windows.has(id)) return false;
    if (index < 0 || index >= global.workspace_manager.get_n_workspaces()) return false;
    this.deps.host.applyWorkspace(id, index);
    return true;
  }

  // -------------------------------------------- bug recorder (§22 extension)

  /** Start the bug recorder; returns its file path or a clear error string. */
  private startRecording(maxSeconds: number): string {
    const recorder = this.deps.recorder();
    if (recorder === null) return 'error: recorder unavailable';
    try {
      return recorder.start(maxSeconds);
    } catch (error) {
      this.deps.reportError('start-recording', error);
      return `error: ${(error as Error).message}`;
    }
  }

  /**
   * Stop the bug recorder (a user stop). Returns the path; the footer is
   * deferred so the observation prompt can write a note first.
   */
  private stopRecording(): string {
    const recorder = this.deps.recorder();
    if (recorder === null) return 'error: recorder unavailable';
    try {
      const path = recorder.stop('user', true);
      if (!path.startsWith('error:')) this.showRecordingPrompt();
      return path;
    } catch (error) {
      this.deps.reportError('stop-recording', error);
      return `error: ${(error as Error).message}`;
    }
  }

  private recordingStatus(): string {
    const recorder = this.deps.recorder();
    const prompt = this.deps.recordingPrompt();
    if (recorder === null) {
      return '{"recording":false,"path":null,"elapsedMs":0,"bytes":0,"events":0,"snapshots":0,"stopReason":null,"promptOpen":false,"note":"","promptMechanism":null,"promptGrab":false,"promptFocus":false,"promptRect":null}';
    }
    // The prompt fields are the extension's view of the UI (add-only), so a test
    // can prove the modal grab, the key focus and the on-screen rect are real.
    return JSON.stringify({
      ...recorder.describe(),
      promptMechanism: prompt?.kind ?? null,
      promptGrab: prompt?.hasGrab ?? false,
      promptFocus: prompt?.hasKeyFocus ?? false,
      promptRect: prompt?.contentRect ?? null,
    });
  }

  /**
   * The one action shared by the Super+Shift+R hotkey and the D-Bus
   * `ToggleRecording` trigger: flip recording on/off in place. Stopping shows
   * the observation prompt; starting closes any prompt left from a previous
   * stop so its file is closed with no note.
   */
  toggleRecording(): void {
    const recorder = this.deps.recorder();
    if (recorder === null) return;
    if (recorder.isRecording) {
      this.stopRecording();
      return;
    }
    this.deps.recordingPrompt()?.close();
    recorder.start(0);
  }

  /** The D-Bus `ToggleRecording` trigger: toggle, then return the new status. */
  private toggleRecordingState(): string {
    this.toggleRecording();
    return this.recordingStatus();
  }

  /** Show the observation prompt for a deferred user stop. */
  private showRecordingPrompt(): void {
    const prompt = this.deps.recordingPrompt();
    if (prompt === null) return;
    prompt.show({
      onSubmit: (text) => this.submitRecordingNote(text),
      onCancel: () => {
        this.deps.recorder()?.cancelNote();
      },
    });
  }

  /**
   * D-Bus `SubmitRecordingNote` and the prompt's Save: close the deferred stop
   * with the note. Returns false when no stop is awaiting one.
   */
  private submitRecordingNote(text: string): boolean {
    const recorder = this.deps.recorder();
    if (recorder === null || !recorder.isAwaitingNote) return false;
    this.deps.recordingPrompt()?.close();
    const path = recorder.finalizeNote(text);
    return !path.startsWith('error:');
  }

  private lookupWindow(id: number): string {
    const tracked = this.deps.session.windows.get(id);
    if (tracked === undefined) return 'null';
    return JSON.stringify({
      id,
      cls: tracked.surface.appId,
      title: tracked.surface.title,
      rect: tracked.surface.frame,
      workspace: tracked.surface.workspaceId,
      tileable: this.deps.session.classify(tracked).tileable,
    });
  }

  private listWindows(): { id: number; cls: string; title: string }[] {
    return [...this.deps.session.windows.values()].map((tracked) => ({
      id: tracked.id,
      cls: tracked.surface.appId,
      title: tracked.surface.title,
    }));
  }

  /** Current floating windows plus the durable neverTile app ids. */
  private floatState(): { windows: Record<string, number[]>; neverTile: string[] } {
    return {
      windows: this.deps.floatingWindows(),
      neverTile: this.deps.registry.entries().filter((entry) => entry.neverTile).map((entry) => entry.appId),
    };
  }

  /** §9 `SimulateScreens`: hand the extension a fixture screen list, or clear it. */
  private simulateScreens(json: string): boolean {
    if (json.length === 0 || json === 'null') {
      this.deps.host.setSimulatedScreens(null);
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
    this.deps.host.setSimulatedScreens(screens.length > 0 ? screens : null);
    return true;
  }

  private simulateResize(a: number, b: number, ratio: number): boolean {
    const { deps } = this;
    const first = deps.session.windows.get(a);
    const second = deps.session.windows.get(b);
    if (first === undefined || second === undefined) return false;
    const screen = deps.host.screenByIndex(first.surface.screenId);
    if (screen === null) return false;
    const axis = screen.geometry.width >= screen.geometry.height ? 'horizontal' : 'vertical';
    deps.session.capturePairChange(a, b);
    deps.tiling.setRatio(ratioKey(screen.connector, first.surface.workspaceId, axis), ratio);
    deps.session.clearSignatures();
    deps.session.retile(first.surface.workspaceId, 'simulate-resize');
    if (deps.settings.boolean('dry-run-mode', false)) deps.history.log('dry_run', { ratio });
    return true;
  }

  private injectVerifyFailure(id: number, count: number): boolean {
    if (!this.deps.session.windows.has(id)) return false;
    // The id matters: a scenario that fails one window's applies must not make
    // every other window's applies look like a refusal too (that taught a bogus
    // minimum in A52).
    this.deps.tiling.injectVerifyFailures(count, id);
    return true;
  }

  private injectSignal(type: string, payload: string): boolean {
    const { deps } = this;
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
        deps.host.emit({ type: 'screens-changed' });
        break;
      case 'focus-changed':
        deps.onFocusChanged(typeof data.id === 'number' ? data.id : null);
        break;
      case 'workspace-switched':
        deps.onWorkspaceSwitched({ from: Number(data.from ?? 0), to: Number(data.to ?? 0) });
        break;
      case 'surface-frame-changed': {
        const tracked = deps.session.windows.get(Number(data.id));
        if (tracked !== undefined) {
          tracked.refreshFrame();
          deps.onStateChanged();
        }
        break;
      }
      default:
        return false;
    }
    deps.history.log('lookup', { injected: type });
    return true;
  }

  /**
   * Test hook: hold GNOME's workspace-switch state open for `holdMs`. This is
   * the exact path a touchpad gesture takes at its start
   * (`WorkspaceAnimationController._switchWorkspaceBegin`), so the border must
   * hide for the whole time, then come back.
   */
  private simulateWorkspaceSwitch(holdMs: number): boolean {
    const controller = this.deps.workspaceAnimation();
    if (controller === null || typeof controller._prepareWorkspaceSwitch !== 'function') return false;
    const hold = holdMs > 0 ? Math.min(holdMs, 5000) : 600;
    controller._prepareWorkspaceSwitch();
    this.deps.timers.add('simulate-workspace-switch', hold, () => {
      const current = this.deps.workspaceAnimation();
      if (current !== null && current._switchData != null) {
        current._finishWorkspaceSwitch(current._switchData);
      }
    });
    return true;
  }

  /**
   * Test hook: put the pointer at the centre of monitor `index`. Mutter opens a
   * new window on the monitor under the pointer, so the live suite parks it on
   * the primary monitor before spawning — the user's own windows may fill
   * another monitor and would otherwise become the newcomers' peers.
   */
  private warpPointerToMonitor(index: number): boolean {
    const screen = this.deps.host.screenByIndex(index);
    if (screen === null) return false;
    const g = screen.geometry;
    return this.deps.host.warpPointer(g.x + g.width / 2, g.y + g.height / 2);
  }
}
