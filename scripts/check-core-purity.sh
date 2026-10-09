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

# §36.4 / P6d: core is deterministic. Time, randomness and IO are inputs, never
# something `src/core/` reads for itself. Each check greps `src/core` only.

if grep -RInE 'Math\.random' src/core; then
  echo "check-core-purity: Math.random found in core (non-deterministic)" >&2
  status=1
fi

if grep -RInE 'readFileSync|writeFileSync|fetch\(|XMLHttpRequest' src/core; then
  echo "check-core-purity: IO call found in core (read/write/fetch/XMLHttpRequest)" >&2
  status=1
fi

# `new Date(0)` is the deterministic epoch literal. Strip it, then any `new
# Date(` left is a wall-clock read.
if grep -RInE 'new Date\(' src/core | sed -E 's/new Date\(0\)/<epoch>/g' | grep -E 'new Date\('; then
  echo "check-core-purity: new Date(...) clock read found in core (only new Date(0) is allowed)" >&2
  status=1
fi

# `Date.now` is allowed only at an injection seam: a parameter default
# (`= Date.now()`, optionally typed), an injected thunk (`=> Date.now()`) or the
# fallback of an injected value (`?? Date.now()`). Strip those seams; any
# `Date.now` left is a non-injected clock read.
if grep -RInE 'Date\.now' src/core \
     | sed -E \
       -e 's/(\(|,)[[:space:]]*(public +|private +|protected +|readonly +)*[A-Za-z_$][A-Za-z0-9_$]*(\??:[^=]*)?=[[:space:]]*Date\.now\(\)/<seam>/g' \
       -e 's/=>[[:space:]]*Date\.now\(\)/<seam>/g' \
       -e 's/\?\?[[:space:]]*Date\.now\(\)/<seam>/g' \
     | grep -E 'Date\.now'; then
  echo "check-core-purity: Date.now() clock read found in core (inject it as a parameter default or thunk)" >&2
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "check-core-purity: OK"
fi
exit "$status"
