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

import { Layer } from '../../core/types.js';
import type { Rect, Screen, Size, Surface } from '../../core/types.js';
import type { PlatformEvent } from '../../platform/events.js';
import type { PlatformHost } from '../../platform/host.js';
import { GnomeSurface } from './surface.js';
import { VersionDetector } from './version.js';

type Listener = (payload: unknown) => void;

interface Connection {
  object: any;
  id: number;
}

export class GnomeHost implements PlatformHost {
  readonly platform = 'gnome' as const;
  readonly versions = new VersionDetector();

  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly connections: Connection[] = [];
  private readonly surfaceCache = new Map<number, GnomeSurface>();
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

  get hostLookups(): number {
    return this.lookupCount;
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
    this.connect(global.display, 'window-created', (_display: any, win: any) => {
      this.emit({ type: 'surface-created', surface: this.ensureSurface(win) });
    });
    this.connect(global.display, 'notify::focus-window', () => {
      this.emit({ type: 'focus-changed', id: global.display.get_focus_window()?.get_id() ?? null });
    });
    this.connect(global.window_manager, 'switch-workspace', (_wm: any, from: number, to: number) => {
      this.emit({ type: 'workspace-switched', from, to, phase: 'active' });
    });
    this.connect(layoutManager, 'monitors-changed', () => {
      this.refreshScreens();
      this.emit({ type: 'screens-changed' });
    });
    // Panels, docks and autohide change the usable area without changing monitors.
    this.connect(global.display, 'workareas-changed', () => {
      this.refreshScreens();
      this.emit({ type: 'screens-changed' });
    });
  }

  disable(): void {
    for (const connection of this.connections.splice(0)) {
      connection.object.disconnect(connection.id);
    }
    this.surfaceCache.clear();
    this.listeners.clear();
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

  windowFor(id: number): any | null {
    this.lookupCount += 1;
    for (const win of this.listAllWindows()) {
      if (win.get_id() === id) return win;
    }
    return null;
  }

  screens(): Screen[] {
    return this.screensCache;
  }

  activeWorkspaceId(): number {
    return global.workspace_manager.get_active_workspace_index();
  }

  applyFrame(id: number, rect: Rect): void {
    const win = this.windowById(id);
    if (win === null) return;
    win.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
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

  maximize(id: number): void {
    const win = this.windowById(id);
    if (win === null) return;
    win.maximize();
  }

  minSize(id: number): Size | null {
    const win = this.windowById(id);
    if (win === null) return null;
    const min = win.get_min_size();
    return { width: min[0], height: min[1] };
  }

  private windowById(id: number): any | null {
    this.lookupCount += 1;
    for (const win of this.listAllWindows()) {
      if (win.get_id() === id) return win;
    }
    return null;
  }

  private connect(object: any, signal: string, cb: (...args: any[]) => void): void {
    this.connections.push({ object, id: object.connect(signal, cb) });
  }

  private refreshScreens(): void {
    const monitors: any[] = layoutManager.monitors;
    const connectors = this.monitorConnectors();
    this.primaryMonitorIndex = layoutManager.primaryIndex ?? 0;
    const workspace = global.workspace_manager.get_active_workspace();
    this.screensCache = monitors.map((monitor, index) => {
      const monitorIndex = monitor.index ?? index;
      const work = workspace === null ? null : workspace.get_work_area_for_monitor(monitorIndex);
      return {
        index: monitorIndex,
        connector: connectors[index] ?? `M${index}`,
        geometry: { x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height },
        workArea:
          work === null
            ? undefined
            : { x: work.x, y: work.y, width: work.width, height: work.height },
        scale: monitor.scale ?? 1,
        refreshRate: monitor.refreshRate ?? 60,
        isPrimary: monitorIndex === layoutManager.primaryIndex,
      };
    });
  }

  private monitorConnectors(): string[] {
    try {
      const manager = global.backend.get_monitor_manager();
      const monitors: any[] = manager.get_monitors();
      return monitors.map((monitor: any) => monitor.get_connector());
    } catch (e) {
      console.debug(`[adrt] monitor connector lookup failed: ${(e as Error).message}`);
      return [];
    }
  }
}
