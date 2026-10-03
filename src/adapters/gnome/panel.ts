// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * The on-screen presence (§1): one `PanelMenu.Button` in the top bar whose menu
 * carries the three user controls — Pause/Resume tiling, the active-window
 * highlight on/off, and Preferences. It is a *view*: it owns no state, it reads
 * the session pause predicate and the indicator setting and writes back through
 * the callbacks. `sync()` is the one place that redraws it, called whenever the
 * extension's state can change and whenever the menu opens, so a change made
 * anywhere (prefs, settings, session mode) is reflected.
 */

import St from 'gi://St';
import { panel } from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/** The state the panel reflects and the actions it drives. */
export interface PanelCallbacks {
  /** The one pause predicate: session lock, manual pause or sharing. */
  isPaused(): boolean;
  /** Set the user-requested pause (does not touch session modes). */
  setPaused(paused: boolean): void;
  /** Whether the active-window highlight is enabled. */
  indicatorEnabled(): boolean;
  /** Toggle the active-window highlight (`active-window-indicator`). */
  setIndicatorEnabled(enabled: boolean): void;
  /** Whether a bug recording is in progress (the recorder's own state). */
  recording(): boolean;
  /** Start a bug recording if off, stop it if on. */
  toggleRecording(): void;
  /** Open the extension's preferences window. */
  openPreferences(): void;
}

/** What `describe()` reports for `DumpState` (add-only observability). */
export interface PanelDescription {
  present: boolean;
  paused: boolean;
  indicatorEnabled: boolean;
  recording: boolean;
  pauseLabel: string;
  indicatorLabel: string;
  recordLabel: string;
}

const ROLE = 'adrt';

export class AdrtPanel {
  private readonly button: any;
  private readonly pauseItem: any;
  private readonly indicatorItem: any;
  private readonly recordItem: any;
  /**
   * True while `sync()` writes the widgets: `PopupSwitchMenuItem.setToggleState`
   * emits `toggled`, so without this the programmatic redraw would be mistaken
   * for a user click (and, for the pause item, set a spurious manual pause).
   */
  private syncing = false;
  /**
   * §Shell stability: the Shell destroys the status-area button itself at
   * session end, before `disable()` runs. A destroyed button is only noticed
   * through its own `destroy` signal — touching it again would log a Gjs
   * "already been disposed" critical even inside a try/catch.
   */
  private destroyed = false;
  private buttonGone = false;
  private readonly toggledIds: { item: any; id: number }[] = [];
  private menuOpenId = 0;

  constructor(private readonly callbacks: PanelCallbacks) {
    // `dontCreateMenu: false` gives the button its own PopupMenu to fill.
    this.button = new PanelMenu.Button(0.0, 'Adrt', false);
    this.button.add_child(new St.Icon({ icon_name: 'view-grid-symbolic', style_class: 'system-status-icon' }));
    this.button.connect('destroy', () => {
      this.buttonGone = true;
    });

    this.pauseItem = new PopupMenu.PopupSwitchMenuItem('Pause tiling', false);
    this.toggledIds.push({
      item: this.pauseItem,
      id: this.pauseItem.connect('toggled', (_item: any, state: boolean) => {
        if (this.syncing) return;
        // The switch already moved; the callback adopts the new value and every
        // other reader (tiling, indicator) sees it through the pause predicate.
        this.callbacks.setPaused(state);
        this.sync();
      }),
    });
    this.button.menu.addMenuItem(this.pauseItem);

    this.indicatorItem = new PopupMenu.PopupSwitchMenuItem('Active-window highlight', true);
    this.toggledIds.push({
      item: this.indicatorItem,
      id: this.indicatorItem.connect('toggled', (_item: any, state: boolean) => {
        if (this.syncing) return;
        this.callbacks.setIndicatorEnabled(state);
        this.sync();
      }),
    });
    this.button.menu.addMenuItem(this.indicatorItem);

    // §22 extension: start/stop a bounded bug recording. The switch reflects the
    // recorder's own state, not a setting, so a recording stopped by its cap
    // still snaps the row back off through `sync()`.
    this.recordItem = new PopupMenu.PopupSwitchMenuItem('Record a bug', false);
    this.toggledIds.push({
      item: this.recordItem,
      id: this.recordItem.connect('toggled', (_item: any, _state: boolean) => {
        if (this.syncing) return;
        this.callbacks.toggleRecording();
        this.sync();
      }),
    });
    this.button.menu.addMenuItem(this.recordItem);

    this.button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this.button.menu.addAction('Preferences…', () => this.callbacks.openPreferences());

    // A menu built while paused must not show stale labels after the state was
    // changed elsewhere (a keybinding, lock, sharing, the prefs window).
    this.menuOpenId = this.button.menu.connect('open-state-changed', (_menu: any, open: boolean) => {
      if (open) this.sync();
    });

    panel.addToStatusArea(ROLE, this.button);
    this.sync();
  }

