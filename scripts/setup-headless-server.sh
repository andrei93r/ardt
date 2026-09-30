#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Prepare a freshly installed **Ubuntu server** (no display, no X, no logged-in
# desktop) as the development and test host for this extension.
#
# What it does:
#   1. verifies the distribution is new enough (GNOME Shell 50 needs Ubuntu 26.04;
#      24.04 ships GNOME 46 and has no `--virtual-monitor`/devkit support),
#   2. installs the runtime the headless native backend needs (no GPU required:
#      Mutter creates a surfaceless EGL context served by llvmpipe),
#   3. installs the tooling the harness uses (node, jq, ripgrep, ydotool optional),
#   4. creates a writable, isolated XDG tree + runtime dir for the tests,
#   5. warms the fontconfig cache (a cold cache produces noisy failures),
#   6. prints a ready-to-paste environment block and self-checks it.
#
# It is idempotent: running it twice is safe. It never reboots and never touches
# an existing desktop session.
#
# Usage:
#   sudo bash scripts/setup-headless-server.sh          # install packages, then self-check
#   sudo bash scripts/setup-headless-server.sh --check  # self-check only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

log()  { printf 'setup: %s\n' "$*"; }
warn() { printf 'setup: WARNING: %s\n' "$*" >&2; }
die()  { printf 'setup: ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- environment

if [ "$(id -u)" -eq 0 ]; then
  TARGET_USER="${SUDO_USER:-root}"
else
  TARGET_USER="$(id -un)"
fi
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
[ -n "$TARGET_HOME" ] || die "cannot resolve the home directory of $TARGET_USER"
# The harness only needs a writable tree; a dedicated one keeps tests from
# touching a real desktop profile if this machine later grows one.
ADRT_HOME="${ADRT_SERVER_HOME:-$TARGET_HOME/.local/share/adrt-server}"

# --------------------------------------------------------------- distro check

if [ "$CHECK_ONLY" -eq 0 ]; then
  [ -r /etc/os-release ] || die "cannot read /etc/os-release"
  # shellcheck disable=SC1091
  . /etc/os-release
  log "detected ${PRETTY_NAME:-unknown Linux}"
  case "${VERSION_ID:-}" in
    26.04 | 25.10 | 25.04) ;;
    *)
      warn "GNOME Shell 50 needs Ubuntu 25.10+/26.04. On 24.04 (GNOME 46) the"
      warn "headless backend has no --virtual-monitor and Mutter has no devkit,"
      warn "so the monitor matrix cannot run. Continuing anyway."
      ;;
  esac

  # ------------------------------------------------------------- apt packages

  # Runtime the headless native backend needs. There is deliberately no GPU
  # package and no X server: --headless renders through EGL_MESA_platform_surfaceless
  # with llvmpipe, so `libegl-mesa0` + `libgl1-mesa-dri` are the requirement.
  PKGS_RUNTIME=(
    gnome-shell              # the shell itself (pulls gjs, libmutter, schemas)
    gjs                      # the JS engine the extension runs on
    dbus-daemon              # dbus-run-session, one private bus per test worker
    libglib2.0-bin           # gsettings, glib-compile-schemas
    gsettings-desktop-schemas
    libegl-mesa0 libgl1-mesa-dri   # software GL (llvmpipe) for surfaceless EGL
    polkitd gir1.2-polkit-1.0      # the shell warns without a polkit authority
    fonts-dejavu-core        # text metrics; an empty font cache breaks layout
  )
  # Tooling: node for the pure-core suite, jq/rg because the scenarios use them,
  # and the optional bits the live suite can use if a seat exists.
  PKGS_TOOLING=(
    nodejs npm
    jq ripgrep python3
    mutter-common-bin        # gdctl: set monitor geometry/rotation/primary at runtime
    mesa-utils               # eglinfo/glxinfo for diagnosing software GL
    gir1.2-mutter-18         # Meta typelib, useful for ad-hoc GJS probes
  )
  PKGS_OPTIONAL=(
    mutter-dev-bin           # mutter-devkit viewer (only needed for input injection)
    libei1                   # RemoteDesktop ConnectToEIS, for synthetic input
    gnome-remote-desktop     # a "real" headless session over RDP, if ever wanted
    ydotool                  # only works with a native seat (not headless)
  )

  log "installing runtime packages"
  apt-get update -qq
  # shellcheck disable=SC2086
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${PKGS_RUNTIME[@]}"
  log "installing tooling"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${PKGS_TOOLING[@]}"
  log "installing optional packages (failures are tolerated)"
  for pkg in "${PKGS_OPTIONAL[@]}"; do
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$pkg" || warn "optional package $pkg unavailable"
  done
fi

# ------------------------------------------------------------ environment tree

log "preparing the isolated XDG tree at $ADRT_HOME"
install -d -m 0755 -o "$TARGET_USER" "$ADRT_HOME"
for sub in data config cache state runtime; do
  install -d -m 0755 -o "$TARGET_USER" "$ADRT_HOME/$sub"
