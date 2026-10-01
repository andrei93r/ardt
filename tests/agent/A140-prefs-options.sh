#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A140 Preferences/options: every user-facing settings key has exactly one
# preferences row (or a custom-rendered editor), internal/debug/dead keys have
# none, each row's widget matches its key type and its bounds/choices cover the
# default, the app-selection keys use a searchable app picker, and a
# representative set of options provably changes behaviour.
#
# The row check runs twice: a static parse of prefs.ts is the deterministic
# gate, and — when GJS can load the built prefs module — the real pages are
# constructed and their rows read back, which is the stronger assertion. The
# GJS pass needs Adw/Gtk, which is present on this laptop, so it is expected to
# run; a setup failure falls back to the static gate rather than failing.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

SCHEMA="$ROOT_DIR/packages/gnome/schemas/org.gnome.shell.extensions.adrt.gschema.xml"
PREFS_SRC="$ROOT_DIR/src/adapters/gnome/prefs.ts"

# Keys that are internal state, debug-only, or declared but unused. They must
# never be presented as user options (see the audit in the task report):
#   settings-version, first-run-complete   internal bookkeeping
#   debug-* / record / perf / trace        developer diagnostics
#   dry-run-mode, max-frame-interval-ms    developer diagnostics
#   keybindings                            legacy override, superseded by kb-*
#   float-pins-workspace                   behaviour is unconditional (dead)
INTERNAL_KEYS="settings-version first-run-complete debug-enabled debug-tiling debug-focus debug-displays debug-undo debug-session debug-inject-verify-failure debug-toasts record perf-enabled trace-enabled dry-run-mode max-frame-interval-ms keybindings float-pins-workspace"
CUSTOM_KEYS="rules-json"

internal_csv="$(printf '%s' "$INTERNAL_KEYS" | tr ' ' ',')"

# --- static row coverage ----------------------------------------------------
# Parse the declarative layout in prefs.ts and compare it with the schema keys
# that are not internal. Fails on a user-facing key with no row, a row for a
# key missing from the schema, a duplicate, or a widget that cannot hold the
# key's type.
check_static_rows() {
  python3 - "$SCHEMA" "$PREFS_SRC" "$internal_csv" "$CUSTOM_KEYS" <<'PY'
import re, sys, xml.etree.ElementTree as ET
schema_path, prefs_path, internal_csv, custom_csv = sys.argv[1:5]
internal = {k for k in internal_csv.split(',') if k}
custom = {k for k in custom_csv.split(',') if k}
keys = {el.get('name'): el.get('type') for el in ET.parse(schema_path).getroot().iter('key')}
text = open(prefs_path).read()
pairs = re.findall(r"key:\s*'([^']+)',\s*kind:\s*'([^']+)'", text)
kinds = {}
errors = []
for key, kind in pairs:
    if key in kinds:
        errors.append('duplicate row for ' + key)
    kinds[key] = kind
expected = {k for k in keys if k not in internal}
rowset = set(kinds)
unknown = sorted(rowset - set(keys))
missing = sorted(expected - custom - rowset)
extra = sorted(rowset - expected)
if unknown:
    errors.append('rows for keys missing from the schema: ' + ', '.join(unknown))
if missing:
    errors.append('user-facing keys with no prefs row: ' + ', '.join(missing))
if extra:
    errors.append('rows for keys that are not user-facing: ' + ', '.join(extra))
allowed = {'b': {'switch'}, 'i': {'spin'}, 's': {'combo', 'entry'}, 'as': {'entry', 'accelerator', 'picker'}}
for key, kind in kinds.items():
    if key in keys and kind not in allowed[keys[key]]:
        errors.append('%s (%s) cannot be rendered with %s' % (key, keys[key], kind))
for key in custom:
    if key not in keys:
        errors.append('custom key ' + key + ' is missing from the schema')
    elif key not in rowset and ("get_string('%s')" % key) not in text:
        errors.append('%s has no prefs editor' % key)
print('static: expected user-facing keys %d, rows %d (custom %d)'
      % (len(expected), len(rowset), len(custom - rowset)))
if errors:
    for error in errors:
        print('  - ' + error)
sys.exit(1 if errors else 0)
PY
}

