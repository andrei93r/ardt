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

declare const global: GlobalObject;

declare const TextDecoder: {
  new (label?: string, options?: unknown): { decode(input?: Uint8Array): string };
};
declare const TextEncoder: {
  new (): { encode(input?: string): Uint8Array };
};

/** A compositor window actor, read only for the Meta window it wraps. */
interface GlobalWindowActor {
  meta_window: import('gi://Meta').MetaWindow;
}

/** A `Meta.Later` list, scheduled through `Meta.Compositor`. */
interface GlobalLaters {
  add(type: unknown, callback: () => boolean): void;
}

/** The Mutter compositor (`global.compositor`). */
interface GlobalCompositor {
  get_laters(): GlobalLaters;
}

/** The Mutter backend (`global.backend`), including the monitor manager. */
interface GlobalBackend {
  get_monitor_manager(): import('gi://Meta').MetaMonitorManager;
  get_default_seat?(): import('gi://Clutter').Seat | null;
  get_cursor_renderer?(): unknown;
  get_cursor_tracker?(): unknown;
}

/** The stage's Clutter context (`global.stage.context`). */
interface GlobalContext {
  get_backend?(): GlobalBackend | null;
}

/** The Clutter stage (`global.stage`), as read across the adapters. */
interface GlobalStage {
  width: number;
  height: number;
  context?: GlobalContext;
  get_context?(): GlobalContext;
  get_key_focus?(): unknown;
  set_key_focus(actor: unknown): void;
  add_action(action: unknown): void;
  remove_action(action: unknown): void;
  connect<A extends unknown[]>(signal: string, callback: (...args: A) => unknown): number;
  disconnect(id: number): void;
  get_view?(): import('gi://Clutter').ClutterStageView | null;
  get_frame_clock?(): import('gi://Clutter').ClutterFrameClock | null;
}

/** The Mutter window manager (`global.window_manager`), read only as a signal source. */
interface GlobalWindowManager {}

/** The GJS global object (`global`), as read by the adapters. */
interface GlobalObject {
  readonly backend: GlobalBackend;
  readonly compositor: GlobalCompositor;
  readonly display: import('gi://Meta').MetaDisplay;
  readonly stage: GlobalStage;
  readonly window_manager: GlobalWindowManager;
  readonly workspace_manager: import('gi://Meta').MetaWorkspaceManager;
  get_current_time(): number;
  /** Current pointer state: `[x, y, modifiers]`. */
  get_pointer(): [number, number, number];
  get_window_actors(): GlobalWindowActor[];
}

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
  const GLib: GLibNamespace;
  export default GLib;

  /**
   * The `GLib` surface the adapters read: main-loop sources and priorities,
   * path/file helpers, environment and monotonic time, plus the `Variant`
   * constructors used by the settings bridge.
   */
  export interface GLibNamespace {
    readonly PRIORITY_DEFAULT: number;
    readonly PRIORITY_DEFAULT_IDLE: number;
    readonly PRIORITY_LOW: number;
    readonly SOURCE_REMOVE: boolean;
    readonly SOURCE_CONTINUE: boolean;
    getenv(variable: string): string | null;
    get_monotonic_time(): number;
    get_user_data_dir(): string;
    idle_add(priority: number, callback: () => number | boolean): number;
    timeout_add(priority: number, interval: number, callback: () => number | boolean): number;
    source_remove(tag: number): boolean;
    mkdir_with_parents(pathname: string, mode: number): number;
    unlink(filename: string): number;
    file_test(filename: string, test: number): boolean;
    file_get_contents(filename: string): [boolean, Uint8Array];
    file_set_contents(filename: string, contents: string): boolean;
    filename_from_uri(uri: string): [string, string];
    path_get_dirname(fileName: string): string;
    build_filenamev(args: string[]): string;
    readonly FileTest: {
      readonly IS_DIR: number;
    };
    /** `GLib.SeekType`, for resuming a stream at a byte offset. */
    readonly SeekType: {
      readonly SET: number;
    };
    /** `GLib.Variant` constructor and static parser. */
    readonly Variant: {
      new (signature: string, value: unknown): Variant;
      parse(type: VariantType, text: string, ...rest: unknown[]): Variant;
    };
    /** `GLib.VariantType` constructor. */
    readonly VariantType: {
      new (signature: string): VariantType;
    };
  }

  /** A `GLib.Variant` as read by the settings bridge and variant helpers. */
  export interface Variant {
    unpack(): unknown;
    recursiveUnpack?(): unknown;
    deepUnpack(): unknown;
    get_type_string(): string;
  }

  /** A `GLib.VariantType`, read only for its type string. */
  export interface VariantType {
    dup_string?(): string;
  }
}
declare module 'gi://Gio' {
  const Gio: GioNamespace;
  export default Gio;

