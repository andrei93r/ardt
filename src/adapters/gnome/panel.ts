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
  /** Open the extension's preferences window. */
  openPreferences(): void;
}

/** What `describe()` reports for `DumpState` (add-only observability). */
export interface PanelDescription {
  present: boolean;
  paused: boolean;
  indicatorEnabled: boolean;
  pauseLabel: string;
  indicatorLabel: string;
}

const ROLE = 'adrt';

export class AdrtPanel {
  private readonly button: any;
  private readonly pauseItem: any;
  private readonly indicatorItem: any;
  /**
   * True while `sync()` writes the widgets: `PopupSwitchMenuItem.setToggleState`
   * emits `toggled`, so without this the programmatic redraw would be mistaken
   * for a user click (and, for the pause item, set a spurious manual pause).
   */
  private syncing = false;

  constructor(private readonly callbacks: PanelCallbacks) {
    // `dontCreateMenu: false` gives the button its own PopupMenu to fill.
    this.button = new PanelMenu.Button(0.0, 'Adrt', false);
    this.button.add_child(new St.Icon({ icon_name: 'view-grid-symbolic', style_class: 'system-status-icon' }));

    this.pauseItem = new PopupMenu.PopupSwitchMenuItem('Pause tiling', false);
    this.pauseItem.connect('toggled', (_item: any, state: boolean) => {
      if (this.syncing) return;
      // The switch already moved; the callback adopts the new value and every
      // other reader (tiling, indicator) sees it through the pause predicate.
      this.callbacks.setPaused(state);
      this.sync();
    });
    this.button.menu.addMenuItem(this.pauseItem);

    this.indicatorItem = new PopupMenu.PopupSwitchMenuItem('Active-window highlight', true);
    this.indicatorItem.connect('toggled', (_item: any, state: boolean) => {
      if (this.syncing) return;
      this.callbacks.setIndicatorEnabled(state);
      this.sync();
    });
    this.button.menu.addMenuItem(this.indicatorItem);

    this.button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this.button.menu.addAction('Preferences…', () => this.callbacks.openPreferences());

    // A menu built while paused must not show stale labels after the state was
    // changed elsewhere (a keybinding, lock, sharing, the prefs window).
    this.button.menu.connect('open-state-changed', (_menu: any, open: boolean) => {
      if (open) this.sync();
    });

    panel.addToStatusArea(ROLE, this.button);
    this.sync();
  }

  /** Redraw the menu to match the live state. Never throws: it may be called
   * from a state-change path. */
  sync(): void {
    this.syncing = true;
    try {
      const paused = this.callbacks.isPaused();
      this.pauseItem.setToggleState(paused);
      this.pauseItem.label.text = paused ? 'Resume tiling' : 'Pause tiling';
      const indicator = this.callbacks.indicatorEnabled();
      this.indicatorItem.setToggleState(indicator);
      this.indicatorItem.label.text = indicator ? 'Hide active-window highlight' : 'Show active-window highlight';
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
    switch (name) {
      case 'pause':
        this.pauseItem.toggle();
        return true;
      case 'indicator':
        this.indicatorItem.toggle();
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
    try {
      paused = this.callbacks.isPaused();
      indicator = this.callbacks.indicatorEnabled();
    } catch {
      /* report the widget's own flags below */
    }
    return {
      present: true,
      paused,
      indicatorEnabled: indicator,
      pauseLabel: this.pauseItem?.label?.text ?? '',
      indicatorLabel: this.indicatorItem?.label?.text ?? '',
    };
  }

  destroy(): void {
    this.button.destroy();
  }
}
