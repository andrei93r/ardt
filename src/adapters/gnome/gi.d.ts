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

  /**
   * The `Gio.Settings` surface the adapters read and write (see `host.ts`,
   * `prefs.ts`). The namespace default stays `any`; this is the accurate shape
   * for the keys actually touched.
   */
  export interface Settings {
    get_strv(key: string): string[];
    get_boolean(key: string): boolean;
    get_int(key: string): number;
    get_double(key: string): number;
    get_string(key: string): string;
    get_value(key: string): Variant | null;
    get_default_value(key: string): Variant;
    set_int(key: string, value: number): void;
    set_string(key: string, value: string): void;
    set_boolean(key: string, value: boolean): void;
    set_strv(key: string, value: string[]): void;
    set_value(key: string, value: Variant): void;
    list_keys(): string[];
    connect(signal: string, callback: () => void): number;
    disconnect(id: number): void;
    bind(key: string, target: unknown, property: string, flags: number): void;
    readonly settings_schema: SettingsSchema;
  }

  /** A settings schema (`Gio.SettingsSchema`), read for a key's value type. */
  export interface SettingsSchema {
    get_key(name: string): SettingsSchemaKey;
  }

  /** One settings key (`Gio.SettingsSchemaKey`). */
  export interface SettingsSchemaKey {
    get_value_type(): VariantType;
  }

  /** A `GLib.VariantType`, read only for its type string. */
  export interface VariantType {
    dup_string?(): string;
  }

  /**
   * A `GLib.Variant` as read by the settings bridge: `unpack()`/`unpack` of the
   * value, and its type string for reconciling a write against the schema.
   */
  export interface Variant {
    unpack(): unknown;
    recursiveUnpack?(): unknown;
    get_type_string(): string;
  }

  /** A `Gio.FileInfo`, read only for the stat fields version detection needs. */
  export interface FileInfo {
    get_attribute_uint64(name: string): number;
    get_symlink_target(): string | null;
  }

  /** A wrapped D-Bus object (`Gio.DBusExportedObject`), exported and unexported. */
  export interface DBusExportedObject {
    export(bus: unknown, path: string): void;
    unexport(): void;
  }

  /** One installed application (`Gio.AppInfo`), as read by the app picker. */
  export interface AppInfo {
    should_show?(): boolean;
    get_id?(): string | null;
    get_startup_wm_class?(): string | null;
    get_display_name?(): string | null;
    get_name?(): string | null;
    get_icon?(): unknown | null;
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

  /**
   * A Mutter window (`Meta.Window`): the full surface the adapters read and
   * drive (host, surface, tracked-window, appidentity, tiling, session). The
   * namespace default stays `any`; this is the accurate shape for call sites
   * that have been typed.
   */
  export interface MetaWindow {
    get_id(): number;
    get_title(): string | null;
    get_wm_class(): string | null;
    get_pid(): number;
    get_sandboxed_app_id?(): string | null;
    get_gtk_application_id?(): string | null;
    get_stable_sequence?(): number;
    get_frame_rect(): MetaRectangle;
    get_monitor(): number;
    get_workspace(): MetaWorkspace | null;
    get_transient_for(): MetaWindow | null;
    /** GNOME 50 leads with a boolean flag, older versions do not. */
    get_min_size(): Array<number | boolean>;
    get_max_size(): Array<number | boolean>;
    get_window_type(): number;
    is_on_all_workspaces(): boolean;
    get_maximized(): number;
    get_maximize_flags?(): number;
    is_attached_dialog?(): boolean;
    is_skip_taskbar?(): boolean;
    is_override_redirect?(): boolean;
    get_compositor_private(): import('gi://Clutter').ClutterActor | null;
    minimized: boolean;
    is_above(): boolean;
    is_fullscreen(): boolean;
    make_above(): void;
    unmake_above(): void;
    stick(): void;
    unstick(): void;
    activate(time: number): void;
    raise(): void;
    delete(time: number): void;
    move_to_monitor(monitor: number): void;
    move_resize_frame(userOp: boolean, x: number, y: number, width: number, height: number): void;
    change_workspace_by_index(index: number, create: boolean): void;
    maximize(): void;
    unmaximize(): void;
    minimize(): void;
    unminimize(): void;
    make_fullscreen(): void;
    unmake_fullscreen(): void;
    connect(signal: string, callback: (...args: unknown[]) => void): number;
    disconnect(id: number): void;
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

  /**
   * The `St.Settings` surface `timing.ts` reads. St settings expose dynamic
   * properties by name (`enable_animations`, `slow_down_factor`,
   * `reduced_motion`, ...), hence the index signature; the named members are
   * the ones connected to directly.
   */
  export interface Settings {
    [property: string]: unknown;
    connect(signal: string, callback: () => void): number;
    disconnect(id: number): void;
    find_property(name: string): unknown;
  }
}
declare module 'gi://Clutter' {
  const Clutter: any;
  export default Clutter;
  /** A `Clutter.Actor` (including a window actor), as read by the animator. */
  export interface ClutterActor {
    get_transformed_position(): [number, number];
    get_stage(): unknown | null;
  }
  /** A `Clutter.Timeline`, driven by the frame animator. */
  export interface ClutterTimeline {
    connect(signal: 'new-frame', callback: (timeline: ClutterTimeline, msec: number) => void): number;
    connect(signal: 'completed', callback: () => void): number;
    start(): void;
    stop(): void;
  }
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

  /**
   * The `Gtk` surface the preferences UI touches (`prefs.ts`). The namespace
   * default stays `any` so the other adapters keep compiling against the broad
   * declarations; these named interfaces are the accurate shapes for call sites
   * that have been typed.
   */

  /** A widget (`Gtk.Widget`), as far as the preferences UI reads it. */
  export interface GtkWidget {
    visible: boolean;
    add_css_class(name: string): void;
    connect(signal: string, callback: () => void): number;
    get_children(): GtkWidget[];
  }

  /** An image (`Gtk.Image`), used for icons and check marks. */
  export interface GtkImage extends GtkWidget {}

  /** A button (`Gtk.Button`). */
  export interface GtkButton extends GtkWidget {}

  /** A label (`Gtk.Label`). */
  export interface GtkLabel extends GtkWidget {
    label: string | null;
    xalign: number;
  }

  /** A toggle switch (`Gtk.Switch`). */
  export interface GtkSwitch extends GtkWidget {
    active: boolean;
  }

  /** A box container (`Gtk.Box`). */
  export interface GtkBox extends GtkWidget {
    append(child: GtkWidget): void;
  }

  /** A search entry (`Gtk.SearchEntry`). */
  export interface GtkSearchEntry extends GtkWidget {
    text: string;
  }

  /** A scrolled window (`Gtk.ScrolledWindow`). */
  export interface GtkScrolledWindow extends GtkWidget {
    set_child(child: GtkWidget): void;
  }

  /** A popover (`Gtk.Popover`). */
  export interface GtkPopover extends GtkWidget {
    set_child(child: GtkWidget): void;
  }

  /** A menu button (`Gtk.MenuButton`), whose `popover` is assigned directly. */
  export interface GtkMenuButton extends GtkWidget {
    popover: GtkPopover;
  }

  /** One row of a `Gtk.ListBox`. */
  export interface GtkListBoxRow extends GtkWidget {
    set_child(child: GtkWidget): void;
    get_child(): GtkWidget | null;
  }

  /** A list box (`Gtk.ListBox`), including its two signal shapes. */
  export interface GtkListBox extends GtkWidget {
    /** Children may be plain widgets or `Adw` rows. */
    append(child: unknown): void;
    remove_all(): void;
    /** Test hook: `A140` tells the rule editor from a plain row set. */
    adrtRulesEditor?: boolean;
    set_filter_func(filter: (row: GtkListBoxRow) => boolean): void;
    connect(signal: 'row-activated', callback: (list: GtkListBox, row: GtkListBoxRow) => void): number;
    connect(signal: string, callback: () => void): number;
  }
}
declare module 'gi://Adw' {
  const Adw: any;
  export default Adw;

  /**
   * The `Adw` surface the preferences UI touches (`prefs.ts`). The namespace
   * default stays `any`; these named interfaces are the accurate shapes for the
   * rows and containers the file has been typed against.
   */

  /** The common row surface (`Adw.PreferencesRow` and subclasses). */
  export interface AdwPreferencesRow {
    title: string;
    subtitle: string;
    add_prefix(widget: unknown): void;
    add_suffix(widget: unknown): void;
    connect(signal: string, callback: () => void): number;
    /** Test hook: `A140` reads this to prove every user-facing key has a row. */
    adrtKey?: string;
  }

  /** An action row (`Adw.ActionRow`). */
  export interface AdwActionRow extends AdwPreferencesRow {}

  /** A switch row (`Adw.SwitchRow`). */
  export interface AdwSwitchRow extends AdwPreferencesRow {
    active: boolean;
  }

  /** A spin row (`Adw.SpinRow`). */
  export interface AdwSpinRow extends AdwPreferencesRow {
    value: number;
  }

  /** A combo row (`Adw.ComboRow`). */
  export interface AdwComboRow extends AdwPreferencesRow {
    selected: number;
  }

  /** An entry row (`Adw.EntryRow`). */
  export interface AdwEntryRow extends AdwPreferencesRow {
    text: string;
  }

  /** An expander row (`Adw.ExpanderRow`), the app-picker container. */
  export interface AdwExpanderRow extends AdwPreferencesRow {
    add_row(row: unknown): void;
    remove(child: unknown): void;
    /** Test hook: `A140` asserts a picker is used for the app-list keys. */
    adrtPicker?: boolean;
  }

  /** A preferences group (`Adw.PreferencesGroup`). */
  export interface AdwPreferencesGroup {
    add(child: unknown): void;
    remove(child: unknown): void;
    title: string;
    description: string;
  }

  /** A preferences page (`Adw.PreferencesPage`). */
  export interface AdwPreferencesPage {
    add(group: AdwPreferencesGroup): void;
  }

  /** The preferences window (`Adw.PreferencesWindow`). */
  export interface AdwPreferencesWindow {
    add(page: AdwPreferencesPage): void;
  }
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
  import type { Settings as GioSettings } from 'gi://Gio';

  /** The `ExtensionPreferences` base the prefs process provides. */
  export interface ExtensionPreferences {
    getSettings(): GioSettings;
    metadata: Record<string, string>;
  }

  export const ExtensionPreferences: { new (): ExtensionPreferences };
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
