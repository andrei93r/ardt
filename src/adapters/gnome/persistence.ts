// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §9/§12: persisted state and one-shot migrations.
 *
 * Owns `state.json` (split ratios + swap pairs), `display-memory.json` (the
 * connector-keyed display memory), the settings-format version gate, the legacy
 * rule-float fold-in and the first-run notice. The live objects (`Tiling`,
 * `WindowSession`, settings, stores) stay in the extension and are reached
 * through `PersistenceDeps`, so no policy lives here.
 */

import { notify } from 'resource:///org/gnome/shell/ui/main.js';

import type { MemoryEntry } from '../../core/displays.js';
import { migrateRulesJson } from '../../core/rules.js';
import { dataDir, readJson, readText, writeAtomic } from './adapt.js';
import type { EventJournal } from './journal.js';
import type { History } from './history.js';
import type { GnomeSettings } from './settings.js';
import type { Tiling } from './tiling.js';
import type { WindowSession } from './session.js';

/**
 * The slice of extension state persistence needs. `tiling`/`session` are lazy
 * because the persistence owner is constructed before the tiling engine and the
 * session exist (the enable order), and both can be absent on a half-built
 * teardown.
 */
export interface PersistenceDeps {
  readonly settings: GnomeSettings;
  readonly history: History;
  readonly journal: EventJournal;
  tiling(): Tiling | undefined;
  session(): WindowSession | undefined;
}

export class Persistence {
  constructor(private readonly deps: PersistenceDeps) {}

  private stateFile(): string {
    return `${dataDir()}/state.json`;
  }

  restoreState(): void {
    const tiling = this.deps.tiling();
    if (tiling === undefined) return;
    const text = readText(this.stateFile());
    if (text === null) return;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      console.error(`[adrt] state.json is corrupt: ${(e as Error).message}`);
      return;
    }
    if (typeof raw !== 'object' || raw === null) return;
    const state = raw as Record<string, unknown>;
    if (state.ratios !== undefined) {
      tiling.loadRatios(
        state.ratios as Record<string, number>,
        (state.swapPairs as string[] | undefined) ?? [],
      );
    }
  }

  saveState(): void {
    const tiling = this.deps.tiling();
    if (tiling === undefined) return;
    const payload = {
      version: 1,
      ratios: tiling.getRatios(),
      swapPairs: tiling.getSwapPairs(),
    };
    writeAtomic(this.stateFile(), JSON.stringify(payload));
  }

  /** §9: display memory keyed by connector, persisted beside the state. */
  private displayMemoryFile(): string {
    return `${dataDir()}/display-memory.json`;
  }

  restoreDisplayMemory(): void {
    const session = this.deps.session();
    if (session === undefined) return;
    const raw = readJson(this.displayMemoryFile());
    if (raw === null || typeof raw !== 'object') return;
    const entries = (raw as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return;
    session.setDisplayMemory(entries as MemoryEntry[]);
  }

  saveDisplayMemory(): void {
    const session = this.deps.session();
    if (session === undefined) return;
    writeAtomic(
      this.displayMemoryFile(),
      JSON.stringify({ version: 1, at: Date.now(), entries: session.getDisplayMemory() }),
    );
  }

  migrate(extensionVersion: number): void {
    const current = this.deps.settings.int('settings-version', 0);
    if (current >= extensionVersion) return;
    this.deps.settings.write('settings-version', extensionVersion);
    this.deps.history.log('config_imported', { migratedFrom: current, to: extensionVersion });
  }

  /**
   * §23 decisions 91-93: fold legacy rule floats into the Never-tile list and
   * carry a legacy global `rules-enabled:false` over as per-rule
   * `enabled:false`. Idempotent: after the first run `rules-json` holds no
   * legacy flags and `changed` is false.
   */
  migrateRuleFloats(): void {
    const { settings, history, journal } = this.deps;
    const migration = migrateRulesJson(
      settings.string('rules-json', '[]'),
      settings.boolean('rules-enabled', true),
    );
    if (migration.neverTile.length > 0) {
      const merged = [...settings.strv('exception-apps')];
      for (const glob of migration.neverTile) {
        if (!merged.includes(glob)) merged.push(glob);
      }
      settings.write('exception-apps', merged);
      history.log('rules_migrated', { neverTile: migration.neverTile });
    }
    if (migration.changed) settings.write('rules-json', JSON.stringify(migration.rules));
    if (migration.errors.length > 0) {
      journal.record('model', 'rules_invalid', { errors: migration.errors });
    }
  }

  firstRun(): void {
    if (this.deps.settings.boolean('first-run-complete', false)) return;
    this.deps.settings.write('first-run-complete', true);
    notify('Adrt', 'Adrt tiles windows into pairs per monitor. Press Super+Z to undo a retile.');
  }
}
