// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Border rendering (§23). A thin view: `BorderState` decides visibility and
 * position, this file only draws.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';
import { layoutManager, messageTray } from 'resource:///org/gnome/shell/ui/main.js';

import type { Rect } from '../../core/types.js';
import type { IndicatorBackend } from '../../platform/indicator.js';
import { SignalRegistry, TimeoutRegistry } from './lifecycle.js';
import type { GnomeSettings } from './settings.js';
import type { GnomeTiming } from './timing.js';

const CSS_CLASS = 'adrt-indicator';
const PREVIEW_CLASS = 'adrt-indicator-preview';

/**
 * Structural views of the GJS chrome actors and settings this file drives.
 * `gi.d.ts` declares `St`/`Gio` as `any`, so each view names only the members
 * used — the same pattern as `compat.ts`/`host.ts`.
 */

/** The subset of `Clutter.Actor.ease` the indicator passes. */
interface EaseParams {
  opacity: number;
  duration: number;
  mode: unknown;
  repeatCount?: number;
  autoReverse?: boolean;
  onComplete?: () => void;
}

/** A chrome parent (`layoutManager.uiGroup`), read for its child ordering. */
interface StContainerLike {
  set_child_below_sibling(child: StWidgetLike, sibling: unknown): void;
  get_children(): StWidgetLike[];
}

/** A `St.Widget` chrome actor: position, styling, visibility and transitions. */
interface StWidgetLike {
  visible: boolean;
  opacity: number;
  connect<A extends unknown[]>(signal: string, callback: (...args: A) => unknown): number;
  destroy(): void;
  show(): void;
  hide(): void;
  set_position(x: number, y: number): void;
  set_size(width: number, height: number): void;
  set_style(style: string): void;
  ease(params: EaseParams): void;
  remove_all_transitions(): void;
  get_parent(): StContainerLike | null;
}

