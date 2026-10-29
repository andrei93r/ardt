# Adrt for Windows — staged port plan (executable checklist)

Companion to `docs/WINDOWS_PORT.md` (strategy, platform mapping, packaging).
This file is the **order of work**: stages with tasks, owners, gates and the
automated-testing machinery. It follows the shape of `docs/V2_PLAN.md` so the
GNOME and Windows tracks read the same.

Target branch: `windows_port`. Everything lands under `windows/` plus the
Windows-specific `scripts/windows/` and docs; the GNOME implementation and
`docs/V2_MODEL.md` are untouched references.

---

## 0. How this plan is executed (agent work split)

The GNOME track proved the working rules; they carry over verbatim.

**Hard rules.**

- **One writer per file.** Every task in a stage names the files it owns; two
  concurrent agents never touch the same file. If a task must edit another
  lane's file, it is a dependency, not a parallel task.
- **Agents never commit.** A subagent implements and runs its own gate; the
  integrator (the main session) reviews, runs the combined gate and commits.
- **2–3 concurrent agents maximum**, always on disjoint files, on the lanes
  below.
- **Green gate before every commit**: build, analyzers/format, unit tests, the
  targeted scenarios, and (for integrator commits) the smoke suite.
- **Scenario discipline** (from `DESIGN_BACKLOG.md` §6): triggers are honest
  (`Inject*` = real input, plain = real API, `Simulate*` = state only) and
  event-confirmed; `DumpState` is add-only; no wait-as-a-fix; no policy in
  platform event callbacks.
- **Every new scenario is classified** in a smoke list or `full-only.list`
  with a reason; the coverage guard fails otherwise.
- **Failure evidence**: a failing scenario writes a bundle (screenshot,
  `DumpState`, `DumpDecisions`, log tail) next to its result — the interpreter
  never fails without leaving evidence.

**Permanent lanes (file ownership).**

| Lane | Owns | Notes |
| --- | --- | --- |
| **CORE** | `windows/src/Adrt.Core/**` | pure C#; no P/Invoke, no UI; ported 1:1 from `src/core` |
| **PLATFORM** | `windows/src/Adrt.Windows/Host/**` (hooks, geometry, monitors, session, workspaces) | the OS surface |
| **INPUT+CHROME** | `windows/src/Adrt.Windows/Input/**`, `Overlay/**` | hotkeys, drag interpretation, border, toasts |
| **UI** | `windows/src/Adrt.Settings/**`, `windows/src/Adrt.Windows/Tray/**` | WPF prefs, tray |
| **HARNESS** | `windows/src/Adrt.Cli/**`, `windows/src/Adrt.Testing/**`, `tests/windows/**`, `scripts/windows/**` | pipe API, runner, scenarios, VM channel |
| **PACKAGING** | `windows/installer/**`, `.github/workflows/windows-*.yml` | Inno, winget, CI |
| **DOCS** | `docs/WINDOWS_*.md`, `docs/PROBE_RESULTS_WINDOWS.md` | spec deltas, probes, guides |

**Gate commands** (used by agents locally and by CI):

```
dotnet build windows/Adrt.sln -warnaserror
dotnet format windows/Adrt.sln --verify-no-changes
dotnet test windows/tests/Adrt.Core.Tests
dotnet test windows/tests/Adrt.Architecture.Tests        # core purity, layering
bash scripts/windows/vm.sh run smoke                     # integration (VM required)
```

---

## 1. The VM lab (user-provided; how the automated tests run)

**What the VM needs** (one-time; the user is creating it). Steps marked ⚙ are
automated by `scripts/windows/bootstrap-vm.ps1` — see
`docs/WINDOWS_VM_SETUP.md`; the rest stay manual by platform constraint.

- [ ] **Windows 11 Pro/Enterprise** VM, 4+ vCPU, 8–16 GB RAM, 80+ GB disk.
- [ ] A **local** test account (not a Microsoft account). ⚙ autologon and the
      no-lock/no-sleep power settings are set by the bootstrap script.
