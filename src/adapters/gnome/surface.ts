// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * `GnomeSurface` — a cached, read-only view of one Mutter window (§2.6).
 * Frame, min/max size and monitor are captured once and refreshed by the
 * signal that changed them (§24 items 2 and 3).
 */

import type { MetaRectangle, MetaWindow } from 'gi://Meta';

import * as compat from './compat.js';
import { Layer, SurfaceKind, emptyFlags } from '../../core/types.js';
import type { Rect, Size, Surface, SurfaceFlags } from '../../core/types.js';
import { layerFor } from '../../core/classify.js';
import { clipText } from '../../core/text.js';

/** A compositor window actor, read only for the Meta window it wraps. */
interface WindowActor {
  meta_window: MetaWindow;
}

function toRect(source: MetaRectangle): Rect {
  return { x: source.x, y: source.y, width: source.width, height: source.height };
}

/**
 * GNOME 50's `Meta.Window.get_min_size()`/`get_max_size()` return
 * `[hasSize, width, height]` (the leading boolean reports whether the hint is
 * set), where older versions returned `[width, height]`. Read whichever shape
 * arrived, so a client's minimum is honest across the versions.
 */
function toSize(pair: Array<number | boolean> | null | undefined): Size {
  if (pair === null || pair === undefined) return { width: 0, height: 0 };
  const length = pair.length ?? 0;
  const base = length >= 3 ? 1 : 0;
  const width = Number(pair[base] ?? 0);
  const height = Number(pair[base + 1] ?? 0);
  return { width: Number.isFinite(width) ? width : 0, height: Number.isFinite(height) ? height : 0 };
}

export class GnomeSurface implements Surface {
  readonly id: number;
  readonly win: MetaWindow;
  kind: SurfaceKind;
  appId: string;
  appVersion: string;
  title: string;
  min: Size;
  max: Size;
  frame: Rect;
  screenId: number;
  workspaceId: number;
  flags: SurfaceFlags;
  parentId: number | null;
  zPosition = 0;
  /** Session-side float state; Mutter has no "floating" flag (§9.3). */
  private floatingOverride = false;

  constructor(
    win: MetaWindow,
    appVersion: string,
    /** Answers whether `on-all-workspaces` is implied by the window's monitor. */
    private readonly flagContext: () => { workspacesOnlyOnPrimary: boolean; primaryMonitor: number },
  ) {
    this.win = win;
    this.id = win.get_id();
    this.appVersion = appVersion;
    this.kind = compat.kindFor(win);
    this.appId = clipText(win.get_wm_class(), 128);
    this.title = clipText(win.get_title());
    this.min = toSize(win.get_min_size());
    this.max = toSize(win.get_max_size());
    this.frame = toRect(win.get_frame_rect());
    this.screenId = win.get_monitor();
    this.workspaceId = win.get_workspace()?.index() ?? 0;
    this.parentId = win.get_transient_for()?.get_id() ?? null;
    this.flags = this.readFlags();
  }

  get layer(): Layer {
    return layerFor(this);
  }

  /** Re-read mutable properties after a signal that can change them. */
  refresh(): void {
    this.title = clipText(this.win.get_title());
    this.appId = clipText(this.win.get_wm_class(), 128) || this.appId;
    this.kind = compat.kindFor(this.win);
    this.frame = toRect(this.win.get_frame_rect());
    this.screenId = this.win.get_monitor();
    this.workspaceId = this.win.get_workspace()?.index() ?? this.workspaceId;
    this.parentId = this.win.get_transient_for()?.get_id() ?? null;
    this.flags = this.readFlags();
    this.min = toSize(this.win.get_min_size());
    this.max = toSize(this.win.get_max_size());
  }

  /** Cheap update for the hot frame-changed path only. */
  refreshFrame(): void {
    this.frame = toRect(this.win.get_frame_rect());
    this.screenId = this.win.get_monitor();
  }

  /** Toggle the session-side float state and refresh the derived flags. */
  setFloating(value: boolean): void {
    this.floatingOverride = value;
    this.flags = this.readFlags();
  }

  /**
   * Re-query Mutter for the window's min/max dimensions and report whether
   * they changed. This is the only place that reads size hints after the
   * initial capture (§24 item 2).
   */
  refreshSizeHints(): boolean {
    const min = toSize(this.win.get_min_size());
    const max = toSize(this.win.get_max_size());
    const changed =
      min.width !== this.min.width || min.height !== this.min.height ||
      max.width !== this.max.width || max.height !== this.max.height;
    this.min = min;
    this.max = max;
    return changed;
  }

  /** §3: stacking is read only for `DumpState`, never on every tick. */
  captureZ(): void {
    const sorted: MetaWindow[] = global.display.sort_windows_by_stacking(
      global.get_window_actors().map((actor: WindowActor) => actor.meta_window),
    );
    this.zPosition = sorted.indexOf(this.win);
  }

  private readFlags(): SurfaceFlags {
    const win = this.win;
    const onAllWorkspaces = compat.isOnAllWorkspaces(win);
    return {
      ...emptyFlags(),
      transient: win.get_transient_for() !== null,
      modal: win.get_window_type() === 2,
      attachedDialog: compat.isAttachedDialog(win),
      fullscreen: win.is_fullscreen() === true,
      above: win.is_above() === true,
      minimized: win.minimized === true,
      maximized: compat.isMaximized(win),
      floating: this.floatingOverride,
      skipTaskbar: compat.isSkipTaskbar(win),
      overrideRedirect: compat.isOverrideRedirect(win),
      onAllWorkspaces,
      // Mutter reports `on-all-workspaces` for every window on a non-primary
      // monitor while `workspaces-only-on-primary` is set, which is GNOME's
      // default. That is a property of the monitor, not a pinned window, so
      // only the flags that are *not* implied by the monitor count as sticky
      // (§5). Without this, nothing on a second monitor can ever be tiled.
      sticky: onAllWorkspaces && !this.impliedByMonitor(),
    };
  }

  /** Mutter's own rule: on-all-workspaces because this window's monitor is not
   * the primary one while workspaces live only on the primary monitor. */
  private impliedByMonitor(): boolean {
    try {
      const context = this.flagContext();
      return context.workspacesOnlyOnPrimary && this.win.get_monitor() !== context.primaryMonitor;
    } catch {
      return false;
    }
  }
}
