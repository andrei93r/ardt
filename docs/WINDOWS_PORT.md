# Adrt for Windows — port plan (C#)

Branch: `windows_port` (experiment; `src/` GNOME implementation stays reference).
Spec: `docs/V2_MODEL.md` remains the authority for behaviour. This document is
the strategy and platform mapping. The executable stage checklist — agent work
split, VM lab and the automated-testing machinery — is
`docs/WINDOWS_PORT_PLAN.md`.

---

## 1. Goal and acceptance criteria

**Goal.** A per-user Windows app (tray + settings window) that tiles windows
into pairs per monitor exactly as the v2 model describes, with Windows-specific
input, workspaces mapped to virtual desktops, and a one-click installer.

**"Easy installable" means, concretely:**

1. One `AdrtSetup-<ver>.exe` (Inno Setup), **per-user, no admin prompt**, checks
   nothing, downloads nothing at install time, finishes in under ~30 s.
2. No runtime prerequisite: self-contained .NET (single-folder or single-file),
   works on a clean Windows 10 22H2 / Windows 11.
3. Start Menu entry, optional "Start with Windows" toggle inside the app,
   clean uninstaller that leaves `%APPDATA%\Adrt` (user data) unless asked.
4. `winget install Adrt.Adrt` works (manifest submitted), and `AdrtSetup.exe
   /VERYSILENT /SUPPRESSMSGBOXES` works for scripted installs.
5. Updates: first release manual; auto-update (Velopack) is a later phase.
6. The binary is code-signed (see §11); unsigned builds are dev-only.

**Non-goals for v1** (fine to cut, revisit later): touchpad gestures, GNOME-style
overview interactions, per-connector gaps, auto-update, MSIX/Store packaging,
screen-sharing auto-pause (no public Windows API, see §7.9).

---

## 2. Strategy

The repository was built for exactly this: `src/core/` is pure TypeScript with
**no `gi://`, no Mutter, no Shell** — 6,849 lines across 38 modules — and the
platform surface is five small interfaces (`src/platform/host.ts`, `events.ts`,
`settings.ts`, `indicator.ts`, `dbus.ts`). The GNOME adapter implements those
interfaces; nothing else touches the OS.

So the port is **not** a from-scratch rewrite of the product. It is:

1. **Port `src/core` to C# 1:1** (same module boundaries, same names, same
   comments and decision references). The pure core is the asset that took the
   longest to get right; keep it.
2. **Port `tests/core` to xUnit 1:1** (566 tests). This is the correctness
   oracle: the C# core is "done" when the same cases pass. Add golden-fixture
   replay (§6.3) so a TS bug fix and a C# bug can never silently diverge.
3. **Write a new Windows platform layer** against Win32/DWM/WinRT — this is the
   real work, because Windows' window manager is a different animal (§7).
4. **Reuse the model's own mechanisms.** adrt already has the pieces Windows
   needs and Windows apps force: a coalescing drain queue, a refusal ladder for
   apps that reject geometry, per-app adaptation, clamp, self-heal. Electron
   and UWP apps on Windows will exercise all of them exactly like GNOME apps do.
5. **Port the observability surface** (the 85 `DumpState`/trigger methods) to a
   local named pipe so the autonomous test harness survives the move (§8).
6. **Keep the GNOME implementation untouched.** The v2 model and the nested
   scenarios are the shared specification; the C# side ports the *tests*, not
   the code.

Technology baseline:

| Choice | Decision | Why |
| --- | --- | --- |
| Runtime | **.NET 10 LTS, C# 14** | current LTS; source generators; single-file publish |
| Tray + app shell | **WinForms NotifyIcon** inside a WPF app | zero extra deps, battle-tested tray |
| Settings UI | **WPF** | mature, full-trust, no packaging constraints (WinUI 3 ties you to the Windows App SDK and packaging stories that fight tray/startup) |
| P/Invoke | **Microsoft.Windows.CsWin32** source generator | compile-time interop, no runtime deps, safe signatures |
| Tests | **xUnit v3** + the ported client harness | matches the existing test families |
| Installer | **Inno Setup** (per-user) + **winget** | smallest path to "double-click and it works" |
| Auto-update (later) | **Velopack** | Squirrel-style delta updates without MSIX |

---

## 3. Repository layout on this branch

