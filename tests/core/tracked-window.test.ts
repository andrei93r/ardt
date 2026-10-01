// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { PROFILES } from '../../src/core/profiles.js';
import { TrackedWindow } from '../../src/adapters/gnome/tracked-window.js';

/** The smallest surface shape `TrackedWindow`'s constructor reads. */
function surface(appId: string): any {
  return {
    id: 42,
    appId,
    min: { width: 0, height: 0 },
    max: { width: 0, height: 0 },
  };
}

describe('TrackedWindow profile', () => {
  it('starts on the default profile before the app class is known', () => {
    const tracked = new TrackedWindow({} as any, surface(''));
    expect(tracked.profile).toBe(PROFILES.default);
  });

  it('re-derives the family profile once the identity is resolved', () => {
    // A Wayland window registers with an empty app id, so the profile is
    // `default` until the class arrives. It must not stay frozen there: Chrome
    // and VS Code need their family's unmaximize delay and retry ladder.
    const tracked = new TrackedWindow({} as any, surface(''));
    tracked.surface.appId = 'google-chrome';
    tracked.refreshProfile();
    expect(tracked.profile).toBe(PROFILES['chrome-family']);

    tracked.surface.appId = 'com.microsoft.VSCode';
    tracked.refreshProfile();
    expect(tracked.profile).toBe(PROFILES.electron);
  });

  it('prefers the resolved identity key over the raw app id', () => {
    const tracked = new TrackedWindow({} as any, surface(''));
    tracked.identityKey = 'google-chrome';
    tracked.surface.appId = 'some.generic.class';
    tracked.refreshProfile();
    expect(tracked.profile).toBe(PROFILES['chrome-family']);
  });
});
