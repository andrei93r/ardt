// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * GSettings bridge (§19.1). Implements `SettingsStore` and exposes typed
 * accessors plus the config builders the core engines consume.
 */

import GLib from 'gi://GLib';

import type { ClassifyConfig } from '../../core/classify.js';
import { parseRulesJson } from '../../core/rules.js';
import type { Rule } from '../../core/rules.js';
import type { TilerConfig } from '../../core/tiler.js';
import type { MinSizePolicy } from '../../core/tiler.js';
import type { SettingValue, SettingsStore } from '../../platform/settings.js';
import { unpackVariant } from './compat.js';

function readVariant(settings: any, key: string): SettingValue | undefined {
  const value = settings.get_value(key);
  if (value === null) return undefined;
  const unpacked = unpackVariant(value);
  if (typeof unpacked === 'number' || typeof unpacked === 'boolean' || typeof unpacked === 'string') return unpacked;
  if (Array.isArray(unpacked)) return unpacked.map((v) => String(v));
  return undefined;
}

function writeVariant(settings: any, key: string, value: unknown): boolean {
  const typeString = settings.get_default_value(key).get_type_string();
  settings.set_value(key, new GLib.Variant(typeString, value));
  return true;
}

export class GnomeSettings implements SettingsStore {
  /**
   * Diagnostics (§24): how often a config object is built and how often the
   * rules JSON is parsed. Both are per-call today and are the target of the
   * first caching pass.
   */
  private configBuildCount = 0;
  /** The memoised classifier config; null means it must be rebuilt. */
  private configCache: ClassifyConfig | null = null;
  private rulesParseCount = 0;

  constructor(private readonly settings: any) {}

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

  rules(): { rules: Rule[]; errors: string[] } {
    this.rulesParseCount += 1;
    return parseRulesJson(this.string('rules-json', '[]'));
  }

  /**
   * The resolved classifier config, memoised until a setting changes. It is read
   * for every window on every pass, so rebuilding it per call was the single
   * hottest allocation in the loop (PERFORMANCE_PLAN stage 1, carried forward).
   */
  classifierConfig(): ClassifyConfig {
    if (this.configCache !== null) return this.configCache;
    this.configBuildCount += 1;
    this.configCache = {
      exceptionApps: this.strv('exception-apps'),
      heuristicModalDetect: this.boolean('heuristic-modal-detect', true),
      rules: this.boolean('rules-enabled', true) ? this.rules().rules : [],
    };
    return this.configCache;
  }

  /** Drop the memoised config: any setting read may have changed. */
  invalidateConfig(): void {
    this.configCache = null;
  }

  tilerConfig(ratios: Readonly<Record<string, number>>, swapPairs: ReadonlySet<string>): TilerConfig {
    this.configBuildCount += 1;
    const policy = this.string('min-size-policy', 'respect');
    const minSizePolicy: MinSizePolicy =
      policy === 'ignore' || policy === 'stack' ? policy : 'respect';
    return {
      gapBase: this.int('gaps-base', 8),
      gapPortrait: this.int('gaps-portrait', -1),
      gapLandscape: this.int('gaps-landscape', -1),
      minSizePolicy,
      primaryApps: this.strv('primary-apps'),
      primaryAppRatio: this.int('primary-app-ratio', 50) / 100,
      ratios,
      swapPairs,
      rules: this.boolean('rules-enabled', true) ? this.rules().rules : [],
      reflowKeepsEdges: this.boolean('reflow-keeps-edges', true),
    };
  }
}
