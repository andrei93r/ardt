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
}
declare module 'gi://St' {
  const St: any;
  export default St;
}
declare module 'gi://Clutter' {
  const Clutter: any;
  export default Clutter;
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
  export const messageTray: any;
  export function notify(title: string, message: string): void;
  export function pushModal(actor: any): void;
  export function popModal(actor: any): void;
}

declare module 'resource:///org/gnome/shell/ui/panelMenu.js' {
  export const Button: any;
}

declare module 'resource:///org/gnome/shell/ui/popupMenu.js' {
  export const PopupMenuItem: any;
  export const PopupSeparatorMenuItem: any;
  export const PopupSwitchMenuItem: any;
}

declare module 'resource:///org/gnome/shell/ui/quickSettings.js' {
  export const QuickSettings: any;
}
