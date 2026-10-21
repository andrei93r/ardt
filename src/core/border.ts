// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import type { Rect } from './types.js';
import { rectEquals } from './types.js';

/** Reasons the border is suppressed (§23.1). */
export type SuppressionReason =
  | 'workspace-switch'
  | 'drag'
  | 'fullscreen'
  | 'pause'
  | 'sharing'
  | 'overview'
  | 'occluded'
  | 'popup';

export interface BorderSnapshot {
  visible: boolean;
  rect: Rect | null;
}

/**
 * The single owner of "should the border be visible and where" (§23.1).
 * Every path that shows the border goes through here.
 */
export class BorderState {
  private readonly suppressions = new Set<SuppressionReason>();
  private focusId: number | null = null;
  private focusRect: Rect | null = null;
  private visible = false;
  /**
   * Whether the focused window's rect is its settled placement. A focus change
   * arrives *before* the model has placed the window, so the rect handed to
   * `setFocus` is the window's pre-placement frame; drawing the highlight then
   * paints it at the old position for a frame, which is the "focus is drawn
   * before the window is in position and stabilized" bug. The border stays
   * hidden until `settle()` says the model has placed it.
   */
  private settled = false;
  /**
   * Whether a focus signal's placement is still owed. A focus signal hands over
   * a *guessed* rect, so any model state pass that arrives before the focus
   * layout is unknown to be "the placement" and must not open the gate. Without
   * this the gate would either draw early (A173) or, once a window is already in
   * place with nothing left to move it, never open at all — the enable/disable
   * stress in A161 showed the highlight failing to come back for exactly that
   * reason. A state pass with no placement owed is authoritative and settles.
   */
  private placementPending = false;

  /** Id of the currently focused tracked window, or null. */
  get focusedId(): number | null {
    return this.focusId;
  }

  /** True once the focused window's rect is its model placement, not a guess. */
  get isSettled(): boolean {
    return this.settled;
  }

  get activeSuppressions(): SuppressionReason[] {
    return [...this.suppressions];
  }

  suppress(reason: SuppressionReason): void {
    this.suppressions.add(reason);
    this.recompute();
  }

  unsuppress(reason: SuppressionReason): void {
    this.suppressions.delete(reason);
    this.recompute();
  }

  isSuppressed(reason: SuppressionReason): boolean {
    return this.suppressions.has(reason);
  }

  /**
   * A focus *signal*: the compositor focused `id`, and the rect is the window's
   * frame *at that moment* — a pre-placement guess, because the model has not
   * run its focus-driven layout yet. The gate is closed until that layout (or a
   * real move) settles it.
   */
  setFocus(id: number, rect: Rect): void {
    // A repeat of the same focus is still a fresh signal: the display re-emitted
    // focus and a focus-driven pass follows, so the gate is re-armed. Only a
    // state pass (see `setFocusFromState`) may settle without one.
    this.placementPending = true;
    this.settled = false;
    this.focusId = id;
    this.focusRect = rect;
    this.recompute();
  }

  /**
   * A model *state pass* re-affirms the focused window. Its rect is the model's
   * current geometry, so it is authoritative — **unless** a focus signal's
   * placement is still owed, in which case this pass is unrelated (a route, a
   * self-heal, a drag) and may be carrying an intermediate frame; it is then
   * left for the focus layout to settle. A frame that merely *differs* is not
   * the placement: the compositor can move a window part-way there, and drawing
   * that intermediate rect is the same early draw. Real geometry is observed by
   * the animated-frame and motion-tick paths (`settleIfMoved`), not here.
   */
  setFocusFromState(id: number, rect: Rect): void {
    this.focusId = id;
    this.focusRect = rect;
    if (!this.placementPending) {
      this.settled = true;
    }
    this.recompute();
  }

  /**
   * The model has placed the focused window, so its rect is now trustworthy and
   * the border may be drawn. Called on the model's focus-driven layout pass
   * (`model.layout reason=focus`) and by a state pass that owes no placement.
   */
  settle(): void {
    this.placementPending = false;
    this.settled = true;
    this.recompute();
  }

  /**
   * Settle only if `rect` is no longer the pre-placement frame captured by
   * `setFocus`. An unrelated model pass (a route, a self-heal, a drag) can run
   * between the focus signal and the focus-driven pass; settling on it would
   * draw the highlight at the frame the window is about to leave — the very bug
   * this gate exists to prevent. Once the window has actually moved, its frame
   * is real geometry and drawing it is correct even if the focus layout is still
   * in flight.
   */
  settleIfMoved(rect: Rect): void {
    if (this.focusRect === null || rectEquals(this.focusRect, rect)) return;
    this.focusRect = rect;
    this.placementPending = false;
    this.settled = true;
    this.recompute();
  }

  clearFocus(): void {
    this.focusId = null;
    this.focusRect = null;
    this.settled = false;
    this.placementPending = false;
    this.recompute();
  }

  /** Follow the focused window's frame; no-op without focus (§23). */
  updateRect(rect: Rect): void {
    if (this.focusId === null) return;
    this.focusRect = rect;
    this.recompute();
  }

  clear(): void {
    this.suppressions.clear();
    this.focusId = null;
    this.focusRect = null;
    this.settled = false;
    this.placementPending = false;
    this.recompute();
  }

  snapshot(): BorderSnapshot {
    return this.visible && this.focusRect !== null ? { visible: true, rect: this.focusRect } : { visible: false, rect: null };
  }

  get shouldShow(): boolean {
    return this.visible;
  }

  get rect(): Rect | null {
    return this.visible ? this.focusRect : null;
  }

  private recompute(): void {
    this.visible = this.suppressions.size === 0 && this.focusId !== null && this.focusRect !== null && this.settled;
  }
}
