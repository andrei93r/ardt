#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A17 Config import: importing a bundle applies its settings.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
original="$(get_setting gaps-base)"

bundle="$(adrt_json ExportConfig | python3 -c 'import json,sys; b=json.load(sys.stdin); b["settings"]["gaps-base"]=24; print(json.dumps(b))')"
adrt ImportConfig "'$bundle'" false >/dev/null
wait_settled 20
sleep 1

# Verify via a fresh export.
exported="$(adrt_json ExportConfig | python3 -c 'import json,sys; print(json.load(sys.stdin)["settings"].get("gaps-base"))')"
assert_eq "gaps-base was imported" "24" "$exported"

set_setting gaps-base "$original"
sleep 1
summary