```
windows/
  Adrt.sln
  src/
    Adrt.Core/            # port of src/core (pure; no P/Invoke, no UI)
    Adrt.Windows/         # platform: hooks, geometry, DWM, input, tray host
    Adrt.Settings/        # WPF preferences window
    Adrt.Cli/             # harness/automation client + app-compat runner
  tests/
    Adrt.Core.Tests/      # xUnit port of tests/core (the oracle)
    Adrt.Integration/     # scenario runner against a live desktop
    clients/              # deterministic test windows (pair, refuse, dialog, float)
  installer/
    adrt.iss
    winget/               # manifest templates
docs/WINDOWS_PORT.md      # this file
src/                      # GNOME implementation, untouched
tests/                    # GNOME suites, untouched
```

`Adrt.Core` must stay free of `P/Invoke` and UI types, exactly like the TS core
is free of `gi://` — the existing purity gate becomes an analyzer test that
fails the build if `Adrt.Core` references `DllImport`/`System.Windows`.

---

## 4. Core port (phase 1, mechanical but exact)

Port order follows the dependency layers in `src/core`:

| Layer | Modules (LOC) | Notes |
| --- | --- | --- |
| Types & pure helpers | `types`, `profiles`, `identity`, `text`, `focus` (215+111+181+?+162) | discriminated unions → C# records + pattern matching |
| Decisions | `rules`, `classify`, `placement`, `normalize`, `clamp`, `workspaces`, `displays`, `topology` (316+160+334+139+?+60+459+306) | the heart; port tests together with each module |
| Planner | `tiler` (579), `replay` (528) | `computePlans` and the event replay; keep the same function names |
| State & history | `undo` (103), `queue` (147), `scheduler`, `session`, `gestures` (211) | `TimeProvider` replaces `Date.now` injection seams |
| Registry & config | `appregistry` (512), `config` (279), `timing` (272), `recording` (187), `dump-schema` (327) | JSON shapes must stay byte-compatible for fixtures |
| Trigger table | `triggers` (175, 85 methods) | one table drives IPC + dispatch, same as D-Bus today |

Translation rules:

- Keep **file, type and function names**; keep the comments, including the
  `§n`/decision references — they are the link to the model.
- `readonly` arrays → `IReadOnlyList<T>`; object literals → `record`s; string
  unions → enums or const strings (match the JSON wire names exactly).
- "No wall-clock/randomness in core" carries over: time enters via
  `TimeProvider`, and the port's analyzer enforces the same rule.
- The TS `Result`-less style stays: exceptions only at the boundary, errors as
  values otherwise.

**Golden fixtures (strongly recommended).** Add a small TS script
(`npm run gen:core-fixtures`) that serialises the inputs/outputs of the core
tests (tiler plans, classifications, placements, replay traces, registry edits)
to `windows/tests/fixtures/*.json`. The C# tests replay them first; hand-ported
xUnit cases cover the rest. A divergence between the two implementations then
fails loudly on either side.

---

## 5. Windows platform layer

### 5.1 Threading and the drain

adrt's model is event-in → queue → 50 ms coalesced drain. On Windows:

- One **STA UI thread** with a message pump. `SetWinEventHook` with
  `WINEVENT_OUTOFCONTEXT` delivers callbacks on that thread, so the pump is the
  event source; callbacks only enqueue (no policy in them — same rule as GNOME).
- A `WM_TIMER`/`DispatcherTimer` renders the 50 ms drain and the safety sweep
  (`scan-interval`).
- `Adrt.Cli` talks to the app over a named pipe; pipe messages are queued on
  the same drain, so the harness observes the same ordering guarantees the
  D-Bus triggers have today.

### 5.2 Window tracking

| Need | Windows API |
| --- | --- |
| New / gone / moved / minimized windows | `SetWinEventHook`: `EVENT_OBJECT_CREATE/DESTROY/LOCATIONCHANGE`, `EVENT_SYSTEM_MINIMIZESTART/END`, `EVENT_SYSTEM_FOREGROUND`, `EVENT_OBJECT_CLOAKED/UNCLOAKED` |
| Identity | `GetWindowThreadProcessId` + process image name/AUMID + `GetClassNameW` (mirror of appId/identity) |
| UWP/Store apps | main HWND is `ApplicationFrameHost.exe`; find the real process via the child `Windows.UI.Core.CoreWindow`, and ignore `DWMWA_CLOAKED != 0` windows |
| Dialogs/tool windows | `GetWindowLong(GWL_EXSTYLE)` (`WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE`), `GetWindow(GW_OWNER)`, `GetWindowLong(GWL_STYLE)` (`WS_POPUP`) — maps onto `classify`'s kinds |
| Focus | `GetForegroundWindow` + `EVENT_SYSTEM_FOREGROUND` |
| Fullscreen/“above” | `GetWindowRect` vs monitor + `SHQueryUserNotificationState` (fullscreen/presentation), `WS_EX_TOPMOST` |

### 5.3 Geometry

