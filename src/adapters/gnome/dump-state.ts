// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §40.4 diagnostics: the capability probe, the state dump and the replayable
 * trace snapshot. Everything here is read-only over the live extension state,
 * which is reached through `DiagnosticsDeps`; no policy, signals or lifecycle
 * live here.
 *
 * `DumpState` is add-only (§2.5): its shape and field order are part of the
 * harness contract and must not change.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import { overview } from 'resource:///org/gnome/shell/ui/main.js';

import type { AdrtDumpState, AdrtRecentError } from '../../core/dump-schema.js';
import { DUMP_SCHEMA_VERSION } from '../../core/dump-schema.js';
import type { TraceEntry, TraceInitial, TraceWorkspace } from '../../core/replay.js';
import type { SessionMachine } from '../../core/session.js';
import type { Rect, Screen } from '../../core/types.js';
import * as compat from './compat.js';
import type { Animator } from './frame-clock.js';
import type { GnomeHost } from './host.js';
import type { History } from './history.js';
import type { GnomeIndicator } from './indicator.js';
import type { EventJournal } from './journal.js';
import type { SignalRegistry } from './lifecycle.js';
import type { PerfProbe } from './perf.js';
import type { Recorder } from './recorder.js';
import type { RegistryStore } from './registry.js';
import type { WindowSession } from './session.js';
import type { GnomeSettings } from './settings.js';
import type { GnomeTiming } from './timing.js';
import type { Tiling } from './tiling.js';
import type { BorderState } from '../../core/border.js';

/** The legacy GJS `imports` global; only `misc.config` is read here. */
interface GjsImports {
  misc?: { config?: { PACKAGE_VERSION?: unknown } };
}

/** The screen with this Mutter index, from the last screen read (§10). */
function screenAt(host: GnomeHost, monitor: number): Screen | undefined {
  return host.screenByIndex(monitor) ?? undefined;
}

/** The work area of one monitor, from the last screen read (§10). */
function workAreaOf(host: GnomeHost, monitor: number): Rect {
  const screen = screenAt(host, monitor);
  if (screen === undefined) return { x: 0, y: 0, width: 0, height: 0 };
  return screen.workArea ?? screen.geometry;
}

/** The pair axis of a monitor: portrait screens and vertical workspaces stack. */
function axisOf(host: GnomeHost, monitor: number): 'horizontal' | 'vertical' {
  const screen = screenAt(host, monitor);
  const rows = global.workspace_manager.layout_rows;
  if (rows === -1) return 'vertical';
  if (screen !== undefined && screen.geometry.height > screen.geometry.width) return 'vertical';
  return 'horizontal';
}

/**
 * Which slot a window occupies, derived from its rectangle: 0 for the first
 * half of the work area along the axis, 1 for the second, null when it spans
 * the middle (a maximized single, a float, a window that refuses to shrink).
 */
function slotOf(rect: Rect, area: Rect, axis: 'horizontal' | 'vertical'): number | null {
  const span = axis === 'vertical' ? area.height : area.width;
  if (span <= 0) return null;
  const start = (axis === 'vertical' ? rect.y - area.y : rect.x - area.x) + (axis === 'vertical' ? rect.height : rect.width) / 2;
  if (Math.abs(start - span / 2) < span * 0.1) return null;
  return start < span / 2 ? 0 : 1;
}

/**
 * The live extension state the diagnostics read. Scalars that change over time
 * are functions so a dump always reports the current value.
 */
export interface DiagnosticsDeps {
  readonly settings: GnomeSettings;
  readonly host: GnomeHost;
  readonly timing: GnomeTiming;
  readonly history: History;
  readonly registry: RegistryStore;
  readonly tiling: Tiling;
  readonly session: WindowSession;
  readonly indicator: GnomeIndicator;
  readonly animator: Animator;
  readonly signals: SignalRegistry;
  readonly border: BorderState;
  readonly probe: PerfProbe;
  readonly journal: EventJournal;
  readonly sessionMachine: SessionMachine;

  readonly releaseVersion: string;
  readonly normalizeOnEnableMs: number;
  readonly coherenceSweepMs: number;
  readonly switchWatchdogMs: number;
  readonly motionSelfMs: number;

