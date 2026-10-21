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

import type { Rect, Size } from './types.js';

/** Identifies a recording stream in its header, so a reader can tell it apart. */
const RECORDING_FORMAT = 'adrt.recording';
const RECORDING_VERSION = 1;

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
/** The note a user types when a recording stops is bounded too (§22 extension). */
export const NOTE_MAX_LENGTH = 2000;

/** Why a recording stopped. `user` and `disable` are explicit; `cap` is a bound. */
export type StopReason = 'user' | 'cap' | 'disable';

/** Recordings are pruned after the same 31-day window as the logs. */
export const RECORDING_RETENTION_DAYS = 31;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RECORDING_NAME = /^rec-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?\.jsonl$/;

/**
 * Clean a user note: normalise line endings, drop other control characters
 * (keeping tab and newline), trim the edges and cap the length. The note is
 * untrusted text headed for a JSONL file and the shell, so this is the one
 * place it is made safe; JSON escaping itself is `JSON.stringify`'s job.
 */
export function normalizeNote(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  let cleaned = '';
  for (const character of normalized) {
    const code = character.codePointAt(0) ?? 0;
    const control = code === 0x7f || (code < 0x20 && character !== '\n' && character !== '\t');
    cleaned += control ? ' ' : character;
  }
  const trimmed = cleaned.trim();
  return trimmed.length > NOTE_MAX_LENGTH ? trimmed.slice(0, NOTE_MAX_LENGTH) : trimmed;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * Centre `content` inside `container`, as the on-screen rect the prompt's
 * content box should occupy. Both sizes are rounded and the result is clamped
 * to the container's top-left so a content larger than the screen still starts
 * on-screen instead of at a negative offset. Pure, so the prompt's layout can
 * be asserted without a Shell.
 */
export function centerRect(container: Size, content: Size): Rect {
  const width = Math.max(0, Math.round(Number.isFinite(content.width) ? content.width : 0));
  const height = Math.max(0, Math.round(Number.isFinite(content.height) ? content.height : 0));
  const x = Math.max(0, Math.round((container.width - width) / 2));
  const y = Math.max(0, Math.round((container.height - height) / 2));
  return { x, y, width, height };
}

/**
 * `rec-YYYYMMDD-HHMMSS.jsonl` from a local-time timestamp. One file per
 * recording session, so the newest is always the one a user just produced.
 *
 * `occurrence` disambiguates a second recording that starts in the *same*
 * second: 1 is the plain name, 2 is `rec-…-2.jsonl`, and so on. The adapter
 * picks the first name whose file does not exist, so two sessions in one second
 * never interleave into one file.
 */
export function recordingFileName(date: Date, occurrence = 1): string {
  const stamp =
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  const suffix = occurrence > 1 ? `-${Math.floor(occurrence)}` : '';
  return `rec-${stamp}${suffix}.jsonl`;
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

/** Local timestamp encoded in a recording name, or null for a foreign name. */
export function recordingTimestamp(name: string): number | null {
  const match = RECORDING_NAME.exec(name);
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  // Reject an impossible date (`20261301` would otherwise roll into 2027).
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null;
  }
  return date.getTime();
}

/**
 * Recording names older than the retention window. Recordings are a bounded
 * diagnostic aid, not a permanent log, so the same 31-day prune applies.
 */
export function recordingsExpired(
  names: readonly string[],
  now: Date = new Date(),
  retentionDays = RECORDING_RETENTION_DAYS,
): string[] {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? Math.floor(retentionDays) : RECORDING_RETENTION_DAYS;
  const cutoff = now.getTime() - days * MS_PER_DAY;
  const out: string[] = [];
  for (const name of names) {
    const timestamp = recordingTimestamp(name);
    if (timestamp !== null && timestamp < cutoff) out.push(name);
  }
  return out;
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

/**
 * One `note` line: what the user observed, written *before* the footer after a
 * user-initiated stop. Add-only, so a reader that does not know it can ignore
 * it; the footer also carries the same text so the file is self-contained from
 * its last line alone.
 */
export function noteRecord(t: number, text: string): Record<string, unknown> {
  return { kind: 'note', t, text };
}

/** One `footer` line: why and when the recording ended, and its totals. */
export function footerRecord(at: number, fields: Record<string, unknown>): Record<string, unknown> {
  return { ...fields, kind: 'footer', at };
}

/** A recording file's identity plus what the prefs window shows about it. */
export interface RecordingSummary {
  /** File name, e.g. `rec-20261021-080540.jsonl`. */
  name: string;
  /** Local timestamp encoded in the name, or 0 when the name is foreign. */
  timestamp: number;
  /** File size in bytes, as reported by the caller. */
  bytes: number;
  /** The reason the recording stopped (`user`, `cap`, `disable`), or null. */
  stopReason: string | null;
  /** The user's observation note, or ''. */
  note: string;
  /** How long the recording ran, in milliseconds, or 0 when unknown. */
  durationMs: number;
  /** True when the file has no footer (still recording, or truncated). */
  open: boolean;
}

/**
 * A recording's size, as a short human string. Binary units, because that is
 * what the file's byte count actually measures: 1536 bytes is "1.5 KiB".
 */
export function formatBytes(bytes: number): string {
  const n = Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : 0;
  if (n < 1024) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Parse a recording file into the summary the prefs window shows. Only the
 * header, the note and the footer are read line-by-line, and every line is
 * tolerated on its own: a truncated or half-written file still yields a usable
 * summary rather than throwing in the preferences process. Nothing here touches
 * IO — the caller passes the file's text and byte size.
 */
export function summarizeRecording(name: string, bytes: number, text: string): RecordingSummary {
  const summary: RecordingSummary = {
    name,
    timestamp: recordingTimestamp(name) ?? 0,
    bytes: Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : 0,
    stopReason: null,
    note: '',
    durationMs: 0,
    open: true,
  };
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record !== 'object' || record === null) continue;
    const row = record as Record<string, unknown>;
    const kind = row['kind'];
    if (kind === 'note') {
      summary.note = typeof row['text'] === 'string' ? row['text'] : summary.note;
    } else if (kind === 'footer') {
      summary.open = false;
      summary.note = typeof row['note'] === 'string' ? row['note'] : summary.note;
      summary.stopReason = typeof row['reason'] === 'string' ? row['reason'] : summary.stopReason;
      const duration = row['durationMs'];
      if (typeof duration === 'number' && Number.isFinite(duration)) summary.durationMs = Math.max(0, duration);
    }
  }
  return summary;
}

/**
 * Summaries newest first. The name's timestamp is the sort key, so a file whose
 * name does not parse falls to the end; equal timestamps break on the name, so
 * the order is stable and the same list is shown every open.
 */
export function sortRecordingsNewest(rows: readonly RecordingSummary[]): RecordingSummary[] {
  return [...rows].sort((a, b) => (b.timestamp - a.timestamp) || b.name.localeCompare(a.name));
}

/**
 * Which of `names` the user asked to remove, validated against what is on disk.
 * Only names that are present are returned, and only ones that look like a
 * recording, so a stale selection can never delete an unrelated file.
 */
export function recordingsToRemove(names: readonly string[], present: readonly string[]): string[] {
  const available = new Set(present);
  return names.filter((name) => available.has(name) && RECORDING_NAME.test(name));
}
