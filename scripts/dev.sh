#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Primary development loop (§39.3): build, start a nested GNOME Shell, install
# and enable the extension, stream its journal, and clean up on Ctrl+C.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ADRT_STATE_DIR="${ADRT_STATE_DIR:-${XDG_RUNTIME_DIR:-/tmp}/adrt-nested}"
NESTED="$ROOT/scripts/nested-shell.sh"

cleanup() {
  echo
  echo "dev: stopping the nested Shell"
  bash "$NESTED" stop >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if [ -n "${GJS_ENABLE_PROFILER:-}" ]; then
  echo "dev: GJS_ENABLE_PROFILER is set"
fi

bash "$NESTED" reset
bash "$NESTED" start
bash "$NESTED" wait-adrt 40

echo "dev: nested Shell running; streaming [adrt] output (Ctrl+C to stop)"
bash "$NESTED" logs --follow | grep --line-buffered -E '\[adrt\]|adrt@|JS ERROR|CRITICAL' || true
