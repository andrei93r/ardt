// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import type { ProcessEnv } from '../../src/core/identity.js';
import {
  appFamily,
  findAppImage,
  isProvisional,
  normalizeIdentity,
  readEnvValue,
  resolveIdentity,
} from '../../src/core/identity.js';

function processEnv(pid: number, ppid: number, entries: Record<string, string>): ProcessEnv {
  const environ = Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join('\0');
  return { pid, ppid, environ };
}

describe('normalizeIdentity', () => {
  it('strips a trailing .desktop', () => {
    expect(normalizeIdentity('org.gnome.Nautilus.desktop')).toBe('org.gnome.Nautilus');
    expect(normalizeIdentity('firefox.desktop')).toBe('firefox');
  });

  it('strips a trailing AppImage suffix', () => {
    expect(normalizeIdentity('/home/u/Apps/Foo.AppImage')).toBe('/home/u/Apps/Foo');
    expect(normalizeIdentity('/home/u/Apps/FooAppImage')).toBe('/home/u/Apps/Foo');
  });

  it('never casefolds a path and never realpaths it', () => {
    expect(normalizeIdentity('/home/u/Apps/MyApp.AppImage')).toBe('/home/u/Apps/MyApp');
    expect(normalizeIdentity('/home/u/Symlink/To/App')).toBe('/home/u/Symlink/To/App');
    expect(normalizeIdentity('Code')).toBe('Code');
  });

  it('trims surrounding space but keeps interior characters', () => {
    expect(normalizeIdentity('  kitty  ')).toBe('kitty');
    expect(normalizeIdentity('  org.gnome.Nautilus.desktop  ')).toBe('org.gnome.Nautilus');
  });
});

describe('isProvisional', () => {
  it('recognises the session-only window key', () => {
    expect(isProvisional('window:12')).toBe(true);
    expect(isProvisional('window:')).toBe(false);
    expect(isProvisional('firefox')).toBe(false);
  });
});

describe('appFamily', () => {
  it('casefolds for grouping only', () => {
    expect(appFamily('Google-Chrome.desktop')).toBe('google-chrome');
    expect(appFamily('Firefox')).toBe('firefox');
  });

  it('keeps deb, Flatpak and Snap installs as different families', () => {
    expect(appFamily('com.spotify.Client')).not.toBe(appFamily('spotify'));
    expect(appFamily('org.gnome.Nautilus')).not.toBe(appFamily('nautilus'));
  });
});

describe('readEnvValue', () => {
  it('reads a NUL-separated variable and ignores the rest', () => {
    const environ = 'HOME=/home/u\0APPIMAGE=/opt/Foo.AppImage\0PATH=/usr/bin';
    expect(readEnvValue(environ, 'APPIMAGE')).toBe('/opt/Foo.AppImage');
    expect(readEnvValue(environ, 'MISSING')).toBeNull();
    expect(readEnvValue('', 'APPIMAGE')).toBeNull();
  });
});

describe('findAppImage', () => {
  it('walks from the window process up to the launcher', () => {
    const processes = [
      processEnv(100, 50, { HOME: '/home/u' }),
      processEnv(50, 1, { APPIMAGE: '/home/u/Apps/Foo.AppImage' }),
    ];
    expect(findAppImage(100, processes)).toBe('/home/u/Apps/Foo.AppImage');
  });

  it('survives Chromium zeroing its own environment', () => {
    // Chromium clears its own environ, so the APPIMAGE only exists on the
    // ancestor that launched it. The mount path is random and must be ignored.
    const processes = [
      { pid: 100, ppid: 50, environ: '' },
      processEnv(50, 1, { APPDIR: '/tmp/.mount_Foo9xZ', APPIMAGE: '/home/u/Apps/Foo.AppImage' }),
    ];
    expect(findAppImage(100, processes)).toBe('/home/u/Apps/Foo.AppImage');
  });

  it('returns null without an APPIMAGE, stopping at an unreadable ancestor', () => {
    const processes = [processEnv(100, 50, { HOME: '/home/u' })];
    expect(findAppImage(100, processes)).toBeNull();
  });
});

describe('resolveIdentity', () => {
  it('prefers the tracker desktop id and normalises it', () => {
    const identity = resolveIdentity({
      desktopId: 'org.gnome.Nautilus.desktop',
      sandboxedAppId: 'com.example.Sandbox',
      gtkApplicationId: 'gtk-id',
      wmClass: 'nautilus',
      windowSeq: 1,
    });
    expect(identity.key).toBe('org.gnome.Nautilus');
    expect(identity.source).toBe('desktop-id');
    expect(identity.provisional).toBe(false);
    expect(identity.raw).toBe('org.gnome.Nautilus.desktop');
  });

  it('ignores a desktop id that is the provisional window key', () => {
    const identity = resolveIdentity({
      desktopId: 'window:7',
      sandboxedAppId: 'com.spotify.Client',
      windowSeq: 7,
    });
    expect(identity.key).toBe('com.spotify.Client');
    expect(identity.source).toBe('sandboxed-app-id');
  });

  it('falls to the sandboxed app id when there is no desktop id', () => {
    const identity = resolveIdentity({ sandboxedAppId: 'com.spotify.Client', gtkApplicationId: 'spotify', windowSeq: 2 });
    expect(identity.key).toBe('com.spotify.Client');
    expect(identity.source).toBe('sandboxed-app-id');
  });

  it('falls to the GTK application id', () => {
    const identity = resolveIdentity({ gtkApplicationId: 'org.gnome.Terminal', wmClass: 'gnome-terminal-server', windowSeq: 3 });
    expect(identity.key).toBe('org.gnome.Terminal');
    expect(identity.source).toBe('gtk-application-id');
  });

  it('resolves an AppImage from the process ancestors, ignoring the mount path', () => {
    const processes = [
      { pid: 400, ppid: 300, environ: '' },
      processEnv(300, 1, { APPDIR: '/tmp/.mount_RandomPerRun', APPIMAGE: '/home/u/Apps/MyEditor.AppImage' }),
    ];
    const identity = resolveIdentity({ pid: 400, processes, wmClass: 'myeditor', windowSeq: 4 });
    expect(identity.key).toBe('/home/u/Apps/MyEditor');
    expect(identity.source).toBe('appimage');
  });

  it('falls to wm_class when nothing else is known', () => {
    const identity = resolveIdentity({ wmClass: 'kitty', windowSeq: 5 });
    expect(identity.key).toBe('kitty');
    expect(identity.source).toBe('wm-class');
  });

  it('falls to the session-only window key', () => {
    const identity = resolveIdentity({ windowSeq: 42 });
    expect(identity.key).toBe('window:42');
    expect(identity.source).toBe('window');
    expect(identity.provisional).toBe(true);
    expect(identity.raw).toBeNull();
  });

  it('records every raw value it saw, for the journal', () => {
    const identity = resolveIdentity({
      desktopId: 'firefox.desktop',
      sandboxedAppId: null,
      gtkApplicationId: 'firefox-gtk',
      wmClass: 'Navigator',
      windowSeq: 9,
    });
    expect(identity.rawValues['desktop-id']).toBe('firefox.desktop');
    expect(identity.rawValues['gtk-application-id']).toBe('firefox-gtk');
    expect(identity.rawValues['wm-class']).toBe('Navigator');
    expect(identity.rawValues.appimage).toBeNull();
    expect(identity.rawValues.window).toBeNull();
  });
});
