// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import type { Layer, Rect, Screen, Surface } from '../core/types.js';
import type { PlatformEvent } from './events.js';

export type { Layer, Rect, Screen, Size, Surface, SurfaceFlags, SurfaceKind } from '../core/types.js';

/**
 * The compositor-facing surface. `Surface` itself is declared in `core/types.ts`
 * (core must not import from platform) and re-exported here so adapter and
 * event code can `import type { Surface } from './host.js'` as in §2.6.
 */
export type { Surface as PlatformSurface };

export interface PlatformHost {
  readonly platform: 'gnome'; // 'kwin' will be added later
  surfaces(): Surface[];
  screens(): Screen[];
  activeWorkspaceId(): number;

  /**
   * Whether a monitor index still exists in the live compositor monitor list.
   * Index-based Mutter calls (`move_to_monitor`, work-area reads) must be
   * skipped when it does not — an out-of-range index asserts in the compositor
   * (§ shell stability, a monitor removed mid-transition).
   */
  isLiveMonitorIndex(index: number): boolean;

  applyFrame(id: number, rect: Rect): void;
  applyLayer(id: number, layer: Layer, order: number): void;
  applyWorkspace(id: number, workspaceId: number): void;
  unmaximize(id: number): void;
  maximize(id: number): void;

  /**
   * Subscribe to an event type. Returns an unsubscribe function. The event
   * union itself carries `type`, so the key is `PlatformEvent['type']`.
   */
  on(type: PlatformEvent['type'], cb: (payload: unknown) => void): () => void;
}
