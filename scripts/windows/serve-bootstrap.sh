#!/usr/bin/env bash
# Generated with AI for personal use.
# Serve the Windows VM bootstrap files over the local network, so the VM can
# fetch them with one line instead of file transfer:
#
#   Linux:  bash scripts/windows/serve-bootstrap.sh [port]
#   VM:     irm http://<printed-ip>:<port>/bootstrap-vm.ps1 -OutFile "$env:TEMP\bootstrap-vm.ps1"
#           & "$env:TEMP\bootstrap-vm.ps1" -Autologon
#
# Nothing else is exposed: the directory holds only the bootstrap scripts.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
port="${1:-8123}"
ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "serving $here on http://${ip:-<this-host>}:$port/"
echo "on the VM:"
echo "  irm http://${ip:-<this-host>}:$port/bootstrap-vm.ps1 -OutFile \$env:TEMP\\bootstrap-vm.ps1"
echo "  & \$env:TEMP\\bootstrap-vm.ps1 -Autologon"
exec python3 -m http.server "$port" --bind 0.0.0.0 --directory "$here"
