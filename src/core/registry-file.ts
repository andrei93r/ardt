// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Registry-file policy, separate from the platform IO that applies it.
 *
 * A 201 MB `registry.json` once made startup parse it in one piece and the
 * Shell died of OOM before any policy could run. The file is therefore gated
 * by size *before* it is read: an oversized or unparseable file is moved aside
 * (gzipped into `backups/`) and startup continues with an empty registry.
 */

import { MAX_REGISTRY_BYTES } from './appregistry.js';
import { utf8ByteLength } from './text.js';

export type RegistryFileAction = 'missing' | 'load' | 'quarantine';

/** What startup may do with a file of `size` bytes (null = stat failed). */
export function registryFileAction(size: number | null, maxBytes = MAX_REGISTRY_BYTES): RegistryFileAction {
  if (size === null || !Number.isFinite(size) || size < 0) return 'missing';
  return size > maxBytes ? 'quarantine' : 'load';
}

/** Serialized size of a registry payload, in UTF-8 bytes. */
export function registryBytes(data: unknown): number {
  return utf8ByteLength(JSON.stringify(data));
}

function stamp(date: Date): string {
  const pad = (value: number): string => `${value}`.padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Backup name for a quarantined registry, e.g.
 * `registry.oversize-20261018-123830.json.gz`. The suffix says why, so a later
 * diagnosis never mistakes it for a live file.
 */
export function quarantineFileName(reason: 'oversize' | 'corrupt', now: Date = new Date()): string {
  return `registry.${reason}-${stamp(now)}.json.gz`;
}