- [ ] ⚙ **OpenSSH Server** (`Add-WindowsCapability -Online -Name
      OpenSSH.Server~~~~0.0.1.0`), key-only login from the Linux dev box; the
      SSH session is only a *file channel* (see below), never the place tests
      run.
- [ ] ⚙ **.NET SDK 10**, Git, PowerShell 7; test apps installed: VS Code, Chrome,
      plus the built-in Explorer/Notepad/Settings/Task Manager.
- [ ] ⚙ Determinism settings (a setup script under `scripts/windows/`):
      animations off, "Snap windows" off, 100% scale on the primary, fixed
      resolution, auto-hide nothing, no Windows Update restarts, high-power plan.
      ("Snap windows" has no supported unattended toggle — verify it manually.)
- [ ] **Indirect Display Driver** (e.g. IddSampleDriver-style) so the VM can
      expose **2 virtual monitors** for multi-monitor scenarios (the equivalent
      of `ADRT_MONITORS`) — manual, after the baseline snapshot.
- [ ] **Snapshots**: a `clean` baseline with everything above; the harness can
      ask the hypervisor to restore it via `ADRT_VM_RESET_CMD` (a user-provided
      command: `Checkpoint-VM`/`vmrun`/`VBoxManage`) — manual.

**How tests run inside it** (autonomy without a human):

```
Linux dev box                                Windows VM (interactive session)
  git/ssh/scp ──────────────►  C:\adrt\jobs\*.json   (job specs)
                                 │  watched by
                                 ▼
  poll results ◄────────── C:\adrt\results\<id>.json  (agent writes)
                             screenshots, logs, bundles
```

- **`Adrt.VmAgent`** (small console app, HARNESS lane) is started by a Scheduled
  Task **at logon** (`/IT` interactive) so it runs in the autologged-in user's
  session — the only place real windows exist. It watches `C:\adrt\jobs`, runs
  the requested action (unit tests, a scenario, a screenshot, a lock/unlock
  drill), and writes `results/<id>.json` + artifacts. A job spec carries
  `{id, kind, args, timeoutMs, monitorCount}`.
- **`scripts/windows/vm.sh`** (Linux side) wraps it: `push`, `run <scenario>`,
  `smoke`, `unit`, `shot`, `reset`, `wait`. Plain SSH + scp; no listener on the
  network, no credentials beyond the SSH key.
- **Boot-to-ready**: `vm.sh reset` restores the `clean` snapshot (if
  configured), boots, waits for the agent heartbeat; if the session comes up
  locked, the job fails fast with a named reason (`session-locked`), never a
  silent flake.
- The same channel runs the **app-compat matrix** and the **nightly full
  suite** unattended.

---

## 2. Automated testing architecture (parity with the GNOME suites)

| GNOME thing | Windows equivalent |
| --- | --- |
| `vitest run tests/core` (566) | `dotnet test Adrt.Core.Tests` + TS-generated golden fixtures |
| `tests/agent/A*.sh` nested scenarios | `tests/windows/T*.ps1` scenarios, run by `Adrt.ScenarioRunner` in the VM session |
| `scripts/agent-test.sh` (sharded workers) | `scripts/windows/vm.sh smoke` / `full` — one desktop, scenarios serialised, each with a timeout |
| `scripts/session-test.sh` live suite | the same T-series; there is no nested variant on Windows, so "live" and "agent" are one suite in the VM |
| `TEST_RESULTS.md` | `TEST_RESULTS_WINDOWS.md` (results table + journals + evidence paths) |
| coverage guard + smoke lists | `scripts/windows/check-coverage.py`, `tests/windows/smoke.list`, `full-only.list`, `coverage.map` |
| app-compat matrix (`appcheck.sh`, A158–A160/S26) | `tests/windows/appmatrix/*` driven by `Adrt.Cli`, real apps + the deterministic test clients |
| trigger table / D-Bus | named pipe, same 85 triggers, same names/signatures |
| journal scan | `[adrt] ERROR` scan of `%APPDATA%\Adrt\logs` + runner log |

