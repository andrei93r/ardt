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
