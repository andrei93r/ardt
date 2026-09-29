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
WAYLAND_DISPLAY_NAME="${ADRT_WAYLAND_DISPLAY:-wayland-adrt}"

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
  if [ "${ADRT_SKIP_BUILD:-0}" = "1" ]; then
    [ -f "$ROOT/dist/extension.js" ] || ( cd "$ROOT" && npm run build )
    return 0
  fi
  ( cd "$ROOT" && npm run build )
}

cmd_install() {
  cmd_build
  mkdir -p "$EXT_DIR/schemas"
  rm -rf "${EXT_DIR:?}/core" "${EXT_DIR:?}/platform" "${EXT_DIR:?}/adapters"
  cp -r "$ROOT/dist/." "$EXT_DIR/"
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
  mkdir -p "$STATE/data" "$STATE/config" "$STATE/cache" "$STATE/state"
  rm -f "$BUS_FILE" "$PID_FILE"

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
      export GSETTINGS_BACKEND=keyfile
      export XDG_SESSION_TYPE=wayland
      export XDG_CURRENT_DESKTOP=GNOME
      export XDG_SESSION_ID=adrt-agent
      export WAYLAND_DISPLAY="$WAYLAND_DISPLAY_NAME"
      exec gnome-shell --devkit --wayland --headless --no-x11 \
        --wayland-display="$WAYLAND_DISPLAY_NAME" \
        --virtual-monitor 1280x800 > "$LOG_FILE" 2>&1
    ' >/dev/null 2>&1 &
  disown || true

  for _ in $(seq 1 40); do
    sleep 0.5
    if [ -f "$BUS_FILE" ] && shell_name_owned; then
      echo "nested-shell: started"
      return 0
    fi
  done
  echo "nested-shell: failed to start; see $LOG_FILE" >&2
  tail -20 "$LOG_FILE" >&2 || true
  return 1
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
    --method "org.adrt.Adrt.$method" "$@"
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
