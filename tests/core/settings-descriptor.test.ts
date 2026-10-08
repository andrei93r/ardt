// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import type { SettingDescriptor } from '../../src/core/settings-descriptor.js';
import { SETTINGS } from '../../src/core/settings-descriptor.js';
import schemaXml from '../../packages/gnome/schemas/org.gnome.shell.extensions.adrt.gschema.xml?raw';
import prefsSource from '../../src/adapters/gnome/prefs.ts?raw';

/** One `<key>` from the GSettings schema, with its raw default text. */
interface SchemaKey {
  key: string;
  gtype: string;
  defaultText: string;
  choices: string[];
  min?: number;
  max?: number;
}

const ATTR_RE = /([A-Za-z_][A-Za-z0-9_-]*)="([^"]*)"/g;

function attrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of text.matchAll(ATTR_RE)) out[match[1]] = match[2];
  return out;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Parse the schema the same way the generator does, from the raw XML text. */
function parseSchema(xml: string): SchemaKey[] {
  const keys: SchemaKey[] = [];
  for (const match of xml.matchAll(/<key\b([^>]*)>([\s\S]*?)<\/key>/g)) {
    const attribute = attrs(match[1]);
    const body = match[2];
    const defaultMatch = /<default>([\s\S]*?)<\/default>/.exec(body);
    const rangeMatch = /<range\b([^>]*)\/?>/.exec(body);
    const choicesMatch = /<choices>([\s\S]*?)<\/choices>/.exec(body);
    const choices = choicesMatch
      ? [...choicesMatch[1].matchAll(/<choice\b([^>]*)\/?>/g)].map((choice) => decodeEntities(attrs(choice[1]).value ?? ''))
      : [];
    const range = rangeMatch ? attrs(rangeMatch[1]) : {};
    keys.push({
      key: attribute.name ?? '',
      gtype: attribute.type ?? '',
      defaultText: defaultMatch ? defaultMatch[1] : '',
      choices,
      ...(range.min !== undefined && range.max !== undefined
        ? { min: Number(range.min), max: Number(range.max) }
        : {}),
    });
  }
  return keys;
}

/** A GVariant array default (`[]` or `['<Super>z']`) as string values. */
function arrayValues(text: string): string[] {
  const body = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  return [...body.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((item) =>
    item[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'),
  );
}

/** A single GVariant-quoted string default as its unwrapped value. */
function stringValue(text: string): string {
  const trimmed = text.trim();
  const unwrapped = trimmed.startsWith("'") && trimmed.endsWith("'") ? trimmed.slice(1, -1) : trimmed;
  return unwrapped.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

/** The descriptor value the schema's default should produce. */
function expectedDefault(gtype: string, raw: string): boolean | number | string | string[] {
  const text = decodeEntities(raw).trim();
  if (gtype === 'b') return text === 'true';
  if (gtype === 'i' || gtype === 'u') return Number(text);
  if (gtype === 'as') return arrayValues(text);
  return stringValue(text);
}

/** The descriptor type a GSettings type code (and optional choices) maps to. */
function expectedType(gtype: string, choices: readonly string[]): string {
  if (gtype === 's' && choices.length > 0) return 'enum';
  return { b: 'bool', i: 'int', u: 'uint', s: 'string', as: 'strv' }[gtype] ?? gtype;
}

const schema = parseSchema(schemaXml);
const descriptors: readonly SettingDescriptor[] = SETTINGS;
const schemaByKey = new Map(schema.map((entry) => [entry.key, entry]));

describe('settings descriptor', () => {
  it('lists every schema key once, in declaration order', () => {
    const keys = descriptors.map((setting) => setting.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(schema.map((entry) => entry.key));
  });

  it('claims no key the schema does not declare', () => {
    const unknown = descriptors.filter((setting) => !schemaByKey.has(setting.key)).map((setting) => setting.key);
    expect(unknown).toEqual([]);
  });

  it('maps every schema type to the descriptor type', () => {
    for (const setting of descriptors) {
      const schemaKey = schemaByKey.get(setting.key);
      expect(schemaKey, `no schema key for ${setting.key}`).toBeDefined();
      if (!schemaKey) continue;
      expect(setting.type).toBe(expectedType(schemaKey.gtype, schemaKey.choices));
    }
  });

  it('reproduces every schema default', () => {
    for (const setting of descriptors) {
      const schemaKey = schemaByKey.get(setting.key);
      if (!schemaKey) continue;
      expect(expectedDefault(schemaKey.gtype, schemaKey.defaultText), setting.key).toEqual(setting.default);
    }
  });

  it('mirrors schema range bounds and choices when declared', () => {
    for (const setting of descriptors) {
      const schemaKey = schemaByKey.get(setting.key);
      if (!schemaKey) continue;
      expect(setting.min, setting.key).toBe(schemaKey.min);
      expect(setting.max, setting.key).toBe(schemaKey.max);
      expect(setting.choices ? [...setting.choices] : undefined, setting.key).toEqual(
        schemaKey.choices.length > 0 ? schemaKey.choices : undefined,
      );
    }
  });
});

describe('preferences layout', () => {
  // `prefs.ts` imports Gtk/Adw (`gi://`), so Node cannot import it. Parsing the
  // source text still gives the deterministic key check; A140-prefs-options.sh
  // remains the UI-level check (constructed rows, widget types, bounds).
  const prefsKeys = [...prefsSource.matchAll(/key:\s*'([^']+)',\s*kind:\s*'([^']+)'/g)].map((match) => match[1]);

  it('declares user-facing rows', () => {
    expect(prefsKeys.length).toBeGreaterThan(50);
  });

  it('references only keys the descriptor declares', () => {
    const known = new Set(descriptors.map((setting) => setting.key));
    expect(prefsKeys.filter((key) => !known.has(key))).toEqual([]);
  });
});
