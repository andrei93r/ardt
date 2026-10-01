// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §12 app registry: one auto-populated entry per app.
 *
 * The registry merges the three legacy stores — `adaptation.json`,
 * `behavior.json` and the `exception-apps` list — into one entry that logs
 * every app seen, holds the durable `neverTile` decision, timing-only
 * adaptation hints, a behaviour profile and the per-app placements. It is pure:
 * the platform layer parses the legacy files and the settings list, and this
 * module only folds them in.
 *
 * `adapt` is performance and smoothness only. It carries delays, settle,
 * animation skip and retry counts; it can never carry geometry, and no learned
 * minimum ever reaches the tiler. The migration drops every geometric field of
 * the legacy adaptation record on purpose.
 *
 * Placements are keyed by instance id and each one carries a durable per-app
 * ordinal (`#1`, `#2`, …). The ordinal counter only ever rolls forward, so
 * windows recreated after a restart match the previous session in order.
 */

import type { AdaptationRecord } from './config.js';
import { normalizeIdentity } from './identity.js';
import type { Rect } from './types.js';

export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REGISTRY_VERSION = 1;

/** Timing/behaviour hints. Never geometry (§12). */
export interface AppProfile {
  family?: string;
  unmaximizeDelayMs?: number;
  retriesMs?: readonly number[];
  animate?: boolean;
}

/** Performance and smoothness only: delays, settle, animation skip, retries. */
export interface AdaptRecord {
  unmaximizeDelayMs?: number;
  settleMs?: number;
  skipAnimation?: boolean;
  retries?: number;
}

/** One remembered placement, keyed by the window's instance id in the entry. */
export interface AppPlacement {
  /** Durable per-app ordinal, 1-based; assigned once per instance id. */
  ordinal: number;
  connector: string;
  slot: number;
  maximized: boolean;
  fullscreen: boolean;
  rect: Rect;
}

export interface PlacementInput {
  connector: string;
  slot: number;
  maximized?: boolean;
  fullscreen?: boolean;
  rect: Rect;
}

export interface AppEntry {
  appId: string;
  firstSeen: number;
  lastSeen: number;
  windowsSeen: number;
  lastTitle: string;
  neverTile: boolean;
  profile: AppProfile;
  adapt: AdaptRecord;
  /** Keyed by instance id. */
  placements: Record<string, AppPlacement>;
  /** Monotonic ordinal counter; never rolls back, even after pruning. */
  nextOrdinal: number;
}

export interface AppObservation {
  appId: string;
  title?: string;
  now?: number;
}

export interface AppRegistryOptions {
  ttlMs?: number;
}

/** Parsed legacy stores, handed in by the platform layer. */
export interface LegacyStores {
  /** Parsed `adaptation.json`: `{ version, records }`. */
  adaptation?: { records?: Record<string, AdaptationRecord> } | null;
  /** Parsed `behavior.json`: `{ version, floats }`. */
  behavior?: { floats?: readonly string[] } | null;
  /** The `exception-apps` setting: glob patterns. */
  exceptionApps?: readonly string[] | null;
}

export interface MigrationReport {
  /** Apps folded in from the legacy adaptation records. */
  adapted: string[];
  /** Apps marked `neverTile` from behavior floats and exception globs. */
  floated: string[];
  /** Keys that could not be read and were left out. */
  skipped: string[];
}

export interface AppRegistryData {
  version: number;
  entries: AppEntry[];
}

function createEntry(appId: string, now: number): AppEntry {
  return {
    appId,
    firstSeen: now,
    lastSeen: now,
    windowsSeen: 0,
    lastTitle: '',
    neverTile: false,
    profile: {},
    adapt: {},
    placements: {},
    nextOrdinal: 1,
  };
}

function clonePlacement(placement: AppPlacement): AppPlacement {
  return { ...placement, rect: { ...placement.rect } };
}

