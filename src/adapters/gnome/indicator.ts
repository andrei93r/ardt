// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Border rendering (§23). A thin view: `BorderState` decides visibility and
 * position, this file only draws.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import { layoutManager, messageTray } from 'resource:///org/gnome/shell/ui/main.js';

import type { Rect } from '../../core/types.js';
import type { IndicatorBackend } from '../../platform/indicator.js';
import type { GnomeSettings } from './settings.js';
import type { GnomeTiming } from './timing.js';

const CSS_CLASS = 'adrt-indicator';
const PREVIEW_CLASS = 'adrt-indicator-preview';

/** GNOME's accent palette (libadwaita). */
const ACCENT_COLORS: Record<string, string> = {
  blue: '#3584e4',
  teal: '#2190a4',
  green: '#3a944a',
  yellow: '#c88800',
  orange: '#ed5b00',
  red: '#e62d42',
  pink: '#d56199',
  purple: '#9141ac',
  slate: '#6f8396',
};

export class GnomeIndicator implements IndicatorBackend {
  private readonly widget: any;
  private readonly preview: any;
  private readonly ghosts = new Set<any>();
  private readonly closeSources = new Set<number>();
  private pulseActive = false;
  private interfaceSettings: any = null;

  constructor(
    private readonly settings: GnomeSettings,
    private readonly timing: GnomeTiming,
  ) {
    this.widget = new St.Widget({ style_class: CSS_CLASS, reactive: false, visible: false });
    this.preview = new St.Widget({ style_class: PREVIEW_CLASS, reactive: false, visible: false, opacity: 120 });
    this.applyStyle();
    layoutManager.addChrome(this.widget, { affectsStruts: false, trackFullscreen: false });
    layoutManager.addChrome(this.preview, { affectsStruts: false, trackFullscreen: false });
    // addChrome inserts just below `top_window_group`, so chrome added later
    // (us) lands *above* the notification tray and the highlight draws over a
    // banner. Keep the highlight below the tray so notifications are never
    // painted through.
    this.stackBelowTray(this.widget);
    this.stackBelowTray(this.preview);
  }

  show(rect: Rect): void {
    if (!this.settings.boolean('active-window-indicator', true)) {
      this.widget.hide();
      return;
    }
    this.applyStyle();
    this.widget.set_position(rect.x, rect.y);
    this.widget.set_size(rect.width, rect.height);
    this.widget.show();
    if (this.settings.boolean('indicator-animated-pulse', false)) this.startPulse();
    else this.stopPulse();
  }

  hide(): void {
    this.stopPulse();
    this.widget.hide();
  }

  showPreview(rect: Rect): void {
    this.preview.set_position(rect.x, rect.y);
    this.preview.set_size(rect.width, rect.height);
    this.preview.show();
  }

  hidePreview(): void {
    this.preview.hide();
  }

