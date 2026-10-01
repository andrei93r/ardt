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

/** §11.4: ease-out quad for short moves, ease-out cubic otherwise. */
export function easingFor(_durationMs: number): (t: number) => number {
  // Always ease out cubic: a quadratic start is too abrupt and reads as janky
  // at the short durations a reflow uses.
  return easeOutCubic;
}

export interface AnimatorHooks {
  isAlive(id: number): boolean;
  apply(id: number, rect: Rect): void;
  onFrame?(id: number, rect: Rect): void;
}

interface Entry {
  timeline: any;
  rect: Rect;
  from: Rect;
  to: Rect;
  durationMs: number;
  easing: (t: number) => number;
  onComplete: (() => void) | null;
  /** Optional work area: the animated rect is kept inside it. */
  bounds: Rect | null;
}

/**
 * One animation event, kept only while recording is armed. A transition must
 * carry exactly one `start` per window with no `frame`/`start` after its `end`
 * (a second `start` from a re-apply is the visible "overshoot then correct").
 * Exposed add-only through `DumpState.animRecords` and driven by the
 * `StartFrameRecording`/`StopFrameRecording` test triggers.
 */
export interface AnimRecord {
  kind: 'start' | 'frame' | 'end' | 'cancel';
  id: number;
  at: number;
  rect: Rect;
  to?: Rect;
  from?: Rect;
}

/** A bounded sample window so an armed recording can never grow without limit. */
const MAX_RECORDS = 4096;

export class FrameClockAnimator {
  private readonly entries = new Map<number, Entry>();
  private records: AnimRecord[] = [];
  private recording = false;

  constructor(private readonly hooks: AnimatorHooks) {}

  /** Arm the bounded recorder: clears it and starts collecting. */
  startRecording(): void {
    this.records = [];
    this.recording = true;
  }

  stopRecording(): void {
    this.recording = false;
  }

  /** The last sampled animation events (empty when never armed). */
  recordsSnapshot(): AnimRecord[] {
    return this.records;
  }

  private record(entry: AnimRecord): void {
    if (!this.recording || this.records.length >= MAX_RECORDS) return;
    this.records.push(entry);
  }

  get activeCount(): number {
    return this.entries.size;
  }

  /** Whether a specific window is mid-animation. */
  isAnimating(id: number): boolean {
    return this.entries.has(id);
  }

  animate(actor: any, id: number, from: Rect, to: Rect, durationMs: number, onComplete: (() => void) | null = null, bounds: Rect | null = null): void {
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
      bounds,
    };
    this.entries.set(id, entry);
    this.record({ kind: 'start', id, at: Date.now(), rect: { ...from }, to: { ...to }, from: { ...from } });
    timeline.connect('new-frame', (_tl: any, msec: number) => this.onFrame(id, entry, msec));
    timeline.connect('completed', () => this.onCompleted(id, entry));
    timeline.start();
  }

  cancel(id: number): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    entry.timeline.stop();
    this.entries.delete(id);
    this.record({ kind: 'cancel', id, at: Date.now(), rect: { ...entry.rect }, to: { ...entry.to }, from: { ...entry.from } });
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
    const b = entry.bounds;
    if (b !== null) {
      entry.rect.width = Math.min(entry.rect.width, b.width);
      entry.rect.height = Math.min(entry.rect.height, b.height);
      entry.rect.x = Math.max(b.x, Math.min(entry.rect.x, b.x + b.width - entry.rect.width));
      entry.rect.y = Math.max(b.y, Math.min(entry.rect.y, b.y + b.height - entry.rect.height));
    }
    this.hooks.apply(id, entry.rect);
    this.record({ kind: 'frame', id, at: Date.now(), rect: { ...entry.rect }, to: { ...entry.to }, from: { ...entry.from } });
    if (this.hooks.onFrame !== undefined) this.hooks.onFrame(id, entry.rect);
  }

  private onCompleted(id: number, entry: Entry): void {
    // A window may have closed mid-animation (§26).
    if (!this.hooks.isAlive(id)) {
      this.entries.delete(id);
      return;
    }
    this.entries.delete(id);
    this.hooks.apply(id, entry.to);
    this.record({ kind: 'end', id, at: Date.now(), rect: { ...entry.to } });
    if (entry.onComplete !== null) entry.onComplete();
  }
}
