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
import { clipText, utf8ByteLength } from './text.js';
import type { Rect } from './types.js';

export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REGISTRY_VERSION = 1;
/** Most placements kept per app; window recreation only needs a handful. */
export const MAX_PLACEMENTS_PER_APP = 64;
/** Hard cap on the serialized registry file (bytes). */
export const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;

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

/** One placement's in-memory key. Bounded so a client id cannot bloat the file. */
function placementKey(instanceId: string): string {
  return clipText(instanceId);
}

function clonePlacement(placement: AppPlacement): AppPlacement {
  return {
    ordinal: Number.isFinite(placement.ordinal) ? placement.ordinal : 0,
    connector: clipText(placement.connector),
    slot: Number.isFinite(placement.slot) ? placement.slot : 0,
    maximized: placement.maximized === true,
    fullscreen: placement.fullscreen === true,
    rect: {
      x: Number.isFinite(placement.rect?.x) ? placement.rect.x : 0,
      y: Number.isFinite(placement.rect?.y) ? placement.rect.y : 0,
      width: Number.isFinite(placement.rect?.width) ? placement.rect.width : 0,
      height: Number.isFinite(placement.rect?.height) ? placement.rect.height : 0,
    },
  };
}

/**
 * Keep only the newest `MAX_PLACEMENTS_PER_APP` placements, by ordinal. Applied
 * on load as well as on `place()`, so a hand-edited or corrupted file cannot
 * force an unbounded object into memory on the next save.
 */
function boundPlacements(placements: Record<string, AppPlacement>): Record<string, AppPlacement> {
  const all = Object.entries(placements ?? {});
  const sorted = all
    .filter(([, placement]) => placement !== null && typeof placement === 'object')
    .sort((a, b) => a[1].ordinal - b[1].ordinal);
  const kept = sorted.slice(-MAX_PLACEMENTS_PER_APP);
  const out: Record<string, AppPlacement> = {};
  for (const [instanceId, placement] of kept) {
    // The instance id is persisted as a JSON key, so it is client text too.
    out[clipText(instanceId)] = clonePlacement(placement);
  }
  return out;
}

