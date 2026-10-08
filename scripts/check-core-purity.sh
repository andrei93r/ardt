#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Acceptance criteria §36.4 / §36.16: no compositor token and no legacy
# identifier may appear anywhere under src/core/ (or src/platform/).
set -euo pipefail

cd "$(dirname "$0")/.."

# A compositor token is only a token when a member follows it (`Shell.Widget`,
# `global.display`). Matching bare `Shell.` also hit prose that ends a sentence
# ("... without a Shell."), so comment-only lines are filtered too.
FORBIDDEN_SHELL='gi://|Meta\.[A-Za-z_$]|Shell\.[A-Za-z_$]|St\.[A-Za-z_$]|Clutter\.[A-Za-z_$]|global\.[A-Za-z_$]|Main\.[A-Za-z_$]'
FORBIDDEN_LEGACY='adr-auto-pos|AutoPos'

status=0

if grep -RInE "$FORBIDDEN_SHELL" src/core src/platform | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)'; then
  echo "check-core-purity: compositor tokens found in core/platform" >&2
  status=1
fi

if grep -RInE "$FORBIDDEN_LEGACY" src; then
  echo "check-core-purity: legacy identifier found" >&2
  status=1
fi

# §36.21: no KDE-specific code outside the documented platform comment.
if grep -RInE 'KWin|KPlugin|kwin' src | grep -v 'platform/host.ts'; then
  echo "check-core-purity: KDE-specific code found" >&2
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "check-core-purity: OK"
fi
exit "$status"
