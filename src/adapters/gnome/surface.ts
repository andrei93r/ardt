// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * `GnomeSurface` — a cached, read-only view of one Mutter window (§2.6).
 * Frame, min/max size and monitor are captured once and refreshed by the
 * signal that changed them (§24 items 2 and 3).
 */

import * as compat from './compat.js';
import { Layer, SurfaceKind, emptyFlags } from '../../core/types.js';
import type { Rect, Size, Surface, SurfaceFlags } from '../../core/types.js';
import { layerFor } from '../../core/classify.js';
import { clipText } from '../../core/text.js';

function toRect(source: any): Rect {
  return { x: source.x, y: source.y, width: source.width, height: source.height };
}

export class GnomeSurface implements Surface {
  readonly id: number;
  readonly win: any;
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

  constructor(win: any, appVersion: string) {
    this.win = win;
    this.id = win.get_id();
    this.appVersion = appVersion;
    this.kind = compat.kindFor(win);
    this.appId = clipText(win.get_wm_class(), 128);
    this.title = clipText(win.get_title());
    const min = win.get_min_size();
    const max = win.get_max_size();
    this.min = { width: min[0], height: min[1] };
    this.max = { width: max[0], height: max[1] };
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
    const min = this.win.get_min_size();
    const max = this.win.get_max_size();
    this.min = { width: min[0], height: min[1] };
    this.max = { width: max[0], height: max[1] };
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
    const min = this.win.get_min_size();
    const max = this.win.get_max_size();
    const changed =
      min[0] !== this.min.width || min[1] !== this.min.height || max[0] !== this.max.width || max[1] !== this.max.height;
    this.min = { width: min[0], height: min[1] };
    this.max = { width: max[0], height: max[1] };
    return changed;
  }

  /** §3: stacking is read only for `DumpState`, never on every tick. */
  captureZ(): void {
    const sorted: any[] = global.display.sort_windows_by_stacking(
      global.get_window_actors().map((actor: any) => actor.meta_window),
    );
    this.zPosition = sorted.indexOf(this.win);
  }

  private readFlags(): SurfaceFlags {
    const win = this.win;
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
      onAllWorkspaces: compat.isOnAllWorkspaces(win),
    };
  }
}