  ghostClose(rect: Rect, durationMs: number): void {
    if (!this.settings.boolean('close-animation-enabled', true)) return;
    // §18: an OS that disabled animations, or a zero resolved duration, means
    // no fade at all rather than an instant flash of chrome.
    if (!this.timing.animationsEnabled() || durationMs <= 0) return;
    const ghost = new St.Widget({ style_class: CSS_CLASS, reactive: false });
    ghost.set_position(rect.x, rect.y);
    ghost.set_size(rect.width, rect.height);
    ghost.set_style(this.styleString());
    layoutManager.addChrome(ghost, { affectsStruts: false, trackFullscreen: false });
    this.stackBelowTray(ghost);
    this.ghosts.add(ghost);

    let sourceId = 0;
    const cleanup = () => {
      if (!this.ghosts.has(ghost)) return;
      this.ghosts.delete(ghost);
      if (sourceId !== 0) {
        this.closeSources.delete(sourceId);
        GLib.source_remove(sourceId);
        sourceId = 0;
      }
      layoutManager.removeChrome(ghost);
      ghost.destroy();
    };

    // A frame-clock-less compositor may never complete the ease; a few frames
    // past the duration guarantees the ghost is destroyed either way.
    sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, durationMs + this.timing.sampleIntervalMs(3), () => {
      sourceId = 0;
      cleanup();
      return GLib.SOURCE_REMOVE;
    });
    this.closeSources.add(sourceId);
    ghost.ease({
      opacity: 0,
      duration: durationMs,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: cleanup,
    });
  }

  destroy(): void {
    this.stopPulse();
    for (const id of this.closeSources) GLib.source_remove(id);
    this.closeSources.clear();
    for (const ghost of this.ghosts) {
      layoutManager.removeChrome(ghost);
      ghost.destroy();
    }
    this.ghosts.clear();
    layoutManager.removeChrome(this.widget);
    layoutManager.removeChrome(this.preview);
    this.widget.destroy();
    this.preview.destroy();
  }

  /** Resolved styling, for `DumpState` and diagnostics. */
  describe(): { color: string; width: number; opacity: number; radius: number; stackedBelowTray: boolean; pulseDurationMs: number; animationsEnabled: boolean } {
    return {
      color: this.colour(),
      width: this.settings.int('indicator-width', 3),
      opacity: this.settings.int('indicator-opacity', 100),
      radius: this.settings.int('indicator-corner-radius', 8),
      stackedBelowTray: this.isBelowTray(),
      pulseDurationMs: this.timing.effectiveDuration(this.settings.int('indicator-pulse-duration', 900)),
      animationsEnabled: this.timing.animationsEnabled(),
    };
  }

  /** Keep `actor` under the notification tray, so a banner paints over it. */
  private stackBelowTray(actor: any): void {
    try {
      const parent = actor.get_parent();
      if (parent === null || messageTray === null || messageTray.get_parent() !== parent) return;
      parent.set_child_below_sibling(actor, messageTray);
    } catch (e) {
      console.error(`[adrt] could not stack the highlight below the notification tray: ${(e as Error).message}`);
    }
  }

  /** Whether the highlight currently sits below the notification tray. */
  private isBelowTray(): boolean {
    try {
      const parent = this.widget.get_parent();
      if (parent === null || messageTray === null || messageTray.get_parent() !== parent) return false;
      const children = parent.get_children();
      return children.indexOf(this.widget) < children.indexOf(messageTray);
    } catch {
      return false;
    }
  }

  get isVisible(): boolean {
    return this.widget.visible === true;
  }

  /** Number of close ghosts currently fading out. */
  get ghostCount(): number {
    return this.ghosts.size;
  }

  private startPulse(): void {
    if (this.pulseActive) return;
    // §18: the pulse is an animation; skip it when the OS asked to save power.
    if (!this.timing.animationsEnabled()) {
      this.stopPulse();
      return;
    }
    const duration = this.timing.effectiveDuration(this.settings.int('indicator-pulse-duration', 900));
    if (duration <= 0) return;
    this.pulseActive = true;
    this.widget.ease({
      opacity: 160,
      duration,
      mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
      repeatCount: -1,
      autoReverse: true,
    });
  }

  private stopPulse(): void {
    if (!this.pulseActive) return;
    this.pulseActive = false;
    this.widget.remove_all_transitions();
    this.widget.opacity = 255;
  }

  private applyStyle(): void {
    this.widget.set_style(this.styleString());
  }

  private styleString(): string {
    const color = this.colour();
    const width = this.settings.int('indicator-width', 2);
    const opacity = this.settings.int('indicator-opacity', 100);
    const radius = this.settings.int('indicator-corner-radius', 8);
    return `border: ${width}px solid ${color}; border-radius: ${radius}px; opacity: ${opacity / 100};`;
  }

  private colour(): string {
    const configured = this.settings.string('indicator-color', 'accent');
    // 'accent' (or a palette name) follows the system accent; otherwise a hex.
    const paletteName = configured === 'accent' ? this.systemAccentName() : configured;
    return ACCENT_COLORS[paletteName] ?? configured;
  }

  private systemAccentName(): string {
    try {
      if (this.interfaceSettings === null) {
        this.interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
      }
      const accent: string = this.interfaceSettings.get_string('accent-color');
      return accent.length > 0 ? accent : 'blue';
    } catch (e) {
      console.error(`[adrt] could not read the system accent colour: ${(e as Error).message}`);
      return 'blue';
    }
  }
}
