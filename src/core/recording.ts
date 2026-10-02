// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Start/stop bug recorder (§22 extension). The user reports a live graphical
 * bug but cannot say *when* it happened; one recording captures a bounded window
 * so they can hand over a timestamp and the matching log.
 *
 * Everything here is pure so it can be unit tested without a Shell: the file
 * name, the cap/rotation decisions, the sample cadence and the line formats.
 * The recorder adapter owns the file, the listeners and the timer; this module
 * never touches IO, the compositor or the clock beyond a `Date` it is handed.
 */

/** Identifies a recording stream in its header, so a reader can tell it apart. */
export const RECORDING_FORMAT = 'adrt.recording';
export const RECORDING_VERSION = 1;

/** Bounds: ten minutes or fifty megabytes, whichever comes first. */
export const DEFAULT_MAX_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
/** Only the newest ten recording files are kept (the oldest rotate away). */
export const MAX_RECORDING_FILES = 10;
/** The minimum gap between two `state` snapshots: about 20 Hz. */
export const SNAPSHOT_INTERVAL_MS = 50;
/** Bounds on the start trigger's optional `maxSeconds` cap. */
export const MIN_CAP_SECONDS = 1;
export const MAX_CAP_SECONDS = 60 * 60;

/** Why a recording stopped. `user` and `disable` are explicit; `cap` is a bound. */
export type StopReason = 'user' | 'cap' | 'disable';

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * `rec-YYYYMMDD-HHMMSS.jsonl` from a local-time timestamp. One file per
 * recording session, so the newest is always the one a user just produced.
 */
export function recordingFileName(date: Date): string {
  const stamp =
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `rec-${stamp}.jsonl`;
}

/**
 * The duration cap to use for a start request, in milliseconds. An absent,
 * non-finite or non-positive request falls back to the default; a real one is
 * clamped to `[MIN_CAP_SECONDS, MAX_CAP_SECONDS]` so no trigger can ask for a
 * recording that never ends or writes for a day.
 */
export function clampMaxSeconds(seconds: number | undefined, fallbackMs = DEFAULT_MAX_MS): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return fallbackMs;
  const bounded = Math.min(Math.max(Math.trunc(seconds), MIN_CAP_SECONDS), MAX_CAP_SECONDS);
  return bounded * 1000;
}

/**
 * Why the recording must stop on its own, or null while it may continue. The
 * byte cap is checked first: it is the one that keeps a pathological event
 * flood from filling the disk before the next time check.
 */
export function capReason(
  elapsedMs: number,
  bytes: number,
  maxMs: number,
  maxBytes: number,
): 'time' | 'bytes' | null {
  if (maxBytes > 0 && bytes >= maxBytes) return 'bytes';
  if (maxMs > 0 && elapsedMs >= maxMs) return 'time';
  return null;
}

/**
 * Names to delete so that at most `keep` of `names` remain. `names` is sorted
 * lexicographically — the `rec-YYYYMMDD-HHMMSS` prefix makes that chronological
 * — and the oldest excess is returned. At least one name is always kept.
 */
export function recordingsToDelete(names: readonly string[], keep = MAX_RECORDING_FILES): string[] {
  const sorted = [...names].sort();
  const bounded = Number.isFinite(keep) && keep >= 1 ? Math.floor(keep) : 1;
  const excess = sorted.length - bounded;
  return excess > 0 ? sorted.slice(0, excess) : [];
}

/** Whether a new state sample is due at the ~20 Hz cadence. */
export function sampleDue(lastSampleMs: number, nowMs: number, intervalMs = SNAPSHOT_INTERVAL_MS): boolean {
  if (lastSampleMs <= 0) return true;
  return nowMs - lastSampleMs >= intervalMs;
}

/**
 * A stable identity for a snapshot, so identical consecutive ones can be
 * dropped and a still screen does not bloat the file. Snapshots are plain
 * JSON data; an unserialisable one (never produced here) is a distinct key.
 */
export function snapshotKey(snapshot: unknown): string {
  try {
    return JSON.stringify(snapshot) ?? 'null';
  } catch {
    return '';
  }
}

/**
 * One `header` line: the build, the environment and the full settings snapshot.
 * The body is spread first so a field can never shadow the `kind` tag.
 */
export function headerRecord(at: number, fields: Record<string, unknown>): Record<string, unknown> {
  return { ...fields, kind: 'header', format: RECORDING_FORMAT, version: RECORDING_VERSION, at };
}

/**
 * One `event` line: a journal/history record, reused verbatim but with the
 * `kind`/`t` tag on top, so a record that itself carries a `kind` (a model
 * event does) cannot masquerade as a header/footer. `t` is the record's own
 * `at`; the body keeps every original field.
 */
export function eventRecord(t: number, entry: Record<string, unknown>): Record<string, unknown> {
  return { ...entry, kind: 'event', t };
}

/** One `state` line: the periodic snapshot, inlined under the line timestamp. */
export function stateRecord(t: number, snapshot: Record<string, unknown>): Record<string, unknown> {
  return { ...snapshot, kind: 'state', t };
}

/** One `footer` line: why and when the recording ended, and its totals. */
export function footerRecord(at: number, fields: Record<string, unknown>): Record<string, unknown> {
  return { ...fields, kind: 'footer', at };
}
