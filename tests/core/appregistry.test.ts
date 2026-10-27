// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import type { AdaptationRecord } from '../../src/core/config.js';
import type { AppEntry } from '../../src/core/appregistry.js';
import {
  AppRegistry,
  MAX_PLACEMENTS_PER_APP,
  MAX_REGISTRY_BYTES,
  REGISTRY_VERSION,
  sanitizeAdapt,
} from '../../src/core/appregistry.js';
import { MAX_TEXT } from '../../src/core/text.js';
import type { Rect } from '../../src/core/types.js';

function rect(x = 0, y = 0, width = 960, height = 1080): Rect {
  return { x, y, width, height };
}

function entry(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    appId: 'files',
    firstSeen: 1,
    lastSeen: 2,
    windowsSeen: 1,
    lastTitle: '',
    neverTile: false,
    profile: {},
    adapt: {},
    placements: {},
    nextOrdinal: 1,
    ...overrides,
  };
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

  it('clips a pathological title at the edge instead of storing it', () => {
    const registry = new AppRegistry();
    const entry = registry.observe({ appId: 'firefox', title: 'x'.repeat(5_000_000) });
    expect(entry.lastTitle.length).toBeLessThanOrEqual(MAX_TEXT + 1);
    expect(entry.lastTitle.endsWith('…')).toBe(true);
    expect(registry.toJSON().entries[0].lastTitle.length).toBeLessThanOrEqual(MAX_TEXT + 1);
  });

  it('does not double non-ASCII titles across a save/load round-trip', () => {
    const registry = new AppRegistry();
    registry.observe({ appId: 'firefox', title: 'Büro – naïve façade 日本語' });
    const restored = AppRegistry.fromJSON(JSON.parse(JSON.stringify(registry.toJSON())));
    expect(restored.get('firefox')?.lastTitle).toBe('Büro – naïve façade 日本語');
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

  it('caps placements per app, keeping the newest ordinals', () => {
    const registry = new AppRegistry();
    const total = MAX_PLACEMENTS_PER_APP + 12;
    for (let index = 0; index < total; index += 1) {
      registry.place('files', `win-${index}`, { connector: 'eDP-1', slot: 0, rect: rect() }, index);
    }
    const placements = registry.placements('files');
    expect(placements).toHaveLength(MAX_PLACEMENTS_PER_APP);
    expect(placements[0].ordinal).toBe(total - MAX_PLACEMENTS_PER_APP + 1);
    expect(registry.ordinalFor('files', 'win-0')).toBeUndefined();
  });

  it('drops excess persisted placements on load', () => {
    const placements: Record<string, unknown> = {};
    for (let index = 0; index < MAX_PLACEMENTS_PER_APP + 5; index += 1) {
      placements[`win-${index}`] = {
        ordinal: index + 1,
        connector: 'eDP-1',
        slot: 0,
        maximized: false,
        fullscreen: false,
        rect: rect(),
      };
    }
    const restored = AppRegistry.fromJSON({
      version: REGISTRY_VERSION,
      entries: [entry({ placements: placements as never, nextOrdinal: 999 })],
    });
    expect(restored.placements('files')).toHaveLength(MAX_PLACEMENTS_PER_APP);
    expect(restored.ordinalFor('files', 'win-0')).toBeUndefined();
    expect(restored.ordinalFor('files', `win-${MAX_PLACEMENTS_PER_APP + 4}`)).toBeDefined();
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

  it('renumbers every colliding carried ordinal, keeping them unique', () => {
    const registry = new AppRegistry();
    registry.place('real', 'r1', { connector: 'eDP-1', slot: 0, rect: rect() });
    registry.place('real', 'r2', { connector: 'eDP-1', slot: 1, rect: rect() });
    registry.place('prov', 'p1', { connector: 'HDMI-1', slot: 0, rect: rect() });
    registry.place('prov', 'p2', { connector: 'HDMI-1', slot: 1, rect: rect() });

    expect(registry.rekey('prov', 'real')).toBe(true);
    const ordinals = registry.placements('real').map((placement) => placement.ordinal);
    expect(ordinals).toEqual([1, 2, 3, 4]);
    expect(new Set(ordinals).size).toBe(4);
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

  it('refuses a newer registry version and yields an empty registry', () => {
    const restored = AppRegistry.fromJSON({ version: REGISTRY_VERSION + 1, entries: [entry()] });
    expect(restored.size).toBe(0);
  });

  it('keeps the first entry deterministically when duplicate appIds appear', () => {
    const restored = AppRegistry.fromJSON({
      version: REGISTRY_VERSION,
      entries: [entry({ lastTitle: 'first', windowsSeen: 1 }), entry({ lastTitle: 'second', windowsSeen: 9 })],
    });
    expect(restored.size).toBe(1);
    expect(restored.get('files')?.lastTitle).toBe('first');
    expect(restored.get('files')?.windowsSeen).toBe(1);
  });

  it('re-derives the ordinal counter from the highest persisted placement', () => {
    const restored = AppRegistry.fromJSON({
      version: REGISTRY_VERSION,
      entries: [
        entry({
          placements: {
            'win-a': { ordinal: 7, connector: 'eDP-1', slot: 0, maximized: false, fullscreen: false, rect: rect() },
          },
          nextOrdinal: 1, // corrupt: below the highest placement
        }),
      ],
    });
    const placed = restored.place('files', 'win-b', { connector: 'eDP-1', slot: 1, rect: rect() });
    expect(placed.ordinal).toBe(8);
  });

  it('bounds the serialized registry and keeps durable decisions first', () => {
    const registry = new AppRegistry();
    registry.setNeverTile('pinned', true, 1);
    for (let index = 0; index < 400; index += 1) {
      registry.observe({ appId: `app-${index}`, title: 't'.repeat(MAX_TEXT), now: index + 2 });
    }
    const cap = 32 * 1024;
    const text = JSON.stringify(registry.toJSON(cap));
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(cap);
    const rounded = JSON.parse(text) as { entries: AppEntry[] };
    expect(rounded.entries.some((item) => item.appId === 'pinned' && item.neverTile)).toBe(true);
    // Everything was bounded, so the default cap also holds for the full copy.
    expect(new TextEncoder().encode(JSON.stringify(registry.toJSON())).length).toBeLessThanOrEqual(
      MAX_REGISTRY_BYTES,
    );
  });
});