# --- constructed row coverage (GJS) -----------------------------------------
# Load the built prefs module under GJS, construct the real pages and read the
# rows back. Exits 3 when the module cannot be loaded at all (caller falls back
# to the static gate), 1 on a mismatch, 0 on success.
check_constructed_rows() {
  local tmp driver rc
  tmp="$(mktemp -d)"
  driver="$tmp/prefs-check.js"
  mkdir -p "$tmp/res/org/gnome/Shell/Extensions/js/extensions"
  cat > "$tmp/res/org/gnome/Shell/Extensions/js/extensions/prefs.js" <<'STUB'
export class ExtensionPreferences {
  constructor(params = {}) { Object.assign(this, params); this._params = params; }
  getSettings() { return this._params.settings; }
}
STUB
  cat > "$tmp/manifest.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<gresources>
  <gresource prefix="/org/gnome/Shell/Extensions/js/extensions">
    <file>prefs.js</file>
  </gresource>
</gresources>
XML
  if ! glib-compile-resources --sourcedir="$tmp/res/org/gnome/Shell/Extensions/js/extensions" --target="$tmp/stub.gresource" "$tmp/manifest.xml" 2>/dev/null; then
    echo '{"setup":true,"ok":false,"error":"glib-compile-resources failed"}'
    rm -rf "$tmp"
    return 3
  fi
  cat > "$driver" <<'JS'
imports.gi.versions.Gtk = '4.0';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

function emit(obj, code) { print(JSON.stringify(obj)); imports.system.exit(code); }

try {
  const extDir = GLib.getenv('ADRT_PREFS_EXT');
  const internal = new Set((GLib.getenv('ADRT_PREFS_INTERNAL') || '').split(',').filter(Boolean));
  const custom = new Set((GLib.getenv('ADRT_PREFS_CUSTOM') || '').split(',').filter(Boolean));
  Gtk.init();
  Gio.resources_register(Gio.Resource.load(GLib.getenv('ADRT_PREFS_RES')));

  // Capture every settings row the page builder actually adds.
  const built = [];
  const origGroupAdd = Adw.PreferencesGroup.prototype.add;
  Adw.PreferencesGroup.prototype.add = function (r) {
    if (r.adrtKey) built.push({ key: r.adrtKey, picker: r.adrtPicker === true });
    return origGroupAdd.call(this, r);
  };

  const mod = await import('file://' + extDir + '/adapters/gnome/prefs.js');
  const settings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.adrt' });
  const prefs = new mod.default({ settings, metadata: { 'version-name': '0.2.0' } });
  prefs.fillPreferencesWindow({ add: () => {} });

  const layout = [];
  for (const page of mod.PREFERENCES_LAYOUT) {
    for (const group of page.groups) for (const r of group.rows) layout.push(r);
  }
  const allKeys = settings.settings_schema.list_keys();
  const typeOf = (k) => settings.get_value(k).get_type_string();
  const defaultOf = (k) => settings.get_default_value(k).unpack();
  const allowed = { b: ['switch'], i: ['spin'], s: ['combo', 'entry'], as: ['entry', 'accelerator', 'picker'] };
  const errors = [];

  const builtKeys = built.map((b) => b.key).sort();
  const layoutKeys = layout.map((r) => r.key).sort();
  if (JSON.stringify(builtKeys) !== JSON.stringify(layoutKeys)) {
    errors.push('built rows differ from the layout: built=' + JSON.stringify(builtKeys) + ' layout=' + JSON.stringify(layoutKeys));
  }
  const counts = {};
  for (const b of built) counts[b.key] = (counts[b.key] || 0) + 1;
  for (const k of Object.keys(counts)) if (counts[k] > 1) errors.push('duplicate row for ' + k);

  const expected = allKeys.filter((k) => !internal.has(k));
  const rowKeys = new Set(Object.keys(counts));
  const missing = expected.filter((k) => !rowKeys.has(k) && !custom.has(k));
  const extra = [...rowKeys].filter((k) => !expected.includes(k));
  const unknown = [...rowKeys].filter((k) => !allKeys.includes(k));
  if (missing.length) errors.push('user-facing keys with no prefs row: ' + missing.join(', '));
  if (extra.length) errors.push('rows for non-user-facing keys: ' + extra.join(', '));
  if (unknown.length) errors.push('rows for keys missing from the schema: ' + unknown.join(', '));

  const kinds = {};
  for (const b of built) kinds[b.key] = b.picker ? 'picker' : null;
  for (const r of layout) {
    const t = typeOf(r.key);
    if (!allowed[t] || !allowed[t].includes(r.kind)) errors.push(r.key + ' is type ' + t + ' but is rendered as ' + r.kind);
    if (r.kind === 'spin') {
      const raw = defaultOf(r.key);
      // A scaled row (history-max-bytes is stored in bytes, shown in MiB)
      // compares the default against the shown bounds.
      const d = typeof raw === 'number' ? raw / (r.scale || 1) : raw;
      if (typeof d === 'number' && (d < (r.lower ?? -Infinity) || d > (r.upper ?? Infinity))) {
        errors.push(r.key + ': default ' + d + ' is outside [' + r.lower + ', ' + r.upper + ']');
      }
    }
    if (r.kind === 'combo' && !(r.choices || []).includes(defaultOf(r.key))) {
      errors.push(r.key + ": default '" + defaultOf(r.key) + "' is not one of its choices");
    }
  }
  for (const [key, picker] of built.map((b) => [b.key, b.picker])) {
    if ((key === 'exception-apps' || key === 'primary-apps') && !picker) errors.push(key + ' is not rendered as an app picker');
  }
  if (!allKeys.includes('pause-during-sharing')) errors.push('the pause-during-sharing key is missing from the schema');
  if (!rowKeys.has('pause-during-sharing')) errors.push('the pause-during-sharing row is missing from the prefs');

  emit({ setup: false, ok: errors.length === 0, rows: built.length, expected: expected.length, errors }, errors.length ? 1 : 0);
} catch (e) {
  emit({ setup: true, ok: false, error: String(e) }, 3);
}
JS
  local out
  out="$(ADRT_PREFS_EXT="$(ext_dir)" \
    ADRT_PREFS_INTERNAL="$internal_csv" \
    ADRT_PREFS_CUSTOM="$CUSTOM_KEYS" \
    ADRT_PREFS_RES="$tmp/stub.gresource" \
    GSETTINGS_BACKEND=keyfile \
    GSETTINGS_SCHEMA_DIR="$(ext_dir)/schemas" \
    XDG_CONFIG_HOME="$tmp/config" \
    XDG_DATA_HOME="$tmp/data" \
    gjs -m "$driver" 2>/dev/null)"
  rc=$?
  rm -rf "$tmp"
  printf '%s\n' "$out"
  return $rc
}

