// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { JsonlBuffer, dayString, encodeText, jsonLine } from '../../src/core/jsonl.js';

describe('dayString', () => {
  it('formats a local date with zero padding', () => {
    expect(dayString(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dayString(new Date(2026, 8, 30))).toBe('2026-09-30');
    expect(dayString(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('sorts chronologically as text', () => {
    const days = [new Date(2026, 11, 1), new Date(2026, 0, 15), new Date(2026, 10, 9)].map(dayString);
    expect([...days].sort()).toEqual(['2026-01-15', '2026-11-09', '2026-12-01']);
  });
});

describe('encodeText', () => {
  it('encodes ASCII as one byte each', () => {
    expect(Array.from(encodeText('ab\n'))).toEqual([0x61, 0x62, 0x0a]);
  });

  it('encodes multi-byte UTF-8', () => {
    expect(Array.from(encodeText('é'))).toEqual([0xc3, 0xa9]);
    expect(Array.from(encodeText('😀'))).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  it('keeps the byte length distinct from the string length', () => {
    expect(encodeText('é').length).toBe(2);
    expect(encodeText('').length).toBe(0);
  });
});

describe('jsonLine', () => {
  it('serializes one object and terminates the line', () => {
    expect(jsonLine({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}\n');
  });

  it('round-trips the record', () => {
    const record = { seq: 3, source: 'display', event: 'shown', nested: { ok: true } };
    expect(JSON.parse(jsonLine(record))).toEqual(record);
  });

  it('never emits a raw newline inside the line', () => {
    const line = jsonLine({ text: 'a\nb' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
  });
});

describe('JsonlBuffer', () => {
  it('drains nothing when empty', () => {
    expect(new JsonlBuffer().drain()).toBeNull();
  });

  it('joins the buffered lines for one day into a single batch', () => {
    const buffer = new JsonlBuffer();
    buffer.push('2026-10-01', '{"n":1}\n');
    buffer.push('2026-10-01', '{"n":2}\n');
    expect(buffer.length).toBe(2);
    expect(buffer.drain()).toEqual({ day: '2026-10-01', text: '{"n":1}\n{"n":2}\n', count: 2 });
    expect(buffer.drain()).toBeNull();
    expect(buffer.length).toBe(0);
  });

  it('reports a day rollover only while lines are pending', () => {
    const buffer = new JsonlBuffer();
    expect(buffer.rollsOver('2026-10-01')).toBe(false);
    buffer.push('2026-10-01', 'a\n');
    expect(buffer.rollsOver('2026-10-01')).toBe(false);
    expect(buffer.rollsOver('2026-10-02')).toBe(true);
    buffer.drain();
    expect(buffer.rollsOver('2026-10-02')).toBe(false);
  });

  it('takes the day from the first line of a batch', () => {
    const buffer = new JsonlBuffer();
    buffer.push('2026-10-02', 'a\n');
    expect(buffer.drain()?.day).toBe('2026-10-02');
  });
});
