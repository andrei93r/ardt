// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Shared JSON-on-disk persistence helpers: the data directory, atomic writes,
 * UTF-8 text reads, bounded line streaming and gzip backups. The stores that
 * own each file (journal, history, recorder, registry) live in their own
 * modules.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import type { ConverterOutputStream, FileInputStream } from 'gi://Gio';

import { LineFramer, decodeText } from '../../core/jsonl.js';

/** Bytes read from a file or log in one chunk while streaming lines. */
const READ_CHUNK_BYTES = 64 * 1024;
/** Bytes copied per pass while gzipping a quarantined file. */
const GZIP_CHUNK_BYTES = 64 * 1024;

export function dataDir(): string {
  const dir = `${GLib.get_user_data_dir()}/adrt`;
  GLib.mkdir_with_parents(dir, 0o755);
  return dir;
}

export function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  GLib.file_set_contents(tmp, text);
  Gio.File.new_for_path(tmp).move(Gio.File.new_for_path(path), Gio.FileCopyFlags.OVERWRITE, null, null);
}

/** Size of a file in bytes, or null when it cannot be stat'ed. */
export function fileSize(path: string): number | null {
  try {
    const info = Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
    return info.get_size();
  } catch {
    return null;
  }
}

/**
 * Read a text file as UTF-8. Decoding the bytes with `String.fromCharCode`
 * (Latin-1) used to corrupt every non-ASCII character; the next write then
 * re-encoded that mojibake as UTF-8 and each round-trip doubled the text.
 */
export function readText(path: string): string | null {
  let contents: Uint8Array;
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) return null;
    contents = bytes;
  } catch {
    // A missing file is a normal state for the first history entry / state.
    return null;
  }
  return decodeText(contents);
}

export function readJson(path: string): unknown {
  const text = readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`[adrt] failed to parse ${path}: ${(e as Error).message}`);
    return null;
  }
}

export interface LineReadOptions {
  /** Byte offset to resume at (a tail keeps this between monitor events). */
  offset?: number;
  /** Stop after roughly this many bytes; 0 or absent means the whole file. */
  maxBytes?: number;
}

export interface LineReadResult {
  /** Offset just past the last complete line actually consumed. */
  bytes: number;
  /** False when a partial line is still buffered (a write was mid-line). */
  complete: boolean;
}

/**
 * Stream a JSONL file line by line, never loading it whole. Chunks are framed
 * with `LineFramer`, which only emits newline-terminated lines, so:
 *
 * - a large log costs one chunk of memory, not one file;
 * - a UTF-8 sequence or a line split across two chunks is decoded correctly;
 * - `bytes` advances only past complete lines, so a tail can resume there and
 *   a partial write is retried on the next event.
 */
export function readLines(
  path: string,
  onLine: (line: string) => void,
  options: LineReadOptions = {},
): LineReadResult {
  const start = Math.max(0, options.offset ?? 0);
  const maxBytes = options.maxBytes !== undefined && options.maxBytes > 0 ? options.maxBytes : 0;
  const framer = new LineFramer();
  let stream: FileInputStream | null = null;
  let total = start;
  try {
    stream = Gio.File.new_for_path(path).read(null);
    if (start > 0) {
      if (!stream.seek(start, GLib.SeekType.SET, null)) return { bytes: 0, complete: false };
    }
    for (;;) {
      const chunk = stream.read_bytes(READ_CHUNK_BYTES, null);
      if (chunk.get_size() === 0) break;
      const result = framer.push(chunk.toArray());
      total += result.consumed;
      for (const line of result.lines) {
        try {
          onLine(line);
        } catch {
          // One bad line must not abort the rest of the stream.
        }
      }
      if (maxBytes > 0 && total - start >= maxBytes) break;
    }
    return { bytes: total, complete: framer.bufferedBytes === 0 };
  } catch {
    return { bytes: total, complete: false };
  } finally {
    try {
      stream?.close(null);
    } catch {
      /* already closed */
    }
  }
}

/**
 * Gzip `sourcePath` into `targetPath` while streaming, then leave the caller to
 * delete the source. Used to quarantine a corrupt/oversized registry without
 * ever holding it in memory. Throws so the caller can fall back to a move.
 */
export function gzipFile(sourcePath: string, targetPath: string): void {
  let input: FileInputStream | null = null;
  let output: ConverterOutputStream | null = null;
  try {
    input = Gio.File.new_for_path(sourcePath).read(null);
    const base = Gio.File.new_for_path(targetPath).replace(
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null,
    );
    output = Gio.ConverterOutputStream.new(
      base,
      new Gio.ZlibCompressor({ format: Gio.ZlibCompressorFormat.GZIP, level: 6 }),
    );
    for (;;) {
      const chunk = input.read_bytes(GZIP_CHUNK_BYTES, null);
      if (chunk.get_size() === 0) break;
      output.write_all(chunk.toArray(), null);
    }
    output.close(null);
    output = null;
    input.close(null);
    input = null;
  } finally {
    try {
      output?.close(null);
    } catch {
      /* the primary error is more useful */
    }
    try {
      input?.close(null);
    } catch {
      /* already closed */
    }
  }
}