done
chmod 700 "$ADRT_HOME/runtime"

if [ "$CHECK_ONLY" -eq 0 ]; then
  log "warming the font cache"
  font_dirs=()
  for d in "$ADRT_HOME/fonts" /usr/share/fonts /usr/local/share/fonts; do
    [ -d "$d" ] && font_dirs+=("$d")
  done
  # A server has no fontconfig cache; building one removes a whole class of
  # noisy, hard-to-read failures in text-heavy apps.
  if command -v fc-cache >/dev/null 2>&1; then
    fc-cache -f >/dev/null 2>&1 || warn "fc-cache failed (fonts may be missing)"
  else
    warn "fontconfig is not installed; text metrics may be inaccurate"
  fi
fi

ENV_BLOCK="# Adrt headless test environment — paste into your shell or CI job
export ADRT_STATE_DIR=$ADRT_HOME
export ADRT_MONITORS=${ADRT_MONITORS:-1280x800}
export ADRT_SOFTWARE_GL=1
export ADRT_DEVKIT=0
export ADRT_START_TIMEOUT_S=${ADRT_START_TIMEOUT_S:-120}
export XDG_RUNTIME_DIR=$ADRT_HOME/runtime
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
export MESA_LOADER_DRIVER_OVERRIDE=llvmpipe

# Development: one nested shell with the monitor matrix, then the suites.
#   ADRT_MONITORS='2560x1440@60:1440x2560@60' bash scripts/nested-shell.sh start
#   bash scripts/agent-test.sh              # nested scenarios, sharded
#   bash scripts/session-test.sh            # live scenarios (see note below)
#
# Note: the *live* suite (S*) assumes a real session and key injection. On a
# headless server there is no seat, so ydotool cannot work; run it against this
# machine's headless shell only for the scenarios that do not inject keys, or
# run it on a machine with a seat. The nested suite is the primary gate."

ENV_FILE="$ADRT_HOME/env.sh"
printf '%s\n' "$ENV_BLOCK" > "$ENV_FILE"
chown "$TARGET_USER" "$ENV_FILE"
log "wrote $ENV_FILE"

# ------------------------------------------------------------------ self-check

failures=0
check() {
  local label="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "1" ]; then
    printf '  ok   %s\n' "$label"
  else
    printf '  FAIL %s%s\n' "$label" "${detail:+ — $detail}"
    failures=$((failures + 1))
  fi
}

log "self-check"
shell_version="$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
check "gnome-shell present (found: ${shell_version:-none})" "$([ -n "${shell_version:-}" ] && echo 1 || echo 0)"
check "gnome-shell is 48+" "$([ -n "${shell_version:-}" ] && [ "$shell_version" -ge 48 ] 2>/dev/null && echo 1 || echo 0)"
check "dbus-run-session present" "$(command -v dbus-run-session >/dev/null 2>&1 && echo 1 || echo 0)"
check "gsettings present" "$(command -v gsettings >/dev/null 2>&1 && echo 1 || echo 0)"
check "glib-compile-schemas present" "$(command -v glib-compile-schemas >/dev/null 2>&1 && echo 1 || echo 0)"
check "software EGL available (libEGL_mesa)" "$(ldconfig -p 2>/dev/null | grep -q 'libEGL_mesa' && echo 1 || echo 0)"
check "llvmpipe present (swrast/llvmpipe dri)" "$(ls /usr/lib/x86_64-linux-gnu/dri/ 2>/dev/null | grep -qE 'swrast|llvmpipe' && echo 1 || echo 0)"
check "no GPU required: /dev/dri absent is fine" "$([ -d /dev/dri ] && echo 1 || echo 1)"
check "node present" "$(command -v node >/dev/null 2>&1 && echo 1 || echo 0)"
check "python3 present" "$(command -v python3 >/dev/null 2>&1 && echo 1 || echo 0)"
check "runtime dir writable" "$([ -w "$ADRT_HOME/runtime" ] && echo 1 || echo 0)"
check "virtual monitors supported (--virtual-monitor in --help)" \
  "$(gnome-shell --help 2>&1 | grep -q -- '--virtual-monitor' && echo 1 || echo 0)" \
  "GNOME 46/47 lacks it; 48+ has it"
check "gdctl available (runtime monitor control)" "$(command -v gdctl >/dev/null 2>&1 && echo 1 || echo 0)"
check "headless run works" "$("$ROOT/scripts/nested-shell.sh" start >/dev/null 2>&1 && echo 1 || echo 0)" \
  "set ADRT_STATE_DIR/ADRT_MONITORS before checking, see $ENV_FILE"

if [ "$failures" -eq 0 ]; then
  log "all checks passed"
  printf '\n%s\n' "$ENV_BLOCK"
  exit 0
fi
warn "$failures check(s) failed"
printf '\n%s\n' "$ENV_BLOCK"
exit 1
