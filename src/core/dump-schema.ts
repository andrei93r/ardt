// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §40.4 / P6c: the typed `DumpState` JSON schema.
 *
 * This is the single typed description of the JSON the extension's
 * `DumpState` D-Bus trigger emits. It lives in `core/` (no `gi://`, no I/O) so
 * both the Shell adapter that builds the payload and the harness/tests that
 * read it share one definition, and so the schema can be asserted in a pure
 * unit test.
 *
 * The schema is add-only (§2.5): field order and the meaning of every existing
 * field are part of the harness contract. New fields are appended over time;
 * a reader must tolerate unknown extra fields. Nothing here changes the JSON —
 * it describes exactly what `Diagnostics.buildDumpState()` already emits.
 */

import type { AppEntry } from './appregistry.js';
import type { BorderSnapshot, SuppressionReason } from './border.js';
import type { Classification } from './classify.js';
import type { IdentitySource } from './identity.js';
import type { SessionMode } from './session.js';
import type { ScreenTiming } from './timing.js';
import type { Layer, Rect, Screen, Size } from './types.js';

/**
 * The `DumpState` JSON schema version. It is deliberately separate from the
 * settings/state migration version: this one tracks the diagnostic payload
 * shape, which only changes add-only.
 */
export const DUMP_SCHEMA_VERSION = 1;

/** One caught boundary error retained in the recent-errors ring (P6h). */
export interface AdrtRecentError {
  /** Wall-clock ms when the boundary caught it. */
  at: number;
  /** The boundary's context tag (e.g. `fault-test:drain`). */
  context: string;
  /** The caught error's message, never empty for a real throw. */
  message: string;
}

interface DumpPanel {
  present: boolean;
  paused: boolean;
  indicatorEnabled: boolean;
  recording: boolean;
  pauseLabel: string;
  indicatorLabel: string;
  recordLabel: string;
}

interface DumpRules {
  count: number;
  errors: string[];
}

/**
 * The recorder status as carried by `DumpState.recording`. `maxMs`/`maxBytes`
 * are optional because the inert fallback object (no recorder) omits them.
 */
interface DumpRecording {
  recording: boolean;
  path: string | null;
  elapsedMs: number;
  bytes: number;
  events: number;
  snapshots: number;
  maxMs?: number;
  maxBytes?: number;
  stopReason: string | null;
  promptOpen: boolean;
  note: string;
}

interface DumpWorkspaceMode {
  dynamic: boolean;
  onlyPrimary: boolean;
  numWorkspaces: number;
}

interface DumpDebugFlags {
  enabled: boolean;
  tiling: boolean;
  focus: boolean;
  displays: boolean;
  undo: boolean;
  session: boolean;
}

interface DumpFlags {
  debug: DumpDebugFlags;
  record: boolean;
  perf: boolean;
}

interface DumpBuild {
  version: string;
  dirMtimeMs: number;
}

interface DumpAnimationsBaseline {
  enableAnimations: boolean | null;
  slowDownFactor: number | null;
}

interface DumpTiming {
  animationsEnabled: boolean;
  osAnimationsEnabled: boolean;
  reducedMotion: boolean;
  slowDownFactor: number;
  baseFrameIntervalMs: number;
  observedFrameIntervalMs: number | null;
  adaptiveSync: boolean;
  variableRefresh: boolean;
  resolvedFrameIntervalMs: number;
  screens: readonly ScreenTiming[];
  baseline: DumpAnimationsBaseline;
  mutated: boolean;
  motionPollMs: number;
  motionRetileTicks: number;
  normaliseOnEnableMs: number;
  coherenceSweepMs: number;
  switchWatchdogMs: number;
  motionSelfMs: number;
}

interface DumpGaps {
  base: number;
  landscape: number;
  portrait: number;
}

/** One window row in `DumpState.windows`. */
interface DumpWindow {
  id: number;
  /** Mutter's `Meta.WindowType` (a numeric enum). */
  windowType: number;
  cls: string;
  identity: string;
  identitySource: IdentitySource;
  provisional: boolean;
  instanceId: string;
  ordinal: number | null;
  neverTile: boolean;
  title: string;
  version: string;
  workspace: number;
  monitor: number;
  rect: Rect;
  layer: Layer;
  z: number;
  maximized: boolean;
  minimized: boolean;
  fullscreen: boolean;
  above: boolean;
  transient: boolean;
  slot: number | null;
  axis: 'horizontal' | 'vertical';
  tileable: boolean;
  /** Why the window is not tiled; `null` when it is tileable. */
  reason: Classification['reason'];
  profile: string;
  stubborn: boolean;
  clamped: boolean;
  min: Size;
  max: Size;
}