  /**
   * The static members of the `Gio` namespace the adapters read: settings,
   * the file/stream/launcher helpers and the D-Bus entry points. Named types
   * (`Settings`, `File`, `FileInfo`, ...) are exported separately.
   */
  export interface GioNamespace {
    /** `Gio.Settings` class (`new Gio.Settings({ schema_id })`). */
    readonly Settings: {
      new (properties?: Record<string, unknown>): Settings;
      sync(): void;
    };
    /** Binding flags accepted by `Settings.bind` (`Gio.SettingsBindFlags`). */
    readonly SettingsBindFlags: {
      readonly DEFAULT: number;
    };
    /** Installed applications (`Gio.AppInfo`). */
    readonly AppInfo: {
      get_all(): AppInfo[];
    };
    /** Exported D-Bus object wrapper (`Gio.DBusExportedObject`). */
    readonly DBusExportedObject: {
      wrapJSObject(xml: string, handlers: unknown): DBusExportedObject;
    };
    /** The session/bus entry point (`Gio.DBus`). */
    readonly DBus: {
      readonly session: DBusConnection;
    };
    /** Bus-type enum (`Gio.BusType`). */
    readonly BusType: {
      readonly SESSION: number;
    };
    /** Name-owner flags (`Gio.BusNameOwnerFlags`). */
    readonly BusNameOwnerFlags: {
      readonly NONE: number;
    };
    /** D-Bus call flags (`Gio.DBusCallFlags`). */
    readonly DBusCallFlags: {
      readonly NONE: number;
    };
    bus_own_name(
      busType: number,
      name: string,
      flags: number,
      busAcquired: unknown,
      nameAcquired: unknown,
      nameLost: unknown,
    ): number;
    bus_unown_name(ownerId: number): void;
    /** `Gio.File` class, constructed by path. */
    readonly File: {
      new_for_path(path: string): File;
    };
    /** Copy flags (`Gio.FileCopyFlags`). */
    readonly FileCopyFlags: {
      readonly OVERWRITE: number;
    };
    /** Create flags (`Gio.FileCreateFlags`). */
    readonly FileCreateFlags: {
      readonly NONE: number;
      /** Overwrite an existing destination file. */
      readonly REPLACE_DESTINATION: number;
    };
    /** Monitor flags (`Gio.FileMonitorFlags`). */
    readonly FileMonitorFlags: {
      readonly NONE: number;
    };
    /** Query flags (`Gio.FileQueryInfoFlags`). */
    readonly FileQueryInfoFlags: {
      readonly NONE: number;
      readonly NOFOLLOW_SYMLINKS: number;
    };
    /** Subprocess flags (`Gio.SubprocessFlags`). */
    readonly SubprocessFlags: {
      readonly NONE: number;
    };
    /** `Gio.SubprocessLauncher` class, spawned with `new()`/`spawnv()`. */
    readonly SubprocessLauncher: {
      'new'(flags: number): SubprocessLauncher;
    };
    /** `Gio.ZlibCompressor` constructor, used for registry backups. */
    readonly ZlibCompressor: {
      new (properties: { format: number; level: number }): ZlibCompressor;
    };
    /** Compression formats (`Gio.ZlibCompressorFormat`). */
    readonly ZlibCompressorFormat: {
      readonly GZIP: number;
    };
    /** `Gio.ConverterOutputStream`: a stream through a converter (gzip). */
    readonly ConverterOutputStream: {
      'new'(base: FileOutputStream, converter: unknown): ConverterOutputStream;
    };
  }

