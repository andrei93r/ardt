// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

export type { GestureEvent, GestureKind, GesturePhase } from '../core/gestures.js';

export interface GestureRecognizer {
  enable(): void;
  disable(): void;
  onGesture(cb: (event: import('../core/gestures.js').GestureEvent) => void): () => void;
}
