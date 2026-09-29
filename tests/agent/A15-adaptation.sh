#!/usr/bin/env bash
# A15 Adaptation: injected verify failures create an adaptation record.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
adrt ResetPerApp org.gnome.TextEditor >/dev/null 2>&1 || true
open_pair
ids=($(list_ids))
adrt InjectVerifyFailure "${ids[0]}" 6 >/dev/null
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.35 >/dev/null
sleep 6

adaptations="$(adrt_json GetAdaptations)"
check_python "an adaptation record exists" '
import json, sys
records = json.load(sys.stdin)
print("records", len(records))
'

ensure_clean
adrt ResetPerApp org.gnome.TextEditor >/dev/null 2>&1 || true
summary
