// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Preferences window (§19.1, §9.5). Reads and writes the same GSettings keys
 * the extension reads; no `gdbus` shell-outs (§24 item 9).
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { AdaptationStore } from './adapt.js';

export default class AdrtPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: any): void {
    const settings = this.getSettings();
    window.add(this.tilingPage(settings));
    window.add(this.behaviourPage(settings));
    window.add(this.rulesPage(settings));
    window.add(this.indicatorPage(settings));
    window.add(this.gesturePage(settings));
    window.add(this.problemWindowsPage());
    window.add(this.aboutPage(settings));
  }

  private tilingPage(settings: any): any {
    const page = new Adw.PreferencesPage({ title: 'Tiling', icon_name: 'view-grid-symbolic' });
    const gaps = new Adw.PreferencesGroup({ title: 'Gaps' });
    gaps.add(this.spinRow(settings, 'gaps-base', 'Base gap', 'Pixels on every side of a tile.', 0, 200));
    gaps.add(this.spinRow(settings, 'gaps-portrait', 'Portrait gap', 'Negative inherits the base gap.', -1, 200));
    gaps.add(this.spinRow(settings, 'gaps-landscape', 'Landscape gap', 'Negative inherits the base gap.', -1, 200));
    page.add(gaps);

    const split = new Adw.PreferencesGroup({ title: 'Split' });
    split.add(this.comboRow(settings, 'min-size-policy', 'Minimum-size policy', ['respect', 'ignore', 'stack']));
    split.add(this.spinRow(settings, 'primary-app-ratio', 'Primary app ratio (%)', 'Clamped to 20–80%.', 20, 80));
    split.add(this.entryRow(settings, 'primary-apps', 'Primary apps', 'Comma-separated app ids.'));
    split.add(this.spinRow(settings, 'nudge-step', 'Nudge step (%)', '', 1, 50));
    split.add(this.spinRow(settings, 'undo-stack-size', 'Undo stack size', '', 0, 100));
    page.add(split);
    return page;
  }

  private behaviourPage(settings: any): any {
    const page = new Adw.PreferencesPage({ title: 'Behaviour', icon_name: 'preferences-system-symbolic' });
    const group = new Adw.PreferencesGroup({ title: 'Windows' });
    group.add(this.switchRow(settings, 'heuristic-modal-detect', 'Heuristic modal detection'));
    group.add(this.entryRow(settings, 'exception-apps', 'Exception apps', 'Comma-separated globs.'));
    group.add(this.switchRow(settings, 'adaptation-enabled', 'Adapt to problem windows'));
    group.add(this.switchRow(settings, 'float-persistence', 'Remember floats per app'));
    page.add(group);

    const animation = new Adw.PreferencesGroup({ title: 'Animation' });
    animation.add(this.switchRow(settings, 'disable-animations', 'Disable animations'));
    animation.add(this.spinRow(settings, 'animation-duration', 'Animation duration (ms)', '', 0, 1000));
    animation.add(this.spinRow(settings, 'close-animation-duration', 'Close animation (ms)', '', 0, 1000));
    page.add(animation);

    const diagnostics = new Adw.PreferencesGroup({ title: 'Diagnostics' });
    diagnostics.add(this.spinRow(settings, 'scan-interval', 'Scan interval (ms)', '', 1000, 60000));
    diagnostics.add(this.switchRow(settings, 'debug-enabled', 'Debug logging'));
    diagnostics.add(this.switchRow(settings, 'trace-enabled', 'Trace logging'));
    diagnostics.add(this.switchRow(settings, 'history-enabled', 'Event history'));
    diagnostics.add(this.switchRow(settings, 'dbus-enabled', 'D-Bus interface'));
    diagnostics.add(this.switchRow(settings, 'dry-run-mode', 'Dry run'));
    page.add(diagnostics);
    return page;
  }

  private rulesPage(settings: any): any {
    const page = new Adw.PreferencesPage({ title: 'Rules', icon_name: 'emblem-documents-symbolic' });
    const group = new Adw.PreferencesGroup({ title: 'Rules' });
    group.add(this.switchRow(settings, 'rules-enabled', 'Enable rules'));
    const editor = new Gtk.TextView({ monospace: true, wrap_mode: Gtk.WrapMode.WORD_CHAR, top_margin: 8, bottom_margin: 8 });
    editor.buffer.text = settings.get_string('rules-json');
    editor.buffer.connect('changed', () => {
      settings.set_string('rules-json', editor.buffer.text);
    });
    const scroller = new Gtk.ScrolledWindow({ min_content_height: 200 });
    scroller.set_child(editor);
    group.add(scroller);
    page.add(group);
    return page;
  }

  private indicatorPage(settings: any): any {
    const page = new Adw.PreferencesPage({ title: 'Indicator', icon_name: 'focus-windows-symbolic' });
    const group = new Adw.PreferencesGroup({ title: 'Border' });
    group.add(this.switchRow(settings, 'active-window-indicator', 'Show border on the focused window'));
    group.add(this.entryRow(settings, 'indicator-color', 'Colour', '"accent" or a hex colour.'));
    group.add(this.spinRow(settings, 'indicator-opacity', 'Opacity (%)', '', 0, 100));
    group.add(this.spinRow(settings, 'indicator-width', 'Width (px)', '', 1, 20));
    group.add(this.spinRow(settings, 'indicator-corner-radius', 'Corner radius (px)', '', 0, 32));
    group.add(this.switchRow(settings, 'indicator-animated-pulse', 'Pulse'));
    page.add(group);
    return page;
  }

  private gesturePage(settings: any): any {
    const page = new Adw.PreferencesPage({ title: 'Gestures', icon_name: 'input-touchpad-symbolic' });
    const group = new Adw.PreferencesGroup({ title: 'Touchpad' });
    group.add(this.switchRow(settings, 'gesture-enabled', 'Enable gestures'));
    group.add(
      this.comboRow(settings, 'gesture-3-swipe-action', '3-finger horizontal', [
        'switch-workspace',
        'toggle-overview',
        'show-desktop',
        'swap-pair',
        'none',
      ]),
    );
    group.add(
      this.comboRow(settings, 'gesture-3-vertical-action', '3-finger vertical', ['toggle-overview', 'switch-workspace', 'show-desktop', 'none']),
    );
    group.add(
      this.comboRow(settings, 'gesture-4-swipe-action', '4-finger horizontal', ['switch-workspace', 'toggle-overview', 'swap-pair', 'none']),
    );
    group.add(this.comboRow(settings, 'gesture-4-vertical-action', '4-finger vertical', ['none', 'switch-workspace', 'toggle-overview']));
    group.add(this.comboRow(settings, 'gesture-pinch-action', 'Pinch', ['show-desktop', 'toggle-overview', 'none']));
    group.add(this.spinRow(settings, 'gesture-sensitivity', 'Sensitivity', 'Higher triggers sooner.', 0, 100));
    page.add(group);
    return page;
  }

  private problemWindowsPage(): any {
    const page = new Adw.PreferencesPage({ title: 'Problem windows', icon_name: 'dialog-warning-symbolic' });
    const group = new Adw.PreferencesGroup({ title: 'Adaptation records' });
    const store = new AdaptationStore(true);
    store.load();
    const records = store.list();
    if (records.length === 0) {
      group.add(new Adw.ActionRow({ title: 'No problem windows recorded yet' }));
    }
    for (const record of records) {
      const row = new Adw.ActionRow({
        title: record.appId,
        subtitle: `observations ${record.observations}${record.skipAnimation ? ', animation skipped' : ''}`,
      });
      const button = new Gtk.Button({ icon_name: 'user-trash-symbolic', valign: Gtk.Align.CENTER });
      button.connect('clicked', () => {
        store.forget(record.appId);
        store.flush();
        group.remove(row);
      });
      row.add_suffix(button);
      group.add(row);
    }
    page.add(group);
    return page;
  }

  private aboutPage(settings: any): any {
    const page = new Adw.PreferencesPage({ title: 'About', icon_name: 'help-about-symbolic' });
    const group = new Adw.PreferencesGroup({ title: 'Adrt' });
    group.add(new Adw.ActionRow({ title: 'Version', subtitle: this.metadata['version-name'] ?? '0.1.0' }));
    group.add(new Adw.ActionRow({ title: 'GNOME UUID', subtitle: 'adrt@adrt.dev' }));
    const reset = new Adw.ActionRow({ title: 'Show the first-run note again' });
    const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    toggle.active = false;
    toggle.connect('state-set', () => {
      settings.set_boolean('first-run-complete', false);
      return false;
    });
    reset.add_suffix(toggle);
    group.add(reset);
    page.add(group);
    return page;
  }

  private switchRow(settings: any, key: string, title: string): any {
    const row = new Adw.SwitchRow({ title });
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  private spinRow(settings: any, key: string, title: string, subtitle: string, lower: number, upper: number): any {
    const row = new Adw.SpinRow({
      title,
      subtitle,
      adjustment: new Gtk.Adjustment({ lower, upper, step_increment: 1 }),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  private comboRow(settings: any, key: string, title: string, values: string[]): any {
    const row = new Adw.ComboRow({ title, model: Gtk.StringList.new(values) });
    const current = settings.get_string(key);
    const index = values.indexOf(current);
    row.selected = index < 0 ? 0 : index;
    row.connect('notify::selected', () => {
      settings.set_string(key, values[row.selected]);
    });
    return row;
  }

  private entryRow(settings: any, key: string, title: string, subtitle: string): any {
    const row = new Adw.EntryRow({ title });
    // Keys come in two shapes: string arrays (`as`, comma separated) and plain
    // strings (`s`, e.g. indicator-color). Calling get_strv on a string key
    // returns null and took the whole preferences window down with it.
    const isStrv = this.keyIsStringArray(settings, key);
    row.text = isStrv
      ? (settings.get_strv(key) ?? []).join(',')
      : (settings.get_string(key) ?? '');
    void subtitle;
    row.connect('changed', () => {
      if (isStrv) {
        const parts = row.text
          .split(',')
          .map((part: string) => part.trim())
          .filter((part: string) => part.length > 0);
        settings.set_strv(key, parts);
      } else {
        settings.set_string(key, row.text);
      }
    });
    return row;
  }

  /** Whether a GSettings key's type is an array of strings (`as`). */
  private keyIsStringArray(settings: any, key: string): boolean {
    try {
      const schema = settings.settings_schema;
      const valueType = schema.get_key(key).get_value_type();
      const name = typeof valueType.dup_string === 'function' ? valueType.dup_string() : String(valueType);
      return name.startsWith('a');
    } catch {
      return false;
    }
  }
}
