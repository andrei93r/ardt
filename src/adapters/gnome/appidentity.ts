// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §12 identity resolution, adapter side.
 *
 * The pure chain lives in `core/identity.ts`; this file only reads the live
 * window and the process table and hands the pure walk its inputs. It never
 * decides anything: the winning key, its source and the provisional fallback
 * all come back from `resolveIdentity`.
 */

import Shell from 'gi://Shell';
import type { MetaWindow } from 'gi://Meta';

import type { IdentityProbe, ProcessEnv } from '../../core/identity.js';
import { resolveIdentity } from '../../core/identity.js';
import type { IdentityResolution } from '../../core/identity.js';
import { readText } from './adapt.js';

/** The shell's window tracker (`Shell.WindowTracker`), as far as it is read. */
interface WindowTrackerLike {
  get_window_app(win: MetaWindow): ShellAppLike | null;
}

/** A `Shell.App`, read only for its desktop id. */
interface ShellAppLike {
  get_id?(): string | null;
}

function safe<T>(fn: () => T | null | undefined): T | null {
  try {
    const value = fn();
    return value === undefined || value === null ? null : value;
  } catch {
    return null;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The desktop id the shell's window tracker attributes to this window, or null.
 * `get_window_app` is absent while a window is still being constructed.
 */
function desktopIdFor(win: MetaWindow, tracker?: WindowTrackerLike): string | null {
  try {
    const source: WindowTrackerLike = tracker ?? Shell.WindowTracker.get_default();
    const app = source?.get_window_app?.(win);
    return stringOrNull(app?.get_id?.());
  } catch {
    return null;
  }
}

/** Field 4 of `/proc/<pid>/stat`, the parent pid (`-1` when unreadable). */
function parentPid(pid: number): number {
  const stat = readText(`/proc/${pid}/stat`);
  if (stat === null) return -1;
  // The comm field is parenthesised and may contain spaces; parse after the
  // closing parenthesis so the numbers line up.
  const close = stat.lastIndexOf(')');
  if (close < 0) return -1;
  const fields = stat.slice(close + 1).trim().split(/\s+/);
  const ppid = Number.parseInt(fields[1] ?? '', 10);
  return Number.isFinite(ppid) ? ppid : -1;
}

/**
 * The ancestor chain of `pid`, own process first, with each process's raw
 * environment. Chromium zeroes its own environment, so the walk must continue
 * past it; `findAppImage` does exactly that.
 */
function processSnapshot(pid: number, maxDepth = 32): ProcessEnv[] {
  const out: ProcessEnv[] = [];
  const seen = new Set<number>();
  let current = pid;
  for (let depth = 0; depth < maxDepth && current > 0; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const environ = readText(`/proc/${current}/environ`) ?? '';
    const ppid = parentPid(current);
    out.push({ pid: current, ppid, environ });
    if (ppid <= 0) break;
    current = ppid;
  }
  return out;
}

/** Read every raw candidate the chain may use for one live window. */
function probeIdentity(win: MetaWindow, windowSeq: number, tracker?: WindowTrackerLike): IdentityProbe {
  const pid = safe<number>(() => win.get_pid?.());
  const processes = pid !== null && pid > 0 ? processSnapshot(pid) : undefined;
  return {
    desktopId: desktopIdFor(win, tracker),
    sandboxedAppId: stringOrNull(safe(() => win.get_sandboxed_app_id?.())),
    gtkApplicationId: stringOrNull(safe(() => win.get_gtk_application_id?.())),
    pid,
    processes,
    wmClass: stringOrNull(safe(() => win.get_wm_class?.())),
    windowSeq,
  };
}

/** Resolve one live window's identity through the pure chain. */
export function resolveWindowIdentity(win: MetaWindow, windowSeq: number, tracker?: WindowTrackerLike): IdentityResolution {
  return resolveIdentity(probeIdentity(win, windowSeq, tracker));
}

/** A stable per-session instance id for placements (§12). */
export function instanceIdFor(win: MetaWindow): string {
  const stable = safe<number>(() => win.get_stable_sequence?.());
  if (stable !== null && Number.isFinite(stable)) return String(stable);
  const id = safe<number>(() => win.get_id?.());
  return id === null ? 'window:0' : `window:${id}`;
}
