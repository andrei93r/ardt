// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import type { AdaptationRecord } from '../../src/core/config.js';
import { AppRegistry, sanitizeAdapt } from '../../src/core/appregistry.js';
import type { Rect } from '../../src/core/types.js';

function rect(x = 0, y = 0, width = 960, height = 1080): Rect {
  return { x, y, width, height };
}

function adaptation(overrides: Partial<AdaptationRecord> = {}): AdaptationRecord {
  return { appId: 'firefox', firstSeen: 10, lastSeen: 20, observations: 3, ...overrides };
}

describe('observe', () => {
  it('auto-populates one entry per app and logs every window', () => {
    const registry = new AppRegistry();
    registry.observe({ appId: 'firefox', title: 'First', now: 1000 });
    const entry = registry.observe({ appId: 'firefox', title: 'Second', now: 2000 });

    expect(registry.size).toBe(1);
    expect(entry.firstSeen).toBe(1000);
    expect(entry.lastSeen).toBe(2000);
    expect(entry.windowsSeen).toBe(2);
    expect(entry.lastTitle).toBe('Second');
    expect(entry.neverTile).toBe(false);
  });
});

describe('neverTile', () => {
  it('is a durable boolean that can be set and toggled', () => {
    const registry = new AppRegistry();
    expect(registry.isNeverTile('pavucontrol')).toBe(false);

    registry.setNeverTile('pavucontrol', true, 100);
    expect(registry.isNeverTile('pavucontrol')).toBe(true);
    expect(registry.toggleNeverTile('pavucontrol')).toBe(false);
  });
});

describe('adapt', () => {
  it('keeps timing hints and drops every geometric field', () => {
    const registry = new AppRegistry();
    registry.setAdapt('chrome', {
      unmaximizeDelayMs: 40,
      settleMs: 120,
      skipAnimation: true,
      retries: 2,
      refusedMinW: 500,
      refusedMinH: 400,
      acceptedW: 900,
      acceptedH: 700,
    });

    const adapt = registry.adaptFor('chrome');
    expect(adapt).toEqual({ unmaximizeDelayMs: 40, settleMs: 120, skipAnimation: true, retries: 2 });
    expect('refusedMinW' in adapt).toBe(false);
    expect('refusedMinH' in adapt).toBe(false);
  });

  it('sanitizeAdapt ignores non-numeric and unknown keys', () => {
    expect(sanitizeAdapt({ settleMs: 'nope', skipAnimation: 'yes', bogus: 1 })).toEqual({});
  });
});

describe('placements and ordinals', () => {
  it('assigns a durable per-app ordinal and keeps it on re-place', () => {
    const registry = new AppRegistry();
    const first = registry.place('files', 'win-a', { connector: 'eDP-1', slot: 0, rect: rect() }, 1);
    const second = registry.place('files', 'win-b', { connector: 'eDP-1', slot: 1, rect: rect() }, 2);

    expect(first.ordinal).toBe(1);
    expect(second.ordinal).toBe(2);

    registry.place('files', 'win-a', { connector: 'HDMI-1', slot: 1, rect: rect() }, 3);
    expect(registry.ordinalFor('files', 'win-a')).toBe(1);
    expect(registry.placement('files', 'win-a')?.connector).toBe('HDMI-1');
  });

  it('rolls the ordinal forward and never reuses a retired one', () => {
    const registry = new AppRegistry();
    registry.place('files', 'win-a', { connector: 'eDP-1', slot: 0, rect: rect() });
    registry.place('files', 'win-b', { connector: 'eDP-1', slot: 1, rect: rect() });
    registry.forgetPlacement('files', 'win-b');

    const replacement = registry.place('files', 'win-c', { connector: 'eDP-1', slot: 1, rect: rect() });
    expect(replacement.ordinal).toBe(3);
  });

  it('matches recreated windows by ordinal in order', () => {
    const registry = new AppRegistry();
    registry.place('files', 'win-a', { connector: 'eDP-1', slot: 0, rect: rect() });
    registry.place('files', 'win-b', { connector: 'eDP-1', slot: 1, rect: rect() });

    expect(registry.placementByOrdinal('files', 2)?.instanceId).toBe('win-b');
    expect(registry.placements('files').map((placement) => placement.ordinal)).toEqual([1, 2]);
  });
});

