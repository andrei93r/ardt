# Windows 11 test VM (local, libvirt session)

This is the VM used for the Windows port. It is a plain `qemu:///session` domain
named `win11`, created with GNOME Boxes-compatible metadata but defined directly
with `virsh` so the hardware matches what Windows 11 requires.

## Hardware

| Item | Value |
| --- | --- |
| Firmware | UEFI, OVMF `OVMF_CODE_4M.ms.fd` + `OVMF_VARS_4M.ms.fd` (Microsoft keys) |
| Secure Boot | On (`enrolled-keys`, SMM) — verified: `msinfo32` → Secure Boot State: On |
| TPM | `tpm-crb`, emulator 2.0 (swtpm) — verified: `tpm.msc` → "The TPM is ready for use", Spec 2.0 |
| Machine | `pc-q35-11.0`, 8 vCPU, 8 GiB RAM |
| Disk | 80 GiB qcow2 (`~/.local/share/gnome-boxes/images/win11`) |
| Display | SPICE + QXL, 1280×800 |
| Network | user-mode NAT, e1000e |

## Guest

| Item | Value |
| --- | --- |
| OS | Windows 11 Pro, build 10.0.26300 |
| User | `andrei` (local account, administrator) |
| Password | `adrt1234` |
| Security answers | `adrt` (all three questions) |

Change the password after the first sign-in if the VM will be kept.

## Installer

`/home/andrei/Downloads/Windows11_Client_x64_en-us_26300_9457.iso`

The ISO is attached as a SATA CD-ROM. OOBE was completed offline with
`oobe\bypassnro` so a local account could be created; the link was re-enabled
afterwards. Keep the BypassNRO registry value (`HKLM\SOFTWARE\Microsoft\Windows
\CurrentVersion\OOBE\BypassNRO=1`) only for as long as this test VM is disposable.

## Driving it from the host

Boxes/virt-manager can attach to the running domain. For scripted checks:

```sh
virsh -c qemu:///session start win11
virsh -c qemu:///session screenshot win11 /tmp/win11.ppm
virsh -c qemu:///session domstate win11
```

Input can be injected with QMP `input-send-event` (absolute tablet coordinates)
and text with per-key QMP events; both were used to complete OOBE.

## Snapshots

Take a `clean` snapshot now that Windows is installed and OOBE is complete:

```sh
virsh -c qemu:///session snapshot-create-as win11 clean "post-install"
```

This is the baseline the Windows test harness (`scripts/windows/vm.sh`) should
restore before each scenario run.

## Multi-monitor release gate (orientation matrix)

Not yet run. The domain has been redefined with QXL `heads='2'`; Windows needs
the QXL-WDDM-DOD driver (or a working inbox QXL path) before the second head
appears in Display Settings.

Required configuration:

| Display | Resolution | Orientation | Role |
| --- | --- | --- | --- |
| DISPLAY1 | 1920×1080 / 2560×1440 / 1920×1200 | landscape | primary |
| DISPLAY2 | 1080×1920 / 1440×2560 / 1200×1920 | portrait | secondary |

Priority resolution matrix (the ones that matter most):

First, the configurations this laptop has actually remembered
(`~/.config/monitors.xml`, 9 entries; `rotation=left` means the panel is
rotated to portrait):

| Local config | Screens |
| --- | --- |
| main (most entries) | 2× **Dell S2725DS 2560×1440**, one `rotation=left` (portrait) at x=0, the other landscape at x=1440 |
| laptop only | **eDP-1 1920×1200** (P14s Gen 4 panel), 100% and 125% in different entries |
| triple | eDP-1 1920×1200 + 2× 2560×1440 (one portrait, one landscape) |

No remembered 1920×1080 configuration exists locally, so 1080p is added
explicitly.

1. **2560×1440 (2K, 16:9)** — the main local rig, one landscape + one portrait:
   landscape 1280/1280; portrait 1440×2560 → stacked 1440×720.
2. **1920×1200 (16:10)** — the Lenovo P14s Gen 4 panel; landscape 960/960;
   portrait 1200×1920 → stacked 1200×600. Also at 125% (remembered locally).
3. **1920×1080 (16:9)** — added by request: landscape 960/960;
   portrait 1080×1920 → stacked 1080×540.

QXL notes: the device is `ram=64M, vram=64M, vgamem=16M`. 2560×1440 needs
~15 MB of surface and 1920×1200 ~9 MB, so raise `vgamem` to 32768 before the 2K
runs; the QXL driver caps a head at 2560×1600, which is why the portrait cases
are the same mode rotated in Windows (logical bounds swap, physical mode stays
landscape).

Expected behaviour (the model splits along each screen's own axis):

- landscape pair → left/right, 50/50 inside the work area;
- portrait pair → **top/bottom**, 50/50 inside the work area;
- a window moved across the boundary re-pairs on the destination screen, never
  straddles both;
- unplug/disable the portrait head → its windows re-home, no orphaned rects and
  no window left at portrait coordinates;
- rotate the second head portrait → landscape → the pair re-splits left/right;
- mixed DPI (100% landscape + 150% portrait) must not shift rects by a pixel
  (physical-pixel bookkeeping, `DWMWA_EXTENDED_FRAME_BOUNDS`).

Re-run `Adrt.Windows` after each configuration change and confirm
`[display] 2 screen(s)` plus per-screen `plans=2 placements=4` with four
windows (two per screen).
