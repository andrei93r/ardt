#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A98 §12: the app registry auto-populates on every window, keyed by the
# resolved identity (never a provisional key), and lists every app that opened.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
adrt ForgetApp org.gnome.TextEditor >/dev/null 2>&1 || true
adrt ForgetApp org.gnome.Calculator >/dev/null 2>&1 || true

spawn_window >/dev/null
wait_count 1 15 || true
spawn_window "gnome-calculator" >/dev/null
wait_count 2 20 || true
wait_settled 15

poll "the registry lists every app that opened" '
import json, sys
d = json.load(sys.stdin)
apps = {e["appId"]: e for e in d.get("registry", [])}
if "org.gnome.TextEditor" not in apps:
    print("text editor missing:", sorted(apps)); sys.exit(1)
if "org.gnome.Calculator" not in apps:
    print("calculator missing:", sorted(apps)); sys.exit(1)
if apps["org.gnome.TextEditor"]["windowsSeen"] < 1:
    print("text editor not counted"); sys.exit(1)
print("apps", sorted(apps))
' 25

check_python "every window carries a resolved, non-provisional identity" '
import json, sys
d = json.load(sys.stdin)
bad = [w["id"] for w in d["windows"] if w.get("provisional") or not w.get("identity")]
if bad:
    print("provisional/unresolved:", bad); sys.exit(1)
print("identities", sorted({w["identity"] for w in d["windows"]}))
'

ensure_clean
adrt ForgetApp org.gnome.TextEditor >/dev/null 2>&1 || true
adrt ForgetApp org.gnome.Calculator >/dev/null 2>&1 || true
summary
