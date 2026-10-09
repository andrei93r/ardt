// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Config bundle format, normalization and merge logic (§19.2).
 *
 * `core/` may not import from `platform/`, so the scalar value union is
 * redeclared here. `platform/settings.ts` exposes the identical shape.
 */

type ConfigValue = number | boolean | string | string[];

export const BUNDLE_FORMAT = 'adrt.config';
/**
 * §12/Stage 4: v4 folds `adaptation.json`, `behavior.json` and `exception-apps`
 * into the app registry. A v3 bundle is read by the same normaliser and its
 * registry field is synthesised from the legacy stores; a bundle newer than
 * this constant is refused rather than downgraded.
 */
export const BUNDLE_VERSION = 4;

/** §9.4 */
export interface AdaptationRecord {
  appId: string;
  firstSeen: number;
  lastSeen: number;
  observations: number;
  unmaximizeDelayEma?: number;
  settleTimeEma?: number;
  refusedMinW?: number;
  refusedMinH?: number;
  acceptedW?: number;
  acceptedH?: number;
  skipAnimation?: boolean;
}

interface BundleTracked {
  adaptations: Record<string, AdaptationRecord>;
  behavior: Record<string, unknown>;
  /** §12: the app registry state (v4). Absent when reading a v3 bundle. */
  registry?: BundleRegistry;
}

/** The serialised app registry, as carried by a v4 bundle. */
interface BundleRegistry {
  version: number;
  entries: unknown[];
}

export interface Bundle {
  format: string;
  version: number;
  exportedAt: string;
  settings: Record<string, ConfigValue>;
  tracked: BundleTracked;
}

export type ImportMode = 'merge' | 'replace';

interface MergeReport {
  applied: string[];
  skipped: string[];
}

