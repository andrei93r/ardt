// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import {
  contextFor,
  firstMatch,
  globMatch,
  globToRegExp,
  migrateRules,
  migrateRulesJson,
  parseRulesJson,
  ruleMatches,
  validateRule,
  validateRules,
} from '../../src/core/rules.js';
import { SurfaceKind } from '../../src/core/types.js';
import { surface } from './helpers.js';

describe('globMatch', () => {
  it('matches wildcards case-insensitively', () => {
    expect(globMatch('org.gnome.*', 'org.gnome.Nautilus')).toBe(true);
    expect(globMatch('*firefox*', 'org.mozilla.Firefox')).toBe(true);
    expect(globMatch('code?', 'codex')).toBe(true);
    expect(globMatch('code', 'codex')).toBe(false);
  });

  it('escapes regex metacharacters', () => {
    expect(globToRegExp('a.b').test('a.b')).toBe(true);
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });
});

describe('ruleMatches / firstMatch', () => {
  const context = contextFor(surface({ appId: 'org.mozilla.Firefox', title: 'Inbox — Firefox' }));

  it('ANDs all present fields', () => {
    expect(ruleMatches({ match: { appId: 'org.mozilla.*', title: '*Firefox*' }, tile: 'full' }, context)).toBe(true);
    expect(ruleMatches({ match: { appId: 'org.mozilla.*', title: 'Inbox' }, tile: 'full' }, context)).toBe(false);
  });

  it('filters by kind list', () => {
    expect(ruleMatches({ match: { kind: [SurfaceKind.NORMAL] }, tile: 'full' }, context)).toBe(true);
    expect(ruleMatches({ match: { kind: [SurfaceKind.DIALOG] }, tile: 'full' }, context)).toBe(false);
    expect(ruleMatches({ match: { kind: ['dialog' as SurfaceKind] }, tile: 'full' }, context)).toBe(false);
  });

  it('filters by transient flag', () => {
    expect(ruleMatches({ match: { transient: false }, tile: 'full' }, context)).toBe(true);
    expect(ruleMatches({ match: { transient: true }, tile: 'full' }, context)).toBe(false);
  });

  it('returns the first matching rule in list order', () => {
    const rules = [
      { match: { appId: 'org.mozilla.*' }, tile: 'left-half' as const },
      { match: { appId: '*' }, tile: 'full' as const },
    ];
    expect(firstMatch(rules, context)).toBe(rules[0]);
    expect(firstMatch([], context)).toBeNull();
  });

  it('skips a disabled rule and takes the next match', () => {
    const rules = [
      { match: { appId: 'org.mozilla.*' }, tile: 'left-half' as const, enabled: false },
      { match: { appId: '*' }, tile: 'full' as const },
    ];
    expect(firstMatch(rules, context)).toBe(rules[1]);
    expect(firstMatch([rules[0]], context)).toBeNull();
  });

  it('returns the matching rule so its tile action is read', () => {
    const rule = { match: { appId: 'org.mozilla.*' }, tile: 'right-half' as const };
    expect(firstMatch([rule], context)?.tile).toBe('right-half');
  });
});

describe('validateRule', () => {
  it('accepts a well-formed tile rule with no errors', () => {
    const errors: string[] = [];
    const rule = validateRule({ match: { appId: 'a*', title: '*Docs*' }, tile: 'left-half' }, 'rule[0]', errors);
    expect(errors).toEqual([]);
    expect(rule?.tile).toBe('left-half');
    expect(rule?.match.appId).toBe('a*');
  });

  it('accepts a per-rule enabled switch', () => {
    const errors: string[] = [];
    const rule = validateRule({ match: { appId: 'a*' }, tile: 'full', enabled: false }, 'rule[0]', errors);
    expect(errors).toEqual([]);
    expect(rule?.enabled).toBe(false);
  });

  it('requires a tile action', () => {
    const errors: string[] = [];
    expect(validateRule({ match: { appId: 'a*' } }, 'rule[0]', errors)).toBeNull();
    expect(errors.join(' ')).toContain('tile');
  });

  it('retires the float action with a pointer to the Never-tile list', () => {
    const errors: string[] = [];
    expect(validateRule({ match: { appId: 'pavu*' }, float: true }, 'rule[0]', errors)).toBeNull();
    expect(errors.join(' ')).toContain('Never-tile');
  });

  it('requires at least one match field', () => {
    const errors: string[] = [];
    expect(validateRule({ match: {}, tile: 'full' }, 'rule[0]', errors)).toBeNull();
    expect(errors.join(' ')).toContain('at least one');
  });

  it('rejects an unknown tile mode and an unknown kind', () => {
    const errors: string[] = [];
    expect(validateRule({ match: { appId: 'a' }, tile: 'nope' }, 'rule[0]', errors)).toBeNull();
    validateRule({ match: { kind: ['bogus'] }, tile: 'full' }, 'rule[1]', errors);
    expect(errors.join(' ')).toContain('tile must be one of');
    expect(errors.join(' ')).toContain('unknown kind');
  });

  it('rejects a non-object entry', () => {
    const errors: string[] = [];
    expect(validateRule(null, 'rule[0]', errors)).toBeNull();
    expect(errors).toEqual(['rule[0]: must be an object']);
  });

  it('reports the "enabled" type error', () => {
    const errors: string[] = [];
    validateRule({ match: { appId: 'a' }, tile: 'full', enabled: 'yes' }, 'rule[0]', errors);
    expect(errors.join(' ')).toContain('enabled must be a boolean');
  });
});

