// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import type { ClassifyConfig } from '../../src/core/classify.js';
import { classify, heuristicModal, layerFor } from '../../src/core/classify.js';
import { Layer, SurfaceKind } from '../../src/core/types.js';
import { rect, size, surface } from './helpers.js';

function config(overrides: Partial<ClassifyConfig> = {}): ClassifyConfig {
  return { exceptionApps: [], heuristicModalDetect: false, ...overrides };
}

describe('layerFor', () => {
  it('maps a plain normal window to TILED', () => {
    expect(layerFor(surface())).toBe(Layer.TILED);
  });

  it('treats transient, modal and attached dialogs as MODAL', () => {
    expect(layerFor(surface({ flags: { transient: true } }))).toBe(Layer.MODAL);
    expect(layerFor(surface({ flags: { modal: true } }))).toBe(Layer.MODAL);
    expect(layerFor(surface({ flags: { attachedDialog: true } }))).toBe(Layer.MODAL);
    expect(layerFor(surface({ kind: SurfaceKind.DIALOG }))).toBe(Layer.MODAL);
    expect(layerFor(surface({ kind: SurfaceKind.MODAL }))).toBe(Layer.MODAL);
  });

  it('treats above and floating as FLOATING', () => {
    expect(layerFor(surface({ flags: { above: true } }))).toBe(Layer.FLOATING);
    expect(layerFor(surface({ flags: { floating: true } }))).toBe(Layer.FLOATING);
  });

  it('never tiles a window that carries the above flag (§16, reversing A61)', () => {
    // A picture-in-picture video or a widget asks to float above the tiling; the
    // model treats that as the user's decision, so the window is not tiled and
    // the flag is left as the application set it.
    const verdict = classify(surface({ flags: { above: true } }), config());
    expect(verdict.tileable).toBe(false);
    expect(verdict.reason).toBe('above');
  });

  it('treats skip-taskbar chrome as BACKGROUND', () => {
    expect(layerFor(surface({ kind: SurfaceKind.SKIP }))).toBe(Layer.BACKGROUND);
  });

  it('gives modal precedence over floating', () => {
    expect(layerFor(surface({ flags: { modal: true, above: true } }))).toBe(Layer.MODAL);
  });
});

describe('classify', () => {
  it('accepts a healthy normal window', () => {
    const result = classify(surface(), config());
    expect(result.tileable).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.layer).toBe(Layer.TILED);
  });

  it.each([
    ['skip-taskbar', surface({ flags: { skipTaskbar: true } })],
    ['override-redirect', surface({ flags: { overrideRedirect: true } })],
    ['on-all-workspaces', surface({ flags: { sticky: true } })],
    ['fullscreen', surface({ flags: { fullscreen: true } })],
    ['floating', surface({ flags: { floating: true } })],
    ['non-tileable-kind', surface({ kind: SurfaceKind.DIALOG })],
    ['min-equals-max', surface({ min: size(500, 100), max: size(500, 10000) })],
    ['transient', surface({ flags: { transient: true } })],
    ['modal', surface({ flags: { modal: true } })],
    ['attached-dialog', surface({ flags: { attachedDialog: true } })],
  ])('rejects with reason %s', (reason, input) => {
    const result = classify(input, config());
    expect(result.tileable).toBe(false);
    expect(result.reason).toBe(reason);
  });

  it('tiles a window whose on-all-workspaces flag comes from its monitor', () => {
    // Mutter reports on-all-workspaces for every window on a secondary monitor
    // when workspaces-only-on-primary is set (GNOME's default). That must not
    // disqualify it: only a genuinely pinned window has no workspace of its own.
    const result = classify(surface({ flags: { onAllWorkspaces: true } }), config());
    expect(result.tileable).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.layer).toBe(Layer.TILED);
  });

  it('rejects apps matched by the exception list (glob)', () => {
    const result = classify(surface({ appId: 'org.gnome.Nautilus' }), config({ exceptionApps: ['org.gnome.*'] }));
    expect(result.tileable).toBe(false);
    expect(result.reason).toBe('exception-app');
  });

  it('marks transient, modal and attached windows as modals', () => {
    expect(classify(surface({ flags: { transient: true } }), config()).modal).toBe(true);
    expect(classify(surface({ flags: { modal: true } }), config()).modal).toBe(true);
    expect(classify(surface({ flags: { attachedDialog: true } }), config()).modal).toBe(true);
    expect(classify(surface({ flags: { skipTaskbar: true } }), config()).modal).toBe(false);
  });

  it('does not consult placement rules: rules only force a tile (§23 decision 91)', () => {
    // Rules are a tiler override, never a classifier input: a rule can no longer
    // float a window (that is the Never-tile list).
    const result = classify(surface({ appId: 'pavucontrol' }), config());
    expect(result.tileable).toBe(true);
  });

  it('detects a heuristic modal when the parent title is live', () => {
    const child = surface({ title: 'Save As — Text Editor' });
    const live = ['Text Editor'];
    expect(heuristicModal(child, live)).toBe(true);
    const result = classify(child, config({ heuristicModalDetect: true }), { liveTitles: live });
    expect(result.tileable).toBe(false);
    expect(result.reason).toBe('heuristic-modal');
    expect(result.layer).toBe(Layer.MODAL);
  });

  it('accepts a title with a dash suffix that is not a live window', () => {
    const child = surface({ title: 'Save As — Text Editor' });
    expect(heuristicModal(child, ['Something Else'])).toBe(false);
    expect(classify(child, config({ heuristicModalDetect: true }), { liveTitles: ['Something Else'] }).tileable).toBe(true);
  });

  it('ignores the heuristic when disabled', () => {
    const child = surface({ title: 'Save As — Text Editor' });
    expect(classify(child, config(), { liveTitles: ['Text Editor'] }).tileable).toBe(true);
  });

  it('places an ignored window in the FLOATING layer', () => {
    expect(classify(surface({ appId: 'x', flags: { skipTaskbar: true } }), config()).layer).toBe(Layer.FLOATING);
  });

  it('exposes frame/min sizes but does not need them for a plain reject', () => {
    const input = surface({ min: size(200, 200), frame: rect(10, 10, 100, 100) });
    expect(classify(input, config()).tileable).toBe(true);
  });
});
