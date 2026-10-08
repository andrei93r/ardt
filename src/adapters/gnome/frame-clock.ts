// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Animation timing (§11.3). One `Clutter.Timeline` per moving window, tied to
 * the actor's frame clock, writing into a preallocated rect (§24 item 6).
 */

import Clutter from 'gi://Clutter';
import type { ClutterActor, ClutterTimeline } from 'gi://Clutter';

import type { Rect } from '../../core/types.js';

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** §11.4: ease-out quad for short moves, ease-out cubic otherwise. */
function easingFor(_durationMs: number): (t: number) => number {
  // Always ease out cubic: a quadratic start is too abrupt and reads as janky
  // at the short durations a reflow uses.
  return easeOutCubic;
}

export interface AnimatorHooks {
  isAlive(id: number): boolean;
  apply(id: number, rect: Rect): void;
  onFrame?(id: number, rect: Rect): void;
}

/**
 * One tween of an actor's rect, standalone. Interpolates `from` → `to` on the
 * actor's frame clock with the duration's easing, clamping inside `bounds`,
 * and reports through `hooks`. A null actor or a non-positive duration applies
 * the target immediately. The returned `rect` is the live interpolated object
 * (mutated in place, never reallocated); `stop()` halts the timeline.
 */
interface Tween {
  stop(): void;
  /** True when the target was applied immediately (no timeline runs). */
  immediate: boolean;
  /** The live interpolated rect. */
  rect: Rect;
}

interface TweenHooks {
  apply(rect: Rect): void;
  frame?(rect: Rect): void;
  complete(): void;
}

function tweenRect(
  actor: ClutterActor | null,
  from: Rect,
  to: Rect,
  durationMs: number,
  hooks: TweenHooks,
  bounds: Rect | null = null,
): Tween {
  const rect = { ...to };
  if (actor === null || durationMs <= 0) {
    hooks.apply({ ...to });
    hooks.complete();
    return { stop: () => undefined, immediate: true, rect };
  }
  const safeDuration = Math.max(1, Math.round(durationMs));
  const easing = easingFor(safeDuration);
  const timeline: ClutterTimeline = new Clutter.Timeline({ duration: safeDuration, actor });
  timeline.connect('new-frame', (_tl: ClutterTimeline, msec: number) => {
    const t = Math.min(1, Math.max(0, msec / safeDuration));
    const e = easing(t);
    rect.x = from.x + (to.x - from.x) * e;
    rect.y = from.y + (to.y - from.y) * e;
    rect.width = from.width + (to.width - from.width) * e;
    rect.height = from.height + (to.height - from.height) * e;
    if (bounds !== null) {
      rect.width = Math.min(rect.width, bounds.width);
      rect.height = Math.min(rect.height, bounds.height);
      rect.x = Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width - rect.width));
      rect.y = Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height - rect.height));
    }
    hooks.apply(rect);
    hooks.frame?.(rect);
  });
  timeline.connect('completed', () => {
    hooks.apply({ ...to });
    hooks.complete();
  });
  timeline.start();
  return { stop: () => timeline.stop(), immediate: false, rect };
}

/**
 * One animation event, kept only while recording is armed. A transition must
 * carry exactly one `start` per window with no `frame`/`start` after its `end`
 * (a second `start` from a re-apply is the visible "overshoot then correct").
 * Exposed add-only through `DumpState.animRecords` and driven by the
 * `StartFrameRecording`/`StopFrameRecording` test triggers.
 */
interface AnimRecord {
  kind: 'start' | 'frame' | 'end' | 'cancel';
  id: number;
  at: number;
  rect: Rect;
  to?: Rect;
  from?: Rect;
}

/** A bounded sample window so an armed recording can never grow without limit. */
const MAX_RECORDS = 4096;

/** The animation surface the tiler drives: live-transition bookkeeping plus the
 * bounded test recorder. Implemented by {@link createAnimationLedger}; the
 * interpolation itself is the standalone {@link tweenRect} helper. */
export interface Animator {
  readonly activeCount: number;
  /** Whether a specific window is mid-animation. */
  isAnimating(id: number): boolean;
  animate(actor: ClutterActor | null, id: number, from: Rect, to: Rect, durationMs: number, onComplete?: (() => void) | null, bounds?: Rect | null): void;
  cancel(id: number): void;
  cancelAll(): void;
  /** Arm the bounded recorder: clears it and starts collecting. */
  startRecording(): void;
  stopRecording(): void;
  /** The last sampled animation events (empty when never armed). */
  recordsSnapshot(): AnimRecord[];
  destroy(): void;
}

