// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { NOTICE_ALWAYS, NOTICE_CATALOGUE, NoticeGate, noticeTitle } from '../../src/core/notify.js';

describe('notice catalogue', () => {
  it('names every decision in the model, phrased as the decision', () => {
    const keys = NOTICE_CATALOGUE.map((n) => n.key);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const key of ['workspace-created', 'did-not-fit', 'sibling-adapted', 'no-room-floats',
      'maximize-moved', 'minimized-moved', 'workspace-reaped', 'screen-changed', 'normalised']) {
      expect(keys).toContain(key);
    }
    for (const entry of NOTICE_CATALOGUE) {
      expect(entry.title.length).toBeGreaterThan(0);
      // Phrased as the decision, never as a question.
      expect(entry.title.endsWith('?')).toBe(false);
    }
    // Most are of the "cause → effect" shape.
    expect(NOTICE_CATALOGUE.filter((n) => n.title.includes('→')).length).toBeGreaterThanOrEqual(8);
  });

  it('keeps the nothing-happened notices separate and always on', () => {
    expect(NOTICE_ALWAYS.length).toBeGreaterThanOrEqual(3);
    expect(NOTICE_ALWAYS.every((n) => n.always === true)).toBe(true);
    expect(NOTICE_CATALOGUE.every((n) => n.always !== true)).toBe(true);
    expect(noticeTitle('un-float-full')).toContain('un-float');
    // A resize at the 5–95% limit changed nothing, so it is always announced.
    expect(NOTICE_ALWAYS.map((n) => n.key)).toContain('resize-limit');
    expect(noticeTitle('resize-limit')).toContain('limit');
  });

  it('returns null for an unknown key so a typo is visible in tests', () => {
    expect(noticeTitle('nope')).toBeNull();
  });
});

describe('NoticeGate', () => {
  it('allows a burst once per subject and dedupes inside the window', () => {
    const gate = new NoticeGate(2000, 3, 10000);
    expect(gate.allow('did-not-fit', 'win-1', 1000)).toBe(true);
    expect(gate.allow('did-not-fit', 'win-1', 1500)).toBe(false);
    expect(gate.allow('did-not-fit', 'win-1', 2900)).toBe(false);
    // Outside the dedupe window the same subject may speak again (cap permitting).
    expect(gate.allow('did-not-fit', 'win-1', 4000)).toBe(true);
  });

  it('treats subjects independently', () => {
    const gate = new NoticeGate(2000, 3, 10000);
    expect(gate.allow('no-room-floats', 'win-1', 0)).toBe(true);
    expect(gate.allow('no-room-floats', 'win-2', 0)).toBe(true);
    expect(gate.allow('no-room-floats', 'win-3', 0)).toBe(true);
    expect(gate.allow('no-room-floats', 'win-4', 0)).toBe(false);
  });

  it('caps a burst at the window limit even across keys and subjects', () => {
    const gate = new NoticeGate(1, 3, 10000);
    expect(gate.allow('workspace-created', 'w1', 0)).toBe(true);
    expect(gate.allow('workspace-reaped', 'w2', 1)).toBe(true);
    expect(gate.allow('screen-changed', 'w3', 2)).toBe(true);
    expect(gate.allow('did-not-fit', 'w4', 3)).toBe(false);
    // The cap window passes and the gate speaks again.
    expect(gate.allow('did-not-fit', 'w4', 10001)).toBe(true);
  });

  it('forgets nothing until the window passes, and never grows without bound', () => {
    const gate = new NoticeGate(100, 10, 1000);
    for (let i = 0; i < 500; i += 1) gate.allow('workspace-reaped', `w${i}`, i * 10);
    expect(gate.size).toBeLessThanOrEqual(200);
  });
});