interface DumpIndicatorPreview {
  visible: boolean;
  rect: Rect | null;
  colour: string;
}

interface DumpIndicator {
  color: string;
  width: number;
  opacity: number;
  radius: number;
  stackedBelowTray: boolean;
  pulseDurationMs: number;
  animationsEnabled: boolean;
  visible: boolean;
  ghosts: number;
  suppressed: SuppressionReason[];
  preview: DumpIndicatorPreview;
}

interface DumpDrag {
  active: boolean;
  windowDrag: boolean;
  clientInteraction: boolean;
  dragId: number | null;
  adjustId: number | null;
  button: boolean;
  displayGrab: boolean | null;
}

interface DumpSessionPerf {
  lastReconcileMs: number;
  lastApplyMs: number;
  lastApplyAtMs: number;
}

interface DumpPerfSectionStat {
  count: number;
  totalMs: number;
}

interface DumpPerfStats {
  queueDepth: number;
  drains: number;
  drainMsP50: number;
  drainMsP95: number;
  applyMsP50: number;
  applyMsP95: number;
  /** Empty while the `trace-enabled` gate never turned the probe on. */
  sections: Record<string, DumpPerfSectionStat>;
}

/** The stage-0 counters plus the settings/tiling/host/history counters. */
interface DumpCounters {
  sweeps: number;
  sweepMsMax: number;
  sweepMsAvg: number;
  classifyCalls: number;
  classifyMisses: number;
  plansComputed: number;
  sweepFrameReads: number;
  drains: number;
  queuePending: number;
  drainMsMax: number;
  drainMsP50: number;
  drainMsP95: number;
  applyMsP50: number;
  applyMsP95: number;
  applySamples: number;
  clampsApplied: number;
  errors: number;
  configBuilds: number;
  rulesParses: number;
  plansApplied: number;
  hostLookups: number;
  hostScans: number;
  logEvents: number;
}

interface DumpBounds {
  windows: number;
  sources: number;
  signals: number;
}

/** One animation event from the bounded test recorder; empty unless armed. */
interface DumpAnimRecord {
  kind: 'start' | 'frame' | 'end' | 'cancel';
  id: number;
  at: number;
  rect: Rect;
  to?: Rect;
  from?: Rect;
}

/**
 * The full `DumpState` JSON. Add-only: existing fields keep their order and
 * meaning; new diagnostic fields are appended.
 */
export interface AdrtDumpState {
  format: 'adrt.state';
  version: number;
  platform: 'gnome';
  paused: boolean;
  mode: SessionMode;
  userPaused: boolean;
  pauseDuringSharing: boolean;
  panel: DumpPanel;
  rules: DumpRules;
  recording: DumpRecording;
  workspaceMode: DumpWorkspaceMode;
  errors: number;
  restarts: number;
  selfDisables: number;
  lastErrorAt: number;
  /** P6h: the last boundary errors, newest last, bounded to ten. */
  recentErrors: readonly AdrtRecentError[];
  flags: DumpFlags;
  activeWorkspace: number;
  workspaceLayoutRows: number;
  build: DumpBuild;
  timing: DumpTiming;
  tileAxis: 'vertical' | 'horizontal';
  focusedReason: string;
  gaps: DumpGaps;
  workspaceAnimating: boolean;
  focused: number | null;
  pointer: { x: number; y: number } | null;
  workspaces: number;
  monitors: Screen[];
  windows: DumpWindow[];
  ratios: Record<string, number>;
  swapPairs: string[];
  border: BorderSnapshot;
  indicator: DumpIndicator;
  overview: boolean;
  workspaceActors: number;
  coherenceSweeps: number;
  coherenceFixes: number;
  wsSwitchEvents: number;
  motionSuppressions: number;
  motionRetiles: number;
  motionTicks: number;
  motionSkip: string;
  drag: DumpDrag;
  adaptations: number;
  registry: AppEntry[];
  registrySize: number;
  neverTile: string[];
  displayMemory: string[];
  perf: DumpSessionPerf;
  perfStats: DumpPerfStats;
  counters: DumpCounters;
  bounds: DumpBounds;
  animRecords: DumpAnimRecord[];
}
