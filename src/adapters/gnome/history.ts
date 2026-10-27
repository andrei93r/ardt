// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Event log and undo history (§21, §15). JSON lines rotate daily under
 * `$XDG_DATA_HOME/adrt/history/`.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { JsonlBuffer, dayString, encodeText, jsonLine } from '../../core/jsonl.js';
import { clipPayload } from '../../core/text.js';
import { LOG_RETENTION_DAYS, partPath, retentionCutoffDay, shouldRotate } from '../../core/rotation.js';
import { dataDir, readLines } from './adapt.js';

/** Rotated parts kept per day before the oldest is deleted. */
const MAX_HISTORY_PARTS = 5;
/** Default size of one part (bytes). */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
/** One buffered flush per this interval; the compositor thread never blocks. */
const FLUSH_MS = 1000;

export interface HistoryEvent {
  t: number;
  ev: string;
  trace: number;
  [field: string]: unknown;
}

/** The one field of a `Gio.FileInfo` the day enumeration reads. */
interface FileInfoLike {
  get_name(): string;
}

/** The `Gio.FileMonitor` surface the tail uses. */
interface FileMonitorLike {
  connect(signal: string, callback: () => void): number;
  cancel(): void;
}

function historyDir(): string {
  const dir = `${dataDir()}/history`;
  GLib.mkdir_with_parents(dir, 0o755);
  return dir;
}

export class History {
  private trace = 0;
  private enabled: boolean;
  private retentionDays: number;
  private dailyFolders: boolean;
  private tailMonitor: FileMonitorLike | null = null;
  /** Byte offset of the last complete line the tail emitted. */
  private tailOffset = 0;
  private tailPath = '';

  /** Size at which the live part rotates (bytes). */
  private maxBytes = DEFAULT_MAX_BYTES;
  /** Diagnostics: events actually written (not the ones dropped while disabled). */
  private written = 0;
  /** Optional sink for the event journal: every logged decision (§22). */
  private sink: ((event: HistoryEvent) => void) | null = null;
  /** Serialized lines awaiting one buffered flush to disk. */
  private readonly buffer = new JsonlBuffer();
  private flushSource: number | null = null;

  get logEvents(): number {
    return this.written;
  }

  constructor(enabled: boolean, retentionDays: number, dailyFolders: boolean, maxBytes = DEFAULT_MAX_BYTES) {
    this.enabled = enabled;
    this.retentionDays = retentionDays;
    this.dailyFolders = dailyFolders;
    this.maxBytes = maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES;
  }

  setMaxBytes(maxBytes: number): void {
    if (maxBytes > 0) this.maxBytes = maxBytes;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  nextTrace(): number {
    this.trace += 1;
    return this.trace;
  }

  setSink(sink: ((event: HistoryEvent) => void) | null): void {
    this.sink = sink;
  }

  log(ev: string, fields: Record<string, unknown> = {}): HistoryEvent | null {
    if (!this.enabled) return null;
    const first = fields.trace;
    const trace = typeof first === 'number' ? first : this.nextTrace();
    // A client string (a window title) is unbounded; clip it before it can
    // become a giant log line or an out-of-memory in GJS.
    const safe = clipPayload(fields) as Record<string, unknown>;
    const event: HistoryEvent = { t: Date.now(), ev, trace, ...safe };
    if (typeof fields.trace === 'number') event.trace = fields.trace;
    this.append(event);
    this.written += 1;
    this.sink?.(event);
    return event;
  }

  days(): string[] {
    const directory = Gio.File.new_for_path(historyDir());
    const enumerator = directory.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    const days: string[] = [];
    let info: FileInfoLike | null;
    while ((info = enumerator.next_file(null)) !== null) {
      const name: string = info.get_name();
      // Only day files, never their rotated parts (`day.2.jsonl`).
      if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) days.push(name.slice(0, 10));
    }
    days.sort();
    return days;
  }

  /**
   * Every event mentioning `windowId` in the newest `maxDays` day files.
   * Streams each file line by line: a lookup never materializes an 8 MB log
   * (let alone a whole day directory) as one string and one split array.
   */
  lookup(windowId: number, maxDays = 7): HistoryEvent[] {
    const all = this.days().slice(-Math.max(1, Math.trunc(maxDays)));
    const results: HistoryEvent[] = [];
    for (let i = all.length - 1; i >= 0; i--) {
      readLines(this.pathFor(all[i]), (line) => {
        if (line.length === 0) return;
        let event: HistoryEvent;
        try {
          event = JSON.parse(line) as HistoryEvent;
        } catch {
          return;
        }
        if (event.id === windowId || event.surfaceId === windowId) results.push(event);
      });
    }
    return results;
  }

  /**
   * Watch today's file and emit appended events (§21). The monitor only says
   * "something changed"; `readLines` streams from the last emitted byte, so an
   * append costs one line of parsing and a partial write is retried intact.
   */
  tail(cb: (event: HistoryEvent) => void): () => void {
    const file = Gio.File.new_for_path(this.pathFor(dayString(new Date())));
    if (!file.query_exists(null)) file.create(Gio.FileCreateFlags.NONE, null);
    const monitor: FileMonitorLike = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
    this.tailMonitor = monitor;
    this.tailPath = file.get_path();
    // Start at the current end: the tail reports new events, not a replay of
    // everything already written today.
    this.tailOffset = this.sizeOf(this.tailPath);
    monitor.connect('changed', () => {
      if (this.tailPath.length === 0) return;
      // Rotation/truncation resets the stream to the start of the new file.
      if (this.sizeOf(this.tailPath) < this.tailOffset) this.tailOffset = 0;
      const result = readLines(
        this.tailPath,
        (line) => {
          if (line.length === 0) return;
          try {
            cb(JSON.parse(line) as HistoryEvent);
          } catch {
            /* a malformed line is skipped, not fatal */
          }
        },
        { offset: this.tailOffset },
      );
      this.tailOffset = result.bytes;
    });
    return () => this.stopTail();
  }

