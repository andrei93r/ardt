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
import type {
  AdwActionRow,
  AdwAlertDialog,
  AdwComboRow,
  AdwEntryRow,
  AdwExpanderRow,
  AdwPreferencesGroup,
  AdwPreferencesPage,
  AdwPreferencesRow,
  AdwPreferencesWindow,
  AdwSpinRow,
  AdwSwitchRow,
} from 'gi://Adw';
import type { Settings as GioSettings, AppInfo, File as GioFile, AsyncResult as GioAsyncResult } from 'gi://Gio';
import type {
  GtkBox,
  GtkButton,
  GtkImage,
  GtkLabel,
  GtkListBox,
  GtkListBoxRow,
  GtkMenuButton,
  GtkPopover,
  GtkScrolledWindow,
  GtkSearchEntry,
  GtkSwitch,
  GtkWidget,
  GtkFileDialog,
  GtkWindow,
} from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { _, loadTranslations } from './i18n.js';
import { RegistryStore } from './registry.js';
import { TILE_MODES, validateRule } from '../../core/rules.js';
import type { TileMode } from '../../core/rules.js';
import { AppRegistry, DEFAULT_TTL_MS, REGISTRY_VERSION } from '../../core/appregistry.js';
import type { AppEntry, AppRegistryData } from '../../core/appregistry.js';
import type { SettingKey } from '../../core/settings-descriptor.js';

/** The widget a settings row is rendered with. */
type RowKind = 'switch' | 'spin' | 'combo' | 'entry' | 'accelerator' | 'picker';

