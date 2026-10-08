// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Event journal (§22). Every raw platform event — and every decision the
 * extension takes — is appended here with **one monotonic sequence**, kept in a
 * bounded in-memory ring for `DumpEvents`/`DumpDecisions` and written as one
 * JSON line per entry into one file per day:
 *
 *   $XDG_DATA_HOME/adrt/journal/2026-10-01.jsonl
 *
 * Rotation mirrors the history log (numbered parts, `core/rotation.ts`) so no
 * single file can grow without limit; entries older than the retention window
 * are pruned. The history log keeps the human-facing narrative; the journal is
 * the machine-facing one: raw events, decisions and their shared sequence.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { RingBuffer } from '../../core/ringbuffer.js';
import { JsonlBuffer, dayString, encodeText, jsonLine } from '../../core/jsonl.js';
import { partPath, shouldRotate } from '../../core/rotation.js';
import { clipPayload } from '../../core/text.js';
import { dataDir, readText, writeAtomic } from './adapt.js';

/** Rotated parts kept per day before the oldest is deleted. */
const MAX_PARTS = 5;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
/** Ring buffer size: enough for a run's worth of `DumpEvents` without growth. */
const RING = 4000;
/** One buffered flush per this interval; the compositor thread never blocks. */
const FLUSH_MS = 1000;

export interface JournalEntry {
  seq: number;
  source: string;
  event: string;
  at: number;
  /** The history trace this entry corresponds to, when it is a decision. */
  trace?: number;
  [field: string]: unknown;
}

/** The one field of a `Gio.FileInfo` the day enumeration reads. */
interface FileInfoLike {
  get_name(): string;
}

function journalDir(): string {
  const dir = `${dataDir()}/journal`;
  GLib.mkdir_with_parents(dir, 0o755);
  return dir;
}

export class EventJournal {
  private seq = 0;
  private readonly ring = new RingBuffer<JournalEntry>(RING);
  private readonly decisions = new RingBuffer<JournalEntry>(RING);
  private written = 0;
  private maxBytes: number;
  /**
   * Optional sink for every written entry (the bug recorder, §22 extension).
   * Null when nothing is recording, so the funnel costs one null check.
   */
  private sink: ((entry: JournalEntry) => void) | null = null;
  /**
   * When false (the default), `surface-frame-changed` lines stay in the ring
   * and reach the sink but are not persisted: they fire per animated frame and
   * would otherwise turn every notification into a disk write.
   */
  private noisyWrites = false;
  /** Serialized lines awaiting one buffered flush to disk. */
  private readonly buffer = new JsonlBuffer();
  private flushSource: number | null = null;

  constructor(
    private readonly retentionDays = 30,
    maxBytes = DEFAULT_MAX_BYTES,
  ) {
    this.maxBytes = maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES;
  }

  get lastSeq(): number {
    return this.seq;
  }

  get entriesWritten(): number {
    return this.written;
  }

  /**
   * Watch every entry as it is written, in order (the bug recorder). Pass null
   * to detach. The sink runs before the file write and is never allowed to
   * break logging.
   */
  setSink(sink: ((entry: JournalEntry) => void) | null): void {
    this.sink = sink;
  }

  /**
   * Arm persistence of `surface-frame-changed` (the `trace-enabled` setting, or
   * any live recorder whose sink is attached). Every other event is always
   * persisted; the ring and the sink see noisy entries regardless.
   */
  setNoisyWrites(enabled: boolean): void {
    this.noisyWrites = enabled;
  }

  /** Record one raw platform event. Returns the entry, sequence assigned. */
  record(source: string, event: string, data?: Record<string, unknown>): JournalEntry {
    return this.append(this.make(source, event, data));
  }

  /** Record one decision, carrying the history trace it corresponds to. */
  decide(event: string, fields: Record<string, unknown> = {}): JournalEntry {
    const trace = typeof fields.trace === 'number' ? (fields.trace as number) : undefined;
    const entry = this.make('decision', event, fields);
    if (trace !== undefined) entry.trace = trace;
    this.decisions.push(entry);
    this.writeLine(entry);
    return entry;
  }

  /** The last `limit` journal entries, optionally filtered by a substring. */
  tail(limit = 200, filter = ''): JournalEntry[] {
    const n = Math.max(0, Math.trunc(limit));
    if (n === 0) return [];
    return filter.length > 0
      ? this.ring.tailWhere((e) => e.event.includes(filter) || e.source.includes(filter), n)
      : this.ring.tail(n);
  }

