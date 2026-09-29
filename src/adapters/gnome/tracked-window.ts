// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Per-window state owner (§34: one `TrackedWindow` per window, never a
 * 20-field struct). Classification is cached here and invalidated only by the
 * signals listed in §5.
 */

import type { Classification, ClassifyConfig, HeuristicContext } from '../../core/classify.js';
import { classify } from '../../core/classify.js';
import type { Profile } from '../../core/profiles.js';
import { profileFor } from '../../core/profiles.js';
import type { Rect } from '../../core/types.js';
import type { GnomeSurface } from './surface.js';

export class TrackedWindow {
  readonly id: number;
  readonly win: any;
  readonly surface: GnomeSurface;
  readonly profile: Profile;
  /** Geometry captured when the window was registered (§7.1). */
  originalRect: Rect | null = null;
  /** Last plan target actually applied, used by verification (§11.2). */
  lastTarget: Rect | null = null;
  refusals = 0;
  stubborn = false;
  cooldownUntilMs = 0;
  previousWorkspaceIdx: number | null = null;
  userMovedAtMs = 0;
  lastWorkspaceIdx = 0;

  private cached: Classification | null = null;

  constructor(win: any, surface: GnomeSurface) {
    this.win = win;
    this.surface = surface;
    this.id = surface.id;
    this.profile = profileFor(surface.appId);
  }

  /** §24 item 1: classify at most once per relevant signal. */
  classify(config: ClassifyConfig, context: HeuristicContext): Classification {
    if (this.cached === null) this.cached = classify(this.surface, config, context);
    return this.cached;
  }

  invalidateClassification(): void {
    this.cached = null;
  }

  refresh(): void {
    this.surface.refresh();
    this.invalidateClassification();
  }
}