function cloneEntry(entry: AppEntry): AppEntry {
  const placements = boundPlacements(entry.placements ?? {});
  // The counter is re-derived: a persisted value below the highest placement
  // ordinal would hand out a duplicate, so the derived floor always wins.
  const persisted = entry.nextOrdinal;
  return {
    appId: clipText(entry.appId),
    firstSeen: Number.isFinite(entry.firstSeen) ? entry.firstSeen : 0,
    lastSeen: Number.isFinite(entry.lastSeen) ? entry.lastSeen : 0,
    windowsSeen: Number.isFinite(entry.windowsSeen) ? entry.windowsSeen : 0,
    lastTitle: clipText(entry.lastTitle ?? ''),
    neverTile: entry.neverTile === true,
    profile: {
      ...(entry.profile ?? {}),
      ...(entry.profile?.family === undefined ? {} : { family: clipText(entry.profile.family) }),
    },
    adapt: { ...(entry.adapt ?? {}) },
    placements,
    nextOrdinal: Math.max(
      typeof persisted === 'number' && Number.isFinite(persisted) ? persisted : 0,
      highestOrdinal(placements) + 1,
    ),
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
    // A title is client text. Clipping here (not only at serialization) keeps
    // a pathological title out of memory, the journal and DumpState too.
    if (observation.title !== undefined) entry.lastTitle = clipText(observation.title);
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
    const existing = entry.placements[placementKey(instanceId)];
    const ordinal = existing?.ordinal ?? entry.nextOrdinal;
    if (existing === undefined) entry.nextOrdinal += 1;
    const placement: AppPlacement = {
      ordinal,
      connector: clipText(input.connector),
      slot: input.slot,
      maximized: input.maximized === true,
      fullscreen: input.fullscreen === true,
      rect: { ...input.rect },
    };
    entry.placements[placementKey(instanceId)] = placement;
    entry.lastSeen = now;
    const count = Object.keys(entry.placements).length;
    if (count > MAX_PLACEMENTS_PER_APP) {
      const oldest = Object.entries(entry.placements)
        .sort((a, b) => a[1].ordinal - b[1].ordinal)
        .slice(0, count - MAX_PLACEMENTS_PER_APP);
      for (const [key] of oldest) delete entry.placements[key];
    }
    return placement;
  }

  placement(appId: string, instanceId: string): AppPlacement | undefined {
    return this.table.get(appId)?.placements[placementKey(instanceId)];
  }

  /** Placements in ordinal order, the order recreated windows match in. */
  placements(appId: string): AppPlacement[] {
    const entry = this.table.get(appId);
    if (entry === undefined) return [];
    return Object.values(entry.placements).sort((a, b) => a.ordinal - b.ordinal);
  }

  ordinalFor(appId: string, instanceId: string): number | undefined {
    return this.table.get(appId)?.placements[placementKey(instanceId)]?.ordinal;
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
    const key = placementKey(instanceId);
    if (entry.placements[key] === undefined) return false;
    delete entry.placements[key];
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
    // One pass with a used-ordinal set: the previous `Object.values(...).some`
    // per placement made this O(n²).
    const merged: Record<string, AppPlacement> = { ...existing.placements };
    const used = new Set<number>();
    let highest = 0;
    for (const placement of Object.values(merged)) {
      used.add(placement.ordinal);
      if (placement.ordinal > highest) highest = placement.ordinal;
    }
    let next = Math.max(existing.nextOrdinal, highest + 1);
    for (const [instanceId, placement] of Object.entries(oldEntry.placements)) {
      if (merged[instanceId] !== undefined) continue;
      if (used.has(placement.ordinal)) {
        while (used.has(next)) next += 1;
        merged[instanceId] = { ...placement, ordinal: next };
        used.add(next);
        next += 1;
      } else {
        merged[instanceId] = { ...placement };
        used.add(placement.ordinal);
        if (placement.ordinal > highest) highest = placement.ordinal;
      }
    }
    existing.placements = merged;
    existing.nextOrdinal = Math.max(existing.nextOrdinal, next, highest + 1);
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
        const existing = this.table.get(appId);
        const entry = this.ensure(appId, now);
        const firstSeen = typeof record.firstSeen === 'number' && Number.isFinite(record.firstSeen) ? record.firstSeen : now;
        const lastSeen = typeof record.lastSeen === 'number' && Number.isFinite(record.lastSeen) ? record.lastSeen : now;
        if (existing === undefined) {
          entry.firstSeen = firstSeen;
          entry.lastSeen = lastSeen;
        } else {
          entry.firstSeen = Math.min(existing.firstSeen, firstSeen);
          entry.lastSeen = Math.max(existing.lastSeen, lastSeen);
        }
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

  /**
   * Serialize a bounded copy of the registry. Every entry is already clipped
   * and placement-capped, so an ordinary registry is far below the cap. If the
   * whole file would still exceed `maxBytes`, keep durable `neverTile` entries
   * first and then the newest entries; the discarded ones stay in memory for
   * this session but are never written to a file that startup would have to
   * parse in one piece.
   */
  toJSON(maxBytes: number = MAX_REGISTRY_BYTES): AppRegistryData {
    const entries = this.entries().map(cloneEntry);
    const wrap = (list: AppEntry[]): AppRegistryData => ({ version: REGISTRY_VERSION, entries: list });
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) return wrap(entries);

    const text = JSON.stringify(wrap(entries));
    if (utf8ByteLength(text) <= maxBytes) return wrap(entries);

    const ranked = [...entries].sort(
      (a, b) =>
        Number(b.neverTile) - Number(a.neverTile) ||
        b.lastSeen - a.lastSeen,
    );
    const kept = new Set<AppEntry>();
    let used = utf8ByteLength(JSON.stringify(wrap([])));
    for (const entry of ranked) {
      const size = utf8ByteLength(JSON.stringify(entry)) + 1; // + the comma
      if (used + size > maxBytes) continue;
      kept.add(entry);
      used += size;
    }
    const bounded = entries.filter((entry) => kept.has(entry));
    return wrap(bounded);
  }

  static fromJSON(data: AppRegistryData, options: AppRegistryOptions = {}): AppRegistry {
    const registry = new AppRegistry(options);
    // A newer persisted schema is refused rather than silently downgraded, the
    // same convention as `config.normalizeBundle`: the caller gets an empty
    // registry and may choose to overwrite the file.
    if (typeof data?.version === 'number' && data.version > REGISTRY_VERSION) {
      return registry;
    }
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object' || typeof entry.appId !== 'string') continue;
      // The table is keyed by appId, so a duplicate is corruption. Keep the
      // first occurrence deterministically; a later one must not silently
      // overwrite the data that was already accepted.
      if (registry.table.has(entry.appId)) continue;
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