/** The `org.gnome.desktop.interface` surface read for the accent colour. */
interface SystemSettingsLike {
  get_string(key: string): string;
}

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
  private readonly widget: StWidgetLike;
  private readonly preview: StWidgetLike;
  private readonly ghosts = new Set<StWidgetLike>();
  /** Ghost fade timers, drained in `destroy()` (§36). */
  private readonly timers = new TimeoutRegistry();
  private ghostSeq = 0;
  private pulseActive = false;
  private interfaceSettings: SystemSettingsLike | null = null;
  /** The last rect handed to `showPreview`, for `DumpState` and diagnostics. */
  private previewRect: Rect | null = null;
  /**
   * §Shell stability: chrome actors can be destroyed by the Shell itself at
   * session end, before (and independent of) `disable()`. A destroyed actor is
   * only ever noticed through its own `destroy` signal — touching it again
   * would log a Gjs "already been disposed" critical, even inside a try/catch.
   */
  private destroyed = false;
  private readonly goneActors = new WeakSet<StWidgetLike>();
  private stageGone = false;
  /** Stage-lifetime subscription, drained in `destroy()` (§36). */
  private readonly signals = new SignalRegistry();

  constructor(
    private readonly settings: GnomeSettings,
    private readonly timing: GnomeTiming,
  ) {
    this.widget = new St.Widget({ style_class: CSS_CLASS, reactive: false, visible: false });
    this.preview = new St.Widget({ style_class: PREVIEW_CLASS, reactive: false, visible: false, opacity: 120 });
    this.widget.connect('destroy', () => this.goneActors.add(this.widget));
    this.preview.connect('destroy', () => this.goneActors.add(this.preview));
    try {
      this.signals.add('stage', global.stage, 'destroy', () => {
        this.stageGone = true;
      });
    } catch {
      /* no stage in this shell: nothing to watch */
    }
    this.applyStyle();
    this.applyPreviewStyle();
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
    if (this.destroyed || this.goneActors.has(this.widget)) return;
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
    if (this.destroyed || this.goneActors.has(this.widget)) return;
    this.widget.hide();
  }

  showPreview(rect: Rect): void {
    if (this.destroyed || this.goneActors.has(this.preview)) return;
    this.applyPreviewStyle();
    this.previewRect = { ...rect };
    this.preview.set_position(rect.x, rect.y);
    this.preview.set_size(rect.width, rect.height);
    this.preview.show();
  }

  hidePreview(): void {
    this.previewRect = null;
    if (this.destroyed || this.goneActors.has(this.preview)) return;
    this.preview.hide();
  }

  ghostClose(rect: Rect, durationMs: number): void {
    if (this.destroyed || this.stageGone) return;
    if (!this.settings.boolean('close-animation-enabled', true)) return;
    // §18: an OS that disabled animations, or a zero resolved duration, means
    // no fade at all rather than an instant flash of chrome.
    if (!this.timing.animationsEnabled() || durationMs <= 0) return;
    const ghost: StWidgetLike = new St.Widget({ style_class: CSS_CLASS, reactive: false });
    ghost.set_position(rect.x, rect.y);
    ghost.set_size(rect.width, rect.height);
    ghost.set_style(this.styleString());
    // §Shell stability: a session end can have torn the chrome host down while
    // the close signal was in flight. Give the actor up at once then and arm
    // neither the fade nor the timer — a queued callback must never touch a
    // disposed chrome host.
    let added = false;
    try {
      layoutManager.addChrome(ghost, { affectsStruts: false, trackFullscreen: false });
      added = true;
      this.stackBelowTray(ghost);
    } catch {
      added = false;
    }
    if (!added) {
      try {
        ghost.destroy();
      } catch {
        /* already gone */
      }
      return;
    }
    // The Shell may destroy the ghost mid-fade (session end); the destroy
    // signal drops it from the set, so `cleanup` never touches it again.
    ghost.connect('destroy', () => {
      this.goneActors.add(ghost);
      this.ghosts.delete(ghost);
    });
    this.ghosts.add(ghost);

    const name = `ghost-${(this.ghostSeq += 1)}`;
    const cleanup = () => {
      if (!this.ghosts.has(ghost)) return;
      this.ghosts.delete(ghost);
      this.removeChrome(ghost);
      this.destroyActor(ghost);
    };

    // A frame-clock-less compositor may never complete the ease; a few frames
    // past the duration guarantees the ghost is destroyed either way. The
    // registry drops the entry when it fires, so `destroy()` never tries to
    // remove an already-fired timer, whatever state the ghost is in by then.
    this.timers.add(name, durationMs + this.timing.sampleIntervalMs(3), () => {
      cleanup();
    });
    ghost.ease({
      opacity: 0,
      duration: durationMs,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: cleanup,
    });
  }

  /**
   * §Shell stability: tear the chrome down. Idempotent, and safe when the
   * Shell already destroyed some or all of the actors (session end, or a
   * repeated disable): every touch is skipped once the actor's own destroy
   * signal has fired, and `removeChrome` is skipped once the stage is gone.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopPulse();
    this.timers.clearAll();
    this.signals.disconnect();
    for (const ghost of this.ghosts) {
      this.removeChrome(ghost);
      this.destroyActor(ghost);
    }
    this.ghosts.clear();
    this.removeChrome(this.widget);
    this.removeChrome(this.preview);
    this.previewRect = null;
    this.destroyActor(this.widget);
    this.destroyActor(this.preview);
  }

  /**
   * §Shell-stability test trigger: destroy the chrome actors exactly the way
   * the Shell's session end does (raw `destroy()`, none of adrt's bookkeeping),
   * so a scenario can prove `disable()` survives chrome the Shell has already
   * torn down.
   */
  destroyChromeActors(): void {
    for (const ghost of this.ghosts) this.destroyActor(ghost);
    this.destroyActor(this.widget);
    this.destroyActor(this.preview);
  }

  /** Remove chrome and destroy one actor, each guarded against a prior destroy. */
  private destroyActor(actor: StWidgetLike | null | undefined): void {
    if (actor === null || actor === undefined || this.goneActors.has(actor)) return;
    try {
      actor.destroy();
    } catch {
      /* already gone */
    }
  }

  /** `removeChrome`, skipped when the actor or the stage is already gone. */
  private removeChrome(actor: StWidgetLike | null | undefined): void {
    if (actor === null || actor === undefined || this.stageGone || this.goneActors.has(actor)) return;
    try {
      layoutManager.removeChrome(actor);
    } catch {
      /* the chrome host (uiGroup) is gone mid-shutdown: nothing to remove */
    }
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

  /** §6/§11: the drop-assist overlay, for `DumpState` and diagnostics. */
  describePreview(): { visible: boolean; rect: Rect | null; colour: string } {
    return {
      visible: !this.goneActors.has(this.preview) && this.preview.visible === true,
      rect: this.previewRect,
      colour: this.colour(),
    };
  }

  /** Keep `actor` under the notification tray, so a banner paints over it. */
  private stackBelowTray(actor: StWidgetLike): void {
    if (this.stageGone || this.goneActors.has(actor)) return;
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
    if (this.stageGone || this.goneActors.has(this.widget)) return false;
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
    return !this.goneActors.has(this.widget) && this.widget.visible === true;
  }

  /** Number of close ghosts currently fading out. */
  get ghostCount(): number {
    return this.ghosts.size;
  }

  private startPulse(): void {
    if (this.pulseActive) return;
    if (this.destroyed || this.goneActors.has(this.widget)) return;
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
    if (this.goneActors.has(this.widget)) return;
    this.widget.remove_all_transitions();
    this.widget.opacity = 255;
  }

  private applyStyle(): void {
    this.widget.set_style(this.styleString());
  }

  private applyPreviewStyle(): void {
    this.preview.set_style(this.previewStyleString());
  }

  private styleString(): string {
    const color = this.colour();
    const width = this.settings.int('indicator-width', 2);
    const opacity = this.settings.int('indicator-opacity', 100);
    const radius = this.settings.int('indicator-corner-radius', 8);
    return `border: ${width}px solid ${color}; border-radius: ${radius}px; opacity: ${opacity / 100};`;
  }

  /** The drop-assist outline: the border's accent and shape, faintly filled. */
  private previewStyleString(): string {
    const color = this.colour();
    const width = this.settings.int('indicator-width', 2);
    const radius = this.settings.int('indicator-corner-radius', 8);
    return `border: ${width}px solid ${color}; border-radius: ${radius}px; background-color: ${color};`;
  }

  private colour(): string {
    const configured = this.settings.string('indicator-color', 'accent');
    // 'accent' (or a palette name) follows the system accent; otherwise a hex.
    const paletteName = configured === 'accent' ? this.systemAccentName() : configured;
    return ACCENT_COLORS[paletteName] ?? configured;
  }

  private systemAccentName(): string {
    try {
      let settings = this.interfaceSettings;
      if (settings === null) {
        const created: SystemSettingsLike = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this.interfaceSettings = created;
        settings = created;
      }
      const accent: string = settings.get_string('accent-color');
      return accent.length > 0 ? accent : 'blue';
    } catch (e) {
      console.error(`[adrt] could not read the system accent colour: ${(e as Error).message}`);
      return 'blue';
    }
  }
}