  /**
   * The `Gio.Settings` surface the adapters read and write (see `host.ts`,
   * `prefs.ts`). This is the accurate shape for the keys actually touched.
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
    deepUnpack(): unknown;
    get_type_string(): string;
  }

  /** A `Gio.FileInfo`, read for stat fields and directory enumeration. */
  export interface FileInfo {
    get_attribute_uint64(name: string): number;
    get_symlink_target(): string | null;
    get_name(): string;
    get_size(): number;
    get_modification_date_time(): DateTime | null;
  }

  /** A `GLib.DateTime`, read only for its Unix-seconds reading. */
  export interface DateTime {
    to_unix(): number;
  }

  /** A `Gio.File`: existence, stat, create/delete, move, monitor, streams. */
  export interface File {
    query_exists(cancellable: unknown): boolean;
    query_info(attributes: string, flags: number, cancellable: unknown): FileInfo;
    create(flags: number, cancellable: unknown): unknown;
    delete(cancellable: unknown): boolean;
    move(destination: File, flags: number, cancellable: unknown, progress: unknown): boolean;
    monitor_file(flags: number, cancellable: unknown): FileMonitor;
    enumerate_children(attributes: string, flags: number, cancellable: unknown): FileEnumerator;
    append_to(flags: number, cancellable: unknown): FileOutputStream;
    replace(
      etag: string | null,
      makeBackup: boolean,
      flags: number,
      cancellable: unknown,
    ): FileOutputStream;
    read(cancellable: unknown): FileInputStream;
    get_path(): string;
    load_contents(cancellable: Cancellable | null): [boolean, Uint8Array, string];
    replace_contents(
      contents: Uint8Array,
      etag: string | null,
      makeBackup: boolean,
      flags: number,
      cancellable: Cancellable | null,
    ): [boolean, string];
  }

  /** A `Gio.Cancellable`; the preference file dialogs pass `null`. */
  export interface Cancellable {}

  /** A `Gio.AsyncResult`, handed to a `*_finish` call. */
  export interface AsyncResult {}

  /** A directory enumerator (`Gio.FileEnumerator`). */
  export interface FileEnumerator {
    next_file(cancellable: unknown): FileInfo | null;
  }

  /** An append stream (`Gio.FileOutputStream`). */
  export interface FileOutputStream {
    write_all(bytes: Uint8Array, cancellable: unknown): boolean;
    close(cancellable: unknown): boolean;
  }

  /** A read stream (`Gio.FileInputStream`), read in bounded chunks. */
  export interface FileInputStream {
    read_bytes(count: number, cancellable: unknown): Bytes;
    seek(offset: number, type: number, cancellable: unknown): boolean;
    close(cancellable: unknown): boolean;
  }

  /** A buffer of bytes (`GLib.Bytes`), as returned by `read_bytes`. */
  export interface Bytes {
    get_size(): number;
    toArray(): Uint8Array;
  }

  /** A gzip filter stream (`Gio.ConverterOutputStream`). */
  export interface ConverterOutputStream {
    write_all(bytes: Uint8Array, cancellable: unknown): boolean;
    close(cancellable: unknown): boolean;
  }

  /** A gzip converter (`Gio.ZlibCompressor`), passed to the output filter. */
  export interface ZlibCompressor {}

  /** A file monitor (`Gio.FileMonitor`), read and cancelled by the tail. */
  export interface FileMonitor {
    connect(signal: string, callback: () => void): number;
    cancel(): void;
  }

  /** A spawned process (`Gio.Subprocess`), read for its identifier. */
  export interface Subprocess {
    get_identifier(): string | null;
  }

  /** A subprocess launcher (`Gio.SubprocessLauncher`). */
  export interface SubprocessLauncher {
    setenv(variable: string, value: string, overwrite: boolean): void;
    spawnv(argv: string[]): Subprocess;
  }

