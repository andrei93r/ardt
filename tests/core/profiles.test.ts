// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { PROFILES, profileFor } from '../../src/core/profiles.js';

describe('profileFor', () => {
  it('resolves the chrome family', () => {
    expect(profileFor('google-chrome')).toBe(PROFILES['chrome-family']);
    expect(profileFor('brave-browser')).toBe(PROFILES['chrome-family']);
  });

  it('resolves electron apps', () => {
    expect(profileFor('code')).toBe(PROFILES.electron);
    expect(profileFor('org.telegram.desktop')).toBe(PROFILES.default);
  });

  it('resolves gtk terminals including reverse-DNS ids', () => {
    expect(profileFor('org.gnome.Terminal')).toBe(PROFILES['gtk-terminal']);
    expect(profileFor('kitty')).toBe(PROFILES['gtk-terminal']);
  });

  it('resolves JetBrains IDEs without animation', () => {
    expect(profileFor('jetbrains-idea')).toBe(PROFILES['java-swing']);
    expect(profileFor('jetbrains-idea').animate).toBe(false);
  });

  it('falls back to default', () => {
    expect(profileFor('totally-unknown')).toBe(PROFILES.default);
  });

  it('is case-insensitive', () => {
    expect(profileFor('Google-Chrome')).toBe(PROFILES['chrome-family']);
  });
});
