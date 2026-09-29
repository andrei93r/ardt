// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import type { Rect } from './types.js';

/** Reasons the border is suppressed (§23.1). */
export type SuppressionReason = 'workspace-switch' | 'drag' | 'fullscreen' | 'pause';

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

  /** Id of the currently focused tracked window, or null. */
  get focusedId(): number | null {
    return this.focusId;
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

  setFocus(id: number, rect: Rect): void {
    this.focusId = id;
    this.focusRect = rect;
    this.recompute();
  }

  clearFocus(): void {
    this.focusId = null;
    this.focusRect = null;
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
    this.visible = this.suppressions.size === 0 && this.focusId !== null && this.focusRect !== null;
  }
}
