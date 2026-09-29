// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Animation timing (§11.3). One `Clutter.Timeline` per moving window, tied to
 * the actor's frame clock, writing into a preallocated rect (§24 item 6).
 */

import Clutter from 'gi://Clutter';

import type { Rect } from '../../core/types.js';

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** §11.4: ease-out quad for short moves, ease-out cubic otherwise. */
export function easingFor(durationMs: number): (t: number) => number {
  return durationMs < 150 ? easeOutQuad : easeOutCubic;
}

export interface AnimatorHooks {
  isAlive(id: number): boolean;
  apply(id: number, rect: Rect): void;
  onFrame?(id: number, deltaMs: number): void;
}

interface Entry {
  timeline: any;
  rect: Rect;
  from: Rect;
  to: Rect;
  durationMs: number;
  easing: (t: number) => number;
  onComplete: (() => void) | null;
}

export class FrameClockAnimator {
  private readonly entries = new Map<number, Entry>();

  constructor(private readonly hooks: AnimatorHooks) {}

  get activeCount(): number {
    return this.entries.size;
  }

  animate(actor: any, id: number, from: Rect, to: Rect, durationMs: number, onComplete: (() => void) | null = null): void {
    if (actor === null || durationMs <= 0) {
      this.hooks.apply(id, to);
      if (onComplete !== null) onComplete();
      return;
    }
    this.cancel(id);
    const safeDuration = Math.max(1, Math.round(durationMs));
    const timeline = new Clutter.Timeline({ duration: safeDuration, actor });
    const entry: Entry = {
      timeline,
      rect: { ...to },
      from: { ...from },
      to: { ...to },
      durationMs: safeDuration,
      easing: easingFor(safeDuration),
      onComplete,
    };
    this.entries.set(id, entry);
    timeline.connect('new-frame', (_tl: any, msec: number) => this.onFrame(id, entry, msec));
    timeline.connect('completed', () => this.onCompleted(id, entry));
    timeline.start();
  }

  cancel(id: number): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    entry.timeline.stop();
    this.entries.delete(id);
  }

  cancelAll(): void {
    for (const entry of this.entries.values()) entry.timeline.stop();
    this.entries.clear();
  }

  destroy(): void {
    this.cancelAll();
  }

  private onFrame(id: number, entry: Entry, msec: number): void {
    if (!this.hooks.isAlive(id)) {
      this.cancel(id);
      return;
    }
    const t = Math.min(1, Math.max(0, msec / entry.durationMs));
    const e = entry.easing(t);
    entry.rect.x = entry.from.x + (entry.to.x - entry.from.x) * e;
    entry.rect.y = entry.from.y + (entry.to.y - entry.from.y) * e;
    entry.rect.width = entry.from.width + (entry.to.width - entry.from.width) * e;
    entry.rect.height = entry.from.height + (entry.to.height - entry.from.height) * e;
    this.hooks.apply(id, entry.rect);
    if (this.hooks.onFrame !== undefined) this.hooks.onFrame(id, entry.durationMs / 60);
  }

  private onCompleted(id: number, entry: Entry): void {
    // A window may have closed mid-animation (§26).
    if (!this.hooks.isAlive(id)) {
      this.entries.delete(id);
      return;
    }
    this.entries.delete(id);
    this.hooks.apply(id, entry.to);
    if (entry.onComplete !== null) entry.onComplete();
  }
}
