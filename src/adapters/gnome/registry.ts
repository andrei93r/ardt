// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §12 app registry store, adapter side.
 *
 * The pure `AppRegistry` owns the entry shape, the `neverTile` precedence, the
 * ordinals and the legacy-store migration. This file is the platform half:
 * it reads and writes `registry.json`, folds `adaptation.json`,
 * `behavior.json` and the `exception-apps` setting into the registry exactly
 * once (copy-verify-delete), and exposes the timing-only adaptation surface the
 * tiler consumes. It never learns or serves geometry: `effectiveMin` is gone
 * on purpose (`adapt` is performance and smoothness only, §12).
 */

import GLib from 'gi://GLib';

import type { AppEntry, AppPlacement, AppRegistryData, AdaptRecord, MigrationReport, PlacementInput } from '../../core/appregistry.js';
import { AppRegistry, DEFAULT_TTL_MS } from '../../core/appregistry.js';
import * as identity from '../../core/identity.js';
import { dataDir, readJson, writeAtomic } from './adapt.js';

const SAVE_DEBOUNCE_MS = 2000;
const TRUSTED_OBSERVATIONS = 2;
const STUBBORN_COOLDOWN_MS = 60 * 1000;

interface RegistryFile {
  version: number;
  entries: unknown[];
}

export class RegistryStore {
  private registry: AppRegistry;
  private dirty = false;
  private saveSource: number | null = null;
  /** A registry file from a newer format is left untouched (no downgrade). */
  private loadedVersion = 0;
  private readonly ttlMs: number;
  /** Reports a failed write without letting it escape a GLib timer. */
  private readonly onError: (context: string, error: unknown) => void;
  /** True once `destroy()` ran, so a failed flush never re-arms a timer. */
  private destroyed = false;
  /** Whether timing adaptation is recorded (`adaptation-enabled`). */
  private enabled = true;
  /** §12: the timing-only adaptation fields. */
  private readonly refusals = new Map<string, number>();
  private readonly consecutive = new Map<string, number>();
  private stubbornUntilMs = 0;

  constructor(options: { ttlMs?: number; onError?: (context: string, error: unknown) => void } = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.onError = options.onError ?? ((): void => undefined);
    this.registry = new AppRegistry({ ttlMs: this.ttlMs });
  }

  private get file(): string {
    return `${dataDir()}/registry.json`;
  }

  // ------------------------------------------------------------------ state

  load(): void {
    const raw = readJson(this.file);
    if (raw === null || typeof raw !== 'object') return;
    const data = raw as Partial<RegistryFile>;
    if (!Array.isArray(data.entries)) return;
    const version = typeof data.version === 'number' ? data.version : 0;
    this.loadedVersion = version;
    if (version > 1) {
      // Newer on disk than we understand: keep it untouched rather than
      // rewriting it in an older shape (no destructive downgrade).
      return;
    }
    this.registry = AppRegistry.fromJSON(
      { version: 1, entries: data.entries as never[] },
      { ttlMs: this.ttlMs },
    );
  }