  /** The D-Bus connection (`Gio.DBusConnection`), read for the sync call. */
  export interface DBusConnection {
    call_sync(
      busName: string,
      objectPath: string,
      interfaceName: string,
      methodName: string,
      parameters: unknown,
      replyType: unknown,
      flags: number,
      timeoutMsec: number,
      cancellable: unknown,
    ): Variant;
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
  /** The `GioUnix` namespace, currently unused by the adapters. */
  export interface GioUnixNamespace {}
  const GioUnix: GioUnixNamespace;
  export default GioUnix;
}
declare module 'gi://GObject' {
  /** The `GObject` namespace, currently unused by the adapters. */
  export interface GObjectNamespace {}
  const GObject: GObjectNamespace;
  export default GObject;
}
declare module 'gi://Meta' {
  const Meta: MetaNamespace;
  export default Meta;

  /**
   * The static members of the `Meta` namespace the adapters read: flag enums,
   * the later-scheduling kinds and one shell capability probe. Named types
   * (`MetaWindow`, `MetaDisplay`, ...) are imported explicitly by consumers.
   */
  export interface MetaNamespace {
    /** Window-type enum (`Meta.WindowType`). */
    readonly WindowType: {
      readonly NORMAL: number;
      readonly DIALOG: number;
      readonly MODAL_DIALOG: number;
      readonly UTILITY: number;
      readonly TOOLBAR: number;
      readonly MENU: number;
      readonly DROPDOWN_MENU: number;
      readonly POPUP_MENU: number;
      readonly TOOLTIP: number;
      readonly NOTIFICATION: number;
      readonly COMBO: number;
      readonly DND: number;
    };
    /** Maximize flags (`Meta.MaximizeFlags`). */
    readonly MaximizeFlags: {
      readonly HORIZONTAL: number;
      readonly VERTICAL: number;
    };
    /** Keybinding flags accepted by `wm.addKeybinding` (`Meta.KeyBindingFlags`). */
    readonly KeyBindingFlags: {
      readonly NONE: number;
    };
    /** Workspace-layout corner enum (`Meta.DisplayCorner`). */
    readonly DisplayCorner: {
      readonly TOPLEFT: number;
    };
    /** Grab-operation enum (`Meta.GrabOp`), read for the window-grab base bit. */
    readonly GrabOp?: {
      readonly WINDOW_BASE?: number;
    };
    /** The compositor later-scheduling kinds (`Meta.LaterType`), by name. */
    readonly LaterType?: Record<string, unknown>;
    /** Shell capability probe: is this a Wayland session? */
    is_wayland_compositor?(): boolean;
  }

  /**
   * Accurate shapes for the Mutter surface `host.ts` reads. The namespace
   * default is the typed `MetaNamespace`; these are the object types for call
   * sites that import them explicitly.
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
    list_windows(): MetaWindow[];
    activate(time: number): void;
  }

  /** A Mutter workspace manager (`Meta.WorkspaceManager`). */
  export interface MetaWorkspaceManager {
    /** The current layout's row count; -1 means vertical workspaces. */
    readonly layout_rows: number;
    get_active_workspace(): MetaWorkspace;
    get_active_workspace_index(): number;
    get_n_workspaces(): number;
    get_workspace_by_index(index: number): MetaWorkspace | null;
    append_new_workspace(create: boolean, time: number): MetaWorkspace;
    remove_workspace(workspace: MetaWorkspace, time: number): void;
    reorder_workspace(workspace: MetaWorkspace, newIndex: number): void;
    override_workspace_layout(corner: number, vertical: boolean, nRows: number, nColumns: number): void;
    connect<A extends unknown[]>(signal: string, callback: (...args: A) => unknown): number;
    disconnect(id: number): void;
  }

  /** A Mutter display (`Meta.Display`), as read by `host.ts`. */
  export interface MetaDisplay {
    list_all_windows(): MetaWindow[];
    get_focus_window(): MetaWindow | null;
    get_grab_op?(): unknown;
    is_grabbed?(): unknown;
    warp_pointer?(x: number, y: number): void;
    /** Window actors in compositor stacking order, bottom-to-top. */
    sort_windows_by_stacking<T>(windows: T[]): T[];
    connect<A extends unknown[]>(signal: string, callback: (...args: A) => unknown): number;
    disconnect(id: number): void;
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
    connect(signal: string, callback: (...args: never[]) => void): number;
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
  const St: StNamespace;
  export default St;

