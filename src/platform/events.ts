// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import type { Rect } from '../core/types.js';
import type { Surface, SurfaceFlags } from './host.js';

export type SessionMode = 'user' | 'unlock-dialog' | 'screen-sharing';

export type PlatformEvent =
  | { type: 'surface-created'; surface: Surface }
  | { type: 'surface-closed'; id: number }
  | { type: 'surface-frame-changed'; id: number; frame: Rect; byUser: boolean }
  | { type: 'surface-flags-changed'; id: number; flags: Partial<SurfaceFlags> }
  | { type: 'surface-workspace-changed'; id: number; workspaceId: number; byUser: boolean }
  | { type: 'surface-screen-changed'; id: number; screenId: number }
  | { type: 'focus-changed'; id: number | null }
  | { type: 'workspace-switched'; from: number; to: number; phase: 'begin' | 'active' | 'end' }
  | { type: 'screens-changed' }
  | { type: 'session-mode-changed'; mode: SessionMode };

export type PlatformEventType = PlatformEvent['type'];
