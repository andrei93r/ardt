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

/** A single user-authored rule (§19.1 `rules-json`, §5, §6). */
export interface RuleMatch {
  appId?: string;
  title?: string;
  kind?: SurfaceKind[];
  transient?: boolean;
}

export type TileMode = 'full' | 'left-half' | 'right-half';

export interface Rule {
  match: RuleMatch;
  float?: boolean;
  tile?: TileMode;
}

export const TILE_MODES: readonly TileMode[] = ['full', 'left-half', 'right-half'];

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

export function globMatch(glob: string, value: string): boolean {
  return globToRegExp(glob).test(value);
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

/** First rule (in list order) that matches, or null. */
export function firstMatch(rules: readonly Rule[], context: RuleContext): Rule | null {
  for (const rule of rules) {
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

/**
 * Validate a parsed `rules-json` value. Invalid entries are dropped and
 * reported; the returned list is always safe to use.
 */
export function validateRules(input: unknown): { rules: Rule[]; errors: string[] } {
  const errors: string[] = [];
  if (input === null || input === undefined) return { rules: [], errors };
  if (!Array.isArray(input)) {
    errors.push('rules-json must be a JSON array');
    return { rules: [], errors };
  }
  const rules: Rule[] = [];
  input.forEach((entry, i) => {
    const where = `rule[${i}]`;
    if (!isRecord(entry)) {
      errors.push(`${where}: must be an object`);
      return;
    }
    const rule: Rule = { match: parseMatch(entry.match, where, errors) };
    if (entry.float !== undefined) {
      if (typeof entry.float !== 'boolean') errors.push(`${where}: float must be a boolean`);
      else rule.float = entry.float;
    }
    if (entry.tile !== undefined) {
      if (typeof entry.tile !== 'string' || !TILE_MODES.includes(entry.tile as TileMode)) {
        errors.push(`${where}: tile must be one of ${TILE_MODES.join(', ')}`);
      } else {
        rule.tile = entry.tile as TileMode;
      }
    }
    rules.push(rule);
  });
  return { rules, errors };
}

/** Parse a JSON string into validated rules (§22 `ReloadRules`). */
export function parseRulesJson(json: string): { rules: Rule[]; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { rules: [], errors: [`rules-json is not valid JSON: ${(e as Error).message}`] };
  }
  return validateRules(parsed);
}
