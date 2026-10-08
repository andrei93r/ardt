// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Shared JSONL primitives for the on-disk stores (history §21, journal §22,
 * recorder §22 extension). Each store still owns its directory, file layout,
 * rotation caps, retention window, Gio stream and GLib flush timer; these are
 * only the pure pieces they repeat: the local day key, UTF-8 line
 * serialization, and the buffered lines waiting for the next flush. No IO and
 * no compositor API, so `core/` stays pure and deterministic.
 */

/** `YYYY-MM-DD` in local time, the day-file key the stores share. */
export function dayString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * UTF-8 encode one line for a Gio stream. `TextEncoder` is present in the GJS
 * that GNOME 45+ ships; if it ever is not, the caller keeps its fallback.
 */
export function encodeText(text: string): Uint8Array {
  const Encoder = (globalThis as { TextEncoder?: new () => { encode(input: string): Uint8Array } }).TextEncoder;
  if (typeof Encoder !== 'function') throw new Error('TextEncoder unavailable');
  return new Encoder().encode(text);
}

/** One JSON line: `JSON.stringify` plus the newline the JSONL format needs. */
export function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/** One drained batch: the day it belongs to and its serialized lines. */
export interface JsonlBatch {
  day: string;
  text: string;
  count: number;
}

/**
 * The lines a store accumulates between flushes. Pure: the store owns the
 * timer, the stream and the rotation decision; this only remembers which day
 * the pending lines belong to and hands them back as one batch. A batch never
 * spans two days, because the store flushes before pushing a new day's line.
 */
export class JsonlBuffer {
  private lines: string[] = [];
  private day = '';

  get length(): number {
    return this.lines.length;
  }

  /** True when lines are pending for a day other than `day` (flush first). */
  rollsOver(day: string): boolean {
    return this.lines.length > 0 && this.day !== day;
  }

  /** Buffer one serialized line for `day`. */
  push(day: string, line: string): void {
    if (this.lines.length === 0) this.day = day;
    this.lines.push(line);
  }

  /** Take every buffered line as one batch, or null when nothing is pending. */
  drain(): JsonlBatch | null {
    if (this.lines.length === 0) return null;
    const batch: JsonlBatch = { day: this.day, text: this.lines.join(''), count: this.lines.length };
    this.lines = [];
    this.day = '';
    return batch;
  }
}
