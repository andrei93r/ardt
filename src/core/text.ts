// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Text taken from a client (window titles, app ids) is unbounded: a client can
 * report a title of millions of characters, and a corrupted one can grow on
 * every read. Clipping it at the edges keeps it out of our memory, our logs and
 * our DumpState payloads.
 */

/** Longest client text we keep (a window title). */
export const MAX_TEXT = 256;
/** Longest string we allow in one history payload field. */
export const MAX_LOG_TEXT = 512;

/** Strip control characters and bound the length of client-provided text. */
export function clipText(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

/**
 * UTF-8 byte length of a string, counted without allocating an encoded copy.
 * Used to gate a serialized file against a byte cap before writing it; JS
 * `string.length` counts UTF-16 code units, which understates non-ASCII text.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Deep-clip the string values of a history payload, so one pathological client
 * string (or a corrupted one that grows) can never produce a giant log line.
 */
export function clipPayload(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return clipText(value, MAX_LOG_TEXT);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= 3) return '…';
  if (Array.isArray(value)) return value.map((item) => clipPayload(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = clipPayload(item, depth + 1);
  }
  return out;
}