  /**
   * The `St` surface the chrome and timing adapters read: widget constructors
   * and the live settings singleton. The structural views in `indicator.ts` and
   * `recording-prompt.ts` are supersets of `Widget`, so the constructors below
   * satisfy them.
   */
  export interface StNamespace {
    readonly Widget: {
      new (properties?: Record<string, unknown>): Widget;
    };
    readonly BoxLayout: {
      new (properties?: Record<string, unknown>): BoxLayout;
    };
    readonly Entry: {
      new (properties?: Record<string, unknown>): Entry;
    };
    readonly Label: {
      new (properties?: Record<string, unknown>): Label;
    };
    readonly Button: {
      new (properties?: Record<string, unknown>): Button;
    };
    /** Reduced-motion enum (`St.ReducedMotion`). */
    readonly ReducedMotion: {
      readonly NO: number;
      readonly REDUCE: number;
      readonly DEFAULT: number;
    };
    /** The live St settings singleton (`St.Settings.get()`). */
    readonly Settings: {
      get(): Settings;
    };
  }

  /** A `St.Widget`, as read for layout, styling, visibility and transitions. */
  export interface Widget {
    visible: boolean;
    opacity: number;
    reactive?: boolean;
    can_focus?: boolean;
    spacing?: number;
    connect<A extends unknown[]>(signal: string, callback: (...args: A) => unknown): number;
    disconnect(id: number): void;
    destroy(): void;
    show(): void;
    hide(): void;
    set_position(x: number, y: number): void;
    set_size(width: number, height: number): void;
    set_style(style: string): void;
    ease(params: unknown): void;
    remove_all_transitions(): void;
    get_parent(): Container | null;
    add_child(child: unknown): void;
    set_x_align(align: unknown): void;
    get_transformed_position(): [number, number];
    get_transformed_size(): [number, number];
    get_preferred_width(forHeight: number): [number, number];
    get_preferred_height(forWidth: number): [number, number];
    get_children(): Widget[];
  }

  /** A container parent (`layoutManager.uiGroup`), read for child ordering. */
  export interface Container {
    set_child_below_sibling(child: Widget, sibling: unknown): void;
    get_children(): Widget[];
  }

  /** A `St.BoxLayout`, the layout container. */
  export interface BoxLayout extends Widget {}

  /** A `St.Label`. */
  export interface Label extends Widget {
    text?: string;
  }

  /** A focusable `St.Entry` and the `Clutter.Text` it wraps. */
  export interface Entry extends Widget {
    set_text(text: string): void;
    get_text?(): string;
    clutter_text?: {
      connect<A extends unknown[]>(signal: string, callback: (...args: A) => unknown): number;
      has_key_focus?(): boolean;
    };
    has_key_focus?(): boolean;
    grab_key_focus?(): void;
  }

  /** A `St.Button`, whose `clicked` emission is driven programmatically. */
  export interface Button extends Widget {
    emit(signal: string, ...args: unknown[]): unknown;
  }

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
  const Clutter: ClutterNamespace;
  export default Clutter;