export interface RowSpec {
  /** The GSettings key. `SettingKey` makes a renamed/removed key a `tsc` error. */
  key: SettingKey;
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

interface GroupSpec {
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

/**
 * The user-facing label for each tile mode. Keyed by `TileMode`, so a mode
 * added to the core list is a `tsc` error until it gets a label; the action
 * combo is built from `TILE_MODES`, so its order can never drift from core.
 */
const TILE_MODE_LABELS: Record<TileMode, string> = {
  full: _('Full'),
  'left-half': _('Left half'),
  'right-half': _('Right half'),
  float: _('Float'),
};

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
    const infos: AppInfo[] = Gio.AppInfo.get_all();
    for (const info of infos) {
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
 *
 * @public Read by tests/agent/A140-prefs-options.sh from the built module.
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
        description: _('The default split and the apps that take the larger share.'),
        rows: [
          { key: 'min-size-policy', kind: 'combo', title: _('Minimum-size policy'), choices: ['respect', 'ignore', 'stack'] },
          { key: 'primary-app-ratio', kind: 'spin', title: _('Primary app share'), subtitle: _('Percentage of the split (20–80%).'), lower: 20, upper: 80 },
          { key: 'primary-apps', kind: 'picker', title: _('Primary apps'), subtitle: _('Apps that take the larger share of a split.') },
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
    groups: [],
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
          { key: 'kb-increase-window', kind: 'accelerator', title: _('Increase window'), subtitle: _('Grow the focused window along the split axis.') },
          { key: 'kb-decrease-window', kind: 'accelerator', title: _('Decrease window'), subtitle: _('Shrink the focused window along the split axis.') },
          { key: 'nudge-step', kind: 'spin', title: _('Step size'), subtitle: _('Percentage moved per keyboard resize.'), lower: 1, upper: 50 },
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
        title: _('Session'),
        rows: [{ key: 'kb-toggle-pause', kind: 'accelerator', title: _('Pause or resume tiling') }],
      },
      {
        title: _('Recording'),
        rows: [{ key: 'kb-recording-toggle', kind: 'accelerator', title: _('Record a bug') }],
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
          { key: 'history-retention-days', kind: 'spin', title: _('Keep history for'), subtitle: _('Days (31 by default).'), lower: 1, upper: 3650 },
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

/** The settings surface the rule editor needs (GSettings in the Shell). */
interface RuleSettings {
  get_string(key: string): string;
  set_string(key: string, value: string): void;
}

/** JSON-safe record test for the raw rule entries the editor preserves. */
function isRuleRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ruleString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The appId a raw rule matches, or '' when it matches any app. */
function ruleAppId(raw: unknown): string {
  if (!isRuleRecord(raw) || !isRuleRecord(raw.match)) return '';
  return ruleString(raw.match.appId);
}

function ruleTitle(raw: unknown): string {
  if (!isRuleRecord(raw)) return _('Invalid rule');
  const appId = ruleAppId(raw);
  if (appId.length > 0 && appId !== '*') return appId;
  const title = isRuleRecord(raw.match) ? ruleString(raw.match.title) : '';
  if (title.length > 0) return title;
  return _('Any application');
}

function ruleSummary(raw: unknown): string {
  if (!isRuleRecord(raw)) return _('Not a rule object');
  const tile = ruleString(raw.tile);
  const action = tile === 'left-half' ? _('Left half') : tile === 'right-half' ? _('Right half') : tile === 'float' ? _('Float') : _('Full');
  const title = isRuleRecord(raw.match) ? ruleString(raw.match.title) : '';
  const titlePart = title.length > 0 ? `, ${_('title')} “${title}”` : '';
  const disabled = raw.enabled === false ? ` · ${_('disabled')}` : '';
  return `${action}${titlePart}${disabled}`;
}

/** Inline validation: every problem, never a silent drop (§23 decision 91). */
function ruleErrors(raw: unknown, index: number): string[] {
  const errors: string[] = [];
  validateRule(raw, `rule[${index}]`, errors);
  return errors;
}

/** A human-readable message for a thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Minimal shape guard for an imported registry file (`version` + `entries`). */
function isRegistryData(value: unknown): value is AppRegistryData {
  return isRuleRecord(value) && typeof value.version === 'number' && Array.isArray(value.entries);
}

/** The result of folding an imported registry into the current one. */
interface MergeResult {
  data: AppRegistryData;
  /** App ids not present locally, i.e. the entries adopted from the file. */
  added: number;
}

/** Await an `Adw.AlertDialog`, resolving with the chosen response id. */
function chooseDialog(dialog: AdwAlertDialog, parent: GtkWindow | null): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    dialog.choose(parent, null, (_source: AdwAlertDialog, result: GioAsyncResult) => {
      try {
        resolve(dialog.choose_finish(result));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** Await a `Gtk.FileDialog` save, resolving with the chosen file. */
function saveFileDialog(dialog: GtkFileDialog, parent: GtkWindow | null): Promise<GioFile> {
  return new Promise<GioFile>((resolve, reject) => {
    dialog.save(parent, null, (_source: GtkFileDialog, result: GioAsyncResult) => {
      try {
        resolve(dialog.save_finish(result));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** Await a `Gtk.FileDialog` open, resolving with the chosen file. */
function openFileDialog(dialog: GtkFileDialog, parent: GtkWindow | null): Promise<GioFile> {
  return new Promise<GioFile>((resolve, reject) => {
    dialog.open(parent, null, (_source: GtkFileDialog, result: GioAsyncResult) => {
      try {
        resolve(dialog.open_finish(result));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export default class AdrtPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: AdwPreferencesWindow): void {
    loadTranslations();
    const settings: GioSettings = this.getSettings();
    const pages = new Map<string, AdwPreferencesPage>();
    for (const spec of PREFERENCES_LAYOUT) {
      const page = this.buildPage(settings, spec);
      pages.set(spec.title, page);
      window.add(page);
    }
    // The rule editor is not a settings row, but lives on the Rules page.
    pages.get(_('Rules'))?.add(this.rulesEditorGroup(settings));
    window.add(this.appsPage(settings, window));
    window.add(this.aboutPage(settings));
  }

  /** Build one page, its groups and its rows from the declarative layout. */
  private buildPage(settings: GioSettings, spec: PageSpec): AdwPreferencesPage {
    const page: AdwPreferencesPage = new Adw.PreferencesPage({ title: spec.title, icon_name: spec.icon });
    for (const groupSpec of spec.groups) {
      const group: AdwPreferencesGroup = new Adw.PreferencesGroup({ title: groupSpec.title });
      if (groupSpec.description) group.description = groupSpec.description;
      for (const rowSpec of groupSpec.rows) group.add(this.buildRow(settings, rowSpec));
      page.add(group);
    }
    return page;
  }

  /** Build a single row, tagged with its settings key for introspection. */
  private buildRow(settings: GioSettings, spec: RowSpec): AdwPreferencesRow {
    const row = this.rowFor(settings, spec);
    // Test hook: A140 reads this to prove every user-facing key has one row.
    row.adrtKey = spec.key;
    return row;
  }

  private rowFor(settings: GioSettings, spec: RowSpec): AdwPreferencesRow {
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
  private appPickerRow(spec: RowSpec, getSelected: () => string[], setSelected: (ids: string[]) => void): AdwExpanderRow {
    const row: AdwExpanderRow = new Adw.ExpanderRow({ title: spec.title });
    if (spec.subtitle) row.subtitle = spec.subtitle;
    // Test hook: A140 asserts a picker is used for the app-list keys.
    row.adrtPicker = true;
    const choices = appChoices();
    const byId = new Map(choices.map((choice) => [choice.id, choice]));
    const selectionRows: AdwActionRow[] = [];
    let addRow: AdwActionRow | null = null;

    const rebuild = (): void => {
      const selected = getSelected();
      for (const child of selectionRows) row.remove(child);
      selectionRows.length = 0;
      if (addRow !== null) row.remove(addRow);
      for (const id of selected) {
        const choice = byId.get(id);
        const child: AdwActionRow = new Adw.ActionRow({ title: choice?.name ?? id, subtitle: id });
        if (choice?.icon) child.add_prefix(new Gtk.Image({ gicon: choice.icon, pixel_size: 16 }));
        const remove: GtkButton = new Gtk.Button({ icon_name: 'list-remove-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Remove') });
        remove.add_css_class('flat');
        remove.connect('clicked', () => {
          setSelected(getSelected().filter((value) => value !== id));
          rebuild();
        });
        child.add_suffix(remove);
        row.add_row(child);
        selectionRows.push(child);
      }
      const addApplicationRow: AdwActionRow = new Adw.ActionRow({ title: _('Add application…') });
      addRow = addApplicationRow;
      const menu: GtkMenuButton = new Gtk.MenuButton({ icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Add application') });
      menu.add_css_class('flat');
      menu.popover = this.buildAppPopover(byId, getSelected, (id) => {
        const selected = getSelected();
        setSelected(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
        rebuild();
      });
      addApplicationRow.add_suffix(menu);
      row.add_row(addApplicationRow);
    };

    rebuild();
    return row;
  }

  /** A searchable popover listing installed applications. */
  private buildAppPopover(byId: Map<string, AppChoice>, getSelected: () => string[], onToggle: (id: string) => void): GtkPopover {
    const popover: GtkPopover = new Gtk.Popover();
    const box: GtkBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6 });
    const search: GtkSearchEntry = new Gtk.SearchEntry({ placeholder_text: _('Search applications') });
    const list: GtkListBox = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
    list.add_css_class('boxed-list');
    const checks = new Map<string, GtkImage>();
    const byRow = new Map<GtkListBoxRow, string>();
    for (const choice of byId.values()) {
      const item: GtkListBoxRow = new Gtk.ListBoxRow();
      const line: GtkBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
      if (choice.icon) line.append(new Gtk.Image({ gicon: choice.icon, pixel_size: 16 }));
      line.append(new Gtk.Label({ label: choice.name, xalign: 0, hexpand: true }));
      const check: GtkImage = new Gtk.Image({ icon_name: 'object-select-symbolic' });
      line.append(check);
      item.set_child(line);
      byRow.set(item, choice.id);
      checks.set(choice.id, check);
      list.append(item);
    }
    list.connect('row-activated', (_list: GtkListBox, item: GtkListBoxRow) => {
      const id = byRow.get(item);
      if (id !== undefined) onToggle(id);
    });
    const syncChecks = (): void => {
      const selected = new Set(getSelected());
      for (const [id, check] of checks) check.visible = selected.has(id);
    };
    search.connect('search-changed', () => {
      const query = search.text.trim().toLowerCase();
      list.set_filter_func((item: GtkListBoxRow) => {
        if (query.length === 0) return true;
        const child = item.get_child();
        const labels = child ? child.get_children().filter((c: GtkWidget): c is GtkLabel => c instanceof Gtk.Label) : [];
        const text: string = labels.map((c) => c.label ?? '').join(' ').toLowerCase();
        return text.includes(query);
      });
    });
    popover.connect('show', syncChecks);
    syncChecks();
    const scroller: GtkScrolledWindow = new Gtk.ScrolledWindow({ min_content_height: 260, min_content_width: 320, hscrollbar_policy: Gtk.PolicyType.NEVER });
    scroller.set_child(list);
    box.append(search);
    box.append(scroller);
    popover.set_child(box);
    return popover;
  }

  private switchRow(settings: GioSettings, spec: RowSpec): AdwSwitchRow {
    const row: AdwSwitchRow = new Adw.SwitchRow({ title: spec.title });
    if (spec.subtitle) row.subtitle = spec.subtitle;
    settings.bind(spec.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  private spinRow(settings: GioSettings, spec: RowSpec): AdwSpinRow {
    const row: AdwSpinRow = new Adw.SpinRow({
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

  private comboRow(settings: GioSettings, spec: RowSpec): AdwComboRow {
    const choices = spec.choices ?? [];
    const current = settings.get_string(spec.key);
    // Always keep the stored value selectable, even if it is off the list.
    const values = choices.includes(current) ? choices : [current, ...choices];
    const row: AdwComboRow = new Adw.ComboRow({ title: spec.title, model: Gtk.StringList.new(values) });
    const index = values.indexOf(current);
    row.selected = index < 0 ? 0 : index;
    row.connect('notify::selected', () => {
      settings.set_string(spec.key, values[row.selected]);
    });
    return row;
  }

  private acceleratorRow(settings: GioSettings, spec: RowSpec): AdwEntryRow {
    const row: AdwEntryRow = new Adw.EntryRow({ title: spec.title });
    row.text = (settings.get_strv(spec.key) ?? [])[0] ?? '';
    row.connect('changed', () => {
      const text = row.text.trim();
      settings.set_strv(spec.key, text.length > 0 ? [text] : []);
    });
    return row;
  }

  private entryRow(settings: GioSettings, spec: RowSpec): AdwEntryRow {
    const row: AdwEntryRow = new Adw.EntryRow({ title: spec.title });
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
  private keyIsStringArray(settings: GioSettings, key: string): boolean {
    try {
      const schema = settings.settings_schema;
      const valueType = schema.get_key(key).get_value_type();
      const name = typeof valueType.dup_string === 'function' ? valueType.dup_string() : String(valueType);
      return name.startsWith('a');
    } catch {
      return false;
    }
  }

  /**
   * The rules editor (§23 decisions 91-93): a rule list, one expandable row per
   * rule with an app picker, a title glob, the tile action chosen from a list, a
   * per-rule enable switch, reorder and remove, and inline validation. There is
   * no JSON textarea and no global switch.
   */
  private rulesEditorGroup(settings: RuleSettings): AdwPreferencesGroup {
    const group: AdwPreferencesGroup = new Adw.PreferencesGroup({
      title: _('Placement rules'),
      description: _(
        'Force a placement when a window matches, or leave it floating. The first enabled rule wins. For a durable per-app choice, use "Never tile these apps" on the Windows page.',
      ),
    });
    const list: GtkListBox = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
    list.add_css_class('boxed-list');
    // Test hook: A140 reads this to tell the rule editor from a plain row set.
    list.adrtRulesEditor = true;
    group.add(list);

    let entries: unknown[] = [];
    let parseError: string | null = null;
    const stored = settings.get_string('rules-json') ?? '[]';
    try {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) entries = parsed;
      else parseError = _('rules-json must be a JSON array.');
    } catch (error) {
      parseError = (error as Error).message;
    }

    const write = (): void => settings.set_string('rules-json', JSON.stringify(entries));
    const rawAt = (index: number): unknown => entries[index];
    const mutate = (index: number, next: unknown): void => {
      entries[index] = next;
      write();
    };

    const setMatchString = (index: number, field: string, value: string): void => {
      const raw = rawAt(index);
      if (!isRuleRecord(raw)) return;
      const match = isRuleRecord(raw.match) ? { ...raw.match } : {};
      if (value.length > 0) match[field] = value;
      else delete match[field];
      mutate(index, { ...raw, match });
    };
    const setTile = (index: number, tile: TileMode): void => {
      const raw = rawAt(index);
      if (!isRuleRecord(raw)) return;
      mutate(index, { ...raw, tile });
    };
    const setEnabled = (index: number, enabled: boolean): void => {
      const raw = rawAt(index);
      if (!isRuleRecord(raw)) return;
      const next = { ...raw };
      if (enabled) delete next.enabled;
      else next.enabled = false;
      mutate(index, next);
    };
    const move = (from: number, to: number): void => {
      if (to < 0 || to >= entries.length || from === to) return;
      const [moved] = entries.splice(from, 1);
      entries.splice(to, 0, moved);
      write();
      rebuild();
    };
    const remove = (index: number): void => {
      entries.splice(index, 1);
      write();
      rebuild();
    };
    const refresh = (index: number, row: AdwExpanderRow): void => {
      row.title = ruleTitle(rawAt(index));
      const errors = ruleErrors(rawAt(index), index);
      row.subtitle = errors.length > 0 ? errors.join('; ') : ruleSummary(rawAt(index));
    };

    const appPickerRow = (index: number, row: AdwExpanderRow): AdwActionRow => {
      const add: AdwActionRow = new Adw.ActionRow({ title: _('Application') });
      const choices = appChoices();
      const byId = new Map(choices.map((choice) => [choice.id, choice]));
      const update = (): void => {
        const id = ruleAppId(rawAt(index));
        const choice = byId.get(id);
        add.subtitle = id.length === 0 || id === '*' ? _('Any application') : choice ? `${choice.name} (${id})` : id;
      };
      const menu: GtkMenuButton = new Gtk.MenuButton({ icon_name: 'view-list-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Choose an application') });
      menu.add_css_class('flat');
      menu.popover = this.buildAppPopover(
        byId,
        () => {
          const id = ruleAppId(rawAt(index));
          return id.length > 0 && id !== '*' ? [id] : [];
        },
        (id) => {
          setMatchString(index, 'appId', ruleAppId(rawAt(index)) === id ? '' : id);
          update();
          refresh(index, row);
        },
      );
      add.add_suffix(menu);
      update();
      return add;
    };

    const buildRuleRow = (index: number): AdwExpanderRow => {
      const raw = rawAt(index);
      const row: AdwExpanderRow = new Adw.ExpanderRow({ title: ruleTitle(raw), subtitle: ruleSummary(raw) });
      if (ruleErrors(raw, index).length > 0) row.add_prefix(new Gtk.Image({ icon_name: 'dialog-warning-symbolic' }));

      const enable: GtkSwitch = new Gtk.Switch({ active: !(isRuleRecord(raw) && raw.enabled === false), valign: Gtk.Align.CENTER, tooltip_text: _('Enable this rule') });
      enable.connect('notify::active', () => {
        setEnabled(index, enable.active);
        refresh(index, row);
      });
      row.add_suffix(enable);

      for (const [icon, delta] of [
        ['go-up-symbolic', -1],
        ['go-down-symbolic', 1],
      ] as const) {
        const button: GtkButton = new Gtk.Button({ icon_name: icon, valign: Gtk.Align.CENTER, tooltip_text: delta < 0 ? _('Move up') : _('Move down') });
        button.add_css_class('flat');
        button.connect('clicked', () => move(index, index + delta));
        row.add_suffix(button);
      }

      const removeButton: GtkButton = new Gtk.Button({ icon_name: 'list-remove-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Remove') });
      removeButton.add_css_class('flat');
      removeButton.connect('clicked', () => remove(index));
      row.add_suffix(removeButton);

      if (isRuleRecord(raw)) {
        row.add_row(appPickerRow(index, row));
        const titleRow: AdwEntryRow = new Adw.EntryRow({ title: _('Title glob') });
        titleRow.tooltip_text = _(
          'A glob matched case-insensitively against the window title: * matches any run of characters, ? exactly one. Every filled field must match (AND).',
        );
        titleRow.text = isRuleRecord(raw.match) ? ruleString(raw.match.title) : '';
        titleRow.connect('changed', () => {
          setMatchString(index, 'title', titleRow.text.trim());
          refresh(index, row);
        });
        row.add_row(titleRow);

        const modes = [...TILE_MODES];
        const combo: AdwComboRow = new Adw.ComboRow({
          title: _('Action'),
          model: Gtk.StringList.new(modes.map((mode) => TILE_MODE_LABELS[mode])),
        });
        const current = modes.indexOf(ruleString(raw.tile) as TileMode);
        combo.selected = current < 0 ? 0 : current;
        combo.connect('notify::selected', () => {
          const mode = modes[combo.selected];
          if (mode !== undefined) {
            setTile(index, mode);
            refresh(index, row);
          }
        });
        row.add_row(combo);
      }
      return row;
    };

    const addRow = (): AdwActionRow => {
      const row: AdwActionRow = new Adw.ActionRow({ title: _('Add rule') });
      const button: GtkButton = new Gtk.Button({ icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Add rule') });
      button.add_css_class('flat');
      button.connect('clicked', () => {
        // A new row starts disabled: one click must not install a catch-all
        // `full` rule that silently turns every pair into a stacked window.
        // The user picks an app/title and flips the switch when it is ready.
        entries.push({ match: { appId: '*' }, tile: 'full', enabled: false });
        write();
        rebuild();
      });
      row.add_suffix(button);
      return row;
    };

    const rebuild = (): void => {
      list.remove_all();
      if (parseError !== null) {
        const warn: AdwActionRow = new Adw.ActionRow({ title: _('The stored rules are not valid JSON'), subtitle: parseError });
        const discard: GtkButton = new Gtk.Button({ label: _('Start over'), valign: Gtk.Align.CENTER });
        discard.connect('clicked', () => {
          entries = [];
          parseError = null;
          write();
          rebuild();
        });
        warn.add_suffix(discard);
        list.append(warn);
        return;
      }
      if (entries.length === 0) {
        list.append(new Adw.ActionRow({ title: _('No rules yet'), subtitle: _('Add a rule to force a window placement.') }));
      }
      entries.forEach((_entry, index) => list.append(buildRuleRow(index)));
      list.append(addRow());
    };

    rebuild();
    return group;
  }

  /**
   * §12: the app registry page. It replaces the old problem-windows page: one
   * row per app adrt has seen, a durable `neverTile` switch, and a forget
   * button that drops the entry (and returns live windows to the tiling).
   * Bulk actions below the list clear, export or import the whole registry.
   * Every mutation bumps `registry-revision`, which reloads the running Shell.
   */
  private appsPage(settings: GioSettings, window: AdwPreferencesWindow): AdwPreferencesPage {
    const page: AdwPreferencesPage = new Adw.PreferencesPage({ title: _('Apps'), icon_name: 'view-app-grid-symbolic' });
    const group: AdwPreferencesGroup = new Adw.PreferencesGroup({
      title: _('App registry'),
      description: _(
        'Every app adrt has seen. Turn on "Never tile" to keep an app floating. Changes reload the running Shell immediately.',
      ),
    });
    page.add(group);

    const store = new RegistryStore();
    store.load();
    const known = new Map(appChoices().map((choice) => [choice.id, choice]));
    const bumpRegistry = (): void => {
      settings.set_int('registry-revision', settings.get_int('registry-revision') + 1);
    };

    // The app rows are rebuilt whenever the registry changes, so they live in
    // one removable list; the action rows below are static.
    let rows: AdwPreferencesRow[] = [];
    const rebuild = (): void => {
      for (const row of rows) group.remove(row);
      rows = [];
      const entries = store.entries().sort((a, b) => b.lastSeen - a.lastSeen);
      if (entries.length === 0) {
        const empty: AdwActionRow = new Adw.ActionRow({ title: _('No apps recorded yet'), subtitle: _('Apps appear here as they are opened.') });
        group.add(empty);
        rows.push(empty);
        return;
      }
      for (const entry of entries) {
        const choice = known.get(entry.appId);
        const row: AdwSwitchRow = new Adw.SwitchRow({ title: choice?.name ?? entry.appId, subtitle: choice ? `${entry.appId} — ${entry.windowsSeen} window(s) seen` : `${entry.windowsSeen} window(s) seen` });
        if (choice?.icon) row.add_prefix(new Gtk.Image({ gicon: choice.icon, pixel_size: 16 }));
        row.active = entry.neverTile;
        row.connect('notify::active', () => {
          store.setNeverTile(entry.appId, row.active);
          store.flush();
          bumpRegistry();
        });
        const button: GtkButton = new Gtk.Button({ icon_name: 'user-trash-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Forget this app') });
        button.connect('clicked', () => {
          store.forget(entry.appId);
          store.flush();
          bumpRegistry();
          rebuild();
        });
        row.add_suffix(button);
        group.add(row);
        rows.push(row);
      }
    };

    const actions: AdwPreferencesGroup = new Adw.PreferencesGroup({
      title: _('Registry data'),
      description: _('Back up, restore or reset the app registry.'),
    });

    const clearRow: AdwActionRow = new Adw.ActionRow({ title: _('Clear all'), subtitle: _('Forget every app adrt has recorded.') });
    const clearButton: GtkButton = new Gtk.Button({ label: _('Clear all'), valign: Gtk.Align.CENTER });
    clearButton.add_css_class('flat');
    clearButton.connect('clicked', () => {
      void this.clearRegistry(store, window, () => {
        bumpRegistry();
        rebuild();
      });
    });
    clearRow.add_suffix(clearButton);
    actions.add(clearRow);

    const exportRow: AdwActionRow = new Adw.ActionRow({ title: _('Export…'), subtitle: _('Save the registry to a JSON file.') });
    const exportButton: GtkButton = new Gtk.Button({ label: _('Export'), valign: Gtk.Align.CENTER });
    exportButton.add_css_class('flat');
    exportButton.connect('clicked', () => {
      void this.exportRegistry(store, window, exportRow);
    });
    exportRow.add_suffix(exportButton);
    actions.add(exportRow);

    const importRow: AdwActionRow = new Adw.ActionRow({ title: _('Import…'), subtitle: _('Load a previously exported registry.') });
    const importButton: GtkButton = new Gtk.Button({ label: _('Import'), valign: Gtk.Align.CENTER });
    importButton.add_css_class('flat');
    importButton.connect('clicked', () => {
      void this.importRegistry(store, window, importRow, () => {
        store.flush();
        bumpRegistry();
        rebuild();
      });
    });
    importRow.add_suffix(importButton);
    actions.add(importRow);

    page.add(actions);
    rebuild();
    return page;
  }

  /**
   * §12: Clear all forgets every app, so confirm it first. The dialog is built
   * on demand — constructing widgets at page-build time would run while the
   * prefs module is built headlessly. Cancel is the default and the close
   * response, so Escape or dismissing never clears; only `clear` does.
   */
  private async clearRegistry(store: RegistryStore, window: AdwPreferencesWindow, onCleared: () => void): Promise<void> {
    const dialog: AdwAlertDialog = new Adw.AlertDialog();
    dialog.set_heading(_('Clear the app registry?'));
    dialog.set_body(_("Clearing forgets every app's Never-tile choice, learned placements and timing adaptation."));
    dialog.add_response('cancel', _('Cancel'));
    dialog.add_response('clear', _('Clear all'));
    dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_default_response('cancel');
    dialog.set_close_response('cancel');
    let response: string;
    try {
      response = await chooseDialog(dialog, window);
    } catch {
      return;
    }
    if (response !== 'clear') return;
    for (const entry of store.entries()) store.forget(entry.appId);
    store.flush();
    onCleared();
  }

  /** Save the registry to a user-chosen file; any failure lands on the row. */
  private async exportRegistry(store: RegistryStore, window: AdwPreferencesWindow, row: AdwActionRow): Promise<void> {
    row.subtitle = '';
    const dialog: GtkFileDialog = new Gtk.FileDialog();
    dialog.set_title(_('Export the app registry'));
    dialog.set_initial_name('adrt-registry.json');
    let file: GioFile;
    try {
      file = await saveFileDialog(dialog, window);
    } catch {
      // A dismissed dialog rejects too; there is nothing to report.
      return;
    }
    try {
      // The Shell may have saved entries since this page was built; reload so
      // the export is fresh. `load()` keeps a newer-format file untouched, so
      // this can never downgrade what is on disk.
      store.load();
      const bytes: Uint8Array = new TextEncoder().encode(JSON.stringify(store.toJSON(), null, 2));
      const [ok] = file.replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
      if (!ok) throw new Error(_('Could not write the registry file.'));
      row.subtitle = _('Registry exported.');
    } catch (error) {
      row.subtitle = errorMessage(error);
    }
  }

  /**
   * Adopt a user-chosen registry file; any failure lands on the row. A file
   * from a newer schema is refused outright — it is never adopted or flushed.
   * A valid file is imported either by replacing the registry or by merging it
   * in, after the user chooses.
   */
  private async importRegistry(
    store: RegistryStore,
    window: AdwPreferencesWindow,
    row: AdwActionRow,
    onImported: () => void,
  ): Promise<void> {
    row.subtitle = '';
    const dialog: GtkFileDialog = new Gtk.FileDialog();
    dialog.set_title(_('Import an app registry'));
    let file: GioFile;
    try {
      file = await openFileDialog(dialog, window);
    } catch {
      return;
    }
    try {
      const [ok, contents] = file.load_contents(null);
      if (!ok) throw new Error(_('Could not read the registry file.'));
      const parsed: unknown = JSON.parse(new TextDecoder().decode(contents));
      if (!isRegistryData(parsed)) throw new Error(_('That file is not an adrt app-registry export.'));
      // `fromJSON` silently returns an empty registry for a newer version; name
      // the real cause instead, and never adopt or flush the file.
      if (parsed.version > REGISTRY_VERSION) throw new Error(_('That file was written by a newer version of adrt.'));
      const validated: AppRegistry = AppRegistry.fromJSON(parsed, { ttlMs: DEFAULT_TTL_MS });
      if (validated.size === 0 && parsed.entries.length > 0) throw new Error(_('That file has no usable app entries.'));
      const mode = await this.chooseImportMode(window);
      if (mode === null) return;
      let adopted: number;
      if (mode === 'replace') {
        store.adopt(parsed);
        adopted = validated.size;
      } else {
        // Reload so entries the Shell saved since this page was built are not
        // overwritten by the flush after `adopt`; `load()` keeps a
        // newer-format file untouched, same as the export path.
        store.load();
        const merged = this.mergedRegistry(store.toJSON(), validated);
        store.adopt(merged.data);
        adopted = merged.added;
      }
      row.subtitle = _('Imported %d apps.').replace('%d', String(adopted));
      onImported();
    } catch (error) {
      row.subtitle = errorMessage(error);
    }
  }

  /**
   * Ask how to import: replace the whole registry or merge into it. Built on
   * demand, like the clear confirmation. Cancel, Escape or dismissing aborts.
   * Merge is the default so a stray Enter cannot discard the current registry.
   */
  private async chooseImportMode(window: AdwPreferencesWindow): Promise<'replace' | 'merge' | null> {
    const dialog: AdwAlertDialog = new Adw.AlertDialog();
    dialog.set_heading(_('Import the app registry'));
    dialog.set_body(
      _(
        'Existing apps keep their data; Never-tile is kept if either side has it; new apps are added. Replace discards the current registry instead.',
      ),
    );
    dialog.add_response('cancel', _('Cancel'));
    dialog.add_response('replace', _('Replace'));
    dialog.add_response('merge', _('Merge'));
    dialog.set_response_appearance('replace', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_default_response('merge');
    dialog.set_close_response('cancel');
    let response: string;
    try {
      response = await chooseDialog(dialog, window);
    } catch {
      return null;
    }
    if (response === 'replace') return 'replace';
    if (response === 'merge') return 'merge';
    return null;
  }

  /**
   * §12 merge rule: union by `appId`. An app already in the local registry
   * keeps its entry — never silently un-float it — and only its `neverTile` is
   * ORed with the imported one. An app that is new locally adopts the imported
   * entry. The result is one `AppRegistryData`, handed to `adopt` so the write
   * is a single flush.
   */
  private mergedRegistry(current: AppRegistryData, imported: AppRegistry): MergeResult {
    const importedEntries = imported.entries();
    const incoming = new Map<string, AppEntry>();
    for (const entry of importedEntries) incoming.set(entry.appId, entry);
    const local = new Set<string>();
    const entries: AppEntry[] = [];
    for (const entry of current.entries) {
      local.add(entry.appId);
      const source = incoming.get(entry.appId);
      entries.push(source === undefined ? entry : { ...entry, neverTile: entry.neverTile || source.neverTile });
    }
    let added = 0;
    for (const entry of importedEntries) {
      if (local.has(entry.appId)) continue;
      entries.push(entry);
      added += 1;
    }
    return { data: { version: REGISTRY_VERSION, entries }, added };
  }

  private aboutPage(settings: GioSettings): AdwPreferencesPage {
    const page: AdwPreferencesPage = new Adw.PreferencesPage({ title: _('About'), icon_name: 'help-about-symbolic' });
    const group: AdwPreferencesGroup = new Adw.PreferencesGroup({ title: _('Adrt') });
    group.add(new Adw.ActionRow({ title: _('Version'), subtitle: this.metadata['version-name'] ?? '0.2.0' }));
    group.add(new Adw.ActionRow({ title: _('GNOME UUID'), subtitle: 'adrt@adrt.dev' }));
    const reset: AdwActionRow = new Adw.ActionRow({
      title: _('Show the first-run notification again'),
      subtitle: _('Displayed the first time adrt starts.'),
    });
    const button: GtkButton = new Gtk.Button({ label: _('Show'), valign: Gtk.Align.CENTER });
    button.connect('clicked', () => settings.set_boolean('first-run-complete', false));
    reset.add_suffix(button);
    group.add(reset);
    page.add(group);
    return page;
  }
}