function cloneEntry(entry: AppEntry): AppEntry {
  const placements: Record<string, AppPlacement> = {};
  for (const [instanceId, placement] of Object.entries(entry.placements ?? {})) {
    placements[instanceId] = clonePlacement(placement);
  }
  return {
    appId: entry.appId,
    firstSeen: entry.firstSeen,
    lastSeen: entry.lastSeen,
    windowsSeen: entry.windowsSeen,
    lastTitle: entry.lastTitle ?? '',
    neverTile: entry.neverTile === true,
    profile: { ...(entry.profile ?? {}) },
    adapt: { ...(entry.adapt ?? {}) },
    placements,
    nextOrdinal: entry.nextOrdinal ?? highestOrdinal(placements) + 1,
  };
}

function highestOrdinal(placements: Record<string, AppPlacement>): number {
  let highest = 0;
  for (const placement of Object.values(placements)) {
    if (placement.ordinal > highest) highest = placement.ordinal;
  }
  return highest;
}

/**
 * Keep only the timing fields of `adapt`. Anything else — in particular the
 * legacy `refusedMinW`/`refusedMinH`/`acceptedW`/`acceptedH` — is dropped, so
 * no learned geometry can ever reach the tiler (§12).
 */
export function sanitizeAdapt(source: Record<string, unknown> | undefined): AdaptRecord {
  const out: AdaptRecord = {};
  if (source === undefined) return out;
  if (typeof source.unmaximizeDelayMs === 'number' && Number.isFinite(source.unmaximizeDelayMs)) {
    out.unmaximizeDelayMs = source.unmaximizeDelayMs;
  }
  if (typeof source.settleMs === 'number' && Number.isFinite(source.settleMs)) {
    out.settleMs = source.settleMs;
  }
  if (typeof source.skipAnimation === 'boolean') {
    out.skipAnimation = source.skipAnimation;
  }
  if (typeof source.retries === 'number' && Number.isFinite(source.retries)) {
    out.retries = source.retries;
  }
  return out;
}

/**
 * Project a legacy adaptation record onto timing-only hints. The EMA fields map
 * to the registry's delays; the geometric fields are deliberately never read.
 */
function legacyTiming(record: AdaptationRecord): Record<string, unknown> {
  const timing: Record<string, unknown> = {};
  if (typeof record.unmaximizeDelayEma === 'number' && Number.isFinite(record.unmaximizeDelayEma)) {
    timing.unmaximizeDelayMs = Math.round(record.unmaximizeDelayEma);
  }
  if (typeof record.settleTimeEma === 'number' && Number.isFinite(record.settleTimeEma)) {
    timing.settleMs = Math.round(record.settleTimeEma);
  }
  if (typeof record.skipAnimation === 'boolean') timing.skipAnimation = record.skipAnimation;
  return timing;
}

export class AppRegistry {
  private readonly table = new Map<string, AppEntry>();
  private readonly ttlMs: number;

