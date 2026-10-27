# Windows test VM — one-time setup

The port's automated tests need a real interactive Windows desktop (an SSH
session lives in session 0 and cannot manage the user's windows). The bootstrap
script turns a fresh VM into that machine, then an agent takes over over SSH.

Files:

| File | Purpose |
| --- | --- |
| `scripts/windows/bootstrap-vm.ps1` | installs/enables everything, idempotent, prints an OK/WARN/FAIL summary |
| `scripts/windows/bootstrap-vm.cmd` | self-elevating launcher for the `.ps1` (double-click it) |
| `scripts/windows/serve-bootstrap.sh` | serves the two files over the LAN so the VM can fetch them with one line |

## What the script installs and enables

| Area | What it does |
| --- | --- |
| Remote access | OpenSSH **Server** capability, `sshd` automatic + started, firewall rule, PowerShell 7 as the SSH shell when present |
| Toolchain | **.NET 10 SDK** (winget, fallback `dotnet-install.ps1` + machine PATH), **Git for Windows** (winget, fallback GitHub release), **PowerShell 7** (winget, fallback MSI) |
| Optional | Sysinternals (`psexec`, useful for session-1 launches), and `-TestApps`: VS Code + Chrome for the app-compat matrix |
| Desktop session | **Autologon** for a local account (secure prompt), so the VM always boots to a live desktop |
| Determinism | no monitor/standby sleep, hibernate + fast startup off, long paths, Developer Mode, no lock screen, no screensaver, Windows Update no auto-reboot, animations off, consumer-features off, Defender exclusions for `C:\adrt` |
| Agent home | `C:\adrt\{jobs,results,reports,logs}` + a README, and the full bootstrap log under `C:\adrt\logs` |

The script is **idempotent** and only the OpenSSH and folder steps are fatal —
everything else warns and continues, so network hiccups never leave a VM with no
remote access. Every run ends with an OK/WARN/FAIL table and an exit code.

## Quick start

1. Fresh VM: Windows 11 Pro/Enterprise, 4+ vCPU, 8+ GB RAM, a **local** admin
   account (not a Microsoft account), internet access.
2. Get the files onto the VM — either
   - copy `bootstrap-vm.ps1` + `bootstrap-vm.cmd` (shared folder, RDP clipboard), then right-click `bootstrap-vm.cmd` → **Run as administrator**; or
   - serve them from the dev box and fetch them on the VM:
     ```
     # dev box
     bash scripts/windows/serve-bootstrap.sh 8123
     # VM (normal PowerShell)
     irm http://<dev-box-ip>:8123/bootstrap-vm.ps1 -OutFile $env:TEMP\bootstrap-vm.ps1
     & $env:TEMP\bootstrap-vm.ps1 -Autologon
     ```
3. Answer the password prompt (stored only in the VM's Winlogon autologon
   entries; this is a throwaway test VM).
4. `shutdown /r /t 5` and confirm it comes back **logged in by itself**.
5. **Snapshot the VM.** This is the clean baseline the harness restores to.
6. Send the agent: `ssh <user>@<ip>` and the credentials. It then:
   deploys the in-session test agent, wires `scripts/windows/vm.sh`, and starts
   Stage W0/W1.

## Flags

```
.\bootstrap-vm.ps1                        # everything, autologon with a prompt
.\bootstrap-vm.ps1 -TestApps              # + VS Code and Chrome
.\bootstrap-vm.ps1 -Autologon:$false      # no autologon (tests then need a manual login)
.\bootstrap-vm.ps1 -Password '<pw>'       # non-interactive autologon
.\bootstrap-vm.ps1 -SkipDeterminism       # leave Windows' defaults alone
.\bootstrap-vm.ps1 -NoSysinternals
```

## What it deliberately does not do

- **Snapshot/restore** — hypervisor-specific; give the agent a reset command
  (`ADRT_VM_RESET_CMD`) or restore snapshots yourself before big runs.
- **Second virtual monitor** — needs an Indirect Display Driver; install it
  after the baseline and take a second snapshot, or the agent adds it later.
- **Turn off "Snap windows"** — no supported unattended toggle; verify it in
  Settings → System → Multitasking after the reboot (the app's first-run check
  will also flag it).
- **Code signing / SmartScreen** — development builds are unsigned by design.

## Security notes

- Autologon writes the password to the registry (LSA); acceptable **only** on a
  disposable test VM. Rotate or discard the VM when done.
- SSH: password login is enabled by the capability's default. After the agent
  connects you can switch to key-only (`administrators_authorized_keys`).
- The `serve-bootstrap.sh` HTTP server exposes exactly the two bootstrap files
  and only while it runs; bind it to your LAN, not the internet.
