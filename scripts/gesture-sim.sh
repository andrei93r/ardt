#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Feed a synthetic gesture to the running extension (§41.1).
#
#   gesture-sim.sh <kind> <deltaX> <deltaY> <touchPoints>
#
# Talks to whichever org.adrt.Adrt is on the current session bus. For the
# nested Shell, use: nested-shell.sh gesture <kind> <dx> <dy> <points>
set -euo pipefail

KIND="${1:?usage: gesture-sim.sh <kind> <deltaX> <deltaY> <touchPoints>}"
DX="${2:?missing deltaX}"
DY="${3:?missing deltaY}"
POINTS="${4:?missing touchPoints}"

gdbus call --session \
  --dest org.adrt.Adrt \
  --object-path /org/adrt/Adrt \
  --method org.adrt.Adrt.SimulateGesture \
  "$KIND" "$DX" "$DY" "$POINTS"
