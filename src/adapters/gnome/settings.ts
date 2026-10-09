// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * GSettings bridge (§19.1). Implements `SettingsStore` and exposes typed
 * accessors plus the config builders the core engines consume.
 */

import GLib from 'gi://GLib';
import type { Settings as GioSettings, Variant } from 'gi://Gio';

import type { ClassifyConfig } from '../../core/classify.js';
import { parseRulesJson } from '../../core/rules.js';
import type { RulesParse } from '../../core/rules.js';
import type { TilerConfig } from '../../core/tiler.js';
import type { MinSizePolicy } from '../../core/tiler.js';
import type { SettingValue, SettingsStore } from '../../platform/settings.js';
import { unpackVariant } from './compat.js';

/**
 * The settings-derived part of a `TilerConfig`. Ratios and swap pairs are live
 * per-pass inputs owned by the tiling adapter, so they stay out of the memo and
 * are merged in per call: a cache must not outlive the inputs it wraps.
 */
type TilerConfigBase = Omit<TilerConfig, 'ratios' | 'swapPairs'>;

function readVariant(settings: GioSettings, key: string): SettingValue | undefined {
  const value = settings.get_value(key);
  if (value === null) return undefined;
  const unpacked = unpackVariant(value);
  if (typeof unpacked === 'number' || typeof unpacked === 'boolean' || typeof unpacked === 'string') return unpacked;
  if (Array.isArray(unpacked)) return unpacked.map((v) => String(v));
  return undefined;
}

function writeVariant(settings: GioSettings, key: string, value: unknown): boolean {
  const typeString = settings.get_default_value(key).get_type_string();
  settings.set_value(key, new GLib.Variant(typeString, value));
  return true;
}

export class GnomeSettings implements SettingsStore {
  /**
   * Diagnostics (§24): how often a settings-derived config object is built and
   * how often the rules JSON is parsed. Both are memoised per settings
   * generation now, so these advance only when a setting actually changes.
   */
  private configBuildCount = 0;
  /** The memoised classifier config; null means it must be rebuilt. */
  private configCache: ClassifyConfig | null = null;
  /** The memoised settings half of the tiler config; null means rebuild. */
  private tilerBaseCache: TilerConfigBase | null = null;
  /** The memoised parsed rules, shared by the tiler and classifier configs and diagnostics. */
  private rulesCache: RulesParse | null = null;
  private rulesParseCount = 0;

  constructor(private readonly settings: GioSettings) {}

  get configBuilds(): number {
    return this.configBuildCount;
  }

  get rulesParses(): number {
    return this.rulesParseCount;
  }

  keys(): string[] {
    return this.settings.list_keys();
  }

  read(key: string): SettingValue | undefined {
    return readVariant(this.settings, key);
  }

  /** Every key's current value: the recorder's header snapshot, diagnostics. */
  snapshot(): Record<string, SettingValue | undefined> {
    const out: Record<string, SettingValue | undefined> = {};
    for (const key of this.keys()) out[key] = this.read(key);
    return out;
  }

  write(key: string, value: unknown): boolean {
    const ok = writeVariant(this.settings, key, value);
    this.invalidateConfig();
    return ok;
  }

  /**
   * Subscribe to any change at all. Used for the cheap, blanket invalidations
   * (the memoised config) next to the per-key reactive list.
   */
  onAnyChange(cb: () => void): () => void {
    const id = this.settings.connect('changed', () => {
      this.invalidateConfig();
      cb();
    });
    return () => this.settings.disconnect(id);
  }

  onChanged(key: string, cb: (value: SettingValue) => void): () => void {
    const id = this.settings.connect(`changed::${key}`, () => {
      const value = this.read(key);
      if (value !== undefined) cb(value);
    });
    return () => this.settings.disconnect(id);
  }

  int(key: string, fallback: number): number {
    const value = this.read(key);
    return typeof value === 'number' ? value : fallback;
  }

  boolean(key: string, fallback: boolean): boolean {
    const value = this.read(key);
    return typeof value === 'boolean' ? value : fallback;
  }

  string(key: string, fallback: string): string {
    const value = this.read(key);
    return typeof value === 'string' ? value : fallback;
  }

  strv(key: string): string[] {
    const value = this.read(key);
    return Array.isArray(value) ? value : [];
  }

  /**
   * The parsed `rules-json`, memoised until a setting changes. Shared by the
   * tiler config, the classifier config and the diagnostics dump; invalidated
   * by the same blanket `changed` wiring as the config caches (key
   * `rules-json`).
   */
  rules(): RulesParse {
    if (this.rulesCache !== null) return this.rulesCache;
    this.rulesParseCount += 1;
    this.rulesCache = parseRulesJson(this.string('rules-json', '[]'));
    return this.rulesCache;
  }