  recorder(): Recorder | null;
  injectionEnabled(): boolean;
  isPaused(): boolean;
  pauseDuringSharing(): boolean;
  derivedMotionPollMs(): number;
  derivedMotionRetileTicks(): number;
  workspaceAnimationActive(): boolean;
  focusReason(): string;
  errorCount(): number;
  restarts(): number;
  selfDisables(): number;
  lastErrorAt(): number;
  /** P6h: the last boundary errors, newest last, bounded to ten. */
  recentErrors(): readonly AdrtRecentError[];
  buildDirMtimeMs(): number;
  animationsBaseline(): { enableAnimations: boolean | null; slowDownFactor: number | null };
  animationsMutated(): boolean;
  wsSwitchEvents(): number;
  motionSuppressions(): number;
  motionRetiles(): number;
  motionTicks(): number;
  motionSkip(): string;
}

export class Diagnostics {
  /** §22/Stage 6: the model state recording started from, for a replayable trace. */
  private recordInitial: TraceInitial | null = null;

  constructor(private readonly deps: DiagnosticsDeps) {}

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

  /** The capability JSON the harness depends on (§40.4, Stage 0). */
  probePlatform(): string {
    const { deps } = this;
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
      const config = (globalThis as { imports?: GjsImports }).imports?.misc?.config;
      if (typeof config?.PACKAGE_VERSION === 'string') gnome = config.PACKAGE_VERSION;
    } catch {
      gnome = 'unknown';
    }
    return JSON.stringify({
      format: 'adrt.probe',
      version: deps.releaseVersion,
      platform: 'gnome',
      gnome,
      session: Meta.is_wayland_compositor?.() === true ? 'wayland' : 'x11',
      monitors: deps.host.screens().length,
      layoutRows: global.workspace_manager.layout_rows,
      // §11.3: what the Shell exposes about refresh and adaptive sync, so a
      // diagnostic can see whether a fixed or variable mode is active.
      refresh: {
        source: deps.host.refreshRateSource,
        screens: deps.timing.screens().map((screen) => ({
          index: screen.index,
          refreshRate: screen.refreshRate,
          frameIntervalMs: screen.frameIntervalMs,
        })),
        observedFrameIntervalMs: deps.timing.resolve().observedFrameIntervalMs,
        variableRefresh: deps.timing.resolve().variableRefresh,
        adaptiveSyncSupported: deps.host.adaptiveSyncSupported(),
        adaptiveSyncReason: deps.host.adaptiveSyncSupported()
          ? 'org.gnome.mutter experimental-features includes variable-refresh-rate'
          : 'Mutter exposes no VRR capability and the experimental feature is off',
      },
      // §18: the OS animation state adrt reads (and never writes).
      animations: {
        enabled: deps.timing.animationsEnabled(),
        reducedMotion: deps.timing.reducedMotion(),
        slowDownFactor: deps.timing.slowDownFactor(),
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
      injection: deps.injectionEnabled(),
      grabOp: deps.host.canDetectUserGrab(),
      devkit: compat.hasDevkit(),
      paused: deps.isPaused(),
      journal: deps.journal.lastSeq,
    });
  }

  /** The model state a trace replays from: the workspaces and their occupants. */
  private buildTraceInitial(): TraceInitial {
    const { deps } = this;
    const count = Math.max(1, deps.session.countWorkspaces());
    const workspaces: TraceWorkspace[] = [];
    for (let index = 0; index < count; index++) {
      workspaces.push({ id: index, slots: [null, null], minimized: [], floats: [] });
    }
    const windows: TraceInitial['windows'] = [];
    const slots = new Map<number, 0 | 1>();
    for (const tracked of deps.session.windows.values()) {
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
      const slot = slotOf(tracked.surface.frame, workAreaOf(deps.host, tracked.surface.screenId), axisOf(deps.host, tracked.surface.screenId));
      if ((slot === 0 || slot === 1) && workspace.slots[slot] === null && !slots.has(tracked.id)) {
        workspace.slots[slot] = tracked.id;
        slots.set(tracked.id, slot);
      } else {
        (workspace.floats ??= []).push(tracked.id);
      }
    }
    return { viewed: deps.host.activeWorkspaceId(), workspaces, windows };
  }