export interface MergeResult<T> {
  record: T;
  report: MergeReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConfigValue(value: unknown): value is ConfigValue {
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return true;
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function asStringArrayMap(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

/**
 * Normalize a parsed bundle. Version 2 placed `adaptations` and `behavior` at
 * the top level; both shapes map onto the v3 `tracked` object.
 */
export function normalizeBundle(raw: unknown, errors: string[] = []): Bundle | null {
  if (!isRecord(raw)) {
    errors.push('bundle must be a JSON object');
    return null;
  }
  if (raw.format !== BUNDLE_FORMAT) {
    errors.push(`bundle format must be "${BUNDLE_FORMAT}"`);
    return null;
  }
  const version = typeof raw.version === 'number' ? raw.version : 0;
  if (version > BUNDLE_VERSION) {
    errors.push(`bundle version ${version} is newer than ${BUNDLE_VERSION}`);
    return null;
  }

  const settings: Record<string, ConfigValue> = {};
  if (isRecord(raw.settings)) {
    for (const [key, value] of Object.entries(raw.settings)) {
      if (isConfigValue(value)) settings[key] = value;
      else errors.push(`settings.${key} has an unsupported value`);
    }
  } else if (raw.settings !== undefined) {
    errors.push('settings must be an object');
  }

  const adaptations: Record<string, AdaptationRecord> = {};
  let behavior: Record<string, unknown> = {};
  const trackedRaw = isRecord(raw.tracked) ? raw.tracked : undefined;
  const adaptationSource = trackedRaw?.adaptations ?? raw.adaptations;
  const behaviorSource = trackedRaw?.behavior ?? raw.behavior;

  if (isRecord(adaptationSource)) {
    for (const [appId, record] of Object.entries(adaptationSource)) {
      if (isRecord(record)) adaptations[appId] = { appId, firstSeen: 0, lastSeen: 0, observations: 0, ...record } as AdaptationRecord;
      else errors.push(`adaptations.${appId} must be an object`);
    }
  } else if (adaptationSource !== undefined) {
    errors.push('adaptations must be an object');
  }
  behavior = asStringArrayMap(behaviorSource);

  let registry: BundleRegistry | undefined;
  const registrySource = trackedRaw?.registry;
  if (isRecord(registrySource) && Array.isArray(registrySource.entries)) {
    registry = {
      version: typeof registrySource.version === 'number' ? registrySource.version : 1,
      entries: [...registrySource.entries],
    };
  }

  const exportedAt = typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date(0).toISOString();

  return {
    format: BUNDLE_FORMAT,
    version,
    exportedAt,
    settings,
    tracked: { adaptations, behavior, ...(registry === undefined ? {} : { registry }) },
  };
}

export function parseBundle(json: string): { bundle: Bundle | null; errors: string[] } {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { bundle: null, errors: [`bundle is not valid JSON: ${(e as Error).message}`] };
  }
  const bundle = normalizeBundle(raw, errors);
  return { bundle, errors };
}

export function serializeBundle(bundle: Bundle): string {
  return JSON.stringify(bundle, null, 2);
}

const DEEP_MERGE_KEYS: ReadonlySet<string> = new Set(['classes', 'floats']);

/**
 * Merge behavior-style records. `merge` deepens only `classes` and `floats`
 * by one level; every other key is replaced by the incoming value (§19.2).
 */
export function mergeRecords(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
  mode: ImportMode,
): MergeResult<Record<string, unknown>> {
  if (mode === 'replace') {
    return {
      record: { ...incoming },
      report: { applied: Object.keys(incoming), skipped: Object.keys(base) },
    };
  }
  const record: Record<string, unknown> = { ...base };
  const applied: string[] = [];
  for (const key of Object.keys(incoming)) {
    const value = incoming[key];
    if (DEEP_MERGE_KEYS.has(key) && isRecord(base[key]) && isRecord(value)) {
      record[key] = { ...(base[key] as Record<string, unknown>), ...value };
    } else {
      record[key] = value;
    }
    applied.push(key);
  }
  const skipped = Object.keys(base).filter((key) => !(key in incoming));
  return { record, report: { applied, skipped } };
}

/**
 * Merge adaptation records one level deep per app (§19.2). `replace` discards
 * the base map entirely.
 */
export function mergeAdaptations(
  base: Record<string, AdaptationRecord>,
  incoming: Record<string, AdaptationRecord>,
  mode: ImportMode,
): MergeResult<Record<string, AdaptationRecord>> {
  if (mode === 'replace') {
    return {
      record: { ...incoming },
      report: { applied: Object.keys(incoming), skipped: Object.keys(base) },
    };
  }
  const record: Record<string, AdaptationRecord> = { ...base };
  const applied: string[] = [];
  for (const appId of Object.keys(incoming)) {
    const previous = base[appId];
    record[appId] = previous === undefined ? incoming[appId] : { ...previous, ...incoming[appId] };
    applied.push(appId);
  }
  const skipped = Object.keys(base).filter((appId) => !(appId in incoming));
  return { record, report: { applied, skipped } };
}

export interface BundleMergeResult {
  bundle: Bundle;
  settings: MergeReport;
  adaptations: MergeReport;
  behavior: MergeReport;
}

/**
 * Merge two bundles. The merged bundle's `exportedAt` is an *input* (P6d): the
 * pure core never reads the wall clock. It defaults to the epoch sentinel,
 * which is deterministic; callers that care about the timestamp pass one.
 */
export function mergeBundles(
  base: Bundle,
  incoming: Bundle,
  mode: ImportMode,
  exportedAt: string = new Date(0).toISOString(),
): BundleMergeResult {
  let settings: Record<string, ConfigValue>;
  let settingsReport: MergeReport;
  if (mode === 'replace') {
    settings = { ...incoming.settings };
    settingsReport = { applied: Object.keys(incoming.settings), skipped: Object.keys(base.settings) };
  } else {
    settings = { ...base.settings, ...incoming.settings };
    settingsReport = {
      applied: Object.keys(incoming.settings),
      skipped: Object.keys(base.settings).filter((key) => !(key in incoming.settings)),
    };
  }

  const adaptations = mergeAdaptations(base.tracked.adaptations, incoming.tracked.adaptations, mode);
  const behavior = mergeRecords(base.tracked.behavior, incoming.tracked.behavior, mode);
  // The serialised registry is opaque to this module (`AppRegistry` owns entry
  // merging), so it is carried through by reference: in merge mode the incoming
  // one wins and falls back to the base; replace mode takes the incoming one
  // wholesale. Rebuilding `tracked` without it silently dropped every placement.
  const registry =
    mode === 'replace' ? incoming.tracked.registry : (incoming.tracked.registry ?? base.tracked.registry);

  return {
    bundle: {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt,
      settings,
      tracked: {
        adaptations: adaptations.record,
        behavior: behavior.record,
        ...(registry === undefined ? {} : { registry }),
      },
    },
    settings: settingsReport,
    adaptations: adaptations.report,
    behavior: behavior.report,
  };
}
