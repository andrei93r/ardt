// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §12 app identity resolution.
 *
 * Identity is resolved at the window's first frame by the documented chain and
 * records the winning key, its source and every raw value it saw. This module
 * is pure: the platform layer hands in the tracker desktop id, the sandboxed /
 * GTK ids, the raw `wm_class` and a snapshot of the process table; everything
 * here only walks and normalises.
 *
 * Normalisation strips a trailing `.desktop` and a trailing `AppImage` suffix.
 * It never casefolds a path, never collapses the filesystem (`realpath`) and
 * never merges packaging namespaces: a deb, a Flatpak and a Snap install of one
 * app stay three identities. The conservative family normaliser exists for
 * grouping only (profiles, display) and is never persisted as an identity.
 */

export type IdentitySource =
  | 'desktop-id'
  | 'sandboxed-app-id'
  | 'gtk-application-id'
  | 'appimage'
  | 'wm-class'
  | 'window';

/** Prefix of the session-only provisional key (`window:<seq>`). */
export const PROVISIONAL_PREFIX = 'window:';

const DESKTOP_SUFFIX = '.desktop';
const APPIMAGE_SUFFIX = /\.?AppImage$/;
const PROVISIONAL = /^window:\d+$/;

/** Strip the `.desktop` / `AppImage` suffixes and surrounding space. Never casefolds, never realpaths. */
export function normalizeIdentity(raw: string): string {
  let value = raw.trim();
  if (value.endsWith(DESKTOP_SUFFIX)) value = value.slice(0, -DESKTOP_SUFFIX.length);
  value = value.replace(APPIMAGE_SUFFIX, '');
  return value.trim();
}

/** A provisional key is session-only and is re-keyed when a real identity appears. */
export function isProvisional(key: string): boolean {
  return PROVISIONAL.test(key);
}

/**
 * Conservative family key for grouping only. It casefolds (grouping is not an
 * identity) and drops surrounding space, but it deliberately does **not** strip
 * reverse-DNS or packaging qualifiers, so `com.spotify.Client` (Flatpak),
 * `spotify` (deb) and Snap installs remain different families.
 */
export function appFamily(key: string): string {
  return normalizeIdentity(key).toLowerCase().replace(/\s+/g, '');
}

/** A snapshot of one process, as the platform reads it from the process table. */
export interface ProcessEnv {
  pid: number;
  ppid: number;
  /** Raw NUL-separated environment. A zeroed or empty string means unreadable. */
  environ: string;
}

/** Read one variable out of a raw NUL-separated environment block. */
export function readEnvValue(environ: string, key: string): string | null {
  for (const entry of environ.split('\0')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    if (entry.slice(0, eq) === key) return entry.slice(eq + 1);
  }
  return null;
}

/**
 * Walk the process ancestors of `pid` (own process first) for `APPIMAGE`.
 *
 * An AppImage sets `APPIMAGE` to the real `.AppImage` path in the launcher
 * environment; the mount path it uses at runtime is random per run. Chromium
 * zeroes its own environment, so its own process shows nothing and the walk
 * must continue to the parent that launched it. Mount paths are therefore never
 * an identity.
 */
export function findAppImage(pid: number, processes: readonly ProcessEnv[]): string | null {
  const table = new Map<number, ProcessEnv>();
  for (const process of processes) table.set(process.pid, process);

  const visited = new Set<number>();
  let current: number | null = pid;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const process = table.get(current);
    if (process === undefined) return null;
    const value = readEnvValue(process.environ, 'APPIMAGE');
    if (value !== null && value.length > 0) return value;
    current = process.ppid > 0 ? process.ppid : null;
  }
  return null;
}

/** Everything the platform observed about the window at its first frame. */
export interface IdentityProbe {
  /** Desktop id from the shell's window tracker (often `*.desktop`). */
  desktopId?: string | null;
  /** Sandboxed app id (Flatpak / Snap). */
  sandboxedAppId?: string | null;
  /** GTK application id. */
  gtkApplicationId?: string | null;
  /** The window's process id, when the platform could read it. */
  pid?: number | null;
  /** The process table used to walk for an AppImage `APPIMAGE`. */
  processes?: readonly ProcessEnv[];
  /** Raw `wm_class`. */
  wmClass?: string | null;
  /** Session sequence for the provisional fallback. */
  windowSeq: number;
}

/** The outcome of the chain: the key, where it came from and what was seen. */
export interface IdentityResolution {
  key: string;
  source: IdentitySource;
  /** The winning raw value, before normalisation; `null` for the provisional key. */
  raw: string | null;
  provisional: boolean;
  /** Every raw candidate, for the journal, keyed by source. */
  rawValues: Readonly<Record<IdentitySource, string | null>>;
}

function nonEmpty(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the chain in the model's order:
 * desktop id → sandboxed app id → GTK application id → AppImage ancestor →
 * `wm_class` → `window:<seq>`.
 */
export function resolveIdentity(probe: IdentityProbe): IdentityResolution {
  const desktopRaw = nonEmpty(probe.desktopId);
  const sandboxedRaw = nonEmpty(probe.sandboxedAppId);
  const gtkRaw = nonEmpty(probe.gtkApplicationId);
  const wmClassRaw = nonEmpty(probe.wmClass);

  let appImageRaw: string | null = null;
  if (probe.pid !== undefined && probe.pid !== null && probe.processes !== undefined) {
    appImageRaw = nonEmpty(findAppImage(probe.pid, probe.processes));
  }

  const rawValues: Record<IdentitySource, string | null> = {
    'desktop-id': desktopRaw,
    'sandboxed-app-id': sandboxedRaw,
    'gtk-application-id': gtkRaw,
    appimage: appImageRaw,
    'wm-class': wmClassRaw,
    window: null,
  };

  const steps: ReadonlyArray<{ source: IdentitySource; raw: string | null }> = [
    // A desktop id that is itself the provisional key is ignored (§12).
    { source: 'desktop-id', raw: desktopRaw !== null && !isProvisional(desktopRaw) ? desktopRaw : null },
    { source: 'sandboxed-app-id', raw: sandboxedRaw },
    { source: 'gtk-application-id', raw: gtkRaw },
    { source: 'appimage', raw: appImageRaw },
    { source: 'wm-class', raw: wmClassRaw },
  ];

  for (const step of steps) {
    if (step.raw === null) continue;
    const key = normalizeIdentity(step.raw);
    if (key.length === 0) continue;
    return { key, source: step.source, raw: step.raw, provisional: false, rawValues };
  }

  const key = `${PROVISIONAL_PREFIX}${probe.windowSeq}`;
  return { key, source: 'window', raw: null, provisional: true, rawValues };
}
