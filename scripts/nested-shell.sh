#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Nested GNOME Shell controller (§42.3). Every command is idempotent and
# returns a clear exit code. No command prompts for input or needs a TTY.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="${ADRT_STATE_DIR:-${XDG_RUNTIME_DIR:-/tmp}/adrt-nested}"
UUID="adrt@adrt.dev"
SCHEMA="org.gnome.shell.extensions.adrt"

EXT_DIR="$STATE/data/gnome-shell/extensions/$UUID"
BUS_FILE="$STATE/bus"
PID_FILE="$STATE/shell.pid"
LOG_FILE="$STATE/shell.log"
WAYLAND_DISPLAY_NAME="${ADRT_WAYLAND_DISPLAY:-wayland-adrt-$(basename "$STATE")}"
# The runtime dir holds our Wayland socket and lockfile. It is *private to this
# state directory*, never the caller's XDG_RUNTIME_DIR: two nested runs that
# shared it would use the same socket name, and `cleanup_display_files` on the
# second start would delete the first run's live socket — which surfaces as
# flaky D-Bus, not as a collision. Keeping it beside the state also means an
# unclean kill (CI timeout, container restart) can be cleaned up: a stale
# `$WAYLAND_DISPLAY.lock` would otherwise make the next start fail with
# "Failed to create_socket".
RUNTIME_DIR="$STATE/runtime"
mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"

# Remove *our own* socket/lock files, never another compositor's.
cleanup_display_files() {
  rm -f "$RUNTIME_DIR/$WAYLAND_DISPLAY_NAME" "$RUNTIME_DIR/$WAYLAND_DISPLAY_NAME.lock"
}

nested_env() {
  export XDG_DATA_HOME="$STATE/data"
  export XDG_CONFIG_HOME="$STATE/config"
  export XDG_CACHE_HOME="$STATE/cache"
  export XDG_STATE_HOME="$STATE/state"
  export GSETTINGS_BACKEND=keyfile
  export XDG_SESSION_TYPE=wayland
  export XDG_CURRENT_DESKTOP=GNOME
  export XDG_SESSION_ID=adrt-agent
  export SHELL_DEBUG="${SHELL_DEBUG:-0}"
  # Mutter creates its Wayland socket in XDG_RUNTIME_DIR. Every nested Shell gets
  # a private one (mode 0700) so concurrent runs can never share or delete each
  # other's socket, and the user's real runtime dir is left untouched.
  export XDG_RUNTIME_DIR="$STATE/runtime"
  mkdir -p "$XDG_RUNTIME_DIR"
  chmod 700 "$XDG_RUNTIME_DIR"
  # Servers have no GPU: the native headless backend uses a surfaceless EGL
  # context served by llvmpipe, so software GL must be selected explicitly.
  if [ "${ADRT_SOFTWARE_GL:-0}" = "1" ]; then
    export LIBGL_ALWAYS_SOFTWARE=1
    export GALLIUM_DRIVER=llvmpipe
    export MESA_LOADER_DRIVER_OVERRIDE=llvmpipe
  fi
}

nested_gsettings() {
  nested_env
  gsettings "$@"
}

bus_address() {
  cat "$BUS_FILE"
}

run_on_bus() {
  DBUS_SESSION_BUS_ADDRESS="$(bus_address)" "$@"
}

shell_name_owned() {
  run_on_bus gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
    --method org.freedesktop.DBus.NameHasOwner org.gnome.Shell 2>/dev/null | grep -q true
}

# ---------------------------------------------------------------- lifecycle

cmd_build() {
  # ADRT_DIST is a per-run snapshot of `dist/` (agent-test.sh); installing from
  # it keeps concurrent runs from reading the shared tree while another rebuilds.
  local dist="${ADRT_DIST:-$ROOT/dist}"
  if [ "${ADRT_SKIP_BUILD:-0}" = "1" ]; then
    [ -f "$dist/extension.js" ] || ( cd "$ROOT" && npm run build )
    return 0
  fi
  ( cd "$ROOT" && npm run build )
}

