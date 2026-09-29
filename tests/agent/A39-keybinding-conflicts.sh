#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A39 Keybinding conflicts: none of Adrt's default accelerators may collide
# with a GNOME binding (a collision silently steals the shortcut).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean

ours="$(GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$ADRT_STATE_DIR/config" \
  GSETTINGS_SCHEMA_DIR="$(ext_dir)/schemas" \
  gsettings list-recursively org.gnome.shell.extensions.adrt | grep ' kb-')"
gnome="$(gsettings list-recursively org.gnome.desktop.wm.keybindings 2>/dev/null
gsettings list-recursively org.gnome.mutter.keybindings 2>/dev/null
gsettings list-recursively org.gnome.shell.keybindings 2>/dev/null)"

output="$(OURS="$ours" GNOME="$gnome" python3 -c '
import os, re, sys

MOD = r"<(?:Super|Shift|Alt|Control|Ctrl|Primary|Mod[0-9])>"
ACCEL = re.compile(r"(?:%s)+[A-Za-z0-9_]+" % MOD)

def accels(text):
    return set(ACCEL.findall(text))

mine = accels(os.environ["OURS"])
theirs = accels(os.environ["GNOME"])
clash = sorted(mine & theirs)
if clash:
    print("collisions: " + ", ".join(clash))
    sys.exit(1)
print("no collisions; %d Adrt bindings checked against %d GNOME bindings" % (len(mine), len(theirs)))
')"
if [ "$output" = "${output#collisions}" ]; then
  pass "$output"
else
  fail "$output"
fi

summary
