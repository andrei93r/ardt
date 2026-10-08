// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §12: configuration export/import (the `ExportConfig`/`ImportConfig` triggers).
 *
 * Serialises the settings, the adaptation timing records and the registry into
 * one versioned bundle, and folds an incoming bundle back into the live
 * settings/registry in either `replace` or `merge` mode. The live objects stay
 * in the extension and are reached through `ConfigTransferDeps`, so no policy
 * lives here.
 */

import type { AdaptationRecord, Bundle, ImportMode } from '../../core/config.js';
import { BUNDLE_FORMAT, BUNDLE_VERSION, normalizeBundle, serializeBundle } from '../../core/config.js';
import type { History } from './history.js';
import type { RegistryStore } from './registry.js';
import type { WindowSession } from './session.js';
import type { GnomeSettings } from './settings.js';

/** The slice of extension state config transfer needs. */
export interface ConfigTransferDeps {
  readonly settings: GnomeSettings;
  readonly registry: RegistryStore;
  readonly history: History;
  readonly session: WindowSession;
  /** §9: current floating windows keyed by app class. */
  floatingWindows(): Record<string, number[]>;
}

export class ConfigTransfer {
  constructor(private readonly deps: ConfigTransferDeps) {}

  exportConfig(): string {
    const settings: Record<string, unknown> = {};
    for (const key of this.deps.settings.keys()) settings[key] = this.deps.settings.read(key);
    const adaptations: Record<string, AdaptationRecord> = {};
    for (const entry of this.deps.registry.entries()) {
      if (Object.keys(entry.adapt).length === 0) continue;
      adaptations[entry.appId] = {
        appId: entry.appId,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        observations: entry.windowsSeen,
        unmaximizeDelayEma: entry.adapt.unmaximizeDelayMs,
        settleTimeEma: entry.adapt.settleMs,
        skipAnimation: entry.adapt.skipAnimation,
      };
    }
    const bundle: Bundle = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      settings: settings as Bundle['settings'],
      tracked: {
        adaptations,
        behavior: { floats: this.deps.floatingWindows() },
        registry: this.deps.registry.toJSON(),
      },
    };
    return serializeBundle(bundle);
  }

  importConfig(json: string, mode: ImportMode): string {
    const errors: string[] = [];
    let incoming: Bundle | null;
    try {
      incoming = normalizeBundle(JSON.parse(json), errors);
    } catch (e) {
      return JSON.stringify({ ok: false, errors: [(e as Error).message] });
    }
    if (incoming === null) return JSON.stringify({ ok: false, errors });
    const { settings, registry, session, history } = this.deps;
    for (const [key, value] of Object.entries(incoming.settings)) {
      if (settings.keys().includes(key)) settings.write(key, value);
    }
    const applied: string[] = [];
    const incomingRegistry = incoming.tracked.registry;
    if (mode === 'replace' && incomingRegistry !== undefined) {
      registry.adopt({ version: 1, entries: incomingRegistry.entries as never[] });
      applied.push(...registry.entries().map((entry) => entry.appId));
    } else {
      for (const [appId, record] of Object.entries(incoming.tracked.adaptations)) {
        // §12: only the timing fields survive; a legacy geometric field is
        // dropped by setAdapt, never imported.
        registry.setAdapt(appId, {
          unmaximizeDelayMs: record.unmaximizeDelayEma,
          settleMs: record.settleTimeEma,
          skipAnimation: record.skipAnimation,
        });
        applied.push(appId);
      }
      if (mode === 'replace' && incomingRegistry !== undefined) {
        for (const entry of incomingRegistry.entries as Array<{ appId?: unknown }>) {
          if (typeof entry.appId === 'string') registry.observe(entry.appId);
        }
      }
    }
    const importedFloats = incoming.tracked.behavior.floats;
    if (importedFloats !== null && typeof importedFloats === 'object') {
      const appIds = Object.keys(importedFloats as Record<string, unknown>);
      for (const appId of appIds) registry.setNeverTile(appId, true);
    }
    session.refreshIdentities();
    session.invalidateAll();
    history.log('config_imported', { mode, applied: applied.length });
    return JSON.stringify({ ok: true, applied, skipped: [] });
  }
}
