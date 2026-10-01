// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §35: the pure eligibility rule for the clamp-to-screen pass. The adapter owns
 * the pass and the compositor writes; this decides *which* windows it may touch.
 */

import type { Rect } from './types.js';

export interface ClampCandidate {
  /** The window has been adopted and its first frame has arrived. */
  ready: boolean;
  /** §3/§11: a mapped newcomer whose placement has not been decided yet. */
  routePending: boolean;
  fullscreen: boolean;
  minimized: boolean;
  /** §12: an app that has demonstrably refused geometry is not fought. */
  stubborn: boolean;
  /** The window's frame as the compositor currently reports it. */
  frame: Rect;
}

/**
 * Whether the clamp pass may move this window back inside its monitor.
 *
 * A window that is not adopted yet, is still waiting to be routed, or reports a
 * degenerate (not-yet-committed) frame is **not** an off-screen float. Clamping
 * it asks the compositor to place a zero-sized rect at the work-area origin,
 * which a slow Wayland client (Chrome, VS Code) renders as a jump/tear — and
 * the clamp's own retry ladder then races the tile apply that is routing the
 * same window, so the window oscillates between the origin and its tile.
 * Fullscreen and minimized windows own their frame and a stubborn client is
 * never fought.
 */
export function shouldClampWindow(candidate: ClampCandidate): boolean {
  if (!candidate.ready || candidate.routePending) return false;
  if (candidate.fullscreen || candidate.minimized || candidate.stubborn) return false;
  if (candidate.frame.width <= 0 || candidate.frame.height <= 0) return false;
  return true;
}
