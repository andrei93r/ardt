// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * History log rotation (§21). One JSONL file per day, split into numbered parts
 * so no single file can grow without limit (a 268 MB file once exhausted memory
 * and crashed the Shell).
 */

/** Whether the current part has grown to the rotation threshold. */
export function shouldRotate(currentBytes: number, maxBytes: number): boolean {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return false;
  return currentBytes >= maxBytes;
}

/**
 * Path of a rotated part. Part 1 is the live file itself; parts 2..N are the
 * older ones, highest number oldest.
 *   "/x/2026-09-30.jsonl", 2 -> "/x/2026-09-30.2.jsonl"
 */
export function partPath(basePath: string, part: number): string {
  if (part <= 1) return basePath;
  return basePath.replace(/\.jsonl$/, `.${part}.jsonl`);
}

/**
 * Part numbers to delete so that at most `maxParts` remain (highest first).
 * At least one part (the live file) is always kept, so a cap below 1 is
 * treated as 1.
 */
export function partsToPrune(highestPart: number, maxParts: number): number[] {
  const keep = Number.isFinite(maxParts) && maxParts >= 1 ? Math.floor(maxParts) : 1;
  const out: number[] = [];
  for (let part = highestPart; part > keep; part--) out.push(part);
  return out;
}
