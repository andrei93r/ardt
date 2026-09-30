// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import type { Rule } from './rules.js';
import { contextFor, firstMatch, globMatch } from './rules.js';
import type { Surface } from './types.js';
import { Layer, NON_TILEABLE_KINDS, SurfaceKind } from './types.js';

/**
 * Why a surface is not tiled. Ordered exactly as the checks in §5.
 */
export type SkipReason =
  | 'skip-taskbar'
  | 'override-redirect'
  | 'on-all-workspaces'
  | 'fullscreen'
  | 'above'
  | 'exception-app'
  | 'floating'
  | 'non-tileable-kind'
  | 'min-equals-max'
  | 'transient'
  | 'modal'
  | 'attached-dialog'
  | 'rule-float'
  | 'heuristic-modal';

/** Reasons that intentionally make a surface a modal relative to tiling. */
const MODAL_REASONS: ReadonlySet<SkipReason> = new Set<SkipReason>([
  'transient',
  'modal',
  'attached-dialog',
  'heuristic-modal',
]);

export interface Classification {
  tileable: boolean;
  layer: Layer;
  /** null when tileable. */
  reason: SkipReason | null;
  /** true when the surface is treated as a modal rather than merely ignored. */
  modal: boolean;
}

export interface ClassifyConfig {
  exceptionApps: readonly string[];
  heuristicModalDetect: boolean;
  rules: readonly Rule[];
}

export interface HeuristicContext {
  /** Titles of other live windows, used by the heuristic modal check (§5). */
  liveTitles: readonly string[];
}

/**
 * Layer derivation from surface flags/kind alone (§3). Deterministic and
 * independent of classification so `Surface.layer` is cheap to compute.
 */
export function layerFor(surface: Surface): Layer {
  const f = surface.flags;
  if (f.modal || f.transient || f.attachedDialog) return Layer.MODAL;
  if (surface.kind === SurfaceKind.MODAL || surface.kind === SurfaceKind.DIALOG) return Layer.MODAL;
  if (f.above || f.floating) return Layer.FLOATING;
  if (surface.kind === SurfaceKind.SKIP) return Layer.BACKGROUND;
  return Layer.TILED;
}

/**
 * Heuristic modal detection: a window whose title is `<title> — <parent>`
 * where `<parent>` is the title of another live window is treated as a modal
 * child that the compositor failed to flag (§5).
 */
export function heuristicModal(surface: Surface, liveTitles: readonly string[]): boolean {
  const marker = ' — ';
  const idx = surface.title.lastIndexOf(marker);
  if (idx <= 0) return false;
  const suffix = surface.title.slice(idx + marker.length).trim();
  if (suffix.length === 0 || suffix === surface.title) return false;
  for (const title of liveTitles) {
    if (title === suffix && title !== surface.title) return true;
  }
  return false;
}

function ignoredLayer(surface: Surface): Layer {
  return surface.kind === SurfaceKind.SKIP ? Layer.BACKGROUND : Layer.FLOATING;
}

/**
 * Pure classification (§5). Returns the first failing check as the reason.
 */
export function classify(
  surface: Surface,
  config: ClassifyConfig,
  context: HeuristicContext = { liveTitles: [] },
): Classification {
  const f = surface.flags;

  const fail = (reason: SkipReason): Classification => {
    const modal = MODAL_REASONS.has(reason);
    return { tileable: false, layer: modal ? Layer.MODAL : ignoredLayer(surface), reason, modal };
  };

  if (f.skipTaskbar) return fail('skip-taskbar');
  if (f.overrideRedirect) return fail('override-redirect');
  // Mutter reports `on_all_workspaces` for every window on a secondary monitor
  // when `workspaces-only-on-primary` is set (GNOME's default), so that flag
  // must not disqualify a window: only a genuinely pinned window has no
  // workspace of its own. `sticky` carries that distinction (§5).
  if (f.sticky) return fail('on-all-workspaces');
  if (f.fullscreen) return fail('fullscreen');
  // Note: `above` ("always on top") deliberately does NOT disqualify a window.
  // Apps leave that flag set by accident, and the user's model is that a normal
  // window is always tiled; the adapter clears the flag when it tiles it.
  for (const exception of config.exceptionApps) {
    if (globMatch(exception, surface.appId)) return fail('exception-app');
  }
  if (f.floating) return fail('floating');
  if (NON_TILEABLE_KINDS.has(surface.kind)) return fail('non-tileable-kind');
  // A window without size hints reports min == max == 0 on both axes; that is
  // not a fixed size, so only a non-zero equal value fails this check (§5).
  if (
    (surface.min.width === surface.max.width && surface.min.width > 0) ||
    (surface.min.height === surface.max.height && surface.min.height > 0)
  ) {
    return fail('min-equals-max');
  }
  if (f.transient) return fail('transient');
  if (f.modal) return fail('modal');
  if (f.attachedDialog) return fail('attached-dialog');

  const rule = firstMatch(config.rules, contextFor(surface));
  if (rule !== null && rule.float === true) return fail('rule-float');

  if (config.heuristicModalDetect && heuristicModal(surface, context.liveTitles)) {
    return fail('heuristic-modal');
  }

  return { tileable: true, layer: Layer.TILED, reason: null, modal: false };
}

export function isTileable(
  surface: Surface,
  config: ClassifyConfig,
  context?: HeuristicContext,
): boolean {
  return classify(surface, config, context).tileable;
}