cmd_install() {
  cmd_build
  local dist="${ADRT_DIST:-$ROOT/dist}"
  mkdir -p "$EXT_DIR/schemas"
  rm -rf "${EXT_DIR:?}/core" "${EXT_DIR:?}/platform" "${EXT_DIR:?}/adapters"
  cp -r "$dist/." "$EXT_DIR/"
  cp "$ROOT/packages/gnome/metadata.json" "$EXT_DIR/metadata.json"
  cp "$ROOT/packages/gnome/stylesheet.css" "$EXT_DIR/stylesheet.css"
  cp "$ROOT/packages/gnome/schemas/$SCHEMA.gschema.xml" "$EXT_DIR/schemas/"
  glib-compile-schemas "$EXT_DIR/schemas"
  echo "nested-shell: installed into $EXT_DIR"
}

cmd_seed() {
  nested_gsettings set org.gnome.shell enabled-extensions "['$UUID']"
  nested_gsettings set org.gnome.shell disable-user-extensions false
  echo "nested-shell: seeded enabled-extensions"
}

cmd_start() {
  if cmd_status >/dev/null 2>&1; then
    echo "nested-shell: already running"
    return 0
  fi
  # Monitor matrix (ADRT_MONITORS): colon-separated `WxH[@R]` specs, one
  # `--virtual-monitor` each, in the order given. Mixed resolutions and
  # orientations are supported: a portrait monitor is simply a spec that is
  # taller than it is wide. The shell lays them out linearly left to right and
  # picks the primary itself (see gdctl for control at runtime).
  local mon_args=""
  local spec
  IFS=':' read -r -a monitor_specs <<< "${ADRT_MONITORS:-1280x800}"
  for spec in "${monitor_specs[@]}"; do
    [ -n "$spec" ] && mon_args="$mon_args --virtual-monitor $spec"
  done
  # `--devkit` is local-development sugar (it forces the headless backend and
  # exports the Devkit service); D-Bus-driven tests do not need it, and a plain
  # server install may not have it.
  local devkit_flag="--devkit"
  [ "${ADRT_DEVKIT:-1}" = "0" ] && devkit_flag=""
  # llvmpipe startup is slow, so the readiness window is configurable.
  local start_ticks=$(( ${ADRT_START_TIMEOUT_S:-20} * 2 ))
  mkdir -p "$STATE/data" "$STATE/config" "$STATE/cache" "$STATE/state"
  rm -f "$BUS_FILE" "$PID_FILE"
  cleanup_display_files

  STATE="$STATE" BUS_FILE="$BUS_FILE" PID_FILE="$PID_FILE" LOG_FILE="$LOG_FILE" \
    WAYLAND_DISPLAY_NAME="$WAYLAND_DISPLAY_NAME" \
    dbus-run-session -- bash -c '
      set -u
      cd "'"$ROOT"'"
      echo "$DBUS_SESSION_BUS_ADDRESS" > "$BUS_FILE"
      echo "$$" > "$PID_FILE"
      export XDG_DATA_HOME="'"$STATE"'/data"
      export XDG_CONFIG_HOME="'"$STATE"'/config"
      export XDG_CACHE_HOME="'"$STATE"'/cache"
      export XDG_STATE_HOME="'"$STATE"'/state"
      export XDG_RUNTIME_DIR="'"$STATE"'/runtime"
      export GSETTINGS_BACKEND=keyfile
      export XDG_SESSION_TYPE=wayland
      export XDG_CURRENT_DESKTOP=GNOME
      export XDG_SESSION_ID=adrt-agent
      export WAYLAND_DISPLAY="$WAYLAND_DISPLAY_NAME"
      # Stage 0: the harness always wants real input injection available. The
      # triggers stay inert unless a test calls them, and a live session never
      # sets this.
      export ADRT_INJECT="${ADRT_INJECT:-1}"
      # Test-only D-Bus settings writers (see nested_env): when the host has no
      # spare inotify instance the keyfile GSettings monitor cannot be created,
      # so the harness writes settings through the Shell process instead. Never
      # set on a production desktop.
      export ADRT_TEST_TRIGGERS=1
      exec gnome-shell '"$devkit_flag"' --wayland --headless --no-x11 \
        --wayland-display="$WAYLAND_DISPLAY_NAME"'"$mon_args"' > "$LOG_FILE" 2>&1
    ' >/dev/null 2>&1 &
  disown || true

  for _ in $(seq 1 "$start_ticks"); do
    sleep 0.5
    if [ -f "$BUS_FILE" ] && shell_name_owned; then
      echo "nested-shell: started ($(monitor_summary))"
      return 0
    fi
  done
  echo "nested-shell: failed to start within ${ADRT_START_TIMEOUT_S:-20}s; see $LOG_FILE" >&2
  tail -20 "$LOG_FILE" >&2 || true
  return 1
}

