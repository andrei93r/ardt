// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import type { Layer, Rect, Screen, Surface } from '../core/types.js';
import type { PlatformEventPayload, PlatformEventType } from './events.js';

export type { Surface, SurfaceFlags } from '../core/types.js';

export interface PlatformHost {
  readonly platform: 'gnome'; // 'kwin' will be added later
  surfaces(): Surface[];
  screens(): readonly Screen[];
  activeWorkspaceId(): number;

  /**
   * Whether a monitor index still exists in the live compositor monitor list.
   * Index-based Mutter calls (`move_to_monitor`, work-area reads) must be
   * skipped when it does not — an out-of-range index asserts in the compositor
   * (§ shell stability, a monitor removed mid-transition).
   */
  isLiveMonitorIndex(index: number): boolean;

  applyFrame(id: number, rect: Rect): void;
  applyLayer(id: number, layer: Layer): void;
  applyWorkspace(id: number, workspaceId: number): void;
  unmaximize(id: number): void;
  maximize(id: number): void;

  /**
   * Subscribe to an event type. Returns an unsubscribe function. The event
   * union itself carries `type`, so the key is a `PlatformEventType` and the
   * callback receives exactly that kind's payload (the full event object, so
   * the handler can still read `payload.type` if it needs to).
   */
  on<K extends PlatformEventType>(type: K, cb: (payload: PlatformEventPayload<K>) => void): () => void;
}
