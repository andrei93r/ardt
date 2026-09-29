#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A16 Config export: ExportConfig returns a valid adrt.config bundle.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean

bundle="$(adrt_json ExportConfig)"
if echo "$bundle" | python3 -c '
import json, sys
b = json.load(sys.stdin)
assert b.get("format") == "adrt.config", b.get("format")
assert isinstance(b.get("version"), int)
assert "settings" in b and "tracked" in b
print("format", b["format"], "version", b["version"])
'; then pass "bundle is valid and versioned"; else fail "invalid bundle"; fi

summary