**Deterministic test clients** (`windows/tests/clients`, HARNESS lane): one app
with a CLI spec so scenarios can request a window that is: a tileable pair
member, a minimum-size refuser, a dialog with owner, always-on-top, a
single-instance second-window quitter, or a slow-settling Electron-like window.
This replaces the Python clients the GNOME suite spawns.

**Evidence bundle on failure** (automatic, per scenario): PNG screenshot,
`DumpState`, last 200 `DumpDecisions`, the scenario transcript, and the app log
tail — committed only in CI artifacts, never the repo.

---

## 3. Stages

Legend: `[ ]` = open, `[x]` = done. Every stage ends with a gate the
integrator runs **in the VM or in CI**, and a committed results artifact where
applicable.

### Stage W0 — Grounding and the VM lab (no product code)

Goal: prove the Windows mechanisms this plan depends on, and make the VM
channel real. Mirrors GNOME Stage 0.

| # | Task | Lane | Files |
| --- | --- | --- | --- |
| W0.1 | `Adrt.VmAgent` + watch-folder protocol + `vm.sh` verbs | HARNESS | `windows/src/Adrt.VmAgent/**`, `scripts/windows/vm.sh` |
| W0.2 | VM bootstrap script (SSH, .NET 10, Git, pwsh7, autologon, determinism, folders) + guide | PACKAGING | `scripts/windows/bootstrap-vm.{ps1,cmd}`, `docs/WINDOWS_VM_SETUP.md` |
| W0.3 | Probe: `SetWinEventHook` delivery ordering/dedup on a busy desktop | PLATFORM | throwaway spike + `docs/PROBE_RESULTS_WINDOWS.md` |
| W0.4 | Probe: `DWMWA_EXTENDED_FRAME_BOUNDS` vs `GetWindowRect` across app kinds; UWP unwrap; cloaked detection | PLATFORM | same report |
| W0.5 | Probe: `RegisterHotKey` acceptance matrix (incl. `Win+Ctrl+…`), hook fallback | INPUT+CHROME | same report |
| W0.6 | Probe: virtual-desktop COM capability on the VM's Windows build | PLATFORM | same report |
| W0.7 | Probe: layered click-through overlay over a maximized window; `SendInput` vs foreground lock | INPUT+CHROME | same report |
| W0.8 | Probe: IDD virtual monitors (2 screens, mixed DPI) | PLATFORM | same report |
| W0.9 | CI skeleton (`windows-latest`: build + unit scaffold + format) | PACKAGING | `.github/workflows/windows-ci.yml` |

**Gate:** `bash scripts/windows/vm.sh run echo` returns from a booted VM with no
human; probes documented with raw evidence (command output, captures).
**Parallelism:** W0.3–W0.8 are independent spikes (3 at a time, disjoint
report sections); W0.1/W0.2 must land first.

### Stage W1 — Scaffold and quality gates

Goal: the port's own quality plan, before any behaviour. Mirrors the GNOME P0–P5
guards.

| # | Task | Lane | Files |
| --- | --- | --- | --- |
| W1.1 | `Adrt.sln`, projects, `net10.0-windows`, nullable, warnings-as-errors | CORE | `windows/**` skeleton |
| W1.2 | Architecture tests: Core has no `DllImport`/UI refs; layer direction; public surface snapshot | CORE | `windows/tests/Adrt.Architecture.Tests/**` |
| W1.3 | TS golden-fixture generator (`npm run gen:core-fixtures`) + fixture loader | HARNESS | `scripts/gen-core-fixtures.ts`, `windows/tests/fixtures/**` |
| W1.4 | Scenario runner + results writer + evidence bundles + coverage guard | HARNESS | `windows/src/Adrt.ScenarioRunner/**`, `scripts/windows/check-coverage.py`, lists |
| W1.5 | `dotnet format` + analyzer config; CI wires the full gate | PACKAGING | `.editorconfig`, CI |

**Gate:** every gate command in §0 runs green with zero product code; a dummy
`T00-self-test.ps1` scenario proves the whole loop (job → VM → result →
evidence → results file).
**Parallelism:** W1.2/W1.3/W1.4 in three lanes after W1.1.

