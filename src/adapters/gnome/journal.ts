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

import { partPath, partsToPrune, shouldRotate } from '../../core/rotation.js';
import { clipPayload } from '../../core/text.js';
import { dataDir, readText, writeAtomic } from './adapt.js';

/** Rotated parts kept per day before the oldest is deleted. */
const MAX_PARTS = 5;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
/** Ring buffer size: enough for a run's worth of `DumpEvents` without growth. */
const RING = 4000;

export interface JournalEntry {
  seq: number;
  source: string;
  event: string;
  at: number;
  /** The history trace this entry corresponds to, when it is a decision. */
  trace?: number;
  [field: string]: unknown;
}

function dayString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function encodeText(text: string): Uint8Array {
  const Encoder = (globalThis as { TextEncoder?: new () => { encode(input: string): Uint8Array } }).TextEncoder;
  if (typeof Encoder !== 'function') throw new Error('TextEncoder unavailable');
  return new Encoder().encode(text);
}

function journalDir(): string {
  const dir = `${dataDir()}/journal`;
  GLib.mkdir_with_parents(dir, 0o755);
  return dir;
}

export class EventJournal {
  private seq = 0;
  private readonly ring: JournalEntry[] = [];
  private readonly decisions: JournalEntry[] = [];
  private written = 0;
  private maxBytes: number;
  /**
   * Optional sink for every written entry (the bug recorder, §22 extension).
   * Null when nothing is recording, so the funnel costs one null check.
   */
  private sink: ((entry: JournalEntry) => void) | null = null;

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
    while (this.decisions.length > RING) this.decisions.shift();
    this.writeLine(entry);
    return entry;
  }

  /** The last `limit` journal entries, optionally filtered by a substring. */
  tail(limit = 200, filter = ''): JournalEntry[] {
    const all = filter.length > 0
      ? this.ring.filter((e) => e.event.includes(filter) || e.source.includes(filter))
      : this.ring;
    const n = Math.max(0, Math.trunc(limit));
    return n === 0 ? [] : all.slice(Math.max(0, all.length - n));
  }

  /** The last `limit` decisions. */
  decisionsTail(limit = 200): JournalEntry[] {
    const n = Math.max(0, Math.trunc(limit));
    return n === 0 ? [] : this.decisions.slice(Math.max(0, this.decisions.length - n));
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
      let info: any;
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
    this.ring.length = 0;
    this.decisions.length = 0;
  }

  private make(source: string, event: string, data?: Record<string, unknown>): JournalEntry {
    this.seq += 1;
    const safe = data === undefined ? {} : (clipPayload(data) as Record<string, unknown>);
    return { seq: this.seq, source, event, at: Date.now(), ...safe };
  }

  private append(entry: JournalEntry): JournalEntry {
    this.ring.push(entry);
    while (this.ring.length > RING) this.ring.shift();
    this.writeLine(entry);
    return entry;
  }

  private writeLine(entry: JournalEntry): void {
    if (this.sink !== null) {
      try {
        this.sink(entry);
      } catch {
        /* recording must never break logging */
      }
    }
    const base = `${journalDir()}/${dayString(new Date())}.jsonl`;
    let path = base;
    if (shouldRotate(this.sizeOf(base), this.maxBytes)) path = this.rotate(base);
    const line = `${JSON.stringify(entry)}\n`;
    try {
      const stream = Gio.File.new_for_path(path).append_to(Gio.FileCreateFlags.NONE, null);
      stream.write_all(encodeText(line), null);
      stream.close(null);
      this.written += 1;
    } catch {
      // Bounded by rotation, so a read-modify-write fallback is acceptable.
      try {
        writeAtomic(path, `${readText(path) ?? ''}${line}`);
        this.written += 1;
      } catch {
        /* never let logging break the shell */
      }
    }
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
    for (const part of partsToPrune(MAX_PARTS, MAX_PARTS)) {
      const from = Gio.File.new_for_path(partPath(base, part - 1));
      const to = Gio.File.new_for_path(partPath(base, part));
      try {
        if (from.query_exists(null)) from.move(to, Gio.FileCopyFlags.OVERWRITE, null, null);
      } catch {
        /* skip a part that cannot move */
      }
    }
    return base;
  }
}
