# Adrt for Windows (C#)

Port of the Adrt tiling model to .NET 10 / Win32. The behavioural spec is
`docs/V2_MODEL.md`; the strategy and stage plan are `docs/WINDOWS_PORT.md` and
`docs/WINDOWS_PORT_PLAN.md`.

## Layout

```
windows/
  Adrt.slnx
  Directory.Build.props          # nullable, warnings-as-errors, analyzers
  src/
    Adrt.Core/                   # 1:1 port of src/core — no P/Invoke, no UI
    Adrt.Windows/                # Win32 host: hooks, monitors, geometry, hotkeys
  tests/
    Adrt.Core.Tests/             # xUnit port of tests/core
    Adrt.Architecture.Tests/     # core purity + layer direction
```

`Adrt.Core` must stay platform-free exactly like `src/core` stays free of
`gi://`. The architecture tests enforce it.

## Build and test (any OS)

```sh
export PATH="$HOME/.dotnet:$PATH"        # .NET 10 SDK
dotnet build windows/Adrt.slnx -warnaserror
dotnet test  windows/Adrt.slnx
```

`Adrt.Windows` targets `net10.0-windows` and sets `EnableWindowsTargeting`, so it
compiles on Linux; running it requires Windows.

## Run (Windows)

```powershell
dotnet run --project windows/src/Adrt.Windows
```

The host is a console app for now (tray + WPF settings are later stages). It
hooks window events, classifies/tiles through `Adrt.Core`, and applies geometry
with `SetWindowPos`. Planned hotkeys: `Ctrl+Alt+P` pause/resume, `Ctrl+Alt+Q`
quit.

A test VM with the required TPM 2.0 + Secure Boot configuration is documented in
`docs/WINDOWS_VM_NOTES.md`.

## Fidelity rules

- Keep TypeScript module/type/function names wherever C# allows it; document the
  forced renames (`Classify.ClassifySurface`, `PlacementPolicy`, `Tiler`,
  `Replay.Run`, `Triggers.All`).
- JSON wire names stay camelCase (`[JsonPropertyName]`), enum strings keep
  `[JsonStringEnumMemberName]`.
- Numbers are `double`; time enters through `TimeProvider`, never
  `DateTime.Now`.
- Behaviour is validated against the TypeScript tests, not re-derived.
