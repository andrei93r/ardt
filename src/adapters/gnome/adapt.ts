// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Problem-window adaptation (§9). Keyed by `appId` alone; triggered only by a
 * demonstrable geometry refusal. Nothing else is learned (§9.3).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import type { AdaptationRecord } from '../../core/config.js';
import type { Size } from '../../core/types.js';

const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 2000;
const TRUSTED_OBSERVATIONS = 2;
const STUBBORN_COOLDOWN_MS = 60 * 1000;

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

export function readText(path: string): string | null {  let contents: Uint8Array;
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) return null;
    contents = bytes;
  } catch {
    // A missing file is a normal state for the first history entry / state.
    return null;
  }
  let out = '';
  for (const byte of contents) out += String.fromCharCode(byte);
  return out;
}

function readJson(path: string): unknown {
  const text = readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`[adrt] failed to parse ${path}: ${(e as Error).message}`);
    return null;
  }
}

export class AdaptationStore {  private readonly records = new Map<string, AdaptationRecord>();
  private readonly refusals = new Map<string, number>();
  private readonly consecutive = new Map<string, number>();
  private stubbornUntilMs = 0;
  private enabled: boolean;
  private dirty = false;
  private saveSource: number | null = null;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  load(): void {
    const raw = readJson(`${dataDir()}/adaptation.json`);
    if (raw === null || typeof raw !== 'object') return;
    const records = (raw as { records?: Record<string, AdaptationRecord> }).records;
    if (records === undefined) return;
    for (const [appId, record] of Object.entries(records)) {
      this.records.set(appId, { ...record, appId });
    }
  }

  /** Two-second debounce; atomic temp-file write (§20). */
  scheduleSave(): void {
    this.dirty = true;
    if (this.saveSource !== null) return;
    this.saveSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DEBOUNCE_MS, () => {
      this.saveSource = null;
      this.save();
      return GLib.SOURCE_REMOVE;
    });
  }

  save(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const records: Record<string, AdaptationRecord> = {};
    for (const [appId, record] of this.records) records[appId] = record;
    writeAtomic(`${dataDir()}/adaptation.json`, JSON.stringify({ version: 1, records }));
  }

  flush(): void {
    if (this.saveSource !== null) {
      GLib.source_remove(this.saveSource);
      this.saveSource = null;
    }
    this.save();
  }

  destroy(): void {
    this.flush();
  }

  get size(): number {
    return this.records.size;
  }

  get(appId: string): AdaptationRecord | undefined {
    return this.records.get(appId);
  }

  list(): AdaptationRecord[] {
    return [...this.records.values()];
  }

  forget(appId: string): boolean {
    this.refusals.delete(appId);
    this.consecutive.delete(appId);
    const removed = this.records.delete(appId);
    if (removed) this.scheduleSave();
    return removed;
  }

  reset(): void {
    this.records.clear();
    this.refusals.clear();
    this.consecutive.clear();
    this.dirty = true;
    this.scheduleSave();
  }

  /** Replace every record, used by config import (§19.2). */
  replaceAll(records: AdaptationRecord[]): void {
    this.records.clear();
    for (const record of records) this.records.set(record.appId, record);
    this.dirty = true;
    this.scheduleSave();
  }

  /** §9.1: adapt only after a refusal, and only for a previously-seen app. */
  shouldAdapt(appId: string): boolean {
    if (!this.enabled) return false;
    return (this.refusals.get(appId) ?? 0) > 0 || (this.records.get(appId)?.observations ?? 0) >= TRUSTED_OBSERVATIONS;
  }

  isTrusted(appId: string): boolean {
    return (this.records.get(appId)?.observations ?? 0) >= TRUSTED_OBSERVATIONS;
  }

  observeRefusedMin(appId: string, width: number, height: number): void {
    const record = this.record(appId);
    record.refusedMinW = width;
    record.refusedMinH = height;
    this.touch(record);
  }

  observeAccepted(appId: string, width: number, height: number): void {
    const record = this.record(appId);
    record.acceptedW = width;
    record.acceptedH = height;
    record.observations += 1;
    record.settleTimeEma = record.settleTimeEma ?? 100;
    this.touch(record);
  }

  observeUnmaximizeDelay(appId: string, delayMs: number): void {
    const record = this.record(appId);
    record.unmaximizeDelayEma =
      record.unmaximizeDelayEma === undefined ? delayMs : record.unmaximizeDelayEma * 0.7 + delayMs * 0.3;
    this.touch(record);
  }

  observeSettle(appId: string, settleMs: number): void {
    const record = this.record(appId);
    record.settleTimeEma =
      record.settleTimeEma === undefined ? settleMs : record.settleTimeEma * 0.7 + settleMs * 0.3;
    this.touch(record);
  }

  /** Returns true when this refusal made the app stubborn for the session. */
  noteRefusal(appId: string): boolean {
    const count = (this.refusals.get(appId) ?? 0) + 1;
    this.refusals.set(appId, count);
    const consecutive = (this.consecutive.get(appId) ?? 0) + 1;
    this.consecutive.set(appId, consecutive);
    if (count >= 3) {
      const record = this.record(appId);
      record.skipAnimation = true;
      this.touch(record);
    }
    if (consecutive >= 3) {
      this.stubbornUntilMs = Date.now() + STUBBORN_COOLDOWN_MS;
      return true;
    }
    return false;
  }

  noteSuccess(appId: string): void {
    this.consecutive.set(appId, 0);
    const record = this.record(appId);
    record.observations += 1;
    this.touch(record);
  }

  inCooldown(nowMs: number = Date.now()): boolean {
    return nowMs < this.stubbornUntilMs;
  }

  cooldownRemainingMs(nowMs: number = Date.now()): number {
    return Math.max(0, this.stubbornUntilMs - nowMs);
  }

  /** Effective minimum for the next tile, if a refusal was recorded (§9.2). */
  effectiveMin(appId: string): Size | null {
    const record = this.records.get(appId);
    if (record === undefined || !this.isTrusted(appId)) return null;
    if (record.refusedMinW === undefined || record.refusedMinH === undefined) return null;
    return { width: record.refusedMinW, height: record.refusedMinH };
  }

  /** Add the learned unmaximize delay to the profile delay (§11.1). */
  delayFor(appId: string, profileDelayMs: number): number {
    const record = this.records.get(appId);
    const learned = record?.unmaximizeDelayEma ?? 0;
    return Math.max(profileDelayMs, Math.round(learned));
  }

  settleFor(appId: string, fallbackMs = 100): number {
    const record = this.records.get(appId);
    if (record?.settleTimeEma === undefined || !this.isTrusted(appId)) return fallbackMs;
    return Math.max(fallbackMs, Math.round(record.settleTimeEma));
  }

  skipAnimation(appId: string): boolean {
    return this.enabled && this.records.get(appId)?.skipAnimation === true;
  }

  prune(nowMs: number = Date.now()): void {
    for (const [appId, record] of this.records) {
      if (nowMs - record.lastSeen > PRUNE_AFTER_MS) {
        this.records.delete(appId);
        this.dirty = true;
      }
    }
  }

  private record(appId: string): AdaptationRecord {
    let record = this.records.get(appId);
    if (record === undefined) {
      record = { appId, firstSeen: Date.now(), lastSeen: Date.now(), observations: 0 };
      this.records.set(appId, record);
    }
    return record;
  }

  private touch(record: AdaptationRecord): void {
    record.lastSeen = Date.now();
    this.scheduleSave();
  }
}

