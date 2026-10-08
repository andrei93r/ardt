// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import type { Surface } from './types.js';
import { SurfaceKind } from './types.js';

/** Minimal surface view a rule is matched against. */
export interface RuleContext {
  appId: string;
  title: string;
  kind: SurfaceKind;
  transient: boolean;
}

export function contextFor(surface: Surface): RuleContext {
  return {
    appId: surface.appId,
    title: surface.title,
    kind: surface.kind,
    transient: surface.flags.transient,
  };
}

/** A single user-authored rule (§19.1 `rules-json`, §6). */
interface RuleMatch {
  appId?: string;
  title?: string;
  kind?: SurfaceKind[];
  transient?: boolean;
}

/** The placement a rule can force. */
export type TileMode = 'full' | 'left-half' | 'right-half';

export const TILE_MODES: readonly TileMode[] = ['full', 'left-half', 'right-half'];

/**
 * One rule. `float` was dropped: a rule only ever *forces a placement*, and the
 * durable "never tile" decision lives in the Never-tile list / registry
 * `neverTile` (§16). First match in array order wins; `enabled: false` skips it
 * without removing it.
 */
export interface Rule {
  match: RuleMatch;
  tile: TileMode;
  /** Per-rule switch. Absent means enabled (storage-compatible). */
  enabled?: boolean;
}

const VALID_KINDS = new Set<string>(Object.values(SurfaceKind));

/** Translate a glob (`*`, `?`) into an anchored, case-insensitive RegExp. */
export function globToRegExp(glob: string): RegExp {
  let source = '^';
  for (const ch of glob) {
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  source += '$';
  return new RegExp(source, 'i');
}

/**
 * Compiled globs, keyed by the pattern string. `globMatch` runs per exception
 * app and per rule field on every classification/retile, so a `new RegExp` per
 * call was pure churn (PERFORMANCE_PLAN stage 1.3). The cache is bounded because
 * patterns come from user settings; FIFO eviction keeps a rules-editor keystroke
 * burst from growing it without limit.
 */
const GLOB_CACHE_LIMIT = 256;
const compiledGlobs = new Map<string, RegExp>();

/** The shared RegExp for a glob — compiled once per distinct pattern. */
export function compileGlob(glob: string): RegExp {
  const cached = compiledGlobs.get(glob);
  if (cached !== undefined) return cached;
  const compiled = globToRegExp(glob);
  if (compiledGlobs.size >= GLOB_CACHE_LIMIT) {
    const oldest = compiledGlobs.keys().next().value;
    if (oldest !== undefined) compiledGlobs.delete(oldest);
  }
  compiledGlobs.set(glob, compiled);
  return compiled;
}

export function globMatch(glob: string, value: string): boolean {
  return compileGlob(glob).test(value);
}

function kindAllowed(kinds: SurfaceKind[] | undefined, kind: SurfaceKind): boolean {
  if (kinds === undefined) return true;
  return kinds.includes(kind);
}

/** Does a rule match a surface? All present fields must match (AND). */
export function ruleMatches(rule: Rule, context: RuleContext): boolean {
  const m = rule.match;
  if (m.appId !== undefined && !globMatch(m.appId, context.appId)) return false;
  if (m.title !== undefined && !globMatch(m.title, context.title)) return false;
  if (m.transient !== undefined && m.transient !== context.transient) return false;
  if (!kindAllowed(m.kind, context.kind)) return false;
  return true;
}

/** First enabled rule (in list order) that matches, or null. */
export function firstMatch(rules: readonly Rule[], context: RuleContext): Rule | null {
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (ruleMatches(rule, context)) return rule;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function parseMatch(raw: unknown, where: string, errors: string[]): RuleMatch {
  if (!isRecord(raw)) {
    errors.push(`${where}: "match" must be an object`);
    return {};
  }
  const match: RuleMatch = {};
  if (raw.appId !== undefined) {
    if (typeof raw.appId !== 'string') errors.push(`${where}: match.appId must be a string`);
    else match.appId = raw.appId;
  }
  if (raw.title !== undefined) {
    if (typeof raw.title !== 'string') errors.push(`${where}: match.title must be a string`);
    else match.title = raw.title;
  }
  if (raw.transient !== undefined) {
    if (typeof raw.transient !== 'boolean') errors.push(`${where}: match.transient must be a boolean`);
    else match.transient = raw.transient;
  }
  if (raw.kind !== undefined) {
    if (!isStringArray(raw.kind)) {
      errors.push(`${where}: match.kind must be a string array`);
    } else {
      const kinds: SurfaceKind[] = [];
      for (const k of raw.kind) {
        if (VALID_KINDS.has(k)) kinds.push(k as SurfaceKind);
        else errors.push(`${where}: unknown kind "${k}"`);
      }
      match.kind = kinds;
    }
  }
  return match;
}

/** Whether a match constrains anything at all. */
function constrains(match: RuleMatch): boolean {
  return (
    match.appId !== undefined ||
    match.title !== undefined ||
    match.transient !== undefined ||
    (match.kind !== undefined && match.kind.length > 0)
  );
}

/**
 * Validate one raw rule entry. Returns the rule when it is usable, `null`
 * otherwise; every problem is appended to `errors` (never silently dropped).
 */
export function validateRule(entry: unknown, where: string, errors: string[]): Rule | null {
  if (!isRecord(entry)) {
    errors.push(`${where}: must be an object`);
    return null;
  }
  if (entry.float !== undefined) {
    errors.push(`${where}: "float" is no longer supported; use the Never-tile list`);
    return null;
  }
  const match = parseMatch(entry.match, where, errors);
  if (!constrains(match)) {
    errors.push(`${where}: match must name at least one of appId, title, kind, transient`);
  }
  let tile: TileMode | null = null;
  if (entry.tile === undefined) {
    errors.push(`${where}: "tile" is required (${TILE_MODES.join(', ')})`);
  } else if (typeof entry.tile !== 'string' || !TILE_MODES.includes(entry.tile as TileMode)) {
    errors.push(`${where}: tile must be one of ${TILE_MODES.join(', ')}`);
  } else {
    tile = entry.tile as TileMode;
  }
  let enabled: boolean | undefined;
  if (entry.enabled !== undefined) {
    if (typeof entry.enabled !== 'boolean') errors.push(`${where}: enabled must be a boolean`);
    else enabled = entry.enabled;
  }
  if (tile === null || !constrains(match)) return null;
  const rule: Rule = { match, tile };
  if (enabled !== undefined) rule.enabled = enabled;
  return rule;
}

export interface RulesParse {
  rules: Rule[];
  errors: string[];
}

/**
 * Validate a parsed `rules-json` value. Invalid entries are reported in
 * `errors` and omitted from `rules` (the UI surfaces them inline; the runtime
 * never applies them).
 */
export function validateRules(input: unknown): RulesParse {
  const errors: string[] = [];
  if (input === null || input === undefined) return { rules: [], errors };
  if (!Array.isArray(input)) {
    errors.push('rules-json must be a JSON array');
    return { rules: [], errors };
  }
  const rules: Rule[] = [];
  input.forEach((entry, i) => {
    const rule = validateRule(entry, `rule[${i}]`, errors);
    if (rule !== null) rules.push(rule);
  });
  return { rules, errors };
}

/** Parse a JSON string into validated rules (§22 `ReloadRules`). */
export function parseRulesJson(json: string): RulesParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { rules: [], errors: [`rules-json is not valid JSON: ${(e as Error).message}`] };
  }
  return validateRules(parsed);
}

