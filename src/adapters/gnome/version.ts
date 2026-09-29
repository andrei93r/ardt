// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * App version detection (§8). Adapter-layer, cached by pid + process start
 * time, pruned on the scan tick. Returns an opaque string; only equality
 * matters to callers.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const STABILITY_WINDOW_MS = 10 * 60 * 1000;
const SEMVER = /\d+\.\d+(?:\.\d+)?/;

interface CacheEntry {
  startTime: number;
  version: string;
}

interface HashEntry {
  mtime: number;
  hash: string;
}

function decode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function readFile(path: string): string | null {
  const [ok, contents] = GLib.file_get_contents(path);
  if (!ok) return null;
  return decode(contents);
}

function envValue(environ: string, key: string): string | null {
  for (const line of environ.split('\0')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    if (line.slice(0, eq) === key) return line.slice(eq + 1);
  }
  return null;
}

function base36(value: number): string {
  return Math.abs(Math.trunc(value)).toString(36);
}

export function semverFromTitle(title: string): string | null {
  const match = SEMVER.exec(title);
  return match === null ? null : match[0];
}

export class VersionDetector {
  private readonly cache = new Map<number, CacheEntry>();
  private readonly hashes = new Map<string, HashEntry>();

  /** Detect the version of the process that owns a window. */
  detect(win: any, title: string): string {
    const pid: number = win.get_pid();
    if (!Number.isInteger(pid) || pid <= 0) {
      return semverFromTitle(title) ?? '*';
    }
    const startTime = this.processStartTime(pid);
    const cached = this.cache.get(pid);
    if (cached !== undefined && cached.startTime === startTime) return cached.version;

    const version = this.compute(pid, title);
    this.cache.set(pid, { startTime, version });
    return version;
  }

  prune(livePids: ReadonlySet<number>): void {
    for (const pid of this.cache.keys()) {
      if (!livePids.has(pid)) this.cache.delete(pid);
    }
  }

  private compute(pid: number, title: string): string {
    const environ = readFile(`/proc/${pid}/environ`);
    if (environ !== null) {
      const snap = envValue(environ, 'SNAP_NAME');
      if (snap !== null) {
        const revision = envValue(environ, 'SNAP_REVISION') ?? '?';
        return `sn:${snap}:${revision}`;
      }
      const flatpak = envValue(environ, 'FLATPAK_ID');
      if (flatpak !== null) {
        const commit = this.flatpakCommit(pid) ?? '?';
        return `fp:${flatpak}:${commit}`;
      }
      const appImage = envValue(environ, 'APPIMAGE');
      if (appImage !== null) {
        const basename = appImage.split('/').pop() ?? appImage;
        return `ai:${basename}:${this.statHash(appImage)}`;
      }
    }

    const exe = this.exePath(pid);
    if (exe !== null) return this.statHash(exe);

    const argv0 = readFile(`/proc/${pid}/cmdline`);
    if (argv0 !== null) {
      const first = argv0.split('\0')[0];
      if (first.length > 0) return this.statHash(first);
    }

    return semverFromTitle(title) ?? '*';
  }

  private flatpakCommit(pid: number): string | null {
    const info = readFile(`/proc/${pid}/root/.flatpak-info`);
    if (info === null) return null;
    for (const line of info.split('\n')) {
      if (line.startsWith('commit=')) return line.slice('commit='.length).trim();
    }
    return null;
  }

  private exePath(pid: number): string | null {
    const file = Gio.File.new_for_path(`/proc/${pid}/exe`);
    const info = file.query_info('standard::symlink-target', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    if (info === null) return null;
    const target: string | null = info.get_symlink_target();
    if (target === null || target.endsWith(' (deleted)')) return null;
    return target;
  }

  private processStartTime(pid: number): number {
    const stat = readFile(`/proc/${pid}/stat`);
    if (stat === null) return 0;
    const close = stat.lastIndexOf(')');
    if (close < 0) return 0;
    const fields = stat.slice(close + 2).split(' ');
    const starttime = Number.parseInt(fields[19], 10);
    return Number.isFinite(starttime) ? starttime : 0;
  }

  private statHash(path: string): string {
    const file = Gio.File.new_for_path(path);
    let info: any;
    try {
      info = file.query_info('time::modified,standard::size', Gio.FileQueryInfoFlags.NONE, null);
    } catch {
      return '*';
    }
    if (info === null) return '*';
    const mtimeUs: number = info.get_attribute_uint64('time::modified');
    const size: number = info.get_attribute_uint64('standard::size');
    const mtimeMs = Math.floor(mtimeUs / 1_000_000);
    const nowMs = Date.now();
    const previous = this.hashes.get(path);
    if (previous !== undefined && nowMs - mtimeMs < STABILITY_WINDOW_MS) {
      return previous.hash;
    }
    // mtime * 31 XOR size, base-36, last 8 chars (§8).
    const raw = base36(mtimeMs * 31 ^ size);
    const hash = raw.slice(-8);
    this.hashes.set(path, { mtime: mtimeMs, hash });
    return hash;
  }
}
