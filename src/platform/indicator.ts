// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import type { Rect } from '../core/types.js';

export interface IndicatorBackend {
  show(rect: Rect): void;
  hide(): void;
  showPreview(rect: Rect): void;
  hidePreview(): void;
  ghostClose(rect: Rect, durationMs: number): void;
  destroy(): void;
}
