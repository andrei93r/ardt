// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import type { AdaptationRecord } from '../../src/core/config.js';
import {
  BUNDLE_FORMAT,
  mergeAdaptations,
  mergeBundles,
  mergeRecords,
  normalizeBundle,
  parseBundle,
  serializeBundle,
} from '../../src/core/config.js';

const v3 = {
  format: BUNDLE_FORMAT,
  version: 3,
  exportedAt: '2026-01-01T00:00:00.000Z',
  settings: { 'gaps-base': 8, 'gesture-enabled': true },
  tracked: {
    adaptations: { firefox: { appId: 'firefox', firstSeen: 1, lastSeen: 2, observations: 3 } },
    behavior: { classes: { firefox: { float: false } }, misc: true },
  },
};

const v2 = {
  format: BUNDLE_FORMAT,
  version: 2,
  exportedAt: '2025-01-01T00:00:00.000Z',
  settings: { 'gaps-base': 4 },
  adaptations: { code: { appId: 'code', firstSeen: 1, lastSeen: 1, observations: 2 } },
  behavior: { floats: { pavucontrol: true } },
};

describe('parseBundle / normalizeBundle', () => {
  it('parses a v3 bundle', () => {
    const { bundle, errors } = parseBundle(JSON.stringify(v3));
    expect(errors).toEqual([]);
    expect(bundle?.version).toBe(3);
    expect(bundle?.tracked.adaptations.firefox.observations).toBe(3);
  });

  it('normalizes v2 top-level adaptations and behavior', () => {
    const { bundle, errors } = parseBundle(JSON.stringify(v2));
    expect(errors).toEqual([]);
    expect(bundle?.tracked.adaptations.code.appId).toBe('code');
    expect(bundle?.tracked.behavior).toEqual({ floats: { pavucontrol: true } });
  });

  it('rejects malformed JSON', () => {
    const { bundle, errors } = parseBundle('nope');
    expect(bundle).toBeNull();
    expect(errors[0]).toContain('not valid JSON');
  });

  it('rejects a wrong format marker', () => {
    const errors: string[] = [];
    expect(normalizeBundle({ format: 'other' }, errors)).toBeNull();
    expect(errors[0]).toContain('format');
  });

  it('drops unsupported setting values', () => {
    const { bundle, errors } = parseBundle(JSON.stringify({ ...v3, settings: { good: 1, bad: { a: 1 } } }));
    expect(errors.some((e) => e.includes('bad'))).toBe(true);
    expect(bundle?.settings).toEqual({ good: 1 });
  });

  it('round-trips through serializeBundle', () => {
    const { bundle } = parseBundle(JSON.stringify(v3));
    expect(parseBundle(serializeBundle(bundle!)).bundle).toEqual(bundle);
  });
});

describe('mergeRecords', () => {
  const base = { classes: { a: { float: false } }, floats: { pavucontrol: true }, misc: 1 };

  it('deepens only classes and floats in merge mode', () => {
    const { record } = mergeRecords(base, { classes: { b: { float: true } }, misc: 2 }, 'merge');
    expect(record.classes).toEqual({ a: { float: false }, b: { float: true } });
    expect(record.floats).toEqual({ pavucontrol: true });
    expect(record.misc).toBe(2);
  });

  it('replaces wholesale in replace mode', () => {
    const { record, report } = mergeRecords(base, { classes: { b: {} } }, 'replace');
    expect(record).toEqual({ classes: { b: {} } });
    expect(report.applied).toContain('classes');
    expect(report.skipped).toContain('misc');
  });

  it('reports skipped base keys in merge mode', () => {
    const { report } = mergeRecords(base, { misc: 2 }, 'merge');
    expect(report.applied).toEqual(['misc']);
    expect(report.skipped).toContain('classes');
  });
});

describe('mergeAdaptations', () => {
  const base: Record<string, AdaptationRecord> = { firefox: { appId: 'firefox', firstSeen: 1, lastSeen: 1, observations: 1 } };
  const incoming: Record<string, AdaptationRecord> = { firefox: { appId: 'firefox', firstSeen: 1, lastSeen: 5, observations: 4, skipAnimation: true } };

  it('merges per-app fields one level deep', () => {
    const { record } = mergeAdaptations(base, incoming, 'merge');
    expect(record.firefox.observations).toBe(4);
    expect(record.firefox.skipAnimation).toBe(true);
  });

  it('replaces in replace mode', () => {
    const { record } = mergeAdaptations(base, {}, 'replace');
    expect(record).toEqual({});
  });
});

describe('mergeBundles', () => {
  it('applies settings and tracks reports', () => {
    const a = parseBundle(JSON.stringify(v3)).bundle!;
    const b = parseBundle(JSON.stringify({ ...v3, settings: { 'gaps-base': 16 } })).bundle!;
    const result = mergeBundles(a, b, 'merge');
    expect(result.bundle.settings['gaps-base']).toBe(16);
    expect(result.settings.applied).toContain('gaps-base');
  });

  const withRegistry = (appId: string) => ({
    ...v3,
    tracked: { ...v3.tracked, registry: { version: 1, entries: [{ appId }] } },
  });

  it('carries the registry through a merge, the incoming one winning', () => {
    const base = parseBundle(JSON.stringify(withRegistry('base'))).bundle!;
    const incoming = parseBundle(JSON.stringify(withRegistry('incoming'))).bundle!;
    const result = mergeBundles(base, incoming, 'merge');
    expect(result.bundle.tracked.registry).toEqual({ version: 1, entries: [{ appId: 'incoming' }] });
  });

  it('keeps the base registry when the incoming bundle has none', () => {
    const base = parseBundle(JSON.stringify(withRegistry('base'))).bundle!;
    const incoming = parseBundle(JSON.stringify(v3)).bundle!;
    const result = mergeBundles(base, incoming, 'merge');
    expect(result.bundle.tracked.registry).toEqual({ version: 1, entries: [{ appId: 'base' }] });
  });
});