# Human-readable monitor configuration, for logs and test reports.
monitor_summary() {
  echo "${ADRT_MONITORS:-1280x800}"
}

cmd_stop() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        sleep 0.2
        kill -0 "$pid" 2>/dev/null || break
      done
      kill -9 "$pid" 2>/dev/null || true
      echo "nested-shell: stopped pid $pid"
    fi
  fi
  rm -f "$PID_FILE" "$BUS_FILE"
  cleanup_display_files
}

cmd_status() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  kill -0 "$pid" 2>/dev/null || return 1
  shell_name_owned
}

cmd_extension_state() {
  if run_on_bus gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
      --method org.gnome.Shell.Extensions.GetExtensionInfo "$UUID" >/dev/null 2>&1; then
    run_on_bus gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
      --method org.gnome.Shell.Extensions.GetExtensionInfo "$UUID" 2>/dev/null | head -c 400
  else
    echo "(shell does not expose extension info)"
  fi
}

cmd_reset() {
  cmd_stop
  rm -rf "$STATE"
  mkdir -p "$STATE/data" "$STATE/config" "$STATE/cache" "$STATE/state"
  cmd_install
  cmd_seed
  echo "nested-shell: reset complete"
}

# ------------------------------------------------------------------ helpers

cmd_wait_adrt() {
  local timeout="${1:-30}"
  for _ in $(seq 1 "$((timeout * 2))"); do
    if run_on_bus gdbus call --session --dest org.adrt.Adrt --object-path /org/adrt/Adrt \
        --method org.adrt.Adrt.DumpState >/dev/null 2>&1; then
      echo "nested-shell: adrt D-Bus is up"
      # The headless devkit Shell starts with the overview open, which a normal
      # session never does. Close it so the Shell matches the real desktop
      # before any scenario runs.
      cmd_dbus SimulateOverview false >/dev/null 2>&1 || true
      return 0
    fi
    sleep 0.5
  done
  echo "nested-shell: adrt D-Bus did not appear" >&2
  return 1
}

cmd_dbus() {
  local method="$1"; shift
  run_on_bus gdbus call --session --dest org.adrt.Adrt --object-path /org/adrt/Adrt \
    --method "org.adrt.Adrt.$method" -- "$@"
}

cmd_enable() {
  cmd_seed
  run_on_bus gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.EnableExtension "$UUID" >/dev/null 2>&1 || true
}

cmd_disable() {
  run_on_bus gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.DisableExtension "$UUID" >/dev/null 2>&1 || true
}

cmd_logs() {
  if [ "${1:-}" = "--follow" ]; then tail -f "$LOG_FILE"; else tail -n 200 "$LOG_FILE"; fi
}

cmd_eval() {
  run_on_bus gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval "$1"
}

cmd_gesture() {
  local kind="$1" dx="$2" dy="$3" points="$4"
  cmd_dbus SimulateGesture "$kind" "$dx" "$dy" "$points"
}

case "${1:-status}" in
  build) shift; cmd_build "$@" ;;
  install) shift; cmd_install "$@" ;;
  seed) shift; cmd_seed "$@" ;;
  start) shift; cmd_start "$@" ;;
  stop) shift; cmd_stop "$@" ;;
  restart) cmd_stop; cmd_start ;;
  status) cmd_status && echo "nested-shell: running" ;;
  reset) cmd_reset ;;
  enable) cmd_enable ;;
  disable) cmd_disable ;;
  extension-state) cmd_extension_state ;;
  wait-adrt) shift; cmd_wait_adrt "$@" ;;
  logs) shift; cmd_logs "$@" ;;
  dbus) shift; cmd_dbus "$@" ;;
  eval) shift; cmd_eval "$@" ;;
  gesture) shift; cmd_gesture "$@" ;;
  *)
    cat >&2 <<EOF
usage: nested-shell.sh <command>

  build | install | seed
  start | stop | restart | status | reset
  enable | disable | extension-state | wait-adrt [seconds]
  logs [--follow]
  dbus <Method> [args...]
  eval <javascript>
  gesture <kind> <dx> <dy> <points>
EOF
    exit 2
    ;;
esac