### Stage W2 — Core port (the oracle), sharded

Goal: `Adrt.Core` == `src/core`, enforced by the ported tests + fixtures.
Shards are dependency-ordered but the last three are parallel.

| # | Task | Lane | Files (each shard is one owner) |
| --- | --- | --- | --- |
| W2.1 | Primitives: `types`, `profiles`, `identity`, `text`, `settings-descriptor`, `triggers` table | CORE-A | `Adrt.Core/{Types,Profiles,Identity,Text,Settings,Triggers}/**` |
| W2.2 | Decisions: `rules`, `classify`, `placement`, `normalize`, `clamp`, `workspaces` | CORE-B | `Adrt.Core/Decisions/**` |
| W2.3 | Planner: `tiler`, `displays`, `topology`, `focus`, `drag`, `border` | CORE-C | `Adrt.Core/Planning/**` |
| W2.4 | State: `queue`, `scheduler`, `session`, `gestures`, `undo`, `replay` | CORE-D | `Adrt.Core/State/**` |
| W2.5 | Data: `appregistry`, `config`, `timing`, `recording`, `dump-schema`, history JSONL | CORE-E | `Adrt.Core/Data/**` |
| W2.6 | Port `tests/core` → xUnit, shard by the same split; wire fixtures | CORE + HARNESS | `windows/tests/Adrt.Core.Tests/**` |

**Gate:** `dotnet test` green; fixture replay green; 566+ ported cases; the TS
core still green (fixtures were generated, not hand-edited).
**Parallelism:** W2.1→W2.2→W2.3 is a chain; W2.4/W2.5 parallel with W2.2/W2.3
where imports allow; W2.6 follows each shard one-by-one. Nominal 3 lanes.

### Stage W3 — Platform foundation (first real tiling)

Goal: two Notepad windows tile as a pair; maximize/minimize basics; the app
survives lock/unlock; the tray shell exists.

| # | Task | Lane | Files |
| --- | --- | --- | --- |
| W3.1 | Event pump + window tracker (hooks → queue), UWP unwrap, cloak/owner/kind mapping | PLATFORM | `Adrt.Windows/Host/Tracking/**` |
| W3.2 | Monitors, work areas, DPI (PerMonitorV2), display changes | PLATFORM | `Adrt.Windows/Host/Displays/**` |
| W3.3 | Geometry apply (`SetWindowPos` batch), maximize/minimize/restore basics | PLATFORM | `Adrt.Windows/Host/Geometry/**` |
| W3.4 | App shell: tray, lifecycle, self-heal/restart policy port | UI | `Adrt.Windows/Tray/**` |
| W3.5 | Session modes: lock/unlock, fullscreen pause | PLATFORM | `Adrt.Windows/Host/Session/**` |
| W3.6 | Scenarios T01 (pair), T02 (third window), T03 (maximize basics), T04 (lock/unlock), T05 (multi-monitor basics) | HARNESS | `tests/windows/T0*.ps1` |

**Gate:** `vm.sh run T01..T05` green 3× in a row on a fresh snapshot.
**Parallelism:** W3.1/W3.2/W3.4 parallel; W3.3 after W3.1+W3.2; scenarios after
their feature.

### Stage W4 — Model behaviours

Goal: the v2 model is in effect: maximize ladder, workspaces, floats, clamp,
reaping, adaptation, undo, focus.

| # | Task | Lane | Files |
| --- | --- | --- | --- |
| W4.1 | Maximize/unmaximize ladders, lone-maximize, pair splits | PLATFORM | `Host/Model/**` |
| W4.2 | Workspaces → virtual desktops (probe-gated) + single-desktop degrade | PLATFORM | `Host/Workspaces/**` |
| W4.3 | Floats, never-tile, above, dialogs/modals | PLATFORM | `Host/Floats/**` |
| W4.4 | Clamp, reaping, periodic sweep | PLATFORM | `Host/SelfHeal/**` |
| W4.5 | Adaptation/refusal ladder + stubborn cooldown wiring | PLATFORM | `Host/Adapt/**` |
| W4.6 | Undo, focus cycle/direction, ratios persistence | PLATFORM | `Host/Actions/**` |
| W4.7 | Scenarios T06–T16 (max ladder, reap, floats, clamp, undo, focus, workspaces, adaptation) | HARNESS | `tests/windows/T0[6-9]*.ps1`, `T1*.ps1` |

