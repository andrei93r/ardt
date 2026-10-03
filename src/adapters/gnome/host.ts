// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * `GnomeHost implements PlatformHost` (§2.6). Wraps `global.display`,
 * `global.workspace_manager` and `Main.layoutManager`. Global signals are
 * translated into `PlatformEvent`s here; per-window signals live in
 * `session.ts`.
 */

import { layoutManager } from 'resource:///org/gnome/shell/ui/main.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { Layer } from '../../core/types.js';
import type { Rect, Screen, Size, Surface } from '../../core/types.js';
import type { PlatformEvent } from '../../platform/events.js';
import type { PlatformHost } from '../../platform/host.js';
import * as compat from './compat.js';
import { GnomeSurface } from './surface.js';
import { VersionDetector } from './version.js';

type Listener = (payload: unknown) => void;

/** If `startup-complete` never arrives, unblock the first drain after this long. */
const STARTUP_FALLBACK_MS = 1500;

interface Connection {
  object: any;
  id: number;
}

function frameOf(win: any): Rect {
  const rect = win.get_frame_rect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

export class GnomeHost implements PlatformHost {
  readonly platform = 'gnome' as const;
  readonly versions = new VersionDetector();

  /** §Self-heal containment: the extension's error boundary, wired in at
   * construction so every host signal handler reports instead of escaping. */
  private readonly onError: (context: string, error: unknown) => void;

  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly connections: Connection[] = [];
  private readonly surfaceCache = new Map<number, GnomeSurface>();
  /** Per-window signal connections for the event journal (§22). */
  private readonly windowSignals = new Map<number, { win: any; ids: number[] }>();
  private screensCache: Screen[] = [];
  /** `org.gnome.mutter`: whether workspaces exist only on the primary monitor. */
  private mutter: any = null;
  private primaryMonitorIndex = 0;
  /**
   * Diagnostics (§24): window lookups and full `list_all_windows()` scans. A
   * lookup must not cost a scan — the surface cache already holds the window.
   */
  private lookupCount = 0;
  private scanCount = 0;
  /** §9: a fixture screen list for the display scenarios (`SimulateScreens`). */
  private simulatedScreens: Screen[] | null = null;
  /** §9: per-connector work-area overrides (`SimulateWorkArea`). */
  private readonly simulatedWorkAreas = new Map<string, Rect>();
  /** §20: whether the shell has finished starting up. */
  private startupComplete = false;
  private startupFallback = 0;
  /** Where the last refresh-rate reading came from (for the platform probe). */
  private refreshSource = 'fallback';

  constructor(onError: (context: string, error: unknown) => void = () => undefined) {
    this.onError = onError;
  }

  /**
   * §Self-heal containment: the host's own boundary. Every signal handler and
   * timer the host connects goes through it, so a throw is reported to the
   * extension (which counts, journals and may recover) and never propagates
   * into a compositor emission.
   */
  private guard<A extends unknown[]>(context: string, cb: (...args: A) => void): (...args: A) => void {
    return (...args: A): void => {
      try {
        cb(...args);
      } catch (error) {
        this.onError(`host:${context}`, error);
      }
    };
  }

  get hostLookups(): number {
    return this.lookupCount;
  }

  /** Which API supplied the per-screen refresh rate: layout/backend/stage/fallback. */
  get refreshRateSource(): string {
    return this.refreshSource;
  }

  /** Whether Mutter was told to try variable refresh (the experimental feature). */
  adaptiveSyncSupported(): boolean {
    try {
      const features: unknown = this.mutter?.get_strv('experimental-features');
      return Array.isArray(features) && features.includes('variable-refresh-rate');
    } catch {
      return false;
    }
  }

  get hostScans(): number {
    return this.scanCount;
  }

  /** The single place the window list is fetched, so the counter is honest. */
  private listAllWindows(): any[] {
    this.scanCount += 1;
    return global.display.list_all_windows();
  }

  enable(): void {
    this.refreshScreens();
    try {
      this.mutter = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
    } catch {
      this.mutter = null;
    }
    // §20: the first layout drain waits for the shell to finish starting up.
    try {
      this.connect(layoutManager, 'startup-complete', this.guard('startup-complete', () => this.markStartupComplete()));
    } catch {
      this.startupComplete = true;
    }
    this.startupFallback = GLib.timeout_add(GLib.PRIORITY_DEFAULT, STARTUP_FALLBACK_MS, () => {
      this.startupFallback = 0;
      try {
        this.markStartupComplete();
      } catch (error) {
        this.onError('host:startup-fallback', error);
      }
      return GLib.SOURCE_REMOVE;
    });
    this.connect(global.display, 'window-created', this.guard('window-created', (_display: any, win: any) => {
      this.emit({ type: 'surface-created', surface: this.ensureSurface(win) });
    }));
    this.connect(global.display, 'notify::focus-window', this.guard('focus-window', () => {
      this.emit({ type: 'focus-changed', id: global.display.get_focus_window()?.get_id() ?? null });
    }));
    this.connect(global.window_manager, 'switch-workspace', this.guard('switch-workspace', (_wm: any, from: number, to: number) => {
      this.emit({ type: 'workspace-switched', from, to, phase: 'active' });
    }));
    this.connect(layoutManager, 'monitors-changed', this.guard('monitors-changed', () => {
      this.refreshScreens();
      this.emit({ type: 'screens-changed' });
    }));
    // Panels, docks and autohide change the usable area without changing monitors.
    this.connect(global.display, 'workareas-changed', this.guard('workareas-changed', () => {
      this.refreshScreens();
      this.emit({ type: 'screens-changed' });
    }));
  }

  disable(): void {
    if (this.startupFallback !== 0) {
      GLib.source_remove(this.startupFallback);
      this.startupFallback = 0;
    }
    for (const connection of this.connections.splice(0)) {
      connection.object.disconnect(connection.id);
    }
    for (const id of [...this.windowSignals.keys()]) this.forgetWindow(id);
    this.surfaceCache.clear();
    this.listeners.clear();
  }

  /**
   * Watch one window's own signals so the journal sees what the compositor
   * does to it, not just what the tiler does. Connected once per window and
   * disconnected with `unmanaged` (§22: the per-window `on()` helper).
   */
  private watchWindow(win: any, id: number): void {
    if (this.windowSignals.has(id)) return;
    const ids: number[] = [];
    const byUser = (): boolean => this.userGrabInProgress();
    ids.push(win.connect('notify::frame-rect', this.guard('window:frame-rect', () => {
      this.emit({ type: 'surface-frame-changed', id, frame: frameOf(win), byUser: byUser() });
    })));
    ids.push(win.connect('notify::monitor', this.guard('window:monitor', () => {
      this.emit({ type: 'surface-screen-changed', id, screenId: win.get_monitor() });
    })));
    ids.push(win.connect('workspace-changed', this.guard('window:workspace-changed', () => {
      this.emit({ type: 'surface-workspace-changed', id, workspaceId: win.get_workspace()?.index() ?? 0, byUser: byUser() });
    })));
    ids.push(win.connect('notify::minimized', this.guard('window:minimized', () => {
      this.emit({ type: 'surface-flags-changed', id, flags: { minimized: win.minimized === true } });
    })));
    ids.push(win.connect('notify::wm-class', this.guard('window:wm-class', () => {
      this.emit({ type: 'surface-flags-changed', id, flags: {} });
    })));
    ids.push(win.connect('unmanaged', this.guard('window:unmanaged', () => {
      this.forgetWindow(id);
      this.emit({ type: 'surface-closed', id });
    })));
    this.windowSignals.set(id, { win, ids });
  }

  private forgetWindow(id: number): void {
    const entry = this.windowSignals.get(id);
    if (entry !== undefined) {
      for (const signal of entry.ids) {
        try {
          entry.win.disconnect(signal);
        } catch {
          /* window already gone */
        }
      }
      this.windowSignals.delete(id);
    }
    this.surfaceCache.delete(id);
  }

  /**
   * Whether the compositor is inside a user grab (a move or a resize the user
   * is performing). Used to mark journal entries as user-driven; missing API
   * simply means "not user-driven".
   */
  userGrabInProgress(): boolean {
    // §22: a user move or resize always drags with the button down, and our own
    // applies never do — that is what distinguishes them (compat.button1Pressed).
    // The compositor's grab op, where the shell exposes it, is a second vote.
    try {
      if (compat.button1Pressed()) return true;
    } catch {
      /* no pointer (a headless shell before injection) */
    }
    try {
      const op = global.display.get_grab_op?.();
      return typeof op === 'number' ? op !== 0 : false;
    } catch {
      return false;
    }
  }

  /** Whether a user grab can be detected here — the journal's `byUser`. */
  canDetectUserGrab(): boolean {
    return typeof compat.button1Pressed === 'function';
  }

  on(type: PlatformEvent['type'], cb: Listener): () => void {
    let set = this.listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  }

  emit(event: PlatformEvent): void {
    const set = this.listeners.get(event.type);
    if (set === undefined) return;
    for (const cb of set) cb(event);
  }

  surfaces(): Surface[] {
    const out: Surface[] = [];
    for (const win of this.listAllWindows()) {
      if (win.get_id() === undefined) continue;
      out.push(this.ensureSurface(win));
    }
    return out;
  }

  ensureSurface(win: any): GnomeSurface {
    const id: number = win.get_id();
    let surface = this.surfaceCache.get(id);
    if (surface === undefined) {
      const version = this.versions.detect(win, win.get_title() ?? '');
      surface = new GnomeSurface(win, version, () => this.flagContext());
      this.surfaceCache.set(id, surface);
      this.watchWindow(win, id);
    }
    return surface;
  }

  /**
   * The context that decides whether `on-all-workspaces` means "pinned" or is
   * simply implied by Mutter keeping a secondary monitor on every workspace
   * while `workspaces-only-on-primary` is set (GNOME's default).
   */
  flagContext(): { workspacesOnlyOnPrimary: boolean; primaryMonitor: number } {
    let only = false;
    try {
      only = this.mutter?.get_boolean('workspaces-only-on-primary') === true;
    } catch {
      only = false;
    }
    return { workspacesOnlyOnPrimary: only, primaryMonitor: this.primaryMonitorIndex };
  }

  forgetSurface(id: number): void {
    this.surfaceCache.delete(id);
  }

  /** Resolve the live Mutter window for a surface id. */
  /** Drop the "always on top" hint so the window can sit in the tiling. */
  clearAbove(id: number): void {
    const win = this.windowFor(id);
    if (win === null) return;
    try {
      if (win.is_above() === true) win.unmake_above();
    } catch {
      /* window gone */
    }
  }

  /**
   * Resolve the live Mutter window for a surface id. The surface cache already
   * holds it, so a lookup is O(1); the `list_all_windows()` scan is kept only
   * as a miss fallback, so behaviour is identical if a surface is somehow
   * absent (PERFORMANCE_PLAN stage 2, carried into v2).
   */
  windowFor(id: number): any | null {
    return this.windowById(id);
  }

  screens(): Screen[] {
    return this.screensCache;
  }

  /** §20: true once the shell's startup is complete (or the fallback fired). */
  isStartupComplete(): boolean {
    return this.startupComplete;
  }

  private markStartupComplete(): void {
    if (this.startupComplete) return;
    this.startupComplete = true;
    // Nudge the deferred first drain now that adoption may move windows.
    this.emit({ type: 'screens-changed' });
  }

  /**
   * §9 `SimulateScreens`: replace the screen list the extension reads with a
   * fixture, so a disconnect/reconnect/primary change can be exercised without
   * physical hardware. The primary flag is part of what GNOME reports here;
   * adrt still never sets the real primary.
   */
  setSimulatedScreens(screens: Screen[] | null): void {
    this.simulatedScreens = screens;
    this.refreshScreens();
    this.emit({ type: 'screens-changed' });
  }

  /**
   * §9 `SimulateWorkArea`: change one connector's work area. A transient or
   * invalid reading (a `-1 × -1` mid-transition) keeps the last good value.
   */
  setSimulatedWorkArea(connector: string, area: Rect): boolean {
    if (area.width <= 0 || area.height <= 0) return false;
    this.simulatedWorkAreas.set(connector, { ...area });
    const apply = (screen: Screen): void => {
      if (screen.connector !== connector) return;
      screen.workArea = { ...area };
    };
    for (const screen of this.screensCache) apply(screen);
    if (this.simulatedScreens !== null) for (const screen of this.simulatedScreens) apply(screen);
    this.emit({ type: 'screens-changed' });
    return true;
  }

  activeWorkspaceId(): number {
    return global.workspace_manager.get_active_workspace_index();
  }

  applyFrame(id: number, rect: Rect): void {
    const win = this.windowById(id);
    if (win === null) return;
    // `move_resize_frame` takes integer logical pixels and GI truncates each
    // argument on its own, which at a fractional scale would drop a sub-pixel
    // each side. Round explicitly; the tiler has already reconciled a pair's
    // shared boundary before it calls here (see `compositorFrames`), so this is
    // a no-op for a plan and the correct grid for every other caller.
    win.move_resize_frame(true, Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height));
  }

  applyLayer(id: number, layer: Layer, _order: number): void {
    const win = this.windowById(id);
    if (win === null) return;
    switch (layer) {
      case Layer.FLOATING:
        win.make_above();
        break;
      case Layer.TILED:
        win.unmake_above();
        break;
      case Layer.MODAL:
        win.raise();
        break;
      default:
        break;
    }
  }

  applyWorkspace(id: number, workspaceId: number): void {
    const win = this.windowById(id);
    if (win === null) return;
    win.change_workspace_by_index(workspaceId, true);
  }

  unmaximize(id: number): void {
    const win = this.windowById(id);
    if (win === null) return;
    win.unmaximize();
  }

  minimize(id: number): void {
    const win = this.windowById(id);
    if (win === null) return;
    win.minimize();
  }

  unminimize(id: number): void {
    const win = this.windowById(id);
    if (win === null) return;
    win.unminimize();
  }

  maximize(id: number): void {
    const win = this.windowById(id);
    if (win === null) return;
    win.maximize();
  }

  /**
   * §17: move the pointer to (x, y). `global.display.warp_pointer` does not
   * exist in GNOME 50; the public `Clutter.Seat.warp_pointer` does, and the
   * extension runs inside the compositor, so it is allowed to warp its own
   * seat. Returns false when neither mechanism is available (the caller then
   * reports honestly instead of pretending the pointer moved).
   *
   * The warp is issued twice: a freshly-started (headless) seat can apply only
   * one axis of the *first* synthetic motion it ever sees (probed, see
   * docs/platform-notes.md), and the call is idempotent, so the second warp in
   * the same pass guarantees both axes without a visible double move.
   */
  warpPointer(x: number, y: number): boolean {
    const px = Math.trunc(x);
    const py = Math.trunc(y);
    const once = (): boolean => {
      try {
        if (typeof (global.display as any)?.warp_pointer === 'function') {
          (global.display as any).warp_pointer(px, py);
          return true;
        }
      } catch {
        /* fall through to the seat */
      }
      try {
        const seat = compat.defaultSeat();
        if (typeof seat?.warp_pointer === 'function') {
          seat.warp_pointer(px, py);
          return true;
        }
      } catch {
        /* no seat */
      }
      return false;
    };
    if (!once()) return false;
    once();
    return true;
  }

  minSize(id: number): Size | null {
    const win = this.windowById(id);
    if (win === null) return null;
    // GNOME 50 returns [hasSize, width, height]; older returns [width, height].
    const min = win.get_min_size() as number[];
    const base = (min?.length ?? 0) >= 3 ? 1 : 0;
    return { width: Number(min?.[base] ?? 0), height: Number(min?.[base + 1] ?? 0) };
  }

  private windowById(id: number): any | null {
    this.lookupCount += 1;
    const cached = this.surfaceCache.get(id);
    if (cached !== undefined) return cached.win;
    for (const win of this.listAllWindows()) {
      if (win.get_id() === id) return win;
    }
    return null;
  }

  private connect(object: any, signal: string, cb: (...args: any[]) => void): void {
    this.connections.push({ object, id: object.connect(signal, cb) });
  }

  private refreshScreens(): void {
    if (this.simulatedScreens !== null) {
      this.screensCache = this.simulatedScreens.map((screen) => ({
        ...screen,
        geometry: { ...screen.geometry },
        workArea: this.simulatedWorkAreas.get(screen.connector) ?? (screen.workArea === undefined ? undefined : { ...screen.workArea }),
      }));
      this.primaryMonitorIndex = this.screensCache.find((screen) => screen.isPrimary)?.index ?? this.screensCache[0]?.index ?? 0;
      this.refreshSource = 'simulated';
      return;
    }
    const monitors: any[] = layoutManager.monitors;
    const connectors = this.monitorConnectors();
    this.primaryMonitorIndex = layoutManager.primaryIndex ?? 0;
    const workspace = global.workspace_manager.get_active_workspace();
    const stageRate = this.stageRefreshRate();
    // §Shell stability: the live logical-monitor count, re-read here rather than
    // derived from `layoutManager.monitors`. During a removal the layout list
    // can lag the monitor manager by one entry, and an index read from the
    // former would make `get_work_area_for_monitor` assert.
    const liveCount = this.liveMonitorCount();
    let sawLayout = false;
    let sawBackend = false;
    this.screensCache = monitors.map((monitor, position) => {
      // The real Mutter index, never the array position: a reordered monitor
      // list must not move the connector or the primary flag.
      const monitorIndex = monitor.index ?? position;
      const work = this.workAreaFor(workspace, monitorIndex, liveCount);
      // Newer Shells put `refreshRate` on the layout monitor; older ones need
      // the Mutter mode. Neither may be assumed to exist, and a virtual monitor
      // reports a fixed rate while a real VRR panel changes at runtime.
      let rate = 0;
      const direct = monitor.refreshRate;
      if (typeof direct === 'number' && direct > 0) {
        rate = direct;
        sawLayout = true;
      } else {
        rate = this.backendRefreshRate(monitorIndex);
        if (rate > 0) sawBackend = true;
      }
      if (rate <= 0) rate = stageRate;
      return {
        index: monitorIndex,
        connector: connectors.get(monitorIndex) ?? connectors.get(position) ?? `M${monitorIndex}`,
        geometry: { x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height },
        workArea:
          work === null
            ? undefined
            : { x: work.x, y: work.y, width: work.width, height: work.height },
        scale: monitor.scale ?? 1,
        refreshRate: rate > 0 ? rate : 60,
        isPrimary: monitorIndex === this.primaryMonitorIndex,
      };
    });
    this.refreshSource = sawLayout ? 'layout' : sawBackend ? 'backend' : stageRate > 0 ? 'stage' : 'fallback';
  }

  /**
   * The work area of one monitor, read only while the index is inside the live
   * monitor list. A monitor removed mid-transition leaves a window — and for a
   * moment the layout list — pointing at an index the workspace no longer
   * holds; `get_work_area_for_monitor` asserts on that. Skip (never call) when
   * the index is out of range, and treat a raced read as "no work area yet".
   */
  private workAreaFor(workspace: any, monitorIndex: number, liveCount: number): any | null {
    if (workspace === null || workspace === undefined) return null;
    if (liveCount < 0) liveCount = this.liveMonitorCount();
    if (monitorIndex < 0 || monitorIndex >= liveCount) return null;
    try {
      return workspace.get_work_area_for_monitor(monitorIndex);
    } catch {
      return null;
    }
  }

  /** The live logical-monitor count, or -1 when the manager is unreachable. */
  private liveMonitorCount(): number {
    try {
      const manager = global.backend.get_monitor_manager();
      // The logical monitor list is what index-based calls (work-area reads,
      // `move_to_monitor`) resolve against. The physical list can still hold a
      // monitor whose logical entry was just removed, so bounding against it
      // would let a stale index through and assert.
      if (typeof manager.get_logical_monitors === 'function') {
        return manager.get_logical_monitors().length;
      }
      if (typeof manager.get_n_monitors === 'function') return manager.get_n_monitors();
      return manager.get_monitors().length;
    } catch {
      return -1;
    }
  }

  /**
   * §Shell stability: whether a Mutter monitor index still exists in the live
   * monitor manager. Index-based Mutter calls (`move_to_monitor`,
   * `get_work_area_for_monitor`) must be skipped when it does not — the
   * alternative is a C assertion inside the compositor.
   */
  isLiveMonitorIndex(index: number): boolean {
    if (!Number.isInteger(index)) return false;
    const count = this.liveMonitorCount();
    return count > 0 && index >= 0 && index < count;
  }

  /**
   * The current mode's refresh rate from the Mutter monitor object, where the
   * typelib exposes it. Feature-detected: a missing method is not an error.
   */
  private backendRefreshRate(index: number): number {
    try {
      const manager = global.backend.get_monitor_manager();
      const monitors: any[] = manager.get_monitors();
      const monitor = monitors.find((m: any) => (typeof m.get_index === 'function' ? m.get_index() : -1) === index) ?? monitors[index];
      if (typeof monitor?.get_current_mode !== 'function') return 0;
      const mode = monitor.get_current_mode();
      const rate = typeof mode?.get_refresh_rate === 'function' ? mode.get_refresh_rate() : undefined;
      return typeof rate === 'number' && rate > 0 ? rate : 0;
    } catch {
      return 0;
    }
  }

  /** The stage's own frame-clock rate, a last real reading; 0 when unavailable. */
  private stageRefreshRate(): number {
    try {
      const view = global.stage?.get_view?.();
      const fromView = typeof view?.get_refresh_rate === 'function' ? view.get_refresh_rate() : undefined;
      if (typeof fromView === 'number' && fromView > 0) return fromView;
      const clock = global.stage?.get_frame_clock?.();
      const fromClock = typeof clock?.get_refresh_rate === 'function' ? clock.get_refresh_rate() : undefined;
      return typeof fromClock === 'number' && fromClock > 0 ? fromClock : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Connectors keyed by the real logical-monitor index, so a screen carries the
   * right connector even when the backend list is ordered differently from
   * `layoutManager.monitors`.
   */
  private monitorConnectors(): Map<number, string> {
    const map = new Map<number, string>();
    try {
      const manager = global.backend.get_monitor_manager();
      const monitors: any[] = manager.get_monitors();
      monitors.forEach((monitor: any, position: number) => {
        const index = typeof monitor.get_index === 'function' ? monitor.get_index() : position;
        map.set(index, monitor.get_connector());
      });
    } catch (e) {
      console.debug(`[adrt] monitor connector lookup failed: ${(e as Error).message}`);
    }
    return map;
  }
}
