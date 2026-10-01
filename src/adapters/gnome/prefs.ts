// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Preferences window (§19.1, §9.5). Reads and writes the same GSettings keys
 * the extension reads; no `gdbus` shell-outs (§24 item 9).
 *
 * The user-facing rows are declared once in `PREFERENCES_LAYOUT` and built by
 * `buildRow`, so the page can never drift from the table and the options test
 * (`tests/agent/A140-prefs-options.sh`) can assert the row set without opening a
 * window. Keys that are internal, debug-only or declared-but-unused are
 * deliberately absent; see that scenario for the classification.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { _, loadTranslations } from './i18n.js';
import { RegistryStore } from './registry.js';

/** The widget a settings row is rendered with. */
export type RowKind = 'switch' | 'spin' | 'combo' | 'entry' | 'accelerator' | 'picker';

export interface RowSpec {
  /** The GSettings key. */
  key: string;
  kind: RowKind;
  title: string;
  subtitle?: string;
  /** `spin` bounds (inclusive). */
  lower?: number;
  upper?: number;
  /** `spin` display scale: the stored value is the shown value times this. */
  scale?: number;
  /** `combo` choices, in display order. */
  choices?: string[];
}

export interface GroupSpec {
  title: string;
  description?: string;
  rows: RowSpec[];
}

export interface PageSpec {
  title: string;
  icon: string;
  groups: GroupSpec[];
}

const SWIPE_ACTIONS = ['switch-workspace', 'toggle-overview', 'show-desktop', 'swap-pair', 'none'];
const VERTICAL_ACTIONS = ['switch-workspace', 'toggle-overview', 'show-desktop', 'none'];
const PINCH_ACTIONS = ['show-desktop', 'toggle-overview', 'none'];

/** One installed application, as shown in the pickers. */
interface AppChoice {
  /** The value written to settings: the app id the tiler matches. */
  id: string;
  name: string;
  icon: unknown | null;
}

let appChoiceCache: AppChoice[] | null = null;

/**
 * The installed applications, keyed by the id the tiler matches a window's WM
 * class against. A desktop file's `StartupWMClass` is preferred; otherwise the
 * desktop id without its `.desktop` suffix is the best available guess.
 */
function appChoices(): AppChoice[] {
  if (appChoiceCache !== null) return appChoiceCache;
  const out: AppChoice[] = [];
  const seen = new Set<string>();
  try {
    for (const info of Gio.AppInfo.get_all()) {
      if (typeof info.should_show === 'function' && !info.should_show()) continue;
      const desktopId: string = info.get_id?.() ?? '';
      let wmClass = '';
      try {
        wmClass = info.get_startup_wm_class?.() ?? '';
      } catch {
        wmClass = '';
      }
      const id = wmClass.length > 0 ? wmClass : desktopId.replace(/\.desktop$/, '');
      if (id.length === 0 || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: info.get_display_name?.() ?? info.get_name?.() ?? id, icon: info.get_icon?.() ?? null });
    }
  } catch {
    // No app database (e.g. a bare test process): fall back to the settings only.
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  appChoiceCache = out;
  return out;
}

/**
 * Every user-facing setting, grouped the way it appears in the window. This is
 * the single source of truth for the settings pages; internal and debug keys
 * are intentionally not here.
 */
