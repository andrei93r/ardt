#!/usr/bin/env python3
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
"""Generate src/core/settings-descriptor.ts from the GSettings schema.

The descriptor is the machine-readable mirror of the schema: key, value type,
default, and (when the schema declares them) range bounds and enum choices. The
runtime never reads the XML; a checked-in descriptor plus
tests/core/settings-descriptor.test.ts, which re-parses the XML and compares,
is the drift gate.

Usage:
    python3 scripts/gen-settings-descriptor.py [schema.xml] [out.ts]
"""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SCHEMA = os.path.join(ROOT, "packages", "gnome", "schemas", "org.gnome.shell.extensions.adrt.gschema.xml")
DEFAULT_OUT = os.path.join(ROOT, "src", "core", "settings-descriptor.ts")

# GSettings type code -> descriptor type. `s` with a <choices> block is an enum.
TYPE_BY_GSETTINGS = {"b": "bool", "i": "int", "u": "uint", "s": "string", "as": "strv"}


def js_string(value: str) -> str:
    """A single-quoted JavaScript string literal."""
    escaped = value.replace("\\", "\\\\").replace("'", "\\'")
    return "'" + escaped + "'"


def js_default(gtype: str, text: str, choices: list[str]) -> str:
    """Render a schema default in the descriptor's JavaScript literal form."""
    text = text.strip()
    if gtype == "b":
        return "true" if text == "true" else "false"
    if gtype in ("i", "u"):
        return str(int(text))
    if gtype == "as":
        # GVariant array text, e.g. [] or ['<Super>z'].
        items = [js_string(part) for part in _variant_array_items(text)]
        return "[" + ", ".join(items) + "]"
    # `s` (and an enum, which is a constrained `s`): the default is a single
    # GVariant-quoted string.
    return js_string(_variant_string(text))


def _variant_string(text: str) -> str:
    text = text.strip()
    if len(text) >= 2 and text.startswith("'") and text.endswith("'"):
        text = text[1:-1]
    return text.replace("\\'", "'")


def _variant_array_items(text: str) -> list[str]:
    """The single-quoted strings inside a GVariant array literal."""
    text = text.strip()
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    items: list[str] = []
    current: list[str] = []
    in_quote = False
    escaped = False
    for char in text:
        if escaped:
            current.append(char)
            escaped = False
        elif char == "\\" and in_quote:
            escaped = True
        elif char == "'":
            if in_quote:
                items.append("".join(current))
                current = []
            in_quote = not in_quote
        elif in_quote:
            current.append(char)
    return items


def descriptor_type(gtype: str, choices: list[str]) -> str:
    if gtype == "s" and choices:
        return "enum"
    return TYPE_BY_GSETTINGS[gtype]


def parse_schema(path: str) -> list[dict[str, object]]:
    root = ET.parse(path).getroot()
    keys: list[dict[str, object]] = []
    for element in root.iter("key"):
        name = element.get("name")
        gtype = element.get("type")
        if name is None or gtype is None:
            raise SystemExit("schema key without name/type in " + path)
        default_el = element.find("default")
        if default_el is None or default_el.text is None:
            raise SystemExit("schema key without default: " + name)
        range_el = element.find("range")
        choices_el = element.find("choices")
        choices = (
            [choice.get("value", "") for choice in choices_el.findall("choice")] if choices_el is not None else []
        )
        entry: dict[str, object] = {
            "key": name,
            "type": descriptor_type(gtype, choices),
            "default": js_default(gtype, default_el.text, choices),
        }
        if range_el is not None and range_el.get("min") is not None and range_el.get("max") is not None:
            entry["min"] = int(range_el.get("min", "0"))
            entry["max"] = int(range_el.get("max", "0"))
        if choices:
            entry["choices"] = [js_string(choice) for choice in choices]
        keys.append(entry)
    return keys


def render(keys: list[dict[str, object]]) -> str:
    lines: list[str] = []
    for entry in keys:
        fields = ["key: " + js_string(str(entry["key"])), "type: " + js_string(str(entry["type"])), "default: " + str(entry["default"])]
        if "min" in entry:
            fields.append("min: " + str(entry["min"]))
        if "max" in entry:
            fields.append("max: " + str(entry["max"]))
        if "choices" in entry:
            fields.append("choices: [ " + ", ".join(str(choice) for choice in entry["choices"]) + " ]")
        lines.append("  { " + ", ".join(fields) + " },")
    body = "\n".join(lines)
    return f'''// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.
//
// Generated by scripts/gen-settings-descriptor.py from
// packages/gnome/schemas/org.gnome.shell.extensions.adrt.gschema.xml.
// Do not edit by hand: `npx vitest run tests/core` re-parses the schema and
// fails when this file drifts.

/**
 * Settings descriptor (backlog P6b): one machine-readable source for every
 * GSettings key the extension exposes. It mirrors the schema's key, value type
 * and default, plus the range bounds and enum choices when the schema declares
 * them (this schema declares none). The XML is the runtime truth; this module is
 * the tooling/type source, and tests/core/settings-descriptor.test.ts re-parses
 * the XML and fails when the two drift.
 */

/** A setting's value type, mapped from the GSettings type code. */
type SettingType = 'bool' | 'int' | 'uint' | 'string' | 'enum' | 'strv';

/** One GSettings key: its type, default and any declared bounds/choices. */
export interface SettingDescriptor {{
  /** The GSettings key. */
  readonly key: string;
  /** The mapped value type. */
  readonly type: SettingType;
  /** The schema default, in its unwrapped JavaScript form. */
  readonly default: boolean | number | string | readonly string[];
  /** Inclusive lower bound, when the schema declares a range. */
  readonly min?: number;
  /** Inclusive upper bound, when the schema declares a range. */
  readonly max?: number;
  /** The permitted values, when the schema declares choices. */
  readonly choices?: readonly string[];
}}

/** Every schema key, in declaration order. */
export const SETTINGS = [
{body}
] as const satisfies readonly SettingDescriptor[];

/** The union of every real settings key; adapters type their key fields with it. */
export type SettingKey = (typeof SETTINGS)[number]['key'];
'''


def main(argv: list[str]) -> int:
    schema = argv[1] if len(argv) > 1 else DEFAULT_SCHEMA
    out = argv[2] if len(argv) > 2 else DEFAULT_OUT
    keys = parse_schema(schema)
    with open(out, "w", encoding="utf8") as handle:
        handle.write(render(keys))
    print(f"wrote {out} ({len(keys)} keys)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