**Gate:** `vm.sh run model` (T06–T16) green; unit suite green; journal scan
clean.
**Parallelism:** W4.2/W4.4/W4.5 parallel (disjoint); W4.1/W4.3/W4.6 partly
serialise on W4.1.

### Stage W5 — Input and chrome

Goal: the `Keys` page's shortcuts work, drags are interpreted, the border
renders.

| # | Task | Lane | Files |
| --- | --- | --- | --- |
| W5.1 | Hotkey registration + Windows default-table audit + conflict test (T17, the A39 twin) + optional LL-hook fallback | INPUT+CHROME | `Adrt.Windows/Input/Hotkeys/**` |
| W5.2 | Focus/move/nudge/increase-decrease actions via the trigger/session path | INPUT+CHROME | `Adrt.Windows/Input/Actions/**` |
| W5.3 | Drag interpretation (`EVENT_SYSTEM_MOVESIZE*` → `core/drag`) incl. inner-edge ratio | INPUT+CHROME | `Adrt.Windows/Input/Drag/**` |
| W5.4 | Border overlay + animations policy | INPUT+CHROME | `Adrt.Windows/Overlay/**` |
| W5.5 | Scenarios T17–T24 (hotkeys, move/focus, nudge, resize limit, drag pair, float key, border, cursor centre) | HARNESS | `tests/windows/T1[7-9]*.ps1`, `T2*.ps1` |

**Gate:** `vm.sh run input` green 3×; no hook-related crash in 30 min soak.
**Parallelism:** W5.1/W5.3/W5.4 parallel; W5.2 after W5.1.

### Stage W6 — Preferences and tray UX

Goal: everything the GNOME prefs window can do, on Windows.

| # | Task | Lane | Files |
| --- | --- | --- | --- |
| W6.1 | Settings window from the settings descriptor (all pages/rows, typed) | UI | `Adrt.Settings/Pages/**` |
| W6.2 | Rules editor (app picker, title glob, Float action), validation | UI | `Adrt.Settings/Rules/**` |
| W6.3 | Apps registry page: never-tile, forget, clear (confirm), export/import merge/replace | UI | `Adrt.Settings/Registry/**` |
| W6.4 | Tray menu: pause, settings, updates, quit; toasts/notices catalogue | UI | `Adrt.Windows/Tray/**` |
| W6.5 | Scenario T25: options coverage (the A140 twin: every setting has a row, types/bounds match) | HARNESS | `tests/windows/T25-prefs-options.ps1` |

**Gate:** T25 green; a settings→behaviour spot-check scenario green.
**Parallelism:** W6.1→W6.2/W6.3 (same window, sequence within UI lane).

### Stage W7 — Harness parity and the app-compat matrix

Goal: the complete observability surface + the full scenario library +
real-app matrix.

| # | Task | Lane | Files |
| --- | --- | --- | --- |
| W7.1 | All 85 triggers over the named pipe; `DumpState`/`DumpDecisions`/`DumpEvents`/`DumpTrace` parity; per-user ACL | HARNESS | `Adrt.Cli/**`, `Host/Ipc/**` |
| W7.2 | Port the GNOME scenario families 1:1 where the platform maps (T26–T70), mark platform-N/A ones with reasons | HARNESS | `tests/windows/**` |
| W7.3 | App-compat matrix (Explorer, Notepad, VS Code, Chrome, Settings/UWP, Task Manager skip) | HARNESS | `tests/windows/appmatrix/**` |
| W7.4 | Multi-monitor scenarios on the IDD virtual screens; mixed-DPI case | HARNESS | `T7*.ps1` |
| W7.5 | Perf counters, memory bounds, section profiler (`perfStats`) parity | CORE + PLATFORM | `Adrt.Core/Perf/**`, scenarios |
| W7.6 | Nightly full suite on the VM + results artifact `TEST_RESULTS_WINDOWS.md` | PACKAGING | CI + `scripts/windows/vm.sh full` |