export const PREFERENCES_LAYOUT: readonly PageSpec[] = [
  {
    title: _('Tiling'),
    icon: 'view-grid-symbolic',
    groups: [
      {
        title: _('Gaps'),
        description: _('The default spacing on each monitor. A gap of -1 inherits the base gap.'),
        rows: [
          { key: 'gaps-base', kind: 'spin', title: _('Base gap'), subtitle: _('Pixels around and between tiles.'), lower: 0, upper: 200 },
          { key: 'gaps-portrait', kind: 'spin', title: _('Portrait gap'), subtitle: _('Used on monitors taller than they are wide.'), lower: -1, upper: 200 },
          { key: 'gaps-landscape', kind: 'spin', title: _('Landscape gap'), subtitle: _('Used on monitors wider than they are tall.'), lower: -1, upper: 200 },
        ],
      },
      {
        title: _('Outer and inner gaps'),
        description: _('Per-side spacing that overrides the base gap. 0 is flush; -1 inherits the base gap.'),
        rows: [
          { key: 'gaps-left', kind: 'spin', title: _('Left gap'), lower: -1, upper: 200 },
          { key: 'gaps-right', kind: 'spin', title: _('Right gap'), lower: -1, upper: 200 },
          { key: 'gaps-top', kind: 'spin', title: _('Top gap'), lower: -1, upper: 200 },
          { key: 'gaps-bottom', kind: 'spin', title: _('Bottom gap'), lower: -1, upper: 200 },
          { key: 'gaps-between', kind: 'spin', title: _('Between windows'), subtitle: _('The gap at a split.'), lower: -1, upper: 200 },
        ],
      },
      {
        title: _('Splitting'),
        description: _('The default split, the keyboard resize step, and the apps that take the larger share.'),
        rows: [
          { key: 'min-size-policy', kind: 'combo', title: _('Minimum-size policy'), choices: ['respect', 'ignore', 'stack'] },
          { key: 'primary-app-ratio', kind: 'spin', title: _('Primary app share'), subtitle: _('Percentage of the split (20–80%).'), lower: 20, upper: 80 },
          { key: 'primary-apps', kind: 'picker', title: _('Primary apps'), subtitle: _('Apps that take the larger share of a split.') },
          { key: 'nudge-step', kind: 'spin', title: _('Keyboard resize step'), subtitle: _('Percentage moved per nudge.'), lower: 1, upper: 50 },
          { key: 'reflow-keeps-edges', kind: 'switch', title: _('Keep outer edges when reflowing') },
        ],
      },
    ],
  },
  {
    title: _('Windows'),
    icon: 'preferences-system-symbolic',
    groups: [
      {
        title: _('Tiling'),
        description: _('Which windows adrt manages and how it reacts when one refuses to fit.'),
        rows: [
          { key: 'heuristic-modal-detect', kind: 'switch', title: _('Detect modal windows heuristically'), subtitle: _("Treat a 'title - parent' window as a modal dialog.") },
          { key: 'exception-apps', kind: 'picker', title: _('Never tile these apps'), subtitle: _('Apps adrt always leaves floating.') },
          { key: 'adaptation-enabled', kind: 'switch', title: _('Adapt to slow windows'), subtitle: _('Learn the settle time of windows that refuse geometry.') },
          { key: 'float-persistence', kind: 'switch', title: _('Remember floating apps'), subtitle: _('A window you float stays floating next time it opens.') },
          { key: 'clamp-windows-to-screen', kind: 'switch', title: _('Keep windows on the screen'), subtitle: _('Pull a window back when its frame leaves the monitor.') },
          { key: 'follow-moved-window', kind: 'switch', title: _('Follow a window moved to another workspace') },
        ],
      },
      {
        title: _('Session'),
        description: _('How adrt behaves while the screen is being shared.'),
        rows: [
          { key: 'pause-during-sharing', kind: 'switch', title: _('Pause tiling while screen sharing or remote desktop is active') },
        ],
      },
      {
        title: _('Pointer'),
        rows: [{ key: 'cursor-follows-focus', kind: 'switch', title: _('Move the pointer to the focused window') }],
      },
      {
        title: _('Animation'),
        description: _('Transitions when tiles are created, moved or closed.'),
        rows: [
          { key: 'disable-animations', kind: 'switch', title: _('Disable all animations'), subtitle: _("Includes GNOME's own Shell animations.") },
          { key: 'animation-duration', kind: 'spin', title: _('Move duration'), subtitle: _('Milliseconds.'), lower: 0, upper: 1000 },
          { key: 'close-animation-enabled', kind: 'switch', title: _('Fade a ghost when a window closes') },
          { key: 'close-animation-duration', kind: 'spin', title: _('Close ghost duration'), subtitle: _('Milliseconds.'), lower: 0, upper: 1000 },
          { key: 'gnome-animation-delay', kind: 'spin', title: _('Shell animation delay'), subtitle: _('Extra wait before reading geometry after an animation.'), lower: 0, upper: 1000 },
        ],
      },
    ],
  },
  {
    title: _('Rules'),
    icon: 'emblem-documents-symbolic',
    groups: [
      {
        title: _('Rules'),
        description: _('User-authored placement rules. Enable or disable the whole rule set here.'),
        rows: [{ key: 'rules-enabled', kind: 'switch', title: _('Enable rules') }],
      },
    ],
  },
  {
    title: _('Highlight'),
    icon: 'focus-windows-symbolic',
    groups: [
      {
        title: _('Focus highlight'),
        description: _('The outline drawn around the focused window. Colour is a named colour such as "accent", or a hex value like #3584e4.'),
        rows: [
          { key: 'active-window-indicator', kind: 'switch', title: _('Show a border on the focused window') },
          { key: 'indicator-color', kind: 'entry', title: _('Colour') },
          { key: 'indicator-opacity', kind: 'spin', title: _('Opacity'), subtitle: _('Percent.'), lower: 0, upper: 100 },
          { key: 'indicator-width', kind: 'spin', title: _('Border width'), subtitle: _('Pixels.'), lower: 1, upper: 20 },
          { key: 'indicator-corner-radius', kind: 'spin', title: _('Corner radius'), subtitle: _('Pixels.'), lower: 0, upper: 32 },
          { key: 'indicator-animated-pulse', kind: 'switch', title: _('Pulse the border while focused') },
          { key: 'indicator-pulse-duration', kind: 'spin', title: _('Pulse duration'), subtitle: _('Milliseconds per half of the pulse.'), lower: 0, upper: 4000 },
        ],
      },
    ],
  },
  {
    title: _('Gestures'),
    icon: 'input-touchpad-symbolic',
    groups: [
      {
        title: _('Touchpad'),
        description: _('Three- and four-finger swipes and pinch on a touchpad.'),
        rows: [
          { key: 'gesture-enabled', kind: 'switch', title: _('Enable gestures') },
          { key: 'gesture-3-swipe-action', kind: 'combo', title: _('Three-finger horizontal'), choices: SWIPE_ACTIONS },
          { key: 'gesture-3-vertical-action', kind: 'combo', title: _('Three-finger vertical'), choices: VERTICAL_ACTIONS },
          { key: 'gesture-4-swipe-action', kind: 'combo', title: _('Four-finger horizontal'), choices: SWIPE_ACTIONS },
          { key: 'gesture-4-vertical-action', kind: 'combo', title: _('Four-finger vertical'), choices: VERTICAL_ACTIONS },
          { key: 'gesture-pinch-action', kind: 'combo', title: _('Pinch'), choices: PINCH_ACTIONS },
          { key: 'gesture-sensitivity', kind: 'spin', title: _('Sensitivity'), subtitle: _('Higher triggers with less travel.'), lower: 0, upper: 100 },
        ],
      },
    ],
  },
  {
    title: _('Keys'),
    icon: 'input-keyboard-symbolic',
    groups: [
      {
        title: _('Focus'),
        rows: [
          { key: 'kb-focus-left', kind: 'accelerator', title: _('Focus left') },
          { key: 'kb-focus-right', kind: 'accelerator', title: _('Focus right') },
          { key: 'kb-focus-up', kind: 'accelerator', title: _('Focus up') },
          { key: 'kb-focus-down', kind: 'accelerator', title: _('Focus down') },
          { key: 'kb-focus-next', kind: 'accelerator', title: _('Focus next (cycle)') },
          { key: 'kb-cursor-centre', kind: 'accelerator', title: _('Move pointer to the focused window') },
        ],
      },
      {
        title: _('Move window'),
        rows: [
          { key: 'kb-move-left', kind: 'accelerator', title: _('Move left') },
          { key: 'kb-move-right', kind: 'accelerator', title: _('Move right') },
          { key: 'kb-move-up', kind: 'accelerator', title: _('Move up') },
          { key: 'kb-move-down', kind: 'accelerator', title: _('Move down') },
          { key: 'kb-move-workspace-prev', kind: 'accelerator', title: _('Move to the previous workspace') },
          { key: 'kb-move-workspace-next', kind: 'accelerator', title: _('Move to the next workspace') },
          { key: 'kb-move-workspace-1', kind: 'accelerator', title: _('Move to workspace 1') },
          { key: 'kb-move-workspace-2', kind: 'accelerator', title: _('Move to workspace 2') },
          { key: 'kb-move-workspace-3', kind: 'accelerator', title: _('Move to workspace 3') },
          { key: 'kb-move-workspace-4', kind: 'accelerator', title: _('Move to workspace 4') },
          { key: 'kb-move-workspace-5', kind: 'accelerator', title: _('Move to workspace 5') },
          { key: 'kb-move-workspace-6', kind: 'accelerator', title: _('Move to workspace 6') },
          { key: 'kb-move-workspace-7', kind: 'accelerator', title: _('Move to workspace 7') },
          { key: 'kb-move-workspace-8', kind: 'accelerator', title: _('Move to workspace 8') },
          { key: 'kb-move-workspace-9', kind: 'accelerator', title: _('Move to workspace 9') },
        ],
      },
      {
        title: _('Resize'),
        rows: [
          { key: 'kb-nudge-left', kind: 'accelerator', title: _('Move the split left') },
          { key: 'kb-nudge-right', kind: 'accelerator', title: _('Move the split right') },
          { key: 'kb-nudge-up', kind: 'accelerator', title: _('Move the split up') },
          { key: 'kb-nudge-down', kind: 'accelerator', title: _('Move the split down') },
        ],
      },
      {
        title: _('Window'),
        rows: [
          { key: 'kb-toggle-float', kind: 'accelerator', title: _('Float or re-tile') },
          { key: 'kb-toggle-fullscreen', kind: 'accelerator', title: _('Toggle fullscreen') },
          { key: 'kb-quit', kind: 'accelerator', title: _('Close the focused window') },
        ],
      },
      {
        title: _('History'),
        rows: [{ key: 'kb-undo', kind: 'accelerator', title: _('Undo') }],
      },
    ],
  },
  {
    title: _('Advanced'),
    icon: 'preferences-other-symbolic',
    groups: [
      {
        title: _('Safety net'),
        description: _('adrt re-checks the layout periodically in case a window misbehaves.'),
        rows: [{ key: 'scan-interval', kind: 'spin', title: _('Scan interval'), subtitle: _('Milliseconds between checks.'), lower: 1000, upper: 60000 }],
      },
      {
        title: _('Displays'),
        description: _('Arrangements are remembered per connector and replayed when it reconnects.'),
        rows: [{ key: 'display-memory-minutes', kind: 'spin', title: _('Remember display layouts'), subtitle: _('Minutes.'), lower: 1, upper: 1440 }],
      },
      {
        title: _('History'),
        description: _('An append-only log of what adrt did, written as JSONL files.'),
        rows: [
          { key: 'history-enabled', kind: 'switch', title: _('Record event history') },
          { key: 'history-retention-days', kind: 'spin', title: _('Keep history for'), subtitle: _('Days.'), lower: 1, upper: 3650 },
          { key: 'history-daily-folders', kind: 'switch', title: _('Store each day in its own folder') },
          { key: 'history-max-bytes', kind: 'spin', title: _('Rotate each file at'), subtitle: _('Megabytes.'), lower: 1, upper: 256, scale: 1048576 },
          { key: 'log-workspace-reorder', kind: 'switch', title: _('Log workspace reorders') },
        ],
      },
      {
        title: _('Integration'),
        rows: [{ key: 'dbus-enabled', kind: 'switch', title: _('Expose the D-Bus interface'), subtitle: _('org.adrt.Adrt on the session bus.') }],
      },
    ],
  },
];