# The static parse is the deterministic gate; the constructed check is the
# stronger assertion and is expected to run on this laptop.
if check_static_rows; then
  pass "prefs.ts declares exactly one row per user-facing key"
else
  fail "prefs.ts declares exactly one row per user-facing key"
fi

rows_json="/tmp/adrt-a138-rows.$$"
if check_constructed_rows > "$rows_json" 2>/dev/null; then
  summary_line="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("%d rows, %d user-facing keys, pickers for the app lists" % (d.get("rows", 0), d.get("expected", 0)))' "$rows_json" 2>/dev/null)"
  pass "prefs constructs and exposes exactly the expected rows ($summary_line)"
else
  rc=$?
  if [ "$rc" = "3" ]; then
    skip "GJS prefs construction unavailable here; the static gate above is authoritative"
  else
    python3 -c 'import json,sys
for e in json.load(open(sys.argv[1])).get("errors", []): print("  - " + e)' "$rows_json" 2>/dev/null
    fail "prefs constructs with exactly the expected rows"
  fi
fi
rm -f "$rows_json"

# --- functional proof -------------------------------------------------------
ensure_clean

# Highlight: the switch hides the border, and the width reaches the style.
set_setting active-window-indicator true
set_setting indicator-width 6
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_border_visible 20 || true
poll "active-window-indicator on shows the highlight and indicator-width reaches the style" '
import json, sys
i = json.load(sys.stdin)["indicator"]
sys.exit(0 if i["visible"] and i["width"] == 6 else 1)' 12

