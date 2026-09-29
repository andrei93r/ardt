// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { contextFor, firstMatch, globMatch, globToRegExp, parseRulesJson, ruleMatches, validateRules } from '../../src/core/rules.js';
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
    expect(ruleMatches({ match: { appId: 'org.mozilla.*', title: '*Firefox*' } }, context)).toBe(true);
    expect(ruleMatches({ match: { appId: 'org.mozilla.*', title: 'Inbox' } }, context)).toBe(false);
  });

  it('filters by kind list', () => {
    expect(ruleMatches({ match: { kind: [SurfaceKind.NORMAL] } }, context)).toBe(true);
    expect(ruleMatches({ match: { kind: [SurfaceKind.DIALOG] } }, context)).toBe(false);
    expect(ruleMatches({ match: { kind: ['dialog' as SurfaceKind] } }, context)).toBe(false);
  });

  it('filters by transient flag', () => {
    expect(ruleMatches({ match: { transient: false } }, context)).toBe(true);
    expect(ruleMatches({ match: { transient: true } }, context)).toBe(false);
  });

  it('returns the first matching rule in list order', () => {
    const rules = [{ match: { appId: 'org.mozilla.*' } }, { match: { appId: '*' } }];
    expect(firstMatch(rules, context)).toBe(rules[0]);
    expect(firstMatch([], context)).toBeNull();
  });
});

describe('validateRules', () => {
  it('accepts well-formed rules', () => {
    const { rules, errors } = validateRules([{ match: { appId: 'a*' }, float: true }, { match: { title: 'b' }, tile: 'right-half' }]);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(2);
    expect(rules[1].tile).toBe('right-half');
  });

  it('reports invalid entries and keeps going', () => {
    const { rules, errors } = validateRules([null, { match: { appId: 5 } }, { match: {}, tile: 'nope' }, { match: { kind: ['bogus'] } }]);
    // Non-object entries are dropped; the rest are kept with errors reported.
    expect(rules).toHaveLength(3);
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects non-array input', () => {
    expect(validateRules({}).errors[0]).toContain('array');
  });
});

describe('parseRulesJson', () => {
  it('parses valid JSON', () => {
    expect(parseRulesJson('[{"match":{"appId":"*"}}]').rules).toHaveLength(1);
  });

  it('reports malformed JSON without throwing', () => {
    const result = parseRulesJson('{not json');
    expect(result.rules).toEqual([]);
    expect(result.errors[0]).toContain('not valid JSON');
  });
});