/**
 * §20 `behavior.json`: the app classes the user has opted to keep floating
 * (§9.3 — floats are user-driven and persistence is opt-in).
 */
export class FloatStore {
  private readonly floats = new Set<string>();
  private enabled: boolean;
  private dirty = false;
  private saveSource: number | null = null;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  load(): void {
    const raw = readJson(`${dataDir()}/behavior.json`);
    if (raw === null || typeof raw !== 'object') return;
    const floats = (raw as { floats?: unknown }).floats;
    if (!Array.isArray(floats)) return;
    for (const appId of floats) {
      if (typeof appId === 'string') this.floats.add(appId);
    }
  }

  has(appId: string): boolean {
    return this.enabled && this.floats.has(appId);
  }

  list(): string[] {
    return [...this.floats];
  }

  set(appId: string, floating: boolean): void {
    if (!this.enabled) return;
    if (floating) this.floats.add(appId);
    else this.floats.delete(appId);
    this.scheduleSave();
  }

  forget(appId: string): boolean {
    const removed = this.floats.delete(appId);
    if (removed) this.scheduleSave();
    return removed;
  }

  /** Replace the whole set, used by config import (§19.2). */
  replace(appIds: string[]): void {
    this.floats.clear();
    for (const appId of appIds) this.floats.add(appId);
    this.scheduleSave();
  }

  scheduleSave(): void {
    this.dirty = true;
    if (this.saveSource !== null) return;
    this.saveSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DEBOUNCE_MS, () => {
      this.saveSource = null;
      this.save();
      return GLib.SOURCE_REMOVE;
    });
  }

  save(): void {
    if (!this.dirty) return;
    this.dirty = false;
    writeAtomic(`${dataDir()}/behavior.json`, JSON.stringify({ version: 1, floats: this.list() }));
  }

  flush(): void {
    if (this.saveSource !== null) {
      GLib.source_remove(this.saveSource);
      this.saveSource = null;
    }
    this.save();
  }

  destroy(): void {
    this.flush();
  }
}
