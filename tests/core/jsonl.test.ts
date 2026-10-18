// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { JsonlBuffer, LineFramer, dayString, decodeText, encodeText, jsonLine } from '../../src/core/jsonl.js';

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

describe('decodeText', () => {
  it('decodes UTF-8 exactly, including characters the Latin-1 loop mangled', () => {
    const text = 'café — 日本語 🚀 “quoted”';
    expect(decodeText(encodeText(text))).toBe(text);
    // A Latin-1 decode would have produced 'Ã©' for these two bytes.
    expect(decodeText(new Uint8Array([0xc3, 0xa9]))).toBe('é');
  });

  it('round-trips a title across a read/write cycle without doubling', () => {
    const original = 'Büro – naïve façade';
    const once = decodeText(encodeText(original));
    const twice = decodeText(encodeText(once));
    expect(once).toBe(original);
    expect(twice).toBe(original);
  });
});

describe('LineFramer', () => {
  it('emits only complete newline-terminated lines', () => {
    const framer = new LineFramer();
    expect(framer.push(encodeText('{"a":1}\n{"b":2}\n'))).toEqual({
      lines: ['{"a":1}', '{"b":2}'],
      consumed: 16,
    });
    expect(framer.bufferedBytes).toBe(0);
  });

  it('carries a partial line to the next chunk', () => {
    const framer = new LineFramer();
    const first = framer.push(encodeText('{"a":'));
    expect(first.lines).toEqual([]);
    expect(first.consumed).toBe(0);
    expect(framer.bufferedBytes).toBe(5);

    const second = framer.push(encodeText('1}\nnext'));
    expect(second.lines).toEqual(['{"a":1}']);
    expect(second.consumed).toBe(8);
    expect(framer.bufferedBytes).toBe(4);
  });

  it('decodes a multi-byte sequence split across chunks', () => {
    const bytes = encodeText('é\n');
    const framer = new LineFramer();
    expect(framer.push(bytes.subarray(0, 1)).lines).toEqual([]);
    expect(framer.push(bytes.subarray(1)).lines).toEqual(['é']);
  });

  it('does not advance the offset past a partial line', () => {
    const framer = new LineFramer();
    const result = framer.push(encodeText('one\ntwo'));
    expect(result.lines).toEqual(['one']);
    expect(result.consumed).toBe(4);
  });

  it('drops a line longer than the cap without buffering it', () => {
    const framer = new LineFramer(8);
    framer.push(encodeText('123456789'));
    expect(framer.bufferedBytes).toBe(0);
    expect(framer.push(encodeText('still long\nok\n'))).toEqual({ lines: ['ok'], consumed: 14 });
  });

  it('accepts CRLF line endings', () => {
    expect(new LineFramer().push(encodeText('a\r\nb\r\n')).lines).toEqual(['a', 'b']);
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
