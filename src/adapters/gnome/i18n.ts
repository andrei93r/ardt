// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Gettext wiring for the GNOME adapter (§19.1).
 *
 * `packages/gnome/metadata.json` already declares `gettext-domain: adrt`, so
 * GNOME Shell binds that domain for the running extension and its preferences.
 * This module exists because the prefs layout is *module-scope* data: it is
 * evaluated while `prefs.js` is imported, before the `ExtensionPreferences`
 * instance exists, so it cannot use `this.gettext()`.
 *
 * It resolves the extension's own `locale/` directory from this module's URL
 * (the same directory `ExtensionBase.initTranslations()` would use) and binds
 * the domain with GJS's `gettext` module. `_(...)` then translates through
 * `dgettext`, and degrades to the English source string when no catalogue is
 * installed — which is always the case until a translator adds a `.po`.
 */

import GLib from 'gi://GLib';
import { bindtextdomain, dgettext } from 'gettext';

/** The domain declared in `metadata.json` (`gettext-domain`). */
export const GETTEXT_DOMAIN = 'adrt';

let localeDir: string | null = null;

/** The extension's `locale/` directory, or `null` when there is none. */
function resolveLocaleDir(): string | null {
  try {
    // dist/adapters/gnome/i18n.js -> dist/ (the extension root).
    const [file] = GLib.filename_from_uri(import.meta.url);
    if (typeof file !== 'string' || file.length === 0) return null;
    let dir = GLib.path_get_dirname(file);
    for (let i = 0; i < 2; i++) dir = GLib.path_get_dirname(dir);
    const candidate = GLib.build_filenamev([dir, 'locale']);
    return GLib.file_test(candidate, GLib.FileTest.IS_DIR) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Bind the domain to the extension's `locale/` directory. Idempotent; call it
 * once at start-up (importing this module already does).
 */
export function loadTranslations(): string | null {
  if (localeDir === null) {
    localeDir = resolveLocaleDir();
    if (localeDir !== null) bindtextdomain(GETTEXT_DOMAIN, localeDir);
  }
  return localeDir;
}

/** Translate a user-facing string. */
export function _(msgid: string): string {
  try {
    return dgettext(GETTEXT_DOMAIN, msgid);
  } catch {
    return msgid;
  }
}

loadTranslations();