describe('rekey', () => {
  it('carries the provisional entry onto the real key', () => {
    const registry = new AppRegistry();
    registry.observe({ appId: 'window:4', title: 'Firefox', now: 100 });
    registry.place('window:4', 'win-a', { connector: 'eDP-1', slot: 0, rect: rect() }, 100);
    registry.setNeverTile('window:4', true, 100);

    expect(registry.rekey('window:4', 'firefox')).toBe(true);
    expect(registry.has('window:4')).toBe(false);

    const entry = registry.get('firefox');
    expect(entry?.appId).toBe('firefox');
    expect(entry?.neverTile).toBe(true);
    expect(entry?.lastTitle).toBe('Firefox');
    expect(registry.get('window:4')).toBeUndefined();
    expect(registry.ordinalFor('firefox', 'win-a')).toBe(1);
  });

  it('lets the real key win and unions neverTile', () => {
    const registry = new AppRegistry();
    registry.observe({ appId: 'window:1', title: 'provisional', now: 100 });
    registry.setNeverTile('window:1', true, 100);
    registry.setAdapt('window:1', { settleMs: 50, skipAnimation: true }, 100);
    registry.place('window:1', 'old-a', { connector: 'eDP-1', slot: 0, rect: rect() }, 100);

    registry.observe({ appId: 'firefox', title: 'real', now: 200 });
    registry.setAdapt('firefox', { unmaximizeDelayMs: 40 }, 200);
    registry.place('firefox', 'new-b', { connector: 'HDMI-1', slot: 1, rect: rect() }, 200);

    expect(registry.rekey('window:1', 'firefox')).toBe(true);
    const entry = registry.get('firefox')!;
    expect(entry.neverTile).toBe(true);
    expect(entry.lastTitle).toBe('real');
    expect(entry.adapt.settleMs).toBe(50);
    expect(entry.adapt.skipAnimation).toBe(true);
    expect(entry.adapt.unmaximizeDelayMs).toBe(40);
    // Both placements survive, with unique ordinals.
    expect(registry.ordinalFor('firefox', 'new-b')).toBe(1);
    expect(registry.ordinalFor('firefox', 'old-a')).toBe(2);
    expect(registry.placements('firefox')).toHaveLength(2);
    expect(registry.get('firefox')!.nextOrdinal).toBe(3);
  });

  it('is a no-op for a missing key or an identical key', () => {
    const registry = new AppRegistry();
    expect(registry.rekey('missing', 'firefox')).toBe(false);
    registry.observe({ appId: 'firefox', now: 1 });
    expect(registry.rekey('firefox', 'firefox')).toBe(false);
  });
});

describe('migration', () => {
  it('folds legacy adaptation into timing-only hints', () => {
    const registry = new AppRegistry();
    const report = registry.migrate(
      {
        adaptation: {
          records: {
            firefox: adaptation({
              unmaximizeDelayEma: 47.6,
              settleTimeEma: 130.4,
              skipAnimation: true,
              refusedMinW: 400,
              refusedMinH: 300,
              acceptedW: 900,
              acceptedH: 700,
            }),
          },
        },
      },
      1000,
    );

    const entry = registry.get('firefox')!;
    expect(entry.firstSeen).toBe(10);
    expect(entry.lastSeen).toBe(20);
    expect(entry.windowsSeen).toBe(3);
    expect(entry.adapt).toEqual({ unmaximizeDelayMs: 48, settleMs: 130, skipAnimation: true });
    expect('refusedMinW' in entry.adapt).toBe(false);
    expect(report.adapted).toContain('firefox');
  });

  it('marks behavior floats as neverTile', () => {
    const registry = new AppRegistry();
    const report = registry.migrate({ behavior: { floats: ['pavucontrol', 'org.gnome.Calculator'] } }, 1000);

    expect(registry.isNeverTile('pavucontrol')).toBe(true);
    expect(registry.isNeverTile('org.gnome.Calculator')).toBe(true);
    expect(report.floated).toContain('pavucontrol');
  });

  it('turns exception globs into neverTile entries, normalised', () => {
    const registry = new AppRegistry();
    registry.migrate({ exceptionApps: ['org.gnome.*', 'pavucontrol.desktop'] }, 1000);

    expect(registry.isNeverTile('org.gnome.*')).toBe(true);
    expect(registry.isNeverTile('pavucontrol')).toBe(true);
  });

  it('is idempotent and keeps the recorded window count', () => {
    const registry = new AppRegistry();
    const stores = { adaptation: { records: { firefox: adaptation() } }, behavior: { floats: ['firefox'] } };
    registry.migrate(stores, 1000);
    registry.migrate(stores, 2000);

    const entry = registry.get('firefox')!;
    expect(entry.windowsSeen).toBe(3);
    expect(entry.neverTile).toBe(true);
    expect(registry.size).toBe(1);
  });
});

describe('pruning', () => {
  it('drops stale entries by TTL but keeps fresh ones', () => {
    const registry = new AppRegistry({ ttlMs: 1000 });
    registry.observe({ appId: 'stale', now: 0 });
    registry.observe({ appId: 'fresh', now: 900 });

    const removed = registry.prune(1001);
    expect(removed).toEqual(['stale']);
    expect(registry.has('fresh')).toBe(true);
  });

  it('never expires a durable neverTile decision', () => {
    const registry = new AppRegistry({ ttlMs: 1000 });
    registry.setNeverTile('pinned', true, 0);
    registry.observe({ appId: 'pinned', now: 0 });

    expect(registry.prune(100000)).toEqual([]);
    expect(registry.isNeverTile('pinned')).toBe(true);
  });
});

describe('serialization', () => {
  it('round-trips entries, placements and the ordinal counter', () => {
    const registry = new AppRegistry();
    registry.observe({ appId: 'files', title: 'Files', now: 100 });
    registry.place('files', 'win-a', { connector: 'eDP-1', slot: 0, rect: rect(0, 0, 960, 1080) }, 100);
    registry.place('files', 'win-b', { connector: 'eDP-1', slot: 1, rect: rect(960, 0, 960, 1080) }, 100);
    registry.forgetPlacement('files', 'win-b');

    const restored = AppRegistry.fromJSON(registry.toJSON());
    expect(restored.ordinalFor('files', 'win-a')).toBe(1);
    restored.place('files', 'win-c', { connector: 'eDP-1', slot: 1, rect: rect() });
    expect(restored.ordinalFor('files', 'win-c')).toBe(3);
    expect(restored.get('files')?.windowsSeen).toBe(1);
  });
});