  prune(now: Date = new Date()): number {
    // Retention is applied even while logging is disabled: old files must not
    // outlive the window just because the user stopped writing new ones.
    const cutoffDay = retentionCutoffDay(
      now,
      this.retentionDays > 0 ? this.retentionDays : LOG_RETENTION_DAYS,
    );
    let removed = 0;
    for (const day of this.days()) {
      if (day >= cutoffDay) continue;
      const base = this.pathFor(day);
      try {
        Gio.File.new_for_path(base).delete(null);
        removed += 1;
      } catch {
        /* already gone */
      }
      for (let part = 2; part <= MAX_HISTORY_PARTS; part++) {
        const extra = Gio.File.new_for_path(partPath(base, part));
        try {
          if (extra.query_exists(null)) {
            extra.delete(null);
            removed += 1;
          }
        } catch {
          /* already gone */
        }
      }
    }
    return removed;
  }

  destroy(): void {
    this.flush();
    this.stopTail();
  }

  private stopTail(): void {
    if (this.tailMonitor !== null) {
      this.tailMonitor.cancel();
      this.tailMonitor = null;
    }
    this.tailPath = '';
    this.tailOffset = 0;
  }

  private pathFor(day: string): string {
    const directory = historyDir();
    if (this.dailyFolders) {
      const nested = `${directory}/${day}`;
      GLib.mkdir_with_parents(nested, 0o755);
      return `${nested}/events.jsonl`;
    }
    return `${directory}/${day}.jsonl`;
  }

  /**
   * Buffer one JSON line. Disk work happens once per `flush()`, never per
   * event: a decision on the compositor thread must not open/append/close a
   * file. This never reads the file back.
   */
  private append(event: HistoryEvent): void {
    const day = dayString(new Date());
    if (this.buffer.rollsOver(day)) this.flush();
    this.buffer.push(day, jsonLine(event));
    this.scheduleFlush();
  }

  /** Flush every buffered line to the day's file: one open/append/close. */
  flush(): void {
    if (this.flushSource !== null) {
      GLib.source_remove(this.flushSource);
      this.flushSource = null;
    }
    const batch = this.buffer.drain();
    if (batch === null) return;
    const base = this.pathFor(batch.day);
    // A batch larger than a part's cap cannot be written in one append: fall
    // back to per-line appends with a rotation check each, so the live part
    // stays bounded (A65). Normal batches take the single-append path.
    if (shouldRotate(this.sizeOf(base) + batch.text.length, this.maxBytes)) {
      this.appendLines(base, batch.text);
      return;
    }
    try {
      const stream = Gio.File.new_for_path(base).append_to(Gio.FileCreateFlags.NONE, null);
      stream.write_all(encodeText(batch.text), null);
      stream.close(null);
    } catch {
      // Logging must never break the Shell. Dropping one bounded batch is
      // preferable to a read-modify-write that buffers a whole file.
    }
  }

  /** Append a batch line by line, rotating whenever the live part fills. */
  private appendLines(base: string, text: string): void {
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      let path = base;
      if (shouldRotate(this.sizeOf(path) + line.length, this.maxBytes)) path = this.rotate(path);
      try {
        const stream = Gio.File.new_for_path(path).append_to(Gio.FileCreateFlags.NONE, null);
        stream.write_all(encodeText(`${line}\n`), null);
        stream.close(null);
      } catch {
        /* never let logging break the shell */
      }
    }
  }

  private scheduleFlush(): void {
    if (this.flushSource !== null) return;
    this.flushSource = GLib.timeout_add(GLib.PRIORITY_LOW, FLUSH_MS, () => {
      this.flushSource = null;
      this.flush();
      return GLib.SOURCE_REMOVE;
    });
  }

  /** Size of a file in bytes, 0 when it does not exist. */
  private sizeOf(path: string): number {
    try {
      const info = Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
      return info.get_size();
    } catch {
      return 0;
    }
  }

  /**
   * Rotate the day's file: `day.jsonl` -> `day.2.jsonl`, parts shift down and
   * the oldest part beyond MAX_HISTORY_PARTS is deleted. Returns the fresh path.
   */
  private rotate(base: string): string {
    const oldest = partPath(base, MAX_HISTORY_PARTS);
    try {
      const file = Gio.File.new_for_path(oldest);
      if (file.query_exists(null)) file.delete(null);
    } catch {
      /* nothing to delete */
    }
    for (let part = MAX_HISTORY_PARTS - 1; part >= 1; part--) {
      const from = Gio.File.new_for_path(partPath(base, part));
      const to = Gio.File.new_for_path(partPath(base, part + 1));
      try {
        if (from.query_exists(null)) from.move(to, Gio.FileCopyFlags.OVERWRITE, null, null);
      } catch {
        /* skip a part that cannot move */
      }
    }
    return base;
  }
}