  /**
   * The `Clutter` static surface the adapters read: enums, event-propagation
   * constants, the backend/event-time probes and the gesture constructors. The
   * structural views in `compat.ts` and `gesture-input.ts` are satisfied by the
   * named types below.
   */
  export interface ClutterNamespace {
    readonly ActorAlign: {
      readonly END: number;
    };
    readonly AnimationMode: {
      readonly EASE_OUT_QUAD: number;
      readonly EASE_IN_OUT_SINE: number;
    };
    readonly ButtonState: {
      readonly PRESSED: number;
      readonly RELEASED: number;
    };
    readonly KeyState: {
      readonly PRESSED: number;
      readonly RELEASED: number;
    };
    readonly InputDeviceType: {
      readonly POINTER_DEVICE: number;
      readonly KEYBOARD_DEVICE: number;
    };
    readonly ModifierType: {
      readonly BUTTON1_MASK: number;
    };
    /** Touchpad event-type enum, probed before use. */
    readonly EventType?: {
      readonly TOUCHPAD_SWIPE?: number;
      readonly TOUCHPAD_PINCH?: number;
    };
    /** Touchpad-gesture phase enum, probed before use. */
    readonly TouchpadGesturePhase?: {
      readonly BEGIN?: unknown;
      readonly UPDATE?: unknown;
      readonly END?: unknown;
      readonly CANCEL?: unknown;
    };
    readonly EVENT_PROPAGATE: boolean;
    readonly EVENT_STOP: boolean;
    readonly KEY_Escape: number;
    /** The modern pan-gesture recognizer (`Clutter.PanGesture`). */
    readonly PanGesture: new (params: {
      min_n_points: number;
      max_n_points: number;
      pan_axis: number;
    }) => PanGesture;
    /** The legacy pre-45 gesture action (`Clutter.GestureAction`). */
    readonly GestureAction: new () => GestureAction;
    /** A `Clutter.Timeline`, driven by the frame animator. */
    readonly Timeline: {
      new (properties?: Record<string, unknown>): ClutterTimeline;
    };
    get_current_event_time(): number;
    get_default_backend?(): Backend | null;
  }

  /** A `Clutter.Actor` (including a window actor), as read by the animator. */
  export interface ClutterActor {
    get_transformed_position(): [number, number];
    get_stage(): unknown | null;
  }

  /** A `Clutter.Backend`: seat plus cursor renderer/tracker probes. */
  export interface Backend {
    get_default_seat?(): Seat | null;
    get_cursor_renderer?(): unknown;
    get_cursor_tracker?(): unknown;
  }

  /** A `Clutter.Seat`, read for pointer warp and virtual-device creation. */
  export interface Seat {
    warp_pointer?(x: number, y: number): void;
    create_virtual_device?(type: number): unknown;
  }

  /** A `Clutter.PanGesture`, read for its point count and delta. */
  export interface PanGesture {
    connect<A extends unknown[]>(signal: string, callback: (...args: A) => unknown): number;
    disconnect(id: number): void;
    get_n_points?(): number;
    get_delta_abs?(): { get_x?(): number; x?: number; get_y?(): number; y?: number };
  }

  /** A legacy `Clutter.GestureAction`. */
  export interface GestureAction {
    connect<A extends unknown[]>(signal: string, callback: (...args: A) => unknown): number;
    disconnect(id: number): void;
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
  const Shell: ShellNamespace;
  export default Shell;

  /**
   * The `Shell` static surface the adapters read: keybinding modes, the window
   * tracker and the modal dialog used by the recording prompt.
   */
  export interface ShellNamespace {
    readonly ActionMode: {
      readonly NORMAL: number;
    };
    readonly WindowTracker: {
      get_default(): WindowTracker;
    };
    readonly ModalDialog: {
      new (properties?: Record<string, unknown>): ModalDialog;
    };
  }

  /** A `Shell.App`, read only for its desktop id. */
  export interface App {
    get_id?(): string | null;
  }

  /** The shell's window tracker (`Shell.WindowTracker`). */
  export interface WindowTracker {
    get_window_app(win: unknown): App | null;
  }

  /** One entry of `Shell.ModalDialog.setButtons`. */
  export interface ModalDialogButton {
    label: string;
    action: () => void;
    key?: unknown;
    default?: boolean;
  }

  /** A `Shell.ModalDialog`, built by the recording prompt. */
  export interface ModalDialog {
    contentLayout: import('gi://St').Widget;
    setButtons(buttons: ModalDialogButton[]): void;
    open(): void;
    close?(): void;
    destroy(): void;
  }
}
declare module 'gi://GDesktopEnums' {
  /** The `GDesktopEnums` namespace, currently unused by the adapters. */
  export interface GDesktopEnumsNamespace {}
  const GDesktopEnums: GDesktopEnumsNamespace;
  export default GDesktopEnums;
}
declare module 'gi://Gtk' {
  const Gtk: GtkNamespace;
  export default Gtk;