  constructor(options: AppRegistryOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  get size(): number {
    return this.table.size;
  }

  has(appId: string): boolean {
    return this.table.has(appId);
  }

  get(appId: string): AppEntry | undefined {
    return this.table.get(appId);
  }

  entries(): AppEntry[] {
    return [...this.table.values()];
  }

  /** Log a window opening: auto-populate the entry and count it. */
  observe(observation: AppObservation): AppEntry {
    const now = observation.now ?? Date.now();
    const entry = this.ensure(observation.appId, now);
    entry.lastSeen = now;
    entry.windowsSeen += 1;
    if (observation.title !== undefined) entry.lastTitle = observation.title;
    return entry;
  }

  /** Set the durable per-app float decision. */
  setNeverTile(appId: string, value: boolean, now: number = Date.now()): AppEntry {
    const entry = this.ensure(appId, now);
    entry.neverTile = value;
    entry.lastSeen = now;
    return entry;
  }

  /** Flip the durable float decision and report the new value. */
  toggleNeverTile(appId: string, now: number = Date.now()): boolean {
    const entry = this.ensure(appId, now);
    entry.neverTile = !entry.neverTile;
    entry.lastSeen = now;
    return entry.neverTile;
  }

  isNeverTile(appId: string): boolean {
    return this.table.get(appId)?.neverTile === true;
  }

  setProfile(appId: string, hints: AppProfile, now: number = Date.now()): AppEntry {
    const entry = this.ensure(appId, now);
    entry.profile = { ...entry.profile, ...hints };
    return entry;
  }

  /**
   * Merge timing-only adaptation hints. Unknown keys are ignored, so a legacy
   * record cannot smuggle geometry in through this path.
   */
  setAdapt(appId: string, patch: Record<string, unknown>, now: number = Date.now()): AppEntry {
    const entry = this.ensure(appId, now);
    entry.adapt = { ...entry.adapt, ...sanitizeAdapt(patch) };
    return entry;
  }

  adaptFor(appId: string): AdaptRecord {
    return { ...(this.table.get(appId)?.adapt ?? {}) };
  }

  /**
   * Record a placement. The instance id keeps its ordinal once assigned; the
   * ordinal counter rolls forward and is never reused.
   */
  place(appId: string, instanceId: string, input: PlacementInput, now: number = Date.now()): AppPlacement {
    const entry = this.ensure(appId, now);
    const existing = entry.placements[instanceId];
    const ordinal = existing?.ordinal ?? entry.nextOrdinal;
    if (existing === undefined) entry.nextOrdinal += 1;
    const placement: AppPlacement = {
      ordinal,
      connector: input.connector,
      slot: input.slot,
      maximized: input.maximized === true,
      fullscreen: input.fullscreen === true,
      rect: { ...input.rect },
    };
    entry.placements[instanceId] = placement;
    entry.lastSeen = now;
    return placement;
  }

  placement(appId: string, instanceId: string): AppPlacement | undefined {
    return this.table.get(appId)?.placements[instanceId];
  }

  /** Placements in ordinal order, the order recreated windows match in. */
  placements(appId: string): AppPlacement[] {
    const entry = this.table.get(appId);
    if (entry === undefined) return [];
    return Object.values(entry.placements).sort((a, b) => a.ordinal - b.ordinal);
  }

  ordinalFor(appId: string, instanceId: string): number | undefined {
    return this.table.get(appId)?.placements[instanceId]?.ordinal;
  }

  placementByOrdinal(appId: string, ordinal: number): { instanceId: string; placement: AppPlacement } | undefined {
    const entry = this.table.get(appId);
    if (entry === undefined) return undefined;
    for (const [instanceId, placement] of Object.entries(entry.placements)) {
      if (placement.ordinal === ordinal) return { instanceId, placement };
    }
    return undefined;
  }

  /** Drop one placement; the ordinal is retired, never handed out again. */
  forgetPlacement(appId: string, instanceId: string): boolean {
    const entry = this.table.get(appId);
    if (entry === undefined) return false;
    if (entry.placements[instanceId] === undefined) return false;
    delete entry.placements[instanceId];
    return true;
  }

  /**
   * Re-key a provisional entry onto its real identity, carrying the entry. When
   * the real key already exists it wins its own fields; only `neverTile` is
   * ORed, and the provisional placements are carried over.
   */
  rekey(oldKey: string, newKey: string): boolean {
    if (oldKey === newKey) return false;
    const oldEntry = this.table.get(oldKey);
    if (oldEntry === undefined) return false;

    const existing = this.table.get(newKey);
    if (existing === undefined) {
      this.table.delete(oldKey);
      oldEntry.appId = newKey;
      this.table.set(newKey, oldEntry);
      return true;
    }

    // The real key wins: its profile, adapt and placements take precedence, its
    // identity fields dominate, and only neverTile is a union.
    existing.neverTile = existing.neverTile || oldEntry.neverTile;
    existing.firstSeen = Math.min(existing.firstSeen, oldEntry.firstSeen);
    existing.lastSeen = Math.max(existing.lastSeen, oldEntry.lastSeen);
    existing.windowsSeen += oldEntry.windowsSeen;
    if (existing.lastTitle.length === 0) existing.lastTitle = oldEntry.lastTitle;
    existing.profile = { ...oldEntry.profile, ...existing.profile };
    existing.adapt = { ...oldEntry.adapt, ...existing.adapt };

    // Placements from the provisional entry are carried over; the real key's
    // own placements win on an instance-id collision. A carried ordinal that
    // clashes with a real one is renumbered forward so ordinals stay unique.
    const merged: Record<string, AppPlacement> = { ...existing.placements };
    let next = Math.max(existing.nextOrdinal, highestOrdinal(existing.placements) + 1);
    for (const [instanceId, placement] of Object.entries(oldEntry.placements)) {
      if (merged[instanceId] !== undefined) continue;
      const clashes = Object.values(merged).some((candidate) => candidate.ordinal === placement.ordinal);
      merged[instanceId] = clashes ? { ...placement, ordinal: next++ } : { ...placement };
    }
    existing.placements = merged;
    existing.nextOrdinal = Math.max(existing.nextOrdinal, next, highestOrdinal(merged) + 1);
    this.table.delete(oldKey);
    return true;
  }

  /**
   * Fold the three legacy stores into entries. Adaptation records contribute
   * their timing only; behavior floats and exception globs contribute
   * `neverTile`. Idempotent: running it twice leaves the same state.
   */
  migrate(stores: LegacyStores, now: number = Date.now()): MigrationReport {
    const report: MigrationReport = { adapted: [], floated: [], skipped: [] };

    const records = stores.adaptation?.records;
    if (records !== undefined && records !== null) {
      for (const [appId, record] of Object.entries(records)) {
        if (typeof appId !== 'string' || appId.length === 0 || record === null || typeof record !== 'object') {
          report.skipped.push(appId);
          continue;
        }
        const entry = this.ensure(appId, now);
        const firstSeen = typeof record.firstSeen === 'number' && Number.isFinite(record.firstSeen) ? record.firstSeen : now;
        const lastSeen = typeof record.lastSeen === 'number' && Number.isFinite(record.lastSeen) ? record.lastSeen : now;
        entry.firstSeen = Math.min(entry.firstSeen, firstSeen);
        entry.lastSeen = Math.max(entry.lastSeen, lastSeen);
        if (typeof record.observations === 'number' && Number.isFinite(record.observations)) {
          entry.windowsSeen = Math.max(entry.windowsSeen, record.observations);
        }
        entry.adapt = { ...entry.adapt, ...sanitizeAdapt(legacyTiming(record)) };
        report.adapted.push(appId);
      }
    }

    const floats = stores.behavior?.floats;
    if (Array.isArray(floats)) {
      for (const appId of floats) {
        if (typeof appId !== 'string' || appId.length === 0) {
          report.skipped.push(String(appId));
          continue;
        }
        const entry = this.ensure(appId, now);
        entry.neverTile = true;
        report.floated.push(appId);
      }
    }

    const exceptions = stores.exceptionApps;
    if (Array.isArray(exceptions)) {
      for (const pattern of exceptions) {
        if (typeof pattern !== 'string' || pattern.trim().length === 0) {
          report.skipped.push(String(pattern));
          continue;
        }
        const key = normalizeIdentity(pattern);
        const entry = this.ensure(key, now);
        entry.neverTile = true;
        report.floated.push(key);
      }
    }

    return report;
  }

  /**
   * TTL pruning. Stale entries are dropped, but a durable `neverTile` decision
   * is kept — it is the user's own decision, not a cache.
   */
  prune(now: number = Date.now()): string[] {
    const removed: string[] = [];
    for (const [appId, entry] of this.table) {
      if (entry.neverTile) continue;
      if (now - entry.lastSeen > this.ttlMs) {
        this.table.delete(appId);
        removed.push(appId);
      }
    }
    return removed;
  }

  remove(appId: string): boolean {
    return this.table.delete(appId);
  }

  toJSON(): AppRegistryData {
    return { version: REGISTRY_VERSION, entries: this.entries().map(cloneEntry) };
  }

  static fromJSON(data: AppRegistryData, options: AppRegistryOptions = {}): AppRegistry {
    const registry = new AppRegistry(options);
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object' || typeof entry.appId !== 'string') continue;
      registry.table.set(entry.appId, cloneEntry(entry));
    }
    return registry;
  }

  private ensure(appId: string, now: number): AppEntry {
    let entry = this.table.get(appId);
    if (entry === undefined) {
      entry = createEntry(appId, now);
      this.table.set(appId, entry);
    }
    return entry;
  }
}