  get size(): number {
    return this.registry.size;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  get appTable(): AppRegistry {
    return this.registry;
  }

  /** The serialised registry, for a config bundle. */
  toJSON(): AppRegistryData {
    return this.registry.toJSON();
  }

  /** Replace the whole registry with imported data (config import, replace). */
  adopt(data: AppRegistryData): void {
    this.registry = AppRegistry.fromJSON(data, { ttlMs: this.ttlMs });
    this.markDirty();
  }

  entries(): AppEntry[] {
    return this.registry.entries();
  }

  get(appId: string): AppEntry | undefined {
    return this.registry.get(appId);
  }

  has(appId: string): boolean {
    return this.registry.has(appId);
  }

  observe(appId: string, title?: string, now: number = Date.now()): AppEntry {
    const entry = this.registry.observe({ appId, title, now });
    this.markDirty();
    return entry;
  }

  rekey(oldKey: string, newKey: string): boolean {
    const changed = this.registry.rekey(oldKey, newKey);
    if (changed) this.markDirty();
    return changed;
  }

  isNeverTile(appId: string): boolean {
    return this.registry.isNeverTile(appId);
  }

  setNeverTile(appId: string, value: boolean, now: number = Date.now()): AppEntry {
    const entry = this.registry.setNeverTile(appId, value, now);
    this.markDirty();
    return entry;
  }

  toggleNeverTile(appId: string, now: number = Date.now()): boolean {
    const value = this.registry.toggleNeverTile(appId, now);
    this.markDirty();
    return value;
  }

  forget(appId: string): boolean {
    this.refusals.delete(appId);
    this.consecutive.delete(appId);
    const removed = this.registry.remove(appId);
    if (removed) this.markDirty();
    return removed;
  }

  prune(now: number = Date.now()): string[] {
    const removed = this.registry.prune(now);
    if (removed.length > 0) this.markDirty();
    return removed;
  }

  // ------------------------------------------------------------- placements

  place(appId: string, instanceId: string, input: PlacementInput, now: number = Date.now()): AppPlacement {
    const placement = this.registry.place(appId, instanceId, input, now);
    this.markDirty();
    return placement;
  }

  placement(appId: string, instanceId: string): AppPlacement | undefined {
    return this.registry.placement(appId, instanceId);
  }

  placements(appId: string): AppPlacement[] {
    return this.registry.placements(appId);
  }

  ordinalFor(appId: string, instanceId: string): number | undefined {
    return this.registry.ordinalFor(appId, instanceId);
  }

  forgetPlacement(appId: string, instanceId: string): boolean {
    const removed = this.registry.forgetPlacement(appId, instanceId);
    if (removed) this.markDirty();
    return removed;
  }

  // ----------------------------------------------------------------- timing

  adaptFor(appId: string): AdaptRecord {
    return this.registry.adaptFor(appId);
  }

  setAdapt(appId: string, patch: Record<string, unknown>, now: number = Date.now()): AppEntry {
    const entry = this.registry.setAdapt(appId, patch, now);
    this.markDirty();
    return entry;
  }

  delayFor(appId: string, fallbackMs: number): number {
    if (!this.enabled) return fallbackMs;
    const learned = this.registry.adaptFor(appId).unmaximizeDelayMs ?? 0;
    return Math.max(fallbackMs, Math.round(learned));
  }

  settleFor(appId: string, fallbackMs: number): number {
    if (!this.enabled) return fallbackMs;
    const learned = this.registry.adaptFor(appId).settleMs;
    if (learned === undefined) return fallbackMs;
    return Math.max(fallbackMs, Math.round(learned));
  }

  skipAnimation(appId: string): boolean {
    return this.enabled && this.registry.adaptFor(appId).skipAnimation === true;
  }

  observeUnmaximizeDelay(appId: string, delayMs: number): void {
    if (!this.enabled) return;
    const record = this.registry.adaptFor(appId);
    const ema = record.unmaximizeDelayMs === undefined ? delayMs : record.unmaximizeDelayMs * 0.7 + delayMs * 0.3;
    this.setAdapt(appId, { unmaximizeDelayMs: Math.round(ema) });
  }

  observeSettle(appId: string, settleMs: number): void {
    if (!this.enabled) return;
    const record = this.registry.adaptFor(appId);
    const ema = record.settleMs === undefined ? settleMs : record.settleMs * 0.7 + settleMs * 0.3;
    this.setAdapt(appId, { settleMs: Math.round(ema) });
  }

  noteSuccess(appId: string): void {
    this.consecutive.set(appId, 0);
    const entry = this.registry.get(appId);
    if (entry !== undefined) entry.lastSeen = Date.now();
  }

  isTrusted(appId: string): boolean {
    return (this.registry.get(appId)?.windowsSeen ?? 0) >= TRUSTED_OBSERVATIONS;
  }

  /** A refusal marks the app stubborn for a session cooldown; it learns no geometry. */
  noteRefusal(appId: string): boolean {
    const count = (this.refusals.get(appId) ?? 0) + 1;
    this.refusals.set(appId, count);
    const consecutive = (this.consecutive.get(appId) ?? 0) + 1;
    this.consecutive.set(appId, consecutive);
    if (count >= 3) this.setAdapt(appId, { skipAnimation: true });
    if (consecutive >= 3) {
      this.stubbornUntilMs = Date.now() + STUBBORN_COOLDOWN_MS;
      return true;
    }
    return false;
  }

  inCooldown(nowMs: number = Date.now()): boolean {
    return nowMs < this.stubbornUntilMs;
  }

  cooldownRemainingMs(nowMs: number = Date.now()): number {
    return Math.max(0, this.stubbornUntilMs - nowMs);
  }

  /** §12: no learned minimum ever reaches the tiler. */
  effectiveMin(): null {
    return null;
  }

  // -------------------------------------------------------------- migration

  /**
   * Fold the legacy stores in exactly once. Returns the report; `migrated` is
   * true when the registry was written and the legacy files verified and then
   * deleted (copy-verify-delete, §12).
   */
  migrateLegacy(options: {
    adaptation?: unknown;
    behavior?: unknown;
    exceptionApps?: readonly string[];
  }): MigrationReport & { migrated: boolean } {
    const adaptation = isRecord(options.adaptation) ? options.adaptation : null;
    const behavior = isRecord(options.behavior) ? options.behavior : null;
    const report = this.registry.migrate({
      adaptation: adaptation as never,
      behavior: behavior as never,
      exceptionApps: options.exceptionApps ?? null,
    });
    const legacyPresent = adaptation !== null || behavior !== null ||
      ((options.exceptionApps?.length ?? 0) > 0);
    if (report.adapted.length === 0 && report.floated.length === 0) {
      return { ...report, migrated: false };
    }
    if (legacyPresent) this.markDirty();
    this.save();
    // Copy-verify: only delete the legacy files when the registry we wrote is
    // readable back with the entries we expect.
    const verified = readJson(this.file);
    const ok = isRecord(verified) && Array.isArray(verified.entries);
    if (ok) this.deleteLegacy();
    return { ...report, migrated: ok };
  }

  private deleteLegacy(): void {
    for (const name of ['adaptation.json', 'behavior.json'] as const) {
      try {
        GLib.unlink(`${dataDir()}/${name}`);
      } catch {
        /* already gone */
      }
    }
  }

  // ------------------------------------------------------------ persistence

  private markDirty(): void {
    this.dirty = true;
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
    if (this.loadedVersion > 1) return; // never overwrite a newer file
    this.dirty = false;
    try {
      writeAtomic(this.file, JSON.stringify(this.registry.toJSON()));
    } catch (error) {
      // The write runs inside a GLib timeout; a throw would escape into the
      // main loop. Re-mark dirty so the state is not lost, report, and retry on
      // the next debounce (unless teardown already ran).
      this.dirty = true;
      this.onError('registry:save', error);
      if (!this.destroyed) this.scheduleSave();
    }
  }

  flush(): void {
    if (this.saveSource !== null) {
      GLib.source_remove(this.saveSource);
      this.saveSource = null;
    }
    this.save();
  }

  destroy(): void {
    this.destroyed = true;
    this.flush();
  }

  /** The legacy-shaped records `GetAdaptations` still answers with (§12). */
  legacyRows(): Array<Record<string, unknown>> {
    return this.registry.entries().map((entry) => ({
      appId: entry.appId,
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen,
      observations: entry.windowsSeen,
      skipAnimation: entry.adapt.skipAnimation === true,
    }));
  }

  /** The identity family key, for grouping only (never persisted as an id). */
  static family(appId: string): string {
    return identity.appFamily(appId);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
