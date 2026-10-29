# Adrt on Windows — user guide

Adrt tiles windows into pairs: up to two tileable windows share a monitor, split
along a shared edge. This guide covers the Windows build in `windows/`.

The current beta is a keyboard-driven host. It runs as a console program that
logs its activity; a tray icon and first-run/settings polish are still landing,
so closing the console window (or pressing `Ctrl+Alt+Q`) quits Adrt.

## Requirements

- 64-bit Windows 10 (1809 or later) or Windows 11.
- No .NET installation is required: the published host is self-contained.
- A secondary monitor and virtual-desktop integration are not required for basic
  tiling, but the host follows each monitor's work area.

Administrator rights are **not** required. The installer is per-user.

## Install

1. Download `AdrtSetup-<version>.exe`.
2. Run it and choose **Install**. Windows may show a SmartScreen warning because
   release builds are not code-signed yet: choose **More info → Run anyway**.
3. Keep **Launch Adrt** ticked on the final page to start the host immediately.

The installer writes:

| Item | Location |
| --- | --- |
| Host executable | `%LocalAppData%\Programs\Adrt\Adrt.Windows.exe` |
| Start Menu shortcut | `%AppData%\Microsoft\Windows\Start Menu\Programs\Adrt` |
| Uninstall entry | **Settings → Apps → Installed apps → Adrt** |
| Optional autostart | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value `Adrt` |

No files are written outside the current user's profile and HK**C**U.

### Silent install

```bat
AdrtSetup-<version>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

To also start Adrt at sign-in:

```bat
AdrtSetup-<version>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="startup"
```

The same switches are used by the winget manifest:
`/VERYSILENT /SUPPRESSMSGBOXES`. The installer never requests elevation.

## First run

1. Start Adrt from the Start Menu (or let setup launch it).
2. Open two ordinary, resizable windows on the same monitor. They are tiled as a
   left/right pair. A window that cannot get a free slot floats; use
   `Win+Ctrl+F` to float or re-tile the focused window.
3. Use the hotkeys below to focus, swap, move, resize, float or close windows.

The console window prints the active hotkey count, for example
`adrt: 25/25 default hotkeys active.` If the number is lower, Windows or another
application owns one of the combinations; the refused binding is logged and
skipped.

Adrt allows one instance per signed-in user. Starting a second copy prints
`adrt: another instance is already running.` and exits.

### Start with Windows

The installer's optional **Start Adrt when I sign in** task writes the per-user
`Run` value. If Adrt is already installed without it, enable it with:

```bat
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v Adrt /t REG_SZ /d "\"%LocalAppData%\Programs\Adrt\Adrt.Windows.exe\"" /f
```

Disable it with:

```bat
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v Adrt /f
```

The uninstaller removes this value automatically.

## Hotkeys

These are the defaults in the current Windows build
(`windows/src/Adrt.Windows/Input/Hotkeys/HotkeyTable.cs`). `Win` means either
Windows key. Combinations are registered globally; an app that already owns one
wins, and Adrt logs the skipped binding at startup.

### Focus and pointer

| Hotkey | Action |
| --- | --- |
| `Win+Ctrl+H` | Focus the window to the left |
| `Win+Ctrl+L` | Focus the window to the right |
| `Win+Ctrl+K` | Focus the window above |
| `Win+Ctrl+J` | Focus the window below |
| `Win+Ctrl+Backtick` (`` ` ``) | Cycle focus |
| `Win+Ctrl+G` | Move the pointer to the focused window |

### Move and swap

| Hotkey | Action |
| --- | --- |
| `Win+Ctrl+X` | Swap the pair |
| `Win+Ctrl+M` | Move the window to the monitor's other half |
| `Win+Ctrl+Shift+H` | Move the focused window left |
| `Win+Ctrl+Shift+L` | Move the focused window right |
| `Win+Ctrl+Shift+K` | Move the focused window up |
| `Win+Ctrl+Shift+J` | Move the focused window down |

### Resize

| Hotkey | Action |
| --- | --- |
| `Win+Ctrl+,` | Nudge the split left (10% step) |
| `Win+Ctrl+.` | Nudge the split right (10% step) |
| `Win+Ctrl+Shift+,` | Nudge the split up (10% step) |
| `Win+Ctrl+Shift+.` | Nudge the split down (10% step) |
| `Win+Ctrl+=` | Grow the focused window |
| `Win+Ctrl+-` | Shrink the focused window |

