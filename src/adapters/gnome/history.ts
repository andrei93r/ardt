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
import { dataDir, readText, writeAtomic } from './adapt.js';

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
}

function dayString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  push(workspaceId: number, rects: { id: number; rect: Rect }[], moved: boolean): boolean {
    if (!moved || rects.length === 0) return false;
    this.trace += 1;
    this.entries.push({ workspaceId, trace: this.trace, rects });
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

  constructor(enabled: boolean, retentionDays: number, dailyFolders: boolean) {
    this.enabled = enabled;
    this.retentionDays = retentionDays;
    this.dailyFolders = dailyFolders;
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
    const event: HistoryEvent = { t: Date.now(), ev, trace, ...fields };
    if (typeof fields.trace === 'number') event.trace = fields.trace;
    this.append(event);
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

  private append(event: HistoryEvent): void {
    const path = this.pathFor(dayString(new Date()));
    const existing = readText(path) ?? '';
    writeAtomic(path, `${existing}${JSON.stringify(event)}\n`);
  }
}