**Gate:** full T-suite green from a fresh snapshot, unattended; coverage guard
PASS; results committed by the integrator.
**Parallelism:** W7.1 first (everything drives it); then W7.2/W7.3/W7.4 in
parallel with W7.5.

### Stage W8 — Packaging and beta

Goal: "double-click and it works."

| # | Task | Lane | Files |
| --- | --- | --- | --- |
| W8.1 | Self-contained single-file publish + Inno per-user installer + silent flags | PACKAGING | `windows/installer/adrt.iss` |
| W8.2 | Start-with-Windows toggle + first-run check (snap off, notifications) | UI | `Adrt.Settings/FirstRun/**` |
| W8.3 | Code signing pipeline (cert or `signtool` hook) + SHA256 publication | PACKAGING | CI |
| W8.4 | winget manifest + `winget install Adrt.Adrt` verification | PACKAGING | `windows/installer/winget/**` |
| W8.5 | User guide (`docs/WINDOWS_USER_GUIDE.md`), uninstall/upgrade drill on a clean snapshot | DOCS | docs + VM scenario T90 |
| W8.6 | Beta soak: 8 h mixed workload, no leaks/restarts, evidence bundle | HARNESS | soak script |

**Gate:** clean-VM install → tile → uninstall drill unattended; beta checklist
signed off in the results file.

---

## 4. Progress

| Stage | State | Evidence |
| --- | --- | --- |
| W0 grounding + VM lab | partial | Win11 VM installed and verified (UEFI, Secure Boot, TPM 2.0); snapshot `clean`; no SSH/VmAgent channel yet — `docs/WINDOWS_VM_NOTES.md` |
| W1 scaffold + gates | done | `Adrt.slnx`, architecture/purity/API tests, CI, format gate; 626 tests green |
| W2 core port + fixtures | done | 38 modules ported 1:1; 619 tests + 17 documented platform skips |
| W3 platform foundation | done (single monitor) | live pair tiling verified in the VM: 2 placements, 0 mismatches |
| W4 model behaviours | mostly done | maximize ladder, undo, clamp, reaping, focus, floats + ratio persistence, refusal adaptation, virtual-desktop service (single-desktop degrade); not live-tested |
| W5 input + chrome | done | 25 bindings with fallbacks, drag interpretation, DWM focus border, pause/lock; partially VM-exercised |
| W6 prefs + tray | done | descriptor-driven settings, rules editor, apps registry, tray menu; runtime UI not exercised |
| W7 harness + app matrix | partial | pipe server + CLI + `vm.sh` + T00/T01; trigger coverage in progress; no VmAgent, no T-suite run, no app matrix |
| W8 packaging and beta | files done | Inno per-user installer, winget template, release workflow, user guide; not built/installed on Windows |

Remaining work is verification, not architecture: multi-monitor orientation matrix
(skipped in the VM for now), runtime UI/IPC exercises, the Windows scenario suite,
and installer drills.

---

## 5. Stage-level watch items

- **W0.3/W0.5**: if `SetWinEventHook` floods under load, the queue must drop
  with a counter (the GNOME drain already models this) — measure before W3.
- **W0.6/W4.2**: virtual-desktop COM is the single biggest platform risk; the
  single-desktop degrade must be a first-class mode, tested by T-scenarios that
  simply expect it when the probe says so.
- **W3.2**: mixed-DPI rects are the most common "mystery misplacement" source;
  the probe pins the math before the planner is wired.
- **W5.1**: the defaults table is a user-visible decision; audit against
  reserved combos and keep a "reset to defaults".
- **W7.2**: platform-N/A scenarios must be *classified*, not deleted — the
  coverage guard treats "missing for the platform" as a recorded reason.

Open decisions are listed in `docs/WINDOWS_PORT.md` §11 and block W3/W4/W5 as
noted there.