/** Custom-rendered user-facing keys that are not plain rows. */
export const CUSTOM_RENDERED_KEYS: readonly string[] = ['rules-json'];

export default class AdrtPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: any): void {
    loadTranslations();
    const settings = this.getSettings();
    const pages = new Map<string, any>();
    for (const spec of PREFERENCES_LAYOUT) {
      const page = this.buildPage(settings, spec);
      pages.set(spec.title, page);
      window.add(page);
    }
    // The rule editor is not a settings row, but lives on the Rules page.
    pages.get(_('Rules'))?.add(this.rulesEditorGroup(settings));
    window.add(this.appsPage());
    window.add(this.aboutPage(settings));
  }

  /** Build one page, its groups and its rows from the declarative layout. */
  private buildPage(settings: any, spec: PageSpec): any {
    const page = new Adw.PreferencesPage({ title: spec.title, icon_name: spec.icon });
    for (const groupSpec of spec.groups) {
      const group = new Adw.PreferencesGroup({ title: groupSpec.title });
      if (groupSpec.description) group.description = groupSpec.description;
      for (const rowSpec of groupSpec.rows) group.add(this.buildRow(settings, rowSpec));
      page.add(group);
    }
    return page;
  }

  /** Build a single row, tagged with its settings key for introspection. */
  private buildRow(settings: any, spec: RowSpec): any {
    const row = this.rowFor(settings, spec);
    // Test hook: A140 reads this to prove every user-facing key has one row.
    row.adrtKey = spec.key;
    return row;
  }

  private rowFor(settings: any, spec: RowSpec): any {
    switch (spec.kind) {
      case 'switch':
        return this.switchRow(settings, spec);
      case 'spin':
        return this.spinRow(settings, spec);
      case 'combo':
        return this.comboRow(settings, spec);
      case 'entry':
        return this.entryRow(settings, spec);
      case 'accelerator':
        return this.acceleratorRow(settings, spec);
      case 'picker':
        return this.appPickerRow(spec, () => settings.get_strv(spec.key) ?? [], (ids) => settings.set_strv(spec.key, ids));
    }
  }

  /**
   * A multi-select app picker: the user chooses installed applications from a
   * searchable list instead of typing ids. The value is stored in the settings
   * key's existing format (the app id the tiler matches).
   */
  private appPickerRow(spec: RowSpec, getSelected: () => string[], setSelected: (ids: string[]) => void): any {
    const row = new Adw.ExpanderRow({ title: spec.title });
    if (spec.subtitle) row.subtitle = spec.subtitle;
    // Test hook: A140 asserts a picker is used for the app-list keys.
    row.adrtPicker = true;
    const choices = appChoices();
    const byId = new Map(choices.map((choice) => [choice.id, choice]));
    const selectionRows: any[] = [];
    let addRow: any = null;

    const rebuild = (): void => {
      const selected = getSelected();
      for (const child of selectionRows) row.remove(child);
      selectionRows.length = 0;
      if (addRow !== null) row.remove(addRow);
      for (const id of selected) {
        const choice = byId.get(id);
        const child = new Adw.ActionRow({ title: choice?.name ?? id, subtitle: id });
        if (choice?.icon) child.add_prefix(new Gtk.Image({ gicon: choice.icon, pixel_size: 16 }));
        const remove = new Gtk.Button({ icon_name: 'list-remove-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Remove') });
        remove.add_css_class('flat');
        remove.connect('clicked', () => {
          setSelected(getSelected().filter((value) => value !== id));
          rebuild();
        });
        child.add_suffix(remove);
        row.add_row(child);
        selectionRows.push(child);
      }
      addRow = new Adw.ActionRow({ title: _('Add application…') });
      const menu = new Gtk.MenuButton({ icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Add application') });
      menu.add_css_class('flat');
      menu.popover = this.buildAppPopover(byId, getSelected, (id) => {
        const selected = getSelected();
        setSelected(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
        rebuild();
      });
      addRow.add_suffix(menu);
      row.add_row(addRow);
    };

    rebuild();
    return row;
  }

  /** A searchable popover listing installed applications. */
  private buildAppPopover(byId: Map<string, AppChoice>, getSelected: () => string[], onToggle: (id: string) => void): any {
    const popover = new Gtk.Popover();
    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6 });
    const search = new Gtk.SearchEntry({ placeholder_text: _('Search applications') });
    const list = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
    list.add_css_class('boxed-list');
    const checks = new Map<string, any>();
    const byRow = new Map<any, string>();
    for (const choice of byId.values()) {
      const item = new Gtk.ListBoxRow();
      const line = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
      if (choice.icon) line.append(new Gtk.Image({ gicon: choice.icon, pixel_size: 16 }));
      line.append(new Gtk.Label({ label: choice.name, xalign: 0, hexpand: true }));
      const check = new Gtk.Image({ icon_name: 'object-select-symbolic' });
      line.append(check);
      item.set_child(line);
      byRow.set(item, choice.id);
      checks.set(choice.id, check);
      list.append(item);
    }
    list.connect('row-activated', (_list: any, item: any) => {
      const id = byRow.get(item);
      if (id !== undefined) onToggle(id);
    });
    const syncChecks = (): void => {
      const selected = new Set(getSelected());
      for (const [id, check] of checks) check.visible = selected.has(id);
    };
    search.connect('search-changed', () => {
      const query = search.text.trim().toLowerCase();
      list.set_filter_func((item: any) => {
        if (query.length === 0) return true;
        const child = item.get_child();
        const labels = child ? child.get_children().filter((c: any) => c instanceof Gtk.Label) : [];
        const text: string = labels.map((c: any) => c.label ?? '').join(' ').toLowerCase();
        return text.includes(query);
      });
    });
    popover.connect('show', syncChecks);
    syncChecks();
    const scroller = new Gtk.ScrolledWindow({ min_content_height: 260, min_content_width: 320, hscrollbar_policy: Gtk.PolicyType.NEVER });
    scroller.set_child(list);
    box.append(search);
    box.append(scroller);
    popover.set_child(box);
    return popover;
  }

  private switchRow(settings: any, spec: RowSpec): any {
    const row = new Adw.SwitchRow({ title: spec.title });
    if (spec.subtitle) row.subtitle = spec.subtitle;
    settings.bind(spec.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  private spinRow(settings: any, spec: RowSpec): any {
    const row = new Adw.SpinRow({
      title: spec.title,
      adjustment: new Gtk.Adjustment({ lower: spec.lower ?? 0, upper: spec.upper ?? 100, step_increment: 1 }),
    });
    if (spec.subtitle) row.subtitle = spec.subtitle;
    const scale = spec.scale ?? 1;
    if (scale === 1) {
      settings.bind(spec.key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    } else {
      // The key is stored in bytes; the row shows whole units.
      row.value = Math.round(settings.get_int(spec.key) / scale);
      row.connect('notify::value', () => {
        settings.set_int(spec.key, Math.round(row.value) * scale);
      });
    }
    return row;
  }

  private comboRow(settings: any, spec: RowSpec): any {
    const choices = spec.choices ?? [];
    const current = settings.get_string(spec.key);
    // Always keep the stored value selectable, even if it is off the list.
    const values = choices.includes(current) ? choices : [current, ...choices];
    const row = new Adw.ComboRow({ title: spec.title, model: Gtk.StringList.new(values) });
    const index = values.indexOf(current);
    row.selected = index < 0 ? 0 : index;
    row.connect('notify::selected', () => {
      settings.set_string(spec.key, values[row.selected]);
    });
    return row;
  }

  private acceleratorRow(settings: any, spec: RowSpec): any {
    const row = new Adw.EntryRow({ title: spec.title });
    row.text = (settings.get_strv(spec.key) ?? [])[0] ?? '';
    row.connect('changed', () => {
      const text = row.text.trim();
      settings.set_strv(spec.key, text.length > 0 ? [text] : []);
    });
    return row;
  }

  private entryRow(settings: any, spec: RowSpec): any {
    const row = new Adw.EntryRow({ title: spec.title });
    // Keys come in two shapes: string arrays (`as`, comma separated) and plain
    // strings (`s`, e.g. indicator-color). Calling get_strv on a string key
    // returns null and took the whole preferences window down with it.
    const isStrv = this.keyIsStringArray(settings, spec.key);
    row.text = isStrv
      ? (settings.get_strv(spec.key) ?? []).join(',')
      : (settings.get_string(spec.key) ?? '');
    row.connect('changed', () => {
      if (isStrv) {
        const parts = row.text
          .split(',')
          .map((part: string) => part.trim())
          .filter((part: string) => part.length > 0);
        settings.set_strv(spec.key, parts);
      } else {
        settings.set_string(spec.key, row.text);
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

  /** The JSON rule set editor, shown below the rules switch. */
  private rulesEditorGroup(settings: any): any {
    const group = new Adw.PreferencesGroup({ title: _('Rule set') });
    const editor = new Gtk.TextView({ monospace: true, wrap_mode: Gtk.WrapMode.WORD_CHAR, top_margin: 8, bottom_margin: 8 });
    editor.buffer.text = settings.get_string('rules-json');
    editor.buffer.connect('changed', () => {
      settings.set_string('rules-json', editor.buffer.text);
    });
    const scroller = new Gtk.ScrolledWindow({ min_content_height: 200 });
    scroller.set_child(editor);
    group.add(scroller);
    return group;
  }

  /**
   * §12: the app registry page. It replaces the old problem-windows page: one
   * row per app adrt has seen, a durable `neverTile` switch, and a forget
   * button that drops the entry (and returns live windows to the tiling).
   */
  private appsPage(): any {
    const page = new Adw.PreferencesPage({ title: _('Apps'), icon_name: 'view-app-grid-symbolic' });
    const group = new Adw.PreferencesGroup({
      title: _('App registry'),
      description: _('Every app adrt has seen. Turn on "Never tile" to keep an app floating.'),
    });
    const store = new RegistryStore();
    store.load();
    const entries = store.entries().sort((a, b) => b.lastSeen - a.lastSeen);
    if (entries.length === 0) {
      group.add(new Adw.ActionRow({ title: _('No apps recorded yet'), subtitle: _('Apps appear here as they are opened.') }));
    }
    const known = new Map(appChoices().map((choice) => [choice.id, choice]));
    for (const entry of entries) {
      const choice = known.get(entry.appId);
      const row = new Adw.SwitchRow({ title: choice?.name ?? entry.appId, subtitle: choice ? `${entry.appId} — ${entry.windowsSeen} window(s) seen` : `${entry.windowsSeen} window(s) seen` });
      if (choice?.icon) row.add_prefix(new Gtk.Image({ gicon: choice.icon, pixel_size: 16 }));
      row.active = entry.neverTile;
      row.connect('notify::active', () => {
        store.setNeverTile(entry.appId, row.active);
        store.flush();
      });
      const button = new Gtk.Button({ icon_name: 'user-trash-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Forget this app') });
      button.connect('clicked', () => {
        store.forget(entry.appId);
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
    const page = new Adw.PreferencesPage({ title: _('About'), icon_name: 'help-about-symbolic' });
    const group = new Adw.PreferencesGroup({ title: _('Adrt') });
    group.add(new Adw.ActionRow({ title: _('Version'), subtitle: this.metadata['version-name'] ?? '0.2.0' }));
    group.add(new Adw.ActionRow({ title: _('GNOME UUID'), subtitle: 'adrt@adrt.dev' }));
    const reset = new Adw.ActionRow({
      title: _('Show the first-run notification again'),
      subtitle: _('Displayed the first time adrt starts.'),
    });
    const button = new Gtk.Button({ label: _('Show'), valign: Gtk.Align.CENTER });
    button.connect('clicked', () => settings.set_boolean('first-run-complete', false));
    reset.add_suffix(button);
    group.add(reset);
    page.add(group);
    return page;
  }
}
