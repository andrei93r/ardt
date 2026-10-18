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

/**
 * Decode raw file bytes as UTF-8. The old Latin-1 loop
 * (`String.fromCharCode(byte)`) turned every non-ASCII byte into a code point
 * of its own; writing that string back as UTF-8 then doubled the mojibake on
 * every read/write round-trip and grew the registry exponentially.
 */
export function decodeText(bytes: Uint8Array): string {
  const Decoder = (globalThis as { TextDecoder?: new (label?: string) => { decode(input?: Uint8Array): string } }).TextDecoder;
  if (typeof Decoder !== 'function') throw new Error('TextDecoder unavailable');
  return new Decoder('utf-8').decode(bytes);
}

/** One complete line is never allowed to buffer more than this while streaming. */
const MAX_LINE_BYTES = 1024 * 1024;

/** One framing pass: the complete lines and how many raw bytes they used. */
export interface FramedLines {
  lines: string[];
  /** Bytes up to and including the last newline; safe to add to a read offset. */
  consumed: number;
}

/**
 * Incremental UTF-8 JSONL framing for streamed reads. Chunks may split a line
 * anywhere (including inside a multi-byte UTF-8 sequence); only complete,
 * newline-terminated lines are decoded and emitted. A partial trailing line
 * stays buffered for the next chunk, and a line longer than `maxLineBytes` is
 * dropped instead of buffering an unbounded string.
 *
 * Pure: the adapter owns the stream, this owns the boundaries. `consumed` is
 * byte-accurate, so a tail can resume where the previous pass stopped and a
 * partial write is re-read once its newline arrives.
 */
export class LineFramer {
  private carry = new Uint8Array(0);
  private skipping = false;

  constructor(private readonly maxLineBytes = MAX_LINE_BYTES) {}

  /** Bytes held for a line whose newline has not arrived yet. */
  get bufferedBytes(): number {
    return this.carry.length;
  }

  push(chunk: Uint8Array): FramedLines {
    if (chunk.length === 0) return { lines: [], consumed: 0 };
    const data = new Uint8Array(this.carry.length + chunk.length);
    data.set(this.carry, 0);
    data.set(chunk, this.carry.length);

    const lines: string[] = [];
    let start = 0;
    for (let index = 0; index < data.length; index += 1) {
      if (data[index] !== 0x0a) continue;
      let end = index;
      if (end > start && data[end - 1] === 0x0d) end -= 1;
      const bytes = data.subarray(start, end);
      if (this.skipping) {
        this.skipping = false;
      } else if (bytes.length <= this.maxLineBytes) {
        lines.push(decodeText(bytes));
      }
      start = index + 1;
    }

    this.carry = data.slice(start);
    if (this.carry.length > this.maxLineBytes) {
      // No newline in sight: discard the oversized line and keep scanning.
      this.carry = new Uint8Array(0);
      this.skipping = true;
    }
    return { lines, consumed: start };
  }
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