  /**
   * The `Gtk` constructors and enums the preferences UI touches (`prefs.ts`).
   * The named interfaces below are the accurate shapes for call sites that have
   * been typed.
   */
  export interface GtkNamespace {
    readonly Widget: {
      new (properties?: Record<string, unknown>): GtkWidget;
    };
    readonly Image: {
      new (properties?: Record<string, unknown>): GtkImage;
    };
    readonly Button: {
      new (properties?: Record<string, unknown>): GtkButton;
    };
    readonly Label: {
      new (properties?: Record<string, unknown>): GtkLabel;
    };
    readonly Switch: {
      new (properties?: Record<string, unknown>): GtkSwitch;
    };
    readonly Box: {
      new (properties?: Record<string, unknown>): GtkBox;
    };
    readonly SearchEntry: {
      new (properties?: Record<string, unknown>): GtkSearchEntry;
    };
    readonly ScrolledWindow: {
      new (properties?: Record<string, unknown>): GtkScrolledWindow;
    };
    readonly Popover: {
      new (properties?: Record<string, unknown>): GtkPopover;
    };
    readonly MenuButton: {
      new (properties?: Record<string, unknown>): GtkMenuButton;
    };
    /** `Gtk.FileDialog`, the GTK4 native file chooser used by `prefs.ts`. */
    readonly FileDialog: {
      new (properties?: Record<string, unknown>): GtkFileDialog;
    };
    readonly ListBoxRow: {
      new (properties?: Record<string, unknown>): GtkListBoxRow;
    };
    readonly ListBox: {
      new (properties?: Record<string, unknown>): GtkListBox;
    };
    readonly Adjustment: {
      new (properties?: Record<string, unknown>): GtkAdjustment;
    };
    /** `Gtk.StringList`, built through the static `new()` factory. */
    readonly StringList: {
      'new'(strings: string[]): GtkStringList;
    };
    readonly Align: {
      readonly CENTER: number;
    };
    readonly Orientation: {
      readonly VERTICAL: number;
      readonly HORIZONTAL: number;
    };
    readonly PolicyType: {
      readonly NEVER: number;
    };
    readonly SelectionMode: {
      readonly NONE: number;
    };
  }

  /** A `Gtk.Adjustment`, handed to an `Adw.SpinRow`. */
  export interface GtkAdjustment {}

  /** A `Gtk.StringList` model. */
  export interface GtkStringList {}

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

  /** A top-level window (`Gtk.Window`); the preferences window is one. */
  export interface GtkWindow {}

  /** A `Gtk.FileDialog`, used for the registry import/export choosers. */
  export interface GtkFileDialog {
    set_title(title: string): void;
    set_initial_name(name: string): void;
    save(
      parent: GtkWindow | null,
      cancellable: import('gi://Gio').Cancellable | null,
      callback: (source: GtkFileDialog, result: import('gi://Gio').AsyncResult) => void,
    ): void;
    save_finish(result: import('gi://Gio').AsyncResult): import('gi://Gio').File;
    open(
      parent: GtkWindow | null,
      cancellable: import('gi://Gio').Cancellable | null,
      callback: (source: GtkFileDialog, result: import('gi://Gio').AsyncResult) => void,
    ): void;
    open_finish(result: import('gi://Gio').AsyncResult): import('gi://Gio').File;
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
  const Adw: AdwNamespace;
  export default Adw;

  /**
   * The `Adw` constructors the preferences UI uses (`prefs.ts`). The named
   * interfaces below are the accurate shapes for the rows and containers.
   */
  export interface AdwNamespace {
    readonly PreferencesWindow: {
      new (properties?: Record<string, unknown>): AdwPreferencesWindow;
    };
    readonly PreferencesPage: {
      new (properties?: Record<string, unknown>): AdwPreferencesPage;
    };
    readonly PreferencesGroup: {
      new (properties?: Record<string, unknown>): AdwPreferencesGroup;
    };
    readonly ActionRow: {
      new (properties?: Record<string, unknown>): AdwActionRow;
    };
    readonly SwitchRow: {
      new (properties?: Record<string, unknown>): AdwSwitchRow;
    };
    readonly SpinRow: {
      new (properties?: Record<string, unknown>): AdwSpinRow;
    };
    readonly ComboRow: {
      new (properties?: Record<string, unknown>): AdwComboRow;
    };
    readonly EntryRow: {
      new (properties?: Record<string, unknown>): AdwEntryRow;
    };
    readonly ExpanderRow: {
      new (properties?: Record<string, unknown>): AdwExpanderRow;
    };
    /** `Adw.AlertDialog`, the confirmation and mode dialogs in `prefs.ts`. */
    readonly AlertDialog: {
      new (properties?: Record<string, unknown>): AdwAlertDialog;
    };
    /** Appearance of an alert-dialog response (`Adw.ResponseAppearance`). */
    readonly ResponseAppearance: {
      readonly DEFAULT: number;
      readonly SUGGESTED: number;
      readonly DESTRUCTIVE: number;
    };
  }

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
    tooltip_text: string;
  }

