// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { MAX_REGISTRY_BYTES } from '../../src/core/appregistry.js';
import {
  quarantineFileName,
  registryBytes,
  registryFileAction,
} from '../../src/core/registry-file.js';

describe('registryFileAction', () => {
  it('never asks startup to parse a file above the cap', () => {
    expect(registryFileAction(null)).toBe('missing');
    expect(registryFileAction(0)).toBe('load');
    expect(registryFileAction(MAX_REGISTRY_BYTES)).toBe('load');
    expect(registryFileAction(MAX_REGISTRY_BYTES + 1)).toBe('quarantine');
  });

  it('quarantines the confirmed 201 MB registry without reading it', () => {
    expect(registryFileAction(201_466_735)).toBe('quarantine');
  });

  it('honours a smaller cap for tests and imports', () => {
    expect(registryFileAction(2_000, 1_000)).toBe('quarantine');
    expect(registryFileAction(1_000, 1_000)).toBe('load');
  });

  it('treats an unreadable size as missing, not as an empty existing file', () => {
    expect(registryFileAction(Number.NaN)).toBe('missing');
    expect(registryFileAction(-1)).toBe('missing');
  });
});

describe('quarantineFileName', () => {
  it('names the backup with its reason and a sortable timestamp', () => {
    expect(quarantineFileName('oversize', new Date(2026, 9, 18, 12, 38, 30))).toBe(
      'registry.oversize-20261018-123830.json.gz',
    );
    expect(quarantineFileName('corrupt', new Date(2026, 0, 2, 3, 4, 5))).toBe(
      'registry.corrupt-20260102-030405.json.gz',
    );
  });
});

describe('registryBytes', () => {
  it('counts UTF-8 bytes, not JS string units', () => {
    expect(registryBytes('é')).toBe(4); // the JSON string quotes plus two bytes
    expect(registryBytes({ title: '日本語' })).toBe(new TextEncoder().encode('{"title":"日本語"}').length);
  });
});
