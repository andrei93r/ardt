// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { MAX_LOG_TEXT, MAX_TEXT, clipPayload, clipText } from '../../src/core/text.js';

describe('clipText', () => {
  it('keeps a normal title', () => {
    expect(clipText('New Tab - Google Chrome')).toBe('New Tab - Google Chrome');
  });

  it('bounds a pathological title', () => {
    const out = clipText('x'.repeat(5_000_000));
    expect(out.length).toBeLessThanOrEqual(MAX_TEXT + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  it('strips control characters', () => {
    expect(clipText('a\u0000b\u001fc')).toBe('a b c');
  });

  it('returns empty for non-strings', () => {
    expect(clipText(null)).toBe('');
    expect(clipText(42)).toBe('');
  });
});

describe('clipPayload', () => {
  it('bounds strings at any depth', () => {
    const payload = {
      id: 7,
      title: 'y'.repeat(10_000_000),
      nested: { deep: { list: ['z'.repeat(1_000_000)] } },
    };
    const out = clipPayload(payload) as {
      id: number;
      title: string;
      nested: { deep: { list: string[] } };
    };
    expect(out.id).toBe(7);
    expect(out.title.length).toBeLessThanOrEqual(MAX_LOG_TEXT + 1);
    expect(out.nested.deep.list[0].length).toBeLessThanOrEqual(MAX_LOG_TEXT + 1);
  });

  it('leaves numbers and booleans alone', () => {
    const out = clipPayload({ a: 1, b: true, c: null }) as { a: number; b: boolean; c: null };
    expect(out).toEqual({ a: 1, b: true, c: null });
  });
});