  /** The last `limit` decisions. */
  decisionsTail(limit = 200): JournalEntry[] {
    const n = Math.max(0, Math.trunc(limit));
    return n === 0 ? [] : this.decisions.tail(n);
  }

  /** Delete day files older than the retention window. */
  prune(now: Date = new Date()): number {
    const cutoff = new Date(now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000);
    const cutoffDay = dayString(cutoff);
    let removed = 0;
    for (const day of this.days()) {
      if (day >= cutoffDay) continue;
      const base = `${journalDir()}/${day}.jsonl`;
      for (const path of [base, ...Array.from({ length: MAX_PARTS - 1 }, (_, i) => partPath(base, i + 2))]) {
        try {
          const file = Gio.File.new_for_path(path);
          if (file.query_exists(null)) {
            file.delete(null);
            removed += 1;
          }
        } catch {
          /* already gone */
        }
      }
    }
    return removed;
  }

  /** Day strings present on disk, oldest first. */
  days(): string[] {
    try {
      const dir = Gio.File.new_for_path(journalDir());
      const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
      const days: string[] = [];
      let info: FileInfoLike | null;
      while ((info = enumerator.next_file(null)) !== null) {
        const name: string = info.get_name();
        if (name.endsWith('.jsonl') && /^\d{4}-\d{2}-\d{2}/.test(name)) days.push(name.slice(0, 10));
      }
      return [...new Set(days)].sort();
    } catch {
      return [];
    }
  }

  destroy(): void {
    this.flush();
    this.ring.clear();
    this.decisions.clear();
  }

  private make(source: string, event: string, data?: Record<string, unknown>): JournalEntry {
    this.seq += 1;
    const safe = data === undefined ? {} : (clipPayload(data) as Record<string, unknown>);
    return { seq: this.seq, source, event, at: Date.now(), ...safe };
  }

  private append(entry: JournalEntry): JournalEntry {
    this.ring.push(entry);
    this.writeLine(entry);
    return entry;
  }

  /**
   * Offer one entry to the sink (in order, synchronously) and buffer its file
   * line. Disk work happens once per `flush()`, never per event: a platform
   * event on the compositor thread must not open/append/close a file.
   */
  private writeLine(entry: JournalEntry): void {
    if (this.sink !== null) {
      try {
        this.sink(entry);
      } catch {
        /* recording must never break logging */
      }
    }
    if (entry.event === 'surface-frame-changed' && !this.noisyWrites && this.sink === null) return;
    const day = dayString(new Date());
    if (this.buffer.rollsOver(day)) this.flush();
    this.buffer.push(day, jsonLine(entry));
    this.scheduleFlush();
  }

  /** Flush every buffered line to today's file: one open/append/close. */
  flush(): void {
    if (this.flushSource !== null) {
      GLib.source_remove(this.flushSource);
      this.flushSource = null;
    }
    const batch = this.buffer.drain();
    if (batch === null) return;
    const base = `${journalDir()}/${batch.day}.jsonl`;
    // A batch larger than the cap cannot be written in one append: fall back
    // to per-line appends with a rotation check each, so the live part stays
    // bounded (normal batches take the single-append path).
    if (shouldRotate(this.sizeOf(base) + batch.text.length, this.maxBytes)) {
      this.appendLines(base, batch.text);
      return;
    }
    try {
      const stream = Gio.File.new_for_path(base).append_to(Gio.FileCreateFlags.NONE, null);
      stream.write_all(encodeText(batch.text), null);
      stream.close(null);
      this.written += batch.count;
    } catch {
      // Bounded by rotation, so a read-modify-write fallback is acceptable.
      try {
        writeAtomic(base, `${readText(base) ?? ''}${batch.text}`);
        this.written += batch.count;
      } catch {
        /* never let logging break the shell */
      }
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
        this.written += 1;
      } catch {
        try {
          writeAtomic(path, `${readText(path) ?? ''}${line}\n`);
          this.written += 1;
        } catch {
          /* never let logging break the shell */
        }
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

  private sizeOf(path: string): number {
    try {
      const info = Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
      return info.get_size();
    } catch {
      return 0;
    }
  }

  private rotate(base: string): string {
    try {
      const oldest = Gio.File.new_for_path(partPath(base, MAX_PARTS));
      if (oldest.query_exists(null)) oldest.delete(null);
    } catch {
      /* nothing to delete */
    }
    // Shift live -> .2 -> .3 ... so the current file starts empty after
    // rotation. `partsToPrune(MAX_PARTS, MAX_PARTS)` is empty by definition,
    // so the previous loop never moved anything and the live file grew past
    // the cap for the rest of the day.
    for (let part = MAX_PARTS - 1; part >= 1; part--) {
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