  /**
   * The resolved classifier config, memoised until a setting changes
   * (`exception-apps`, `rules-json`, `heuristic-modal-detect`). It is read for
   * every window on every pass, so rebuilding it per call was the single hottest
   * allocation in the loop (PERFORMANCE_PLAN stage 1, carried forward).
   */
  classifierConfig(): ClassifyConfig {
    if (this.configCache !== null) return this.configCache;
    this.configBuildCount += 1;
    this.configCache = {
      exceptionApps: this.strv('exception-apps'),
      rules: this.rules().rules,
      heuristicModalDetect: this.boolean('heuristic-modal-detect', true),
    };
    return this.configCache;
  }

  /**
   * Test-only: write a key from its serialized GVariant text, through the
   * extension's own settings instance (the bare schema is not in the Shell's
   * default source, so a fresh `Gio.Settings` cannot see it). Used by the D-Bus
   * SetSetting trigger when the host's inotify budget is spent and an external
   * `gsettings set` cannot reach the running Shell. Mirrors `gsettings set`'s
   * tolerance of a bare word for a string key.
   */
  writeSerialized(key: string, text: string): boolean {
    const type = this.settings.get_default_value(key)?.get_type_string();
    if (typeof type !== 'string') return false;
    let parsed: Variant;
    try {
      parsed = GLib.Variant.parse(new GLib.VariantType(type), text, null, null);
    } catch {
      if (type !== 's') return false;
      parsed = new GLib.Variant('s', text);
    }
    this.settings.set_value(key, parsed);
    this.invalidateConfig();
    return true;
  }

  /**
   * Drop every settings-derived memo. The blanket `changed` wiring in
   * `onAnyChange` (and every `write` / `writeSerialized`) funnels here, so the
   * caches below are rebuilt on the same event the classifier cache already
   * used:
   *   - classifier: `exception-apps`, `heuristic-modal-detect`, and
   *     `rules-json` (via `rules()`);
   *   - tiler base: `min-size-policy`, `gaps-*`, `primary-apps`,
   *     `primary-app-ratio`, `reflow-keeps-edges`, and `rules-json` (via
   *     `rules()`);
   *   - rules: `rules-json`.
   *
   * `rules-json` now feeds both the tiler config and the classifier config: a
   * `float` rule is a classifier input, a placement rule is a tiler input, and
   * both are rebuilt from the same parsed rules.
   */
  invalidateConfig(): void {
    this.configCache = null;
    this.tilerBaseCache = null;
    this.rulesCache = null;
  }

  /**
   * The settings-derived half of the tiler config. Reads `min-size-policy`,
   * `gaps-base`, `gaps-portrait`, `gaps-landscape`, the four outer `gaps-*`,
   * `gaps-between`, `primary-apps`, `primary-app-ratio`, `reflow-keeps-edges`
   * and `rules-json`; all are dropped by `invalidateConfig`.
   */
  private buildTilerBase(): TilerConfigBase {
    this.configBuildCount += 1;
    const policy = this.string('min-size-policy', 'respect');
    const minSizePolicy: MinSizePolicy =
      policy === 'ignore' || policy === 'stack' ? policy : 'respect';
    return {
      gapBase: this.int('gaps-base', 8),
      gapPortrait: this.int('gaps-portrait', -1),
      gapLandscape: this.int('gaps-landscape', -1),
      // §10: outer sides default to 0; negative inherits the base. The schema
      // defaults these keys to -1, so the schema must default them to 0 for the
      // model's flush outer edge.
      gapLeft: this.int('gaps-left', 0),
      gapRight: this.int('gaps-right', 0),
      gapTop: this.int('gaps-top', 0),
      gapBottom: this.int('gaps-bottom', 0),
      // §10: unset or negative inherits the base gap.
      gapBetween: this.int('gaps-between', -1),
      minSizePolicy,
      primaryApps: this.strv('primary-apps'),
      primaryAppRatio: this.int('primary-app-ratio', 50) / 100,
      rules: this.rules().rules,
      reflowKeepsEdges: this.boolean('reflow-keeps-edges', true),
    };
  }

  /**
   * The tiler config for one pass. `ratios` and `swapPairs` are live inputs
   * (per-workspace ratios, the current pair-swap set) and are merged onto the
   * memoised base on every call; only the settings half is cached, so a change
   * to either argument is never masked by a stale memo.
   */
  tilerConfig(ratios: Readonly<Record<string, number>>, swapPairs: ReadonlySet<string>): TilerConfig {
    if (this.tilerBaseCache === null) this.tilerBaseCache = this.buildTilerBase();
    return { ...this.tilerBaseCache, ratios, swapPairs };
  }
}
