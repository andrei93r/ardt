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
  /**
   * §11: the tiler is mid-transition for this window — an animation is live or
   * an apply has just landed. The frame read now is an intermediate step toward
   * a target the tiler already chose, not an off-screen float.
   */
  settling: boolean;
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
 *
 * A window the tiler is currently moving (`settling`) is likewise not an
 * off-screen float: its frame is an intermediate step toward a target the tiler
 * already chose. Clamping it writes a rect derived from that intermediate frame
 * and races the animation — the window jumps, and the clamp's own apply resets
 * the "recently moved" clock so the next drain clamps again. Chrome and VS Code
 * skip adrt's animation entirely, so the tiler's apply is their whole
 * transition and this race is what read as the live jump/tear.
 */
export function shouldClampWindow(candidate: ClampCandidate): boolean {
  if (!candidate.ready || candidate.routePending || candidate.settling) return false;
  if (candidate.fullscreen || candidate.minimized || candidate.stubborn) return false;
  if (candidate.frame.width <= 0 || candidate.frame.height <= 0) return false;
  return true;
}