  /** Capture the recording's initial model state (called at enable). */
  captureRecordInitial(): void {
    this.recordInitial = this.buildTraceInitial();
  }

  /** §22/Stage 6: the recorded journal + decisions as a replayable trace. */
  dumpTrace(limit: number): string {
    const initial = this.recordInitial ?? this.buildTraceInitial();
    const events: TraceEntry[] = this.deps.journal.tail(4000, 'model');
    const decisions: TraceEntry[] = this.deps.journal.decisionsTail(limit);
    return JSON.stringify({ version: 1, initial, events, decisions });
  }

  /**
   * The model subset one `state` line carries: every window, the focused id, the
   * border, the drop preview, the drag state, the monitors and the counters.
   * Deliberately not the full `dumpState()` (z-order, registry, …), which would
   * be written 20 times a second.
   */
  recordSnapshot(): Record<string, unknown> {
    const { deps } = this;
    const windows = [...deps.session.windows.values()].map((tracked) => {
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
        tileable: deps.session.classify(tracked).tileable,
      };
    });
    const preview = deps.indicator.describePreview();
    const target = deps.session.isDragging ? deps.session.previewTarget() : null;
    return {
      windows,
      focused: deps.session.focused()?.id ?? null,
      border: deps.border.snapshot(),
      preview: { visible: preview.visible, rect: preview.rect, kind: target?.kind ?? null },
      drag: deps.session.dragState(),
      monitors: deps.host.screens().map((screen) => ({ ...screen })),
      counters: deps.session.counters(),
    };
  }

  /**
   * P6c: the typed builder for the `DumpState` JSON. Returns the raw object;
   * `dumpState()` serialises it. The return type is `AdrtDumpState` (§40.4),
   * which is add-only and lives in `core/` so Shell and harness share it.
   */
  buildDumpState(): AdrtDumpState {
    const { deps } = this;
    const monitors = deps.host.screens().map((screen) => ({ ...screen }));
    // §23: the rules the tiler would use, with the parse errors surface — the
    // runtime never silently drops an invalid rule.
    const rulesParse = deps.settings.rules();
    const windows = [...deps.session.windows.values()].map((tracked) => {
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
        ordinal: deps.registry.ordinalFor(tracked.appKey, tracked.instanceId) ?? null,
        neverTile: deps.registry.isNeverTile(tracked.appKey),
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
        slot: slotOf(tracked.surface.frame, workAreaOf(deps.host, tracked.surface.screenId), axisOf(deps.host, tracked.surface.screenId)),
        axis: axisOf(deps.host, tracked.surface.screenId),
        tileable: deps.session.classify(tracked).tileable,
        reason: deps.session.classify(tracked).reason,
        profile: tracked.profile.name,
        stubborn: tracked.stubborn,
        clamped: tracked.clamped,
        min: tracked.minSize,
        max: tracked.maxSize,
      };
    });
    return {
      format: 'adrt.state',
      version: DUMP_SCHEMA_VERSION,
      platform: 'gnome',
      paused: deps.isPaused(),
      mode: deps.sessionMachine.state.mode,
      userPaused: deps.sessionMachine.manualPause,
      pauseDuringSharing: deps.pauseDuringSharing(),
      panel: {
        present: false,
        paused: deps.isPaused(),
        indicatorEnabled: deps.settings.boolean('active-window-indicator', true),
        recording: deps.recorder()?.isRecording ?? false,
        pauseLabel: '',
        indicatorLabel: '',
        recordLabel: '',
      },
      rules: { count: rulesParse.rules.length, errors: rulesParse.errors },
      recording: deps.recorder()?.describe() ?? {
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
      errors: deps.errorCount(),
      // §Self-heal diagnostics (add-only): the recovery counters and the last
      // caught error, so a restart is never silent in DumpState.
      restarts: deps.restarts(),
      selfDisables: deps.selfDisables(),
      lastErrorAt: deps.lastErrorAt(),
      // P6h (add-only): the last boundary errors, newest last, bounded to ten.
      recentErrors: deps.recentErrors(),
      flags: {
        debug: {
          enabled: deps.settings.boolean('debug-enabled', false),
          tiling: deps.settings.boolean('debug-tiling', false),
          focus: deps.settings.boolean('debug-focus', false),
          displays: deps.settings.boolean('debug-displays', false),
          undo: deps.settings.boolean('debug-undo', false),
          session: deps.settings.boolean('debug-session', false),
        },
        record: deps.settings.boolean('record', false),
        perf: deps.settings.boolean('perf-enabled', true),
      },
      activeWorkspace: deps.host.activeWorkspaceId(),
      workspaceLayoutRows: global.workspace_manager.layout_rows,
      build: { version: deps.releaseVersion, dirMtimeMs: deps.buildDirMtimeMs() },
      timing: {
        ...deps.timing.describe(),
        // The pre-enable accessibility state we found and never changed.
        baseline: {
          enableAnimations: deps.animationsBaseline().enableAnimations,
          slowDownFactor: deps.animationsBaseline().slowDownFactor,
        },
        mutated: deps.animationsMutated(),
        motionPollMs: deps.derivedMotionPollMs(),
        motionRetileTicks: deps.derivedMotionRetileTicks(),
        normaliseOnEnableMs: deps.normalizeOnEnableMs,
        coherenceSweepMs: deps.coherenceSweepMs,
        switchWatchdogMs: deps.switchWatchdogMs,
        motionSelfMs: deps.motionSelfMs,
      },
      tileAxis: deps.session.tileAxis(),
      focusedReason: deps.focusReason(),
      gaps: {
        base: deps.settings.int('gaps-base', 8),
        landscape: deps.settings.int('gaps-landscape', -1),
        portrait: deps.settings.int('gaps-portrait', -1),
      },
      workspaceAnimating: deps.workspaceAnimationActive(),
      focused: deps.session.focused()?.id ?? null,
      pointer: (() => {
        try {
          const [px, py] = global.get_pointer();
          return { x: px, y: py };
        } catch {
          return null;
        }
      })(),
      workspaces: deps.session.countWorkspaces(),
      monitors,
      windows,
      ratios: deps.tiling.getRatios(),
      swapPairs: deps.tiling.getSwapPairs(),
      border: deps.border.snapshot(),
      indicator: {
        ...deps.indicator.describe(),
        visible: deps.indicator.isVisible,
        ghosts: deps.indicator.ghostCount,
        suppressed: deps.border.activeSuppressions,
        preview: deps.indicator.describePreview(),
      },
      overview: overview.visible,
      workspaceActors: deps.signals.groupSize('workspace-actors') / 2,
      coherenceSweeps: deps.session.coherenceSweepCount(),
      coherenceFixes: deps.session.coherenceFixCount(),
      wsSwitchEvents: deps.wsSwitchEvents(),
      motionSuppressions: deps.motionSuppressions(),
      motionRetiles: deps.motionRetiles(),
      motionTicks: deps.motionTicks(),
      motionSkip: deps.motionSkip(),
      drag: deps.session.dragState(),
      adaptations: deps.registry.size,
      registry: deps.registry.entries(),
      registrySize: deps.registry.size,
      neverTile: deps.registry.entries().filter((entry) => entry.neverTile).map((entry) => entry.appId),
      displayMemory: deps.session.getDisplayMemory().map((entry) => entry.connector),
      perf: deps.session.perf(),
      perfStats: {
        queueDepth: deps.session.counters().queuePending,
        drains: deps.session.counters().drains,
        drainMsP50: deps.session.counters().drainMsP50,
        drainMsP95: deps.session.counters().drainMsP95,
        applyMsP50: deps.session.counters().applyMsP50,
        applyMsP95: deps.session.counters().applyMsP95,
        // P6e (add-only): named section call counts and total ms. Empty
        // (`{}`) while the `trace-enabled` gate never turned the probe on.
        sections: deps.probe.snapshot(),
      },
      counters: {
        ...deps.session.counters(),
        configBuilds: deps.settings.configBuilds,
        rulesParses: deps.settings.rulesParses,
        plansApplied: deps.tiling.plansApplied,
        hostLookups: deps.host.hostLookups,
        hostScans: deps.host.hostScans,
        logEvents: deps.history.logEvents,
      },
      bounds: deps.session.memoryBounds(),
      animRecords: deps.animator.recordsSnapshot(),
    };
  }

  /** The `DumpState` JSON string the D-Bus trigger returns. */
  dumpState(): string {
    return JSON.stringify(this.buildDumpState());
  }
}
