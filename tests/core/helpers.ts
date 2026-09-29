// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import type { Rect, Screen, Size, Surface, SurfaceFlags } from '../../src/core/types.js';
import { Layer, SurfaceKind, emptyFlags } from '../../src/core/types.js';
import type { TilerWindow } from '../../src/core/tiler.js';

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export function size(width: number, height: number): Size {
  return { width, height };
}

export function screen(overrides: Partial<Screen> = {}): Screen {
  return {
    index: 0,
    connector: 'eDP-1',
    geometry: rect(0, 0, 1920, 1080),
    scale: 1,
    refreshRate: 60,
    isPrimary: true,
    ...overrides,
  };
}

export function surface(overrides: Partial<Omit<Surface, 'flags'>> & { flags?: Partial<SurfaceFlags> } = {}): Surface {
  const { flags, ...rest } = overrides;
  return {
    id: 1,
    kind: SurfaceKind.NORMAL,
    appId: 'app',
    appVersion: '*',
    title: 'window',
    min: size(100, 100),
    max: size(10000, 10000),
    frame: rect(0, 0, 800, 600),
    screenId: 0,
    workspaceId: 0,
    parentId: null,
    layer: Layer.TILED,
    zPosition: 0,
    ...rest,
    flags: { ...emptyFlags(), ...flags },
  };
}

export function window(overrides: Partial<TilerWindow> = {}): TilerWindow {
  return {
    id: 1,
    appId: 'app',
    title: 'window',
    kind: SurfaceKind.NORMAL,
    rect: rect(0, 0, 800, 600),
    min: size(100, 100),
    max: size(10000, 10000),
    screenId: 0,
    workspaceId: 0,
    ...overrides,
  };
}
