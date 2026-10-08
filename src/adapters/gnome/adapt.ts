// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Shared JSON-on-disk persistence helpers: the data directory, atomic writes
 * and text/JSON reads. The stores that own each file (journal, history,
 * recorder, registry) live in their own modules.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export function dataDir(): string {
  const dir = `${GLib.get_user_data_dir()}/adrt`;
  GLib.mkdir_with_parents(dir, 0o755);
  return dir;
}

export function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  GLib.file_set_contents(tmp, text);
  Gio.File.new_for_path(tmp).move(Gio.File.new_for_path(path), Gio.FileCopyFlags.OVERWRITE, null, null);
}

export function readText(path: string): string | null {
  let contents: Uint8Array;
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) return null;
    contents = bytes;
  } catch {
    // A missing file is a normal state for the first history entry / state.
    return null;
  }
  let out = '';
  for (const byte of contents) out += String.fromCharCode(byte);
  return out;
}

export function readJson(path: string): unknown {
  const text = readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`[adrt] failed to parse ${path}: ${(e as Error).message}`);
    return null;
  }
}