### Window and session

| Hotkey | Action |
| --- | --- |
| `Win+Ctrl+F` | Float or re-tile the focused window |
| `Win+Ctrl+E` | Toggle maximize |
| `Win+Ctrl+Z` | Undo the last layout change (one level) |
| `Win+Ctrl+Shift+Q` | Close the focused window |
| `Ctrl+Alt+P` | Pause or resume tiling |
| `Ctrl+Alt+B` | Show or hide the focus border |
| `Ctrl+Alt+Q` | Quit Adrt |

While paused, Adrt keeps observing windows but applies no layout changes.
Resuming requests a fresh layout. `Ctrl+C` in the console also quits.

## Your data

Adrt keeps per-user data in:

```text
%AppData%\Adrt\
```

(`%AppData%` expands to `C:\Users\<you>\AppData\Roaming`.) The settings file is
`settings.json`; only Adrt writes this folder, and it is never stored under the
install directory.

- Upgrading Adrt leaves `%AppData%\Adrt` untouched.
- Uninstalling leaves it untouched by default.
- To reset Adrt, quit the host first, then rename or delete `%AppData%\Adrt` and
  start Adrt again.

## Upgrade

Run the newer `AdrtSetup-<version>.exe` over the old install. The installer uses
one stable application ID, keeps the previous install directory, and preserves
`%AppData%\Adrt`. Quit Adrt before upgrading; the installer detects the running
instance and asks you to close it.

## Uninstall

Use **Settings → Apps → Installed apps → Adrt → Uninstall**, or the
**Uninstall Adrt** Start Menu shortcut. This removes the host binary, shortcuts,
the uninstall entry and the autostart value. `%AppData%\Adrt` is kept.

Silent uninstall, keeping your data:

```bat
"%LocalAppData%\Programs\Adrt\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES
```

Silent uninstall and delete `%AppData%\Adrt` as well:

```bat
"%LocalAppData%\Programs\Adrt\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /PURGEDATA
```

`/PURGEDATA` is an explicit uninstaller switch, not an installer option and not
an interactive prompt in this beta. Without it, deleting the folder manually is
always safe once Adrt has quit.

## Troubleshooting

**Nothing tiles.** Adrt pairs windows on the same monitor. Make sure both windows
are ordinary, resizable, non-elevated windows and that tiling is not paused
(`Ctrl+Alt+P`). Elevated windows cannot be moved by a non-elevated process.

**A hotkey does nothing.** Another application or Windows itself may own that
combination. Check the startup log's active-hotkey count and the refused binding
line. `Ctrl+Alt+P`, `Ctrl+Alt+B` and `Ctrl+Alt+Q` are the session keys; the rest
use `Win+Ctrl`.

**The console window is open.** Expected in this beta: the host is a console
program and prints layout/action logs there. Closing it quits Adrt. Use
`Ctrl+Alt+Q` for a normal quit.

**"Another instance is already running."** Adrt is already active for this user.
Use the existing instance, or quit it with `Ctrl+Alt+Q` / `Ctrl+C` and start
again.

**SmartScreen or antivirus warning.** Release installers are unsigned at this
stage. Verify the download against the published SHA256 before choosing
**Run anyway**. Code signing is planned in the release pipeline.

**The installer says Adrt is running.** Quit Adrt from its console
(`Ctrl+Alt+Q`) and rerun setup.

## Files for packagers

| File | Purpose |
| --- | --- |
| `scripts/windows/publish.ps1` | Self-contained single-file `win-x64` publish to `dist/windows`, SHA256 output |
| `windows/installer/adrt.iss` | Inno Setup 6 per-user installer |
| `windows/installer/winget/Adrt.Adrt.yaml` | winget singleton manifest template |
| `.github/workflows/windows-release.yml` | `v*` tag release build and artifact upload |

Local installer build (from the repository root):

```powershell
./scripts/windows/publish.ps1 -Version 0.3.0
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" windows\installer\adrt.iss
```

The setup executable lands in `dist\installer\AdrtSetup-<version>.exe`; its
SHA256 is printed by the release workflow and written next to it as
`dist\installer\SHA256SUMS.txt`.