/**
 * The live-transition ledger: which windows are mid-animation, plus the bounded
 * `animRecords` test recorder. State lives in this closure — no class — while
 * every frame is interpolated by {@link tweenRect}.
 */
export function createAnimationLedger(hooks: AnimatorHooks): Animator {
  const entries = new Map<number, LedgerEntry>();
  let records: AnimRecord[] = [];
  let recording = false;

  // §2.1: each recorder helper checks `recording` *before* it spreads a rect
  // or builds an `AnimRecord`, so a disabled recorder allocates nothing at all —
  // these run on every animated frame.
  function recordStart(id: number, from: Rect, to: Rect): void {
    if (!recording || records.length >= MAX_RECORDS) return;
    records.push({ kind: 'start', id, at: Date.now(), rect: { ...from }, to: { ...to }, from: { ...from } });
  }

  function recordFrame(id: number, rect: Rect, from: Rect, to: Rect): void {
    if (!recording || records.length >= MAX_RECORDS) return;
    records.push({ kind: 'frame', id, at: Date.now(), rect: { ...rect }, to: { ...to }, from: { ...from } });
  }

  function recordEnd(id: number, to: Rect): void {
    if (!recording || records.length >= MAX_RECORDS) return;
    records.push({ kind: 'end', id, at: Date.now(), rect: { ...to } });
  }

  function recordCancel(id: number, rect: Rect, from: Rect, to: Rect): void {
    if (!recording || records.length >= MAX_RECORDS) return;
    records.push({ kind: 'cancel', id, at: Date.now(), rect: { ...rect }, to: { ...to }, from: { ...from } });
  }

  /** Stop any in-flight tween for `id` without running its `onComplete`: a
   * cancellation means its target no longer applies, so the verify ladder it
   * would have scheduled must not fire (1.6). */
  function cancel(id: number): void {
    const entry = entries.get(id);
    if (entry === undefined) return;
    entry.stop();
    entries.delete(id);
    recordCancel(id, entry.rect, entry.from, entry.to);
  }

  function animate(actor: ClutterActor | null, id: number, from: Rect, to: Rect, durationMs: number, onComplete: (() => void) | null = null, bounds: Rect | null = null): void {
    // 1.6: a new target always supersedes an in-flight tween for this id, so
    // cancel it first — including on the immediate path below. Otherwise a
    // still-running tween would later re-apply its stale target over the one
    // applied here, and its `onComplete` would verify the wrong target. The
    // caller that supersedes supplies its own completion.
    cancel(id);
    if (actor === null || durationMs <= 0) {
      hooks.apply(id, to);
      if (onComplete !== null) onComplete();
      return;
    }
    let dead = false;
    const tween = tweenRect(actor, from, to, durationMs, {
      apply: (rect) => {
        if (!hooks.isAlive(id)) {
          dead = true;
          cancel(id);
          return;
        }
        hooks.apply(id, rect);
      },
      frame: (rect) => {
        if (dead) return;
        recordFrame(id, rect, from, to);
        hooks.onFrame?.(id, rect);
      },
      complete: () => {
        // A window may have closed mid-animation (§26).
        if (!hooks.isAlive(id)) {
          entries.delete(id);
          return;
        }
        entries.delete(id);
        hooks.apply(id, to);
        recordEnd(id, to);
        onComplete?.();
      },
    }, bounds);
    if (tween.immediate) return;
    entries.set(id, { stop: () => tween.stop(), rect: tween.rect, from: { ...from }, to: { ...to } });
    recordStart(id, from, to);
  }

  return {
    get activeCount(): number {
      return entries.size;
    },
    isAnimating: (id: number): boolean => entries.has(id),
    animate,
    cancel,
    cancelAll: (): void => {
      for (const entry of entries.values()) entry.stop();
      entries.clear();
    },
    startRecording: (): void => {
      records = [];
      recording = true;
    },
    stopRecording: (): void => {
      recording = false;
    },
    recordsSnapshot: (): AnimRecord[] => records,
    destroy: (): void => {
      for (const entry of entries.values()) entry.stop();
      entries.clear();
    },
  };
}

interface LedgerEntry {
  stop: () => void;
  rect: Rect;
  from: Rect;
  to: Rect;
}