/** The result of migrating a legacy rule list to the new shape. */
export interface RuleMigration extends RulesParse {
  /** App patterns extracted from legacy float rules: append to `exception-apps`. */
  neverTile: string[];
  /** True when `rules-json` should be rewritten. */
  changed: boolean;
}

function appIdOf(raw: unknown): string {
  if (!isRecord(raw) || !isRecord(raw.match)) return '';
  return typeof raw.match.appId === 'string' ? raw.match.appId : '';
}

/**
 * Migrate a parsed legacy rule list (§23 decisions 91-93):
 *   - a `{"match":{"appId":…},"float":true}` rule moves its app glob to the
 *     Never-tile list and leaves the rule set;
 *   - a legacy global `rules-enabled:false` becomes `enabled:false` on every
 *     rule, so the per-rule switch carries the old off state;
 *   - a `float` flag on a rule that *also* has a `tile` action is stripped, and
 *     the tile action survives.
 */
export function migrateRules(input: unknown, rulesEnabled: boolean): RuleMigration {
  const errors: string[] = [];
  const rules: Rule[] = [];
  const neverTile: string[] = [];
  let changed = false;
  if (input === null || input === undefined) return { rules, errors, neverTile, changed };
  if (!Array.isArray(input)) {
    return { rules, errors: ['rules-json must be a JSON array'], neverTile, changed: false };
  }
  input.forEach((entry, i) => {
    const where = `rule[${i}]`;
    if (!isRecord(entry)) {
      errors.push(`${where}: must be an object`);
      return;
    }
    const legacyFloat = entry.float === true;
    if (entry.float !== undefined) changed = true;
    if (legacyFloat && rulesEnabled) {
      const appId = appIdOf(entry);
      if (appId.length > 0) neverTile.push(appId);
    }
    // Rebuild the entry without the legacy flag, then validate it as today.
    const clean: Record<string, unknown> = {};
    if (entry.match !== undefined) clean.match = entry.match;
    if (entry.tile !== undefined) clean.tile = entry.tile;
    if (entry.enabled !== undefined) clean.enabled = entry.enabled;
    // A float-only rule has nothing left to keep once its app moved.
    if (legacyFloat && entry.tile === undefined) return;
    const rule = validateRule(clean, where, errors);
    if (rule === null) return;
    if (!rulesEnabled && rule.enabled !== false) {
      rule.enabled = false;
      changed = true;
    }
    rules.push(rule);
  });
  return { rules, errors, neverTile, changed };
}

/** Migrate a raw `rules-json` string. Invalid JSON is reported, never rewritten. */
export function migrateRulesJson(json: string, rulesEnabled: boolean): RuleMigration {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { rules: [], errors: [`rules-json is not valid JSON: ${(e as Error).message}`], neverTile: [], changed: false };
  }
  return migrateRules(parsed, rulesEnabled);
}
