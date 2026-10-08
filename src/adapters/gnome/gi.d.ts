// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Ambient declarations for the GNOME Shell / GJS runtime.
 *
 * The shell exposes no TypeScript types; these declarations let `tsc` compile
 * the adapter while keeping `core/` and `platform/` free of `gi://` imports
 * (§2.2). They are intentionally permissive — the runtime is the type checker
 * for compositor APIs.
 */

declare const global: any;
declare const TextDecoder: any;
declare const TextEncoder: any;

/** GJS ESM modules expose `import.meta.url` (`lib` has no DOM/Node types). */
interface ImportMeta {
  readonly url: string;
}
declare const console: {
  debug(...args: unknown[]): void;
  error(...args: unknown[]): void;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};

declare module 'gi://GLib' {
  const GLib: any;
  export default GLib;
}
declare module 'gi://Gio' {
  const Gio: any;
  export default Gio;
  /** The `Gio.Settings` surface the adapters read (see `host.ts`). */
  export interface Settings {
    get_strv(key: string): string[];
    get_boolean(key: string): boolean;
  }
}
declare module 'gi://GioUnix' {
  const GioUnix: any;
  export default GioUnix;
}
declare module 'gi://GObject' {
  const GObject: any;
  export default GObject;
}
declare module 'gi://Meta' {
  const Meta: any;
  export default Meta;

  /**
   * Accurate shapes for the Mutter surface `host.ts` reads. The namespace
   * default stays `any` so the other adapters keep compiling against the broad
   * declarations; these are imported explicitly where a file has been typed.
   */

  /** A logical rectangle in pixels (`Meta.Rectangle`). */
  export interface MetaRectangle {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  /** A Mutter workspace (`Meta.Workspace`). */
  export interface MetaWorkspace {
    index(): number;
    get_work_area_for_monitor(index: number): MetaRectangle;
  }

  /** A Mutter workspace manager (`Meta.WorkspaceManager`). */
  export interface MetaWorkspaceManager {
    get_active_workspace(): MetaWorkspace;
    get_active_workspace_index(): number;
  }

  /** A Mutter display (`Meta.Display`), as read by `host.ts`. */
  export interface MetaDisplay {
    list_all_windows(): MetaWindow[];
    get_focus_window(): MetaWindow | null;
    get_grab_op?(): unknown;
    warp_pointer?(x: number, y: number): void;
  }

  /** A Mutter window (`Meta.Window`), as read by `host.ts`. */
  export interface MetaWindow {
    get_id(): number;
    get_title(): string | null;
    get_frame_rect(): MetaRectangle;
    get_monitor(): number;
    get_workspace(): MetaWorkspace | null;
    minimized: boolean;
    is_above(): boolean;
    make_above(): void;
    unmake_above(): void;
    move_resize_frame(userOp: boolean, x: number, y: number, width: number, height: number): void;
    change_workspace_by_index(index: number, create: boolean): void;
    maximize(): void;
    unmaximize(): void;
    minimize(): void;
    unminimize(): void;
    /** GNOME 50 leads with a boolean flag, older versions do not. */
    get_min_size(): Array<number | boolean>;
  }

  /** A Mutter monitor mode (`Meta.MonitorMode`). */
  export interface MetaMonitorMode {
    get_refresh_rate(): number;
  }

  /** A Mutter monitor (`Meta.Monitor`). */
  export interface MetaMonitor {
    get_index(): number;
    get_connector(): string;
    get_current_mode(): MetaMonitorMode | null;
  }

  /** The backend monitor manager (`Meta.MonitorManager`). */
  export interface MetaMonitorManager {
    get_logical_monitors?(): unknown[];
    get_n_monitors?(): number;
    get_monitors(): MetaMonitor[];
  }
}
declare module 'gi://St' {
  const St: any;
  export default St;
}
declare module 'gi://Clutter' {
  const Clutter: any;
  export default Clutter;
  /** A `Clutter.Stage`, read only for its own frame-clock rate (`host.ts`). */
  export interface ClutterStage {
    get_view?(): ClutterStageView | null;
    get_frame_clock?(): ClutterFrameClock | null;
  }
  /** A stage view, read only for its refresh rate. */
  export interface ClutterStageView {
    get_refresh_rate?(): number;
  }
  /** A stage frame clock, read only for its refresh rate. */
  export interface ClutterFrameClock {
    get_refresh_rate?(): number;
  }
}
declare module 'gi://Shell' {
  const Shell: any;
  export default Shell;
}
declare module 'gi://GDesktopEnums' {
  const GDesktopEnums: any;
  export default GDesktopEnums;
}
declare module 'gi://Gtk' {
  const Gtk: any;
  export default Gtk;
}
declare module 'gi://Adw' {
  const Adw: any;
  export default Adw;
}

// GJS ships a built-in `gettext` module (see gjs.guide). Only the functions
// the adapter uses are declared; messages come from the extension's `locale/`.
declare module 'gettext' {
  export function bindtextdomain(domain: string, dirname: string): void;
  export function dgettext(domain: string, msgid: string): string;
  export function dngettext(domain: string, msgid: string, msgidPlural: string, n: number): string;
}

declare module 'resource:///org/gnome/shell/extensions/extension.js' {
  export const Extension: any;
}

declare module 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js' {
  export const ExtensionPreferences: any;
}

declare module 'resource:///org/gnome/shell/misc/config.js' {
  export const PACKAGE_VERSION: string;
}

declare module 'resource:///org/gnome/shell/ui/main.js' {
  export const layoutManager: any;
  export const overview: any;
  export const sessionMode: any;
  export const wm: any;
  export const panel: any;
  export const stage: any;
  export const uiGroup: any;
  export const messageTray: any;
  /** One entry of `layoutManager.monitors`, as read by `host.ts`. */
  export interface LayoutMonitor {
    index?: number;
    x: number;
    y: number;
    width: number;
    height: number;
    scale?: number;
    refreshRate?: number;
  }
  export function notify(title: string, message: string): void;
  export function pushModal(actor: any): void;
  export function popModal(actor: any): void;
}

declare module 'resource:///org/gnome/shell/ui/quickSettings.js' {
  export const QuickSettings: any;
}