describe('validateRules', () => {
  it('accepts well-formed rules and keeps entries in order', () => {
    const { rules, errors } = validateRules([
      { match: { appId: 'a*' }, tile: 'full' },
      { match: { title: 'b' }, tile: 'right-half' },
    ]);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(2);
    expect(rules[1].tile).toBe('right-half');
  });

  it('reports invalid entries and keeps the valid ones', () => {
    const { rules, errors } = validateRules([
      null,
      { match: { appId: 5 } },
      { match: {}, tile: 'nope' },
      { match: { kind: ['bogus'] }, tile: 'full' },
      { match: { appId: 'ok' }, tile: 'full' },
    ]);
    // Only the last entry survives; every problem is still reported, never dropped.
    expect(rules).toHaveLength(1);
    expect(rules[0].tile).toBe('full');
    expect(errors.length).toBeGreaterThanOrEqual(5);
  });

  it('rejects non-array input', () => {
    expect(validateRules({}).errors[0]).toContain('array');
  });
});

describe('parseRulesJson', () => {
  it('parses valid JSON', () => {
    expect(parseRulesJson('[{"match":{"appId":"*"},"tile":"full"}]').rules).toHaveLength(1);
  });

  it('reports malformed JSON without throwing', () => {
    const result = parseRulesJson('{not json');
    expect(result.rules).toEqual([]);
    expect(result.errors[0]).toContain('not valid JSON');
  });

  it('surfaces a rule error without dropping the valid rules', () => {
    const result = parseRulesJson('[{"match":{"appId":"a"},"tile":"full"},{"match":{}}]');
    expect(result.rules).toHaveLength(1);
    expect(result.errors.join(' ')).toContain('tile');
  });
});

describe('migrateRules', () => {
  it('moves a legacy float rule to the Never-tile list and drops it', () => {
    const migration = migrateRules([{ match: { appId: 'pavucontrol' }, float: true }], true);
    expect(migration.neverTile).toEqual(['pavucontrol']);
    expect(migration.rules).toEqual([]);
    expect(migration.changed).toBe(true);
  });

  it('keeps a tile rule and strips the legacy float flag', () => {
    const migration = migrateRules([{ match: { appId: 'a' }, tile: 'left-half', float: true }], true);
    expect(migration.neverTile).toEqual(['a']);
    expect(migration.rules).toHaveLength(1);
    expect(migration.rules[0].tile).toBe('left-half');
    expect(migration.changed).toBe(true);
  });

  it('carries a legacy global disable into per-rule enabled:false', () => {
    const migration = migrateRules([{ match: { appId: 'a' }, tile: 'full' }], false);
    expect(migration.rules[0].enabled).toBe(false);
    expect(migration.changed).toBe(true);
  });

  it('does not migrate rule floats when the global gate was off', () => {
    const migration = migrateRules([{ match: { appId: 'a' }, float: true }], false);
    expect(migration.neverTile).toEqual([]);
    expect(migration.rules).toEqual([]);
  });

  it('is a no-op once the rules are in the new shape', () => {
    const migration = migrateRules([{ match: { appId: 'a' }, tile: 'full' }], true);
    expect(migration.changed).toBe(false);
    expect(migration.neverTile).toEqual([]);
    expect(migration.rules).toHaveLength(1);
  });

  it('reports an invalid entry without rewriting a legacy-clean list', () => {
    const migration = migrateRules([{ match: {}, tile: 'full' }], true);
    expect(migration.changed).toBe(false);
    expect(migration.rules).toEqual([]);
    expect(migration.errors.length).toBeGreaterThan(0);
  });
});

describe('migrateRulesJson', () => {
  it('reports malformed JSON without rewriting it', () => {
    const migration = migrateRulesJson('{not json', true);
    expect(migration.rules).toEqual([]);
    expect(migration.changed).toBe(false);
    expect(migration.errors[0]).toContain('not valid JSON');
  });
});
