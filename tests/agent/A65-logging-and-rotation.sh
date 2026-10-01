#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A65 Diagnostics and log rotation: DumpState reports the running build, the
# history rotates by size instead of growing without limit, and rotated parts
# are pruned.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean

check_python "DumpState reports the running build" '
import json, sys
d = json.load(sys.stdin)
b = d.get("build") or {}
# The build reports the release version, a string such as 0.2.0, plus the
# install dir mtime; both must be present.
if not isinstance(b, dict) or not str(b.get("version", "")).strip() or int(b.get("dirMtimeMs", 0)) <= 0:
    print("build marker missing:", b); sys.exit(1)
print("build", b)
'

open_pair
ids=($(list_ids))
A="${ids[0]}"

# Rotate at a tiny size so the test does not need megabytes of log.
set_setting history-max-bytes 2048
B="${ids[1]}"
for i in $(seq 1 30); do
  # Each resize logs a split_resize line plus the retile it triggers.
  adrt SimulateResize "$A" "$B" 0.3 >/dev/null 2>&1 || true
  adrt SimulateResize "$A" "$B" 0.7 >/dev/null 2>&1 || true
done
sleep 1

base="$(history_file)"
dir="$(dirname "$base")"
parts="$(ls "$dir" 2>/dev/null | grep -cE '\.[0-9]+\.jsonl$' || true)"
if [ "${parts:-0}" -ge 1 ]; then
  pass "the log rotated into $parts part(s)"
else
  fail "no rotated history parts (dir: $(ls "$dir" 2>/dev/null | tr '\n' ' '))"
fi

basebytes="$(stat -c %s "$base" 2>/dev/null || echo 0)"
if [ "$basebytes" -le 8192 ]; then
  pass "the live part is bounded ($basebytes bytes)"
else
  fail "the live part grew to $basebytes bytes despite a 2048-byte cap"
fi

# No part may be absurd either.
huge="$(find "$dir" -name '*.jsonl' -size +1M 2>/dev/null | wc -l)"
if [ "$huge" = "0" ]; then
  pass "no oversized history part"
else
  fail "$huge history part(s) exceed 1 MiB"
fi

set_setting history-max-bytes 8388608
ensure_clean
summary