  /** An expander row (`Adw.ExpanderRow`), the app-picker container. */
  export interface AdwExpanderRow extends AdwPreferencesRow {
    add_row(row: unknown): void;
    remove(child: unknown): void;
    /** Test hook: `A140` asserts a picker is used for the app-list keys. */
    adrtPicker?: boolean;
  }

  /** An alert dialog (`Adw.AlertDialog`), shown and awaited through `choose`. */
  export interface AdwAlertDialog {
    set_heading(heading: string): void;
    set_body(body: string): void;
    add_response(id: string, label: string): void;
    set_response_appearance(id: string, appearance: number): void;
    set_default_response(id: string): void;
    set_close_response(id: string): void;
    choose(
      parent: import('gi://Gtk').GtkWindow | null,
      cancellable: import('gi://Gio').Cancellable | null,
      callback: (source: AdwAlertDialog, result: import('gi://Gio').AsyncResult) => void,
    ): void;
    choose_finish(result: import('gi://Gio').AsyncResult): string;
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
  /**
   * The `Extension` base class the adapter extends. Only the members the
   * adapter actually reads are declared.
   */
  export interface GjsExtension {
    /** Absolute path to the installed extension, set by the Shell. */
    path: string;
    getSettings(): import('gi://Gio').Settings;
    getMetadata(): { uuid: string; name?: string; [key: string]: unknown };
  }

  export const Extension: { new (...args: unknown[]): GjsExtension };
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
  import type { Widget as StWidget } from 'gi://St';
  import type { Settings as GioSettings } from 'gi://Gio';

  /** The shell layout manager (`Main.layoutManager`). */
  export interface LayoutManager {
    monitors: LayoutMonitor[];
    primaryIndex?: number;
    uiGroup: StWidget;
    addChrome(actor: unknown, params?: Record<string, unknown>): void;
    removeChrome(actor: unknown): void;
  }

  /** The workspaces overview (`Main.overview`). */
  export interface Overview {
    visible: boolean;
    toggle(): void;
    show(): void;
    hide(): void;
  }

  /** The session-mode controller (`Main.sessionMode`). */
  export interface SessionModeController {
    currentMode: string;
  }

  /** The shell window manager (`Main.wm`), as far as keybindings go. */
  export interface WindowManager {
    addKeybinding(
      name: string,
      settings: GioSettings,
      flags: number,
      modes: number,
      handler: (...args: unknown[]) => void,
    ): number;
    removeKeybinding(name: string): void;
  }

  /** The shell panel (`Main.panel`). */
  export interface Panel {}

  /** The notification tray (`Main.messageTray`), an St actor. */
  export interface MessageTray extends StWidget {}

  export const layoutManager: LayoutManager;
  export const overview: Overview;
  export const sessionMode: SessionModeController;
  export const wm: WindowManager;
  export const panel: Panel;
  export const stage: StWidget;
  export const uiGroup: StWidget;
  export const messageTray: MessageTray;

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
  export function pushModal(actor: unknown): boolean;
  export function popModal(actor: unknown): boolean;
}

declare module 'resource:///org/gnome/shell/ui/quickSettings.js' {
  /** The `QuickSettings` namespace, currently unused by the adapters. */
  export interface QuickSettingsNamespace {}
  export const QuickSettings: QuickSettingsNamespace;
}
