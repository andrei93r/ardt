#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A99 §12: a registry `neverTile` decision takes precedence on every window of
# the app, including one opened afterwards: it floats and is never re-tiled.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
adrt SetNeverTile org.gnome.TextEditor false >/dev/null 2>&1 || true
adrt ForgetApp org.gnome.TextEditor >/dev/null 2>&1 || true

spawn_window >/dev/null
wait_count 1 15 || true
ids=($(list_ids))
A="${ids[0]:-}"
if [ -z "$A" ]; then
  fail "no test window opened"
  summary
  exit 0
fi
IDENT="$(window_field "$A" identity)"
echo "identity=$IDENT"

adrt SetNeverTile "$IDENT" true >/dev/null

poll "neverTile floats the live window" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$A"'")]
if not w:
    print("window gone"); sys.exit(1)
if w[0]["layer"] != 2:
    print("layer", w[0]["layer"]); sys.exit(1)
if not w[0].get("neverTile"):
    print("neverTile not recorded on the window"); sys.exit(1)
print("floated", w[0]["id"])
' 20

# A second window of the same app must also float, without any user action on it.
spawn_window >/dev/null
wait_count 2 20 || true
poll "a newly opened window of a neverTile app floats too" '
import json, sys
d = json.load(sys.stdin)
ident = "'"$IDENT"'"
w = [x for x in d["windows"] if x["identity"] == ident]
if len(w) < 2:
    print("expected two windows of the app, got", len(w)); sys.exit(1)
bad = [x["id"] for x in w if x["layer"] != 2]
if bad:
    print("not floating:", bad); sys.exit(1)
if ident not in d.get("neverTile", []):
    print("app missing from neverTile:", d.get("neverTile")); sys.exit(1)
print("floating windows", [x["id"] for x in w])
' 20

adrt SetNeverTile "$IDENT" false >/dev/null 2>&1 || true
ensure_clean
adrt ForgetApp "$IDENT" >/dev/null 2>&1 || true
summary