  /** Redraw the menu to match the live state. Never throws: it may be called
   * from a state-change path. */
  sync(): void {
    if (this.destroyed || this.buttonGone) return;
    this.syncing = true;
    try {
      const paused = this.callbacks.isPaused();
      this.pauseItem.setToggleState(paused);
      this.pauseItem.label.text = paused ? 'Resume tiling' : 'Pause tiling';
      const indicator = this.callbacks.indicatorEnabled();
      this.indicatorItem.setToggleState(indicator);
      this.indicatorItem.label.text = indicator ? 'Hide active-window highlight' : 'Show active-window highlight';
      const recording = this.callbacks.recording();
      this.recordItem.setToggleState(recording);
      this.recordItem.label.text = recording ? 'Stop recording' : 'Record a bug';
    } catch (error) {
      console.error(`[adrt] panel sync failed: ${(error as Error).message}`);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Test trigger: "click" one menu item through the widget's own path. `pause`
   * and `indicator` toggle the real switch items; `preferences` invokes the
   * same action the menu row does. Returns false for an unknown name.
   */
  activate(name: string): boolean {
    if (this.destroyed || this.buttonGone) return false;
    switch (name) {
      case 'pause':
        this.pauseItem.toggle();
        return true;
      case 'indicator':
        this.indicatorItem.toggle();
        return true;
      case 'record':
        this.recordItem.toggle();
        return true;
      case 'preferences':
        try {
          this.callbacks.openPreferences();
          return true;
        } catch (error) {
          console.error(`[adrt] could not open preferences: ${(error as Error).message}`);
          return false;
        }
      default:
        return false;
    }
  }

  describe(): PanelDescription {
    let paused = false;
    let indicator = false;
    let recording = false;
    try {
      paused = this.callbacks.isPaused();
      indicator = this.callbacks.indicatorEnabled();
      recording = this.callbacks.recording();
    } catch {
      /* report the widget's own flags below */
    }
    let pauseLabel = '';
    let indicatorLabel = '';
    let recordLabel = '';
    if (!this.destroyed && !this.buttonGone) {
      try {
        pauseLabel = this.pauseItem?.label?.text ?? '';
        indicatorLabel = this.indicatorItem?.label?.text ?? '';
        recordLabel = this.recordItem?.label?.text ?? '';
      } catch {
        /* the items went away mid-read */
      }
    }
    return {
      present: true,
      paused,
      indicatorEnabled: indicator,
      recording,
      pauseLabel,
      indicatorLabel,
      recordLabel,
    };
  }

  /**
   * §Shell stability: tear the panel down. Idempotent, and safe when the Shell
   * already destroyed the button: signals are disconnected before the destroy,
   * each guarded because the emitter (or its closure) may already be gone.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (!this.buttonGone) {
      if (this.menuOpenId !== 0) {
        try {
          this.button.menu.disconnect(this.menuOpenId);
        } catch {
          /* the menu is gone */
        }
        this.menuOpenId = 0;
      }
      for (const { item, id } of this.toggledIds) {
        try {
          item.disconnect(id);
        } catch {
          /* the item is gone */
        }
      }
      this.toggledIds.length = 0;
      try {
        this.button.destroy();
      } catch {
        /* already destroyed */
      }
    }
  }

  /**
   * §Shell-stability test trigger: destroy the button exactly the way the
   * Shell's session end does (raw `destroy()`, none of adrt's bookkeeping), so
   * a scenario can prove `disable()` survives chrome the Shell already tore
   * down.
   */
  destroyChromeActors(): void {
    try {
      this.button.destroy();
    } catch {
      /* already destroyed */
    }
  }
}
