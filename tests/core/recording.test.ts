// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import {
  capReason,
  clampMaxSeconds,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_MS,
  eventRecord,
  footerRecord,
  headerRecord,
  MAX_CAP_SECONDS,
  MAX_RECORDING_FILES,
  MIN_CAP_SECONDS,
  recordingFileName,
  recordingsToDelete,
  sampleDue,
  SNAPSHOT_INTERVAL_MS,
  snapshotKey,
  stateRecord,
} from '../../src/core/recording.js';

describe('recordingFileName', () => {
  it('stamps one local-time file per session', () => {
    // Local-time components, so the assertion is timezone-independent.
    expect(recordingFileName(new Date(2026, 9, 2, 3, 4, 5))).toBe('rec-20261002-030405.jsonl');
    expect(recordingFileName(new Date(2026, 0, 31, 23, 59, 59))).toBe('rec-20260131-235959.jsonl');
  });

  it('zero-pads every component', () => {
    expect(recordingFileName(new Date(2026, 0, 1, 0, 0, 0))).toBe('rec-20260101-000000.jsonl');
  });
});

describe('clampMaxSeconds', () => {
  it('falls back to the default for an absent or non-positive request', () => {
    expect(clampMaxSeconds(undefined)).toBe(DEFAULT_MAX_MS);
    expect(clampMaxSeconds(0)).toBe(DEFAULT_MAX_MS);
    expect(clampMaxSeconds(-5)).toBe(DEFAULT_MAX_MS);
    expect(clampMaxSeconds(Number.NaN)).toBe(DEFAULT_MAX_MS);
  });

  it('clamps a real request to the allowed window', () => {
    expect(clampMaxSeconds(30)).toBe(30_000);
    expect(clampMaxSeconds(0.9)).toBe(MIN_CAP_SECONDS * 1000);
    expect(clampMaxSeconds(60 * 60 * 5)).toBe(MAX_CAP_SECONDS * 1000);
  });
});

describe('capReason', () => {
  it('stops at the first bound reached', () => {
    expect(capReason(0, 0, 1000, 1000)).toBeNull();
    expect(capReason(1000, 0, 1000, 1000)).toBe('time');
    expect(capReason(0, 1000, 1000, 1000)).toBe('bytes');
  });

  it('prefers the byte cap when both are exceeded', () => {
    expect(capReason(5000, 5000, 1000, 1000)).toBe('bytes');
  });

  it('ignores a non-positive cap', () => {
    expect(capReason(1e9, 1e12, 0, 0)).toBeNull();
  });

  it('honours the built-in defaults', () => {
    expect(capReason(0, DEFAULT_MAX_BYTES, DEFAULT_MAX_MS, DEFAULT_MAX_BYTES)).toBe('bytes');
    expect(capReason(DEFAULT_MAX_MS, 0, DEFAULT_MAX_MS, DEFAULT_MAX_BYTES)).toBe('time');
  });
});

describe('recordingsToDelete', () => {
  const names = ['rec-20260101-000000.jsonl', 'rec-20260102-000000.jsonl', 'rec-20260103-000000.jsonl'];

  it('deletes the oldest excess, chronologically', () => {
    expect(recordingsToDelete(names, 2)).toEqual([names[0]]);
    expect(recordingsToDelete(names, 3)).toEqual([]);
    expect(recordingsToDelete(names, 10)).toEqual([]);
  });

  it('never deletes below one file', () => {
    expect(recordingsToDelete(names, 0)).toEqual([names[0], names[1]]);
    expect(recordingsToDelete(names, -1)).toEqual([names[0], names[1]]);
  });

  it('does not depend on the input order', () => {
    expect(recordingsToDelete([names[2], names[0], names[1]], 2)).toEqual([names[0]]);
  });

  it('keeps the newest ten by default', () => {
    const many = Array.from({ length: 13 }, (_, index) => `rec-202601${`${index + 1}`.padStart(2, '0')}-000000.jsonl`);
    expect(recordingsToDelete(many)).toHaveLength(13 - MAX_RECORDING_FILES);
  });
});

describe('sampleDue', () => {
  it('samples immediately, then at most once per interval', () => {
    expect(sampleDue(0, 1_000)).toBe(true);
    expect(sampleDue(1_000, 1_000 + SNAPSHOT_INTERVAL_MS - 1)).toBe(false);
    expect(sampleDue(1_000, 1_000 + SNAPSHOT_INTERVAL_MS)).toBe(true);
  });
});

describe('snapshotKey', () => {
  it('is stable for equal snapshots and distinct for a changed field', () => {
    const a = { focused: 7, windows: [{ id: 7, rect: { x: 0, y: 0, width: 10, height: 10 } }] };
    const b = { focused: 7, windows: [{ id: 7, rect: { x: 0, y: 0, width: 10, height: 10 } }] };
    const c = { focused: 7, windows: [{ id: 7, rect: { x: 1, y: 0, width: 10, height: 10 } }] };
    expect(snapshotKey(a)).toBe(snapshotKey(b));
    expect(snapshotKey(a)).not.toBe(snapshotKey(c));
  });
});

describe('line formats', () => {
  it('tags each kind and keeps the record body verbatim', () => {
    expect(headerRecord(5, { platform: 'gnome' })).toMatchObject({
      kind: 'header',
      format: 'adrt.recording',
      version: 1,
      at: 5,
      platform: 'gnome',
    });
    expect(eventRecord(9, { seq: 3, event: 'window-opened', at: 8 })).toEqual({
      kind: 'event',
      t: 9,
      seq: 3,
      event: 'window-opened',
      at: 8,
    });
    // A journal record can carry its own `kind`; the line tag must still win.
    expect(eventRecord(2, { kind: 'work-area', t: 1 }).kind).toBe('event');
    expect(stateRecord(11, { focused: 4 })).toEqual({ kind: 'state', t: 11, focused: 4 });
    expect(footerRecord(12, { reason: 'user', events: 2 })).toEqual({
      kind: 'footer',
      at: 12,
      reason: 'user',
      events: 2,
    });
  });
});
