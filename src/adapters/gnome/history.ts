// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Event log and undo history (§21, §15). JSON lines rotate daily under
 * `$XDG_DATA_HOME/adrt/history/`.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import type { Rect } from '../../core/types.js';
import { clipPayload } from '../../core/text.js';
import { partPath, partsToPrune, shouldRotate } from '../../core/rotation.js';
import { dataDir, readText, writeAtomic } from './adapt.js';

/** Rotated parts kept per day before the oldest is deleted. */
const MAX_HISTORY_PARTS = 5;
/** Default size of one part (bytes). */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export interface HistoryEvent {
  t: number;
  ev: string;
  trace: number;
  [field: string]: unknown;
}

export interface UndoEntry {
  workspaceId: number;
  trace: number;
  rects: { id: number; rect: Rect }[];
  /**
   * §15: the split ratios that produced `rects`. Undo must restore them too,
   * otherwise the plan disagrees with the restored layout and the very next
   * reconcile (scan tick, periodic pass) re-tiles over the undo.
   */
  ratios?: Record<string, number>;
}

function dayString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * UTF-8 encode one log line for a Gio stream. `TextEncoder` is present in the
 * GJS that GNOME 45+ ships; if it ever is not, the caller falls back.
 */
function encodeText(text: string): Uint8Array {
  const Encoder = (globalThis as { TextEncoder?: new () => { encode(input: string): Uint8Array } }).TextEncoder;
  if (typeof Encoder !== 'function') throw new Error('TextEncoder unavailable');
  return new Encoder().encode(text);
}

function historyDir(): string {
  const dir = `${dataDir()}/history`;
  GLib.mkdir_with_parents(dir, 0o755);
  return dir;
}

export class UndoStack {
  private readonly entries: UndoEntry[] = [];
  private trace = 0;

  constructor(private maxSize: number) {}

  setMaxSize(size: number): void {
    this.maxSize = Math.max(0, size);
    this.trim();
  }

  /** §15: only a retile that actually moved a tileable window is undoable. */
  push(workspaceId: number, rects: { id: number; rect: Rect }[], moved: boolean, ratios?: Record<string, number>): boolean {
    if (!moved || rects.length === 0) return false;
    this.trace += 1;
    const entry: UndoEntry = { workspaceId, trace: this.trace, rects };
    if (ratios !== undefined) entry.ratios = { ...ratios };
    this.entries.push(entry);
    this.trim();
    return true;
  }

  pop(): UndoEntry | null {
    return this.entries.pop() ?? null;
  }

  get size(): number {
    return this.entries.length;
  }

  toJSON(): UndoEntry[] {
    return [...this.entries];
  }

  restore(entries: UndoEntry[]): void {
    this.entries.length = 0;
    for (const entry of entries) this.entries.push(entry);
    this.trace = entries.reduce((max, entry) => Math.max(max, entry.trace), 0);
    this.trim();
  }

  private trim(): void {
    while (this.entries.length > this.maxSize) this.entries.shift();
  }
}

export class History {
  private trace = 0;
  private enabled: boolean;
  private retentionDays: number;
  private dailyFolders: boolean;
  private tailMonitor: any = null;

  /** Size at which the live part rotates (bytes). */
  private maxBytes = DEFAULT_MAX_BYTES;
  /** Diagnostics: events actually written (not the ones dropped while disabled). */
  private written = 0;

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
    return event;
  }

  days(): string[] {
    const directory = Gio.File.new_for_path(historyDir());
    const enumerator = directory.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    const days: string[] = [];
    let info: any;
    while ((info = enumerator.next_file(null)) !== null) {
      const name: string = info.get_name();
      if (name.endsWith('.jsonl')) days.push(name.slice(0, -'.jsonl'.length));
    }
    days.sort();
    return days;
  }

  lookup(windowId: number, maxDays = 7): HistoryEvent[] {
    const all = this.days().slice(-maxDays);
    const results: HistoryEvent[] = [];
    for (let i = all.length - 1; i >= 0; i--) {
      const text = readText(this.pathFor(all[i]));
      if (text === null) continue;
      for (const line of text.split('\n')) {
        if (line.length === 0) continue;
        let event: HistoryEvent;
        try {
          event = JSON.parse(line) as HistoryEvent;
        } catch {
          continue;
        }
        if (event.id === windowId || event.surfaceId === windowId) results.push(event);
      }
    }
    return results;
  }

  /** Watch today's file and emit appended events (§21). */
  tail(cb: (event: HistoryEvent) => void): () => void {
    const file = Gio.File.new_for_path(this.pathFor(dayString(new Date())));
    if (!file.query_exists(null)) file.create(Gio.FileCreateFlags.NONE, null);
    this.tailMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
    this.tailMonitor.connect('changed', () => {
      // Rotation keeps a part bounded, so reading it whole is safe here.
      const text = readText(file.get_path());
      if (text === null) return;
      for (const line of text.trimEnd().split('\n')) {
        if (line.length === 0) continue;
        try {
          cb(JSON.parse(line) as HistoryEvent);
        } catch {
          continue;
        }
      }
    });
    return () => this.stopTail();
  }

  prune(now: Date = new Date()): number {
    if (!this.enabled) return 0;
    const cutoff = new Date(now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000);
    const cutoffDay = dayString(cutoff);
    let removed = 0;
    for (const day of this.days()) {
      if (day >= cutoffDay) continue;
      const file = Gio.File.new_for_path(this.pathFor(day));
      file.delete(null);
      for (const part of partsToPrune(MAX_HISTORY_PARTS, 1)) {
        const extra = Gio.File.new_for_path(partPath(this.pathFor(day), part));
        try {
          if (extra.query_exists(null)) {
            extra.delete(null);
            removed += 1;
          }
        } catch {
          /* already gone */
        }
      }
      removed += 1;
    }
    return removed;
  }

  destroy(): void {
    this.stopTail();
  }

  private stopTail(): void {
    if (this.tailMonitor !== null) {
      this.tailMonitor.cancel();
      this.tailMonitor = null;
    }
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
   * Append one JSON line. This must never read the file back: the old
   * read-modify-write version loaded the whole file into a string per event,
   * which is what turned a 200 MB log into an out-of-memory crash.
   */
  private append(event: HistoryEvent): void {
    const day = dayString(new Date());
    const base = this.pathFor(day);
    let path = base;
    if (shouldRotate(this.sizeOf(base), this.maxBytes)) path = this.rotate(base);
    const line = `${JSON.stringify(event)}\n`;
    try {
      const stream = Gio.File.new_for_path(path).append_to(Gio.FileCreateFlags.NONE, null);
      stream.write_all(encodeText(line), null);
      stream.close(null);
    } catch {
      // Last resort (unusual filesystem or no TextEncoder): the part is bounded
      // by rotation, so a read-modify-write here is acceptable.
      writeAtomic(path, `${readText(path) ?? ''}${line}`);
    }
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
