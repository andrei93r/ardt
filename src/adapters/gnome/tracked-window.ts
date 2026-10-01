// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Per-window state owner (§34: one `TrackedWindow` per window, never a
 * 20-field struct). Classification is cached here and invalidated only by the
 * signals listed in §5.
 *
 * The window's minimum and maximum dimensions are queried from Mutter once,
 * cached here, and reused for every tile calculation (§24 item 2). Mutter is
 * only asked again when a signal that can change size hints fires.
 */

import type { Classification, ClassifyConfig, HeuristicContext } from '../../core/classify.js';
import { classify } from '../../core/classify.js';
import type { Profile } from '../../core/profiles.js';
import { profileFor } from '../../core/profiles.js';
import type { Rect, Size } from '../../core/types.js';
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
  /** True when Adrt floated this window itself (a no-room placement) rather
   * than the user asking for it. */
  autoFloated = false;
  /** Set once the first frame has been processed; signals before that are not user actions. */
  ready = false;
  /** Set when the user moves this window; policies leave it alone for a while. */
  userMovedAtMs = 0;
  /**
   * Set while the tiler unmaximizes this window itself, to apply a tile frame.
   * That unmaximize is not a user action and must not drive the unmaximize
   * policy (`onMaximizeSignal`), or a stale retry would drag a window we just
   * maximized to its own workspace back to the pair (A45).
   */
  selfUnmaximize = false;
  /**
   * Set when the window is maximized while it shares its workspace (a user
   * maximize, §4), cleared when it settles alone on its own workspace or is
   * unmaximized. The drain treats this as a property: while it is set, the
   * window belongs on its own workspace to the right.
   */
  maximizeRequested = false;
  lastWorkspaceIdx = 0;
  /** The fullscreen state adrt has already routed for the current transition. */
  fullscreenApplied = false;
  /** A user unmaximize reported by Mutter, applied from the drain (§4). */
  unmaximizeRequested = false;
  /** A user workspace move reported by Mutter; the drain arrives it (§6/§17). */
  userMovedTo: number | null = null;
  /**
   * §16: a window that did not fit its slot owns a workspace at its own clamped
   * size. While set it is left out of the tiling — the lone law must not
   * maximize it.
   */
  escaped = false;
  /** §3/§4: the slot the window's own change chose, honoured by the tiler. */
  pendingSlot: 0 | 1 | null = null;

  /** Cached min/max dimensions; never re-queried on the tile hot path. */
  minSize: Size;
  maxSize: Size;
  private hintsKnown: boolean;

  private cached: Classification | null = null;

  constructor(win: any, surface: GnomeSurface) {
    this.win = win;
    this.surface = surface;
    this.id = surface.id;
    this.profile = profileFor(surface.appId);
    this.minSize = { ...surface.min };
    this.maxSize = { ...surface.max };
    this.hintsKnown = surface.max.width > 0 && surface.max.height > 0;
  }

  get sizeHintsKnown(): boolean {
    return this.hintsKnown;
  }

  /**
   * Whether a classification is already cached. Diagnostics only: it lets the
   * session report how often `classify()` actually had to run (a cache miss)
   * instead of quietly rebuilding the config for a cached answer.
   */
  get hasClassification(): boolean {
    return this.cached !== null;
  }

  /**
   * Cheap frame update for the hot frame path (§24 items 2 and 3). A window
   * that changed monitor is re-read in full: `on-all-workspaces` (and the rest
   * of the flags) depend on which monitor the window is on, so a cross-monitor
   * move would otherwise leave a stale classification behind — the reason a
   * window could stay untileable on a secondary monitor (or keep being skipped
   * after moving to the primary one).
   */
  refreshFrame(): void {
    const previousMonitor = this.surface.screenId;
    this.surface.refreshFrame();
    if (this.surface.screenId !== previousMonitor) {
      this.surface.refresh();
      this.cacheSizeHints();
      this.invalidateClassification();
    }
  }

  /** §24 item 1: classify at most once per relevant signal. */
  classify(config: ClassifyConfig, context: HeuristicContext): Classification {
    if (this.cached === null) this.cached = classify(this.surface, config, context);
    return this.cached;
  }

  invalidateClassification(): void {
    this.cached = null;
  }

  /** Copy hints that `surface.refresh()` has already read. No Mutter query. */
  cacheSizeHints(): void {
    this.minSize = { ...this.surface.min };
    this.maxSize = { ...this.surface.max };
    if (this.maxSize.width > 0 && this.maxSize.height > 0) this.hintsKnown = true;
  }

  /** Query Mutter for min/max once; returns true when they changed. */
  refreshSizeHints(): boolean {
    const changed = this.surface.refreshSizeHints();
    if (changed) this.cacheSizeHints();
    if (this.surface.max.width > 0 && this.surface.max.height > 0) this.hintsKnown = true;
    return changed;
  }

  refresh(): void {
    this.surface.refresh();
    this.cacheSizeHints();
    this.invalidateClassification();
  }
}
