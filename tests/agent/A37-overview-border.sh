#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A37 Every scenario runs with the overview closed, as on a real desktop: the
# border shows normally and nothing is suppressed. (Adrt only hides the border
# when the overview is open; the suite never opens it.)
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean

check_python "the overview is closed" '
import json, sys
d = json.load(sys.stdin)
if d["overview"]:
    print("overview is open"); sys.exit(1)
print("closed")
'

open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
if wait_border_visible 20; then
  pass "the border is visible with the overview closed"
else
  fail "border never became visible (suppressed: $(state_expr 'd["indicator"]["suppressed"]'))"
fi

check_python "the overview never suppresses the border here" '
import json, sys
d = json.load(sys.stdin)
if "overview" in d["indicator"]["suppressed"]:
    print("suppressed:", d["indicator"]["suppressed"]); sys.exit(1)
print("suppressions:", d["indicator"]["suppressed"])
'

ensure_clean
summary
