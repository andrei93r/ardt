// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { SessionMachine } from '../../src/core/session.js';

describe('SessionMachine', () => {
  it('starts in user mode, running', () => {
    const session = new SessionMachine();
    expect(session.state).toEqual({ mode: 'user', paused: false });
  });

  it('pauses and hides the indicator for the lock screen', () => {
    const session = new SessionMachine();
    const effects = session.setMode('unlock-dialog');
    expect(effects).toEqual({
      paused: true,
      indicatorVisible: false,
      indicatorSuppression: 'pause',
      scanTickRunning: false,
      retileOnResume: false,
    });
    expect(session.isPaused).toBe(true);
  });

  it('keeps tiling but hides the indicator while screen sharing', () => {
    const session = new SessionMachine();
    const effects = session.setMode('screen-sharing');
    expect(effects.paused).toBe(false);
    expect(effects.scanTickRunning).toBe(true);
    expect(effects.indicatorVisible).toBe(false);
    expect(effects.indicatorSuppression).toBe('sharing');
  });

  it('emits a resume retile exactly once when returning to user', () => {
    const session = new SessionMachine();
    session.setMode('unlock-dialog');
    const resumed = session.setMode('user');
    expect(resumed.paused).toBe(false);
    expect(resumed.retileOnResume).toBe(true);
    expect(session.consumeRetile()).toBe(true);
    expect(session.consumeRetile()).toBe(false);

    // Staying in user does not retile again.
    expect(session.setMode('user').retileOnResume).toBe(false);
  });

  it('does not retile when returning from screen sharing', () => {
    const session = new SessionMachine();
    session.setMode('screen-sharing');
    expect(session.setMode('user').retileOnResume).toBe(false);
  });
});