- Visible bounds: `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`; fall back
  to `GetWindowRect` for windows that fail DWM.
- Monitors/work areas: `EnumDisplayMonitors` + `GetMonitorInfo`
  (`rcWork` respects the taskbar), `WM_DISPLAYCHANGE` for topology changes.
- **PerMonitorV2 DPI awareness** in the manifest; all rects kept in physical
  pixels internally (matches the model's `Screen.scale` handling).
- Apply with `SetWindowPos` (`SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOSENDCHANGING`)
  or `BeginDeferWindowPos` for a two-window batch.
- **Minimum sizes cannot be queried cross-process.** Use the model's refusal
  ladder: request the half, read back what the window took, and let
  `adapt`/`stubborn` do exactly what they do on GNOME (this is why the
  adaptation subsystem ports unchanged).

### 5.4 Maximize, minimize, restore, floats

`ShowWindow(SW_MAXIMIZE/SW_MINIMIZE/SW_RESTORE)`, `SetWindowPos(HWND_TOPMOST)`
for `above`. The model's "maximize moves to its own workspace" maps to a
**virtual desktop** (§5.5). Native animations are the OS's; adrt only animates
its own moves (later phase).

### 5.5 Workspaces → virtual desktops

This is the biggest platform gap:

- **Documented:** `IVirtualDesktopManager.MoveWindowToDesktop`,
  `IsWindowOnCurrentVirtualDesktop`, `GetWindowDesktopId`.
- **Undocumented:** create/remove/switch are on `IVirtualDesktopManagerInternal`
  (COM vtable + GUIDs that change between Windows builds — 24H2 already moved
  some).
- Plan: a versioned interop module with runtime probing, behind the existing
  `WorkspaceHost` interface. If the COM surface is not recognised, degrade to
  **single-desktop mode** (one workspace; maximize stays in place), which is a
  legal v2 configuration (`§7 single-workspace-capable screens`). Never crash
  the session over it.
- Windows has no "workspaces only on primary": every virtual desktop spans all
  monitors. The model's per-screen workspace filtering therefore collapses to
  "the active desktop"; document this as a platform deviation.

### 5.6 Input

- Keys: `RegisterHotKey` for every `kb-*` setting. Windows reserves many
  `Win+<key>` combos (arrows, D, E, L...), so the default table needs a
  Windows-specific pass: keep `Super+Ctrl+H/J/K/L`-style *modifier+letter*
  bindings that Windows does not own (the GNOME defaults `Super+Alt+...` also
  collide with nothing on Windows). Provide a "reset to defaults" button.
- Fallback: a `WH_KEYBOARD_LL` hook for combos `RegisterHotKey` refuses. This
  needs a signed binary (AV/SmartScreen) and is only armed when a binding
  actually requires it.
- Move/resize with the mouse: Windows owns window drags (`WM_ENTERSIZEMOVE` /
  `EVENT_SYSTEM_MOVESIZESTART/END`). On release, read the final rect and
  interpret it through the same pure `core/drag` policy. Inner-edge drags
  become "a move whose edge touched the shared split": derive the ratio from
  the release rect. Floats are left entirely to the OS.
- Pointer centre: `SetCursorPos` (no GNOME seat restrictions).

### 5.7 Border / highlight

One click-through overlay per monitor: a layered window
(`WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`)
owned by the app, redrawn on focus/occlusion changes (the `border.ts` state
machine ports as-is). Colour/width/radius/pulse come from settings unchanged.
Render with Direct2D or GDI+; the overlay must not be a tracked window.

### 5.8 Session modes

- Lock/unlock: `WTSRegisterSessionNotification` (`WTS_SESSION_LOCK/UNLOCK`).
- Fullscreen: `SHQueryUserNotificationState` + the classify check; pause tiling
  for exclusive fullscreen, keep the border hidden.
- **Screen sharing: no public detection API.** Cut the
  `pause-during-sharing` feature (or make it manual from the tray menu); note
  it in the parity matrix.

### 5.9 Settings, registry, config

- `%APPDATA%\Adrt\settings.json` with the **same key names** as the gschema
  (the settings descriptor is generated from a JSON schema that mirrors
  `settings-descriptor.ts`), same defaults, versioned migrations.
- App registry `%APPDATA%\Adrt\registry.json`, same shape as today (the import
  /export/merge/stubborn semantics port unchanged).
- Event history JSONL in `%APPDATA%\Adrt\history\` with the same rotation rules.

### 5.10 IPC (the harness surface)

Named pipe `\\.\pipe\adrt` (ACL: current user SID only), newline-delimited
JSON-RPC, driven by the **same 85-entry trigger table** with the same names and
signatures. The GNOME harness scenarios become Windows scenarios by swapping
`gdbus call` for `Adrt.Cli call`. Add `SpawnWindow(argv, env)` with the same
contract so the app-compat matrix ports.

### 5.11 Tray and toasts

Tray icon with pause/resume, "relaunch", "open settings", "quit". The model's
notifications go to Windows toast notifications (or tray balloons if the toast
API is unavailable); same notice keys/catalogue semantics.

---

## 6. Testing and CI

### 6.1 Unit (fast, always green)

- `Adrt.Core.Tests`: the 566 ported cases + golden fixtures + new Windows-only
  core cases. Runs on every commit on `windows-latest`.

### 6.2 Integration (the nested-suite equivalent)

There is no nested compositor on Windows, so integration runs on a **real
interactive desktop** (a VM). Components:

- `Adrt.Cli` drives the running app via the pipe: spawn clients, query
  `DumpState`/`DumpDecisions`, inject keys (`SendInput`), move windows.
- Deterministic test clients (`windows/tests/clients`): a WPF window with a
  configurable minimum size, a dialog/owner window, a refusing window, a
  always-on-top window — the same cast as `tests/agent/cover-dialog-client.py`
  and friends.
- Ported scenario families, in the same order as the GNOME suite: pair tiling,
  third window, maximize ladder, floats, ratio/undo, clamp, reaping, registry,
  rules, workspaces (virtual desktops where the COM surface is available),
  multi-monitor (`EnumDisplayMonitors` fixtures/VM with 2 virtual screens).
- The app-compat matrix: Explorer, Notepad, VS Code, Chrome, Word/Office,
  Settings (UWP), Task Manager (elevated → skip with reason).

### 6.3 Fidelity gate

`Adrt.Core.Tests` must consume the TS-generated fixtures (§4). A red fixture is
a stop-the-line event: either the C# port diverges or the TS core changed and
the fixture was regenerated deliberately.

### 6.4 CI

- `windows-latest`: build, analyzers (core purity), unit tests, `dotnet format`
  check.
- Self-hosted Windows VM: integration suite + app matrix, nightly (the runners'
  session cannot be trusted for real window management).
- Release job: signed build, Inno installer, winget manifest validation.

### 6.5 Performance

Port the dev-gated section profiler (`perfStats`) with `Stopwatch`; assert the
same bounded counters (drain/retile/apply/classify) and the memory-bounds test.

---

## 7. Feature parity matrix

| v2 model area | Windows | Notes |
| --- | --- | --- |
| Pair tiling per monitor | ✅ | `SetWindowPos` + work areas |
| Per-screen axis (landscape/portrait) | ✅ | monitor aspect ratio, same predicate |
| Maximize model (lone → own space, ladder) | ✅ / ⚠️ | own space = virtual desktop; degrade in single-desktop mode |
| Unmaximize ladder, joins/park | ✅ | pure core |
| Floats, never-tile, above | ✅ | `HWND_TOPMOST`, registry |
| Rules (app/title/kind/float/full/half) | ✅ | same editor, WPF |
| Ratios, per workspace+monitor, undo | ✅ | pure core |
| Workspaces: pack, reap, reorder | ⚠️ | virtual desktops; reorder = COM, may be unavailable |
| Workspaces only on primary | ❌ | platform has no such concept |
| Clamp to screen | ✅ | pure core + `SetWindowPos` |
| Focus direction/move, nudges, resize | ✅ | hotkeys; defaults re-picked vs Windows |
| Drag/drop interpretation | ⚠️ | OS-owned drags; interpret on release |
| Active-window border | ✅ | layered overlay |
| Animations | ⚠️ | later; OS animates its own |
| Gestures | ❌ v1 | RawInput HID is fragile; cut from v1 |
| Overview interactions | ❌ | Task View is not scriptable |
| Session modes (lock, fullscreen) | ✅ | WTS + `SHQueryUserNotificationState` |
| Pause during screen sharing | ❌ | no public API; manual pause instead |
| Registry (profiles/adaptation/ordinals) | ✅ | same JSON |
| History/recording/diagnostics | ✅ | JSONL + pipe |
| Config export/import | ✅ | same bundle shape |

---

## 8. Packaging (the "easy installable" specifics)

1. `dotnet publish windows/src/Adrt.Windows -c Release -r win-x64
   --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true`
   — no .NET prerequisite. (~80–150 MB; trimming WPF is limited, accept it.)
2. `installer/adrt.iss` (Inno Setup, `PrivilegesRequired=lowest`):
   install to `%LocalAppData%\Programs\Adrt`, Start Menu shortcut, optional
   "Start with Windows" checkbox (registry `Run` key, toggleable in-app),
   uninstaller, `/VERYSILENT` support.
3. Sign the exe + installer with a code-signing certificate (OV or EV).
   Unsigned builds show SmartScreen warnings and can trip AV hooks.
4. `win-get`: submit `manifests/a/Adrt/Adrt/<ver>` with the installer URL and
   SHA256 → `winget install Adrt.Adrt`.
5. Later: Velopack auto-update + delta packages.

---

## 9. Phases and effort (single experienced C#/Win32 engineer)

| Phase | Deliverable | Estimate |
| --- | --- | --- |
| P0 | solution, CI, analyzer gates, fixture generator | 3–5 days |
| P1 | `Adrt.Core` + xUnit port + fixtures green (566+) | 3–5 weeks |
| P2 | platform essentials: tracking, monitors/DPI, geometry, drain, first real tiling (pair, maximize, focus) | 4–6 weeks |
| P3 | model features: virtual desktops, floats, clamp, reaping, adaptation, undo | 3–4 weeks |
| P4 | input: hotkeys (defaults audit), move/focus/nudge/resize, drag interpretation, border overlay | 3–4 weeks |
| P5 | settings window, tray, rules editor, registry tools, toasts | 3–4 weeks |
| P6 | pipe harness, ported integration scenarios, app-compat matrix, perf gates | 3–5 weeks |
| P7 | Inno + winget + signing + docs + beta hardening | 2–3 weeks |

Roughly **5–7 months** for one engineer; **3–4 months** for three working on the
seams in parallel (core / platform / tests+packaging). P1 can start
immediately and is a natural parallel track.

---

## 10. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Virtual-desktop COM GUIDs change per Windows build | workspace features degrade | versioned interop with runtime probing; single-desktop mode; never throw |
| `SetForegroundWindow` foreground lock blocks keyboard focus changes | focus shortcuts flaky | `AllowSetForegroundWindow`/`AttachThreadInput` tricks, retry on `EVENT_SYSTEM_FOREGROUND`; document limitations |
| Reserved combos (`Win+arrows`, `Win+D`) | default hotkeys unusable | Windows-specific default table; `WH_KEYBOARD_LL` fallback for opted-in bindings |
| Windows Snap fights the tiler | user sees two snapping systems | require "Snap windows" off (first-run check + docs), same stance GNOME takes with edge-tiling |
| UWP/cloaked/elevated windows | phantom or untouchable windows | ApplicationFrameHost unwrap, `DWMWA_CLOAKED`, elevated windows skipped with a named reason |
| Mixed-DPI multi-monitor | wrong rects | PerMonitorV2 + physical-pixel model (already scale-aware) |
| AV/SmartScreen false positives on hooks | app blocked | signed releases; hook only when needed |
| No gesture touchpad support | feature loss | explicitly cut from v1 |
| Integration tests need a real desktop | CI can't cover window management on hosted runners | self-hosted VM nightly; hosted runners for unit only |

---

## 11. Open decisions to settle before P2

1. **Default hotkey table for Windows** — which `kb-*` defaults, given reserved
   combos. (Proposal: `Win+Ctrl+H/J/K/L` for focus/move/nudges, `Win+Ctrl+↑/↓`
   only if `RegisterHotKey` accepts them; otherwise letters.)
2. **Virtual-desktop strategy** — full COM interop vs documented-only +
   single-desktop mode. (Proposal: documented-only first, COM behind a flag.)
3. **Maximize-to-own-desktop semantics** on Windows (the model's "own
   workspace") — virtual desktop per maximize is heavy; alternative: maximize
   in place when desktops are unavailable (already in the model).
4. **Auto-update** — Velopack now or later. (Proposal: later; manual first.)
5. **Scope of the app-compat matrix** for the first beta (Office/Word may be
   licensed; choose Explorer, Notepad, VS Code, Chrome, Settings).

---

## 12. P0 checklist (next concrete steps)

1. `dotnet new sln` + projects under `windows/`, `net10.0-windows`, nullable
   enabled, `TreatWarningsAsErrors`.
2. Add the `Adrt.Core` purity analyzer test (no `DllImport`, no UI namespaces).
3. Add `scripts/gen-core-fixtures` to dump core test vectors to JSON.
4. Stand up CI: build, unit tests, fixtures replay skeleton, `dotnet format`.
5. Port `types`, `rules`, `classify` + their tests as the first vertical slice;
   prove the fixture pipeline on it.
6. Spike (time-boxed, throwaway): event hook + `SetWindowPos` on two Notepad
   windows to validate the threading/drain design before committing to P1/P2
   sequencing.