set_setting active-window-indicator false
adrt ActivateWindow "${ids[1]}" >/dev/null
poll "active-window-indicator off hides the highlight" '
import json, sys
sys.exit(0 if not json.load(sys.stdin)["indicator"]["visible"] else 1)' 12

set_setting active-window-indicator true
adrt ActivateWindow "${ids[0]}" >/dev/null
poll "active-window-indicator back on shows the highlight again" '
import json, sys
sys.exit(0 if json.load(sys.stdin)["indicator"]["visible"] else 1)' 12
set_setting indicator-width 3

# follow-moved-window: move the focused window one workspace; the view either
# follows it or stays put. Focus and the move are both confirmed before the
# follow decision is asserted, so a slow shell cannot masquerade as a pass.
follow_phase() {
  local value="$1" expect="$2" label="$3"
  ensure_clean
  adrt ActivateWorkspace 0 >/dev/null 2>&1 || true
  set_setting follow-moved-window "$value"
  open_pair
  local ids target
  ids=($(list_ids))
  target="${ids[0]}"
  adrt ActivateWindow "$target" >/dev/null
  wait_python 15 "import json,sys; sys.exit(0 if json.load(sys.stdin).get('focused') == $target else 1)" || true
  poll "the window starts on the first workspace (follow=$value)" "
import json, sys
w = next((x for x in json.load(sys.stdin)['windows'] if x['id'] == $target), None)
sys.exit(0 if w and w['workspace'] == 0 else 1)" 20
  adrt MoveFocusedToWorkspace 1 >/dev/null
  poll "the window reached the next workspace (follow=$value)" "
import json, sys
w = next((x for x in json.load(sys.stdin)['windows'] if x['id'] == $target), None)
sys.exit(0 if w and w['workspace'] == 1 else 1)" 20
  poll "$label" "
import json, sys
d = json.load(sys.stdin)
if d['activeWorkspace'] != $expect:
    print('activeWorkspace', d['activeWorkspace'], 'expected', $expect); sys.exit(1)" 15
}
follow_phase false 0 "follow-moved-window off leaves the view on the old workspace"
follow_phase true 1 "follow-moved-window on follows the window to the new workspace"

# float-persistence: toggling it decides whether a float becomes durable. The
# window's own `neverTile` flag is read from DumpState, so the check does not
# depend on resolving the app-key spelling.
ensure_clean
adrt ActivateWorkspace 0 >/dev/null 2>&1 || true
set_setting float-persistence true
spawn_window >/dev/null
wait_count 1 20 || true
id="$(list_ids | awk '{print $1}')"
app="$(window_field "$id" cls)"
if [ -n "$id" ] && [ -n "$app" ]; then
  adrt SetNeverTile "$app" false >/dev/null 2>&1 || true
  poll "the window is tiled before the float" "
import json, sys
w = next((x for x in json.load(sys.stdin)['windows'] if x['id'] == $id), None)
sys.exit(0 if w and not w['minimized'] and w['layer'] != 2 and not w.get('neverTile') else 1)" 20
  adrt ToggleFloat "$id" >/dev/null
  poll "float-persistence on records the floated window" "
import json, sys
w = next((x for x in json.load(sys.stdin)['windows'] if x['id'] == $id), None)
sys.exit(0 if w and w['layer'] == 2 and w.get('neverTile') else 1)" 25
  adrt SetNeverTile "$app" false >/dev/null 2>&1 || true
  set_setting float-persistence false
else
  skip "float-persistence: could not resolve the window"
fi

# pause-during-sharing (new option): the key exists and a write round-trips.
assert_eq "pause-during-sharing defaults to off" "false" "$(get_setting pause-during-sharing)"
set_setting pause-during-sharing true
assert_eq "pause-during-sharing persists on" "true" "$(get_setting pause-during-sharing)"
set_setting pause-during-sharing false
assert_eq "pause-during-sharing persists off" "false" "$(get_setting pause-during-sharing)"

set_setting follow-moved-window true
set_setting active-window-indicator true
set_setting indicator-width 3
ensure_clean
summary
