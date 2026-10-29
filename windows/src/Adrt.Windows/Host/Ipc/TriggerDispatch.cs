using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// Maps the ported trigger table onto the host's public surface. Triggers the
/// host cannot yet honour return a structured <c>notImplemented</c> object
/// instead of failing the pipe (the transport stays policy-free).
/// </summary>
/// <remarks>
/// The dispatch table is keyed by the exact names in <see cref="Triggers.All"/>:
/// every core name gets an entry, either a real handler or an honest
/// <c>notImplemented</c> with a reason. Names outside the table still answer
/// <c>{notImplemented: name}</c> so a direct caller cannot crash the loop, but
/// <see cref="IpcServer"/> rejects them first. Action triggers are delegated to
/// <see cref="TriggerActions"/>, which reuses the hotkey lane's
/// <see cref="Adrt.Windows.Input.Actions.WindowActions"/>.
/// </remarks>
public sealed class TriggerDispatch
{
    /// <summary>The default nudge step, matching the hotkey table (10%).</summary>
    private const double DefaultNudgeStep = 0.10;

    private static readonly HashSet<string> KnownTriggers =
        Triggers.All.Select(trigger => trigger.Name).ToHashSet(StringComparer.Ordinal);

    /// <summary>
    /// The reasons the Windows host cannot answer a core trigger yet. Every
    /// remaining name is filled from this table at construction, so coverage is
    /// explicit and a newly ported trigger cannot silently keep returning
    /// <c>notImplemented</c>.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, string> UnsupportedReasons =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["GetSplitRatio"] = "TilingHost has no ratio getter; the stored table is host-private",
            ["MoveFocusedToWorkspace"] = "the Windows host has one workspace; virtual-desktop ids are not addressable by index",
            ["ReloadRules"] = "the Windows host has no rule store yet",
            ["ResetPerApp"] = "the host's adaptation store is private",
            ["GetAdaptations"] = "the host's adaptation store is private",
            ["ForgetAdaptation"] = "the host's adaptation store is private",
            ["ForgetFloat"] = "FloatState has no forget-by-app-id entry point",
            ["ExportConfig"] = "no config-transfer service on Windows yet",
            ["ImportConfig"] = "no config-transfer service on Windows yet",
            ["ListHistoryDays"] = "no history store on Windows yet",
            ["SimulateGesture"] = "there is no touchpad-gesture input path in the Windows host",
            ["InjectSignal"] = "the Windows host has no event journal or signal bus",
            ["SimulateSessionMode"] = "session lock is handled inside InputLayer and is not exposed to IPC",
            ["SimulateOverview"] = "there is no overview controller in the Windows host",
            ["BeginDrag"] = "drag state is driven by WinEvent hooks and has no injection entry point",
            ["EndDrag"] = "drag state is driven by WinEvent hooks and has no injection entry point",
            ["ActivateWorkspace"] = "the Windows host runs a single workspace",
            ["InjectVerifyFailure"] = "the Windows host has no fault-injection hook",
            ["ResetLayoutState"] = "the host has no single reset for ratios, undo and signatures",
            ["SimulateWorkspaceSwitch"] = "the Windows host runs a single workspace",
            ["MoveToWorkspace"] = "the Windows host runs a single workspace; virtual-desktop ids are not addressable by index",
            ["MarkWorkspaceCached"] = "the Windows host runs a single workspace and has no workspace cache",
            ["ToggleFullscreen"] = "the Windows host has no fullscreen state; use MaximizeWindow",
            ["SimulateSticky"] = "show-on-all-desktops needs an undocumented Windows API",
            ["SimulateWorkspaceReorder"] = "the Windows host runs a single workspace",
            ["SimulateWorkspaceOrientation"] = "the Windows host runs a single workspace",
            ["InjectFault"] = "the Windows host has no fault-injection hook",
            ["SimulateChromeTeardown"] = "the Windows host has no adrt shell chrome actors",
            ["StartFrameRecording"] = "there is no animation-frame sampler in the Windows host",
            ["StopFrameRecording"] = "there is no animation-frame sampler in the Windows host",
            ["GetRegistry"] = "no app registry on Windows yet",
            ["SetNeverTile"] = "no app registry on Windows yet",
            ["ToggleNeverTile"] = "no app registry on Windows yet",
            ["ForgetApp"] = "no app registry on Windows yet",
            ["GetDisplayMemory"] = "no display-memory store on Windows yet",
            ["ForgetDisplayMemory"] = "no display-memory store on Windows yet",
            ["SimulateScreens"] = "the Windows host reads the live monitor topology; simulated screens are not ported",
            ["SimulateWorkArea"] = "the Windows host reads live work areas; simulated work areas are not ported",
            ["InjectPointerButton"] = "real input injection (SendInput) is not wired yet",
            ["SimulateBurst"] = "there is no event journal to burst",
            ["SimulateNotice"] = "no toast/notice catalogue on Windows yet",
            ["InjectKey"] = "real key injection and X11-keyval mapping are not wired yet",
            ["SetSetting"] = "no settings store is exposed over IPC yet",
            ["SetSchemaSetting"] = "no settings store is exposed over IPC yet",
        };

    private readonly TilingHost _host;
    private readonly TriggerActions _actions;
    private readonly Action _quit;
    private readonly Action<string> _log;
    private readonly Dictionary<string, Func<JsonNode?, JsonNode?>> _handlers;
    private readonly HashSet<string> _supported = new(StringComparer.Ordinal);

    /// <summary>Create a dispatcher over a started host with the default nudge step.</summary>
    /// <param name="host">The tiling host.</param>
    /// <param name="quit">Called for the <c>Quit</c> trigger.</param>
    /// <param name="log">Optional diagnostics sink.</param>
    public TriggerDispatch(TilingHost host, Action quit, Action<string>? log = null)
        : this(host, quit, DefaultNudgeStep, log)
    {
    }

    /// <summary>Create a dispatcher over a started host.</summary>
    /// <param name="host">The tiling host.</param>
    /// <param name="quit">Called for the <c>Quit</c> trigger.</param>
    /// <param name="nudgeStep">The configured nudge step, for triggers without an explicit step.</param>
    /// <param name="log">Optional diagnostics sink.</param>
    public TriggerDispatch(TilingHost host, Action quit, double nudgeStep, Action<string>? log)
    {
        _host = host ?? throw new ArgumentNullException(nameof(host));
        _quit = quit ?? throw new ArgumentNullException(nameof(quit));
        _log = log ?? Console.WriteLine;
        _actions = new TriggerActions(host, nudgeStep, _log);
        _handlers = new Dictionary<string, Func<JsonNode?, JsonNode?>>(StringComparer.Ordinal);

        RegisterHandlers();

        foreach (Trigger trigger in Triggers.All)
        {
            if (_handlers.ContainsKey(trigger.Name)) continue;

            string reason = UnsupportedReasons.TryGetValue(trigger.Name, out string? why)
                ? why
                : "no Windows implementation yet";
            _handlers[trigger.Name] = _ => NotImplemented(trigger.Name, reason);
        }

        if (_handlers.Count != Triggers.All.Count)
        {
            throw new InvalidOperationException(
                FormattableString.Invariant(
                    $"dispatch covers {_handlers.Count} of {Triggers.All.Count} triggers"));
        }
    }

    /// <summary>How many core triggers have a real handler.</summary>
    public int SupportedCount => _supported.Count;

    /// <summary>How many trigger names the table dispatches (always <see cref="Triggers.All"/>'s count).</summary>
    public int TriggerCount => _handlers.Count;

    /// <summary>Dispatch one trigger name and return its JSON result.</summary>
    public JsonNode? Invoke(string trigger, JsonNode? args)
    {
        _log($"adrt: ipc {trigger}");

        try
        {
            if (_handlers.TryGetValue(trigger, out Func<JsonNode?, JsonNode?>? handler))
            {
                return handler(args);
            }

            return new JsonObject { ["notImplemented"] = trigger };
        }
        catch (Exception error) when (!IsFatal(error))
        {
            _log(FormattableString.Invariant($"adrt: ipc {trigger} failed: {error.Message}"));
            return new JsonObject
            {
                ["error"] = error.Message,
                ["trigger"] = trigger,
            };
        }
    }

    private void RegisterHandlers()
    {
        // Host-level state and diagnostics.
        Register("DumpState", _ => DumpState());
        Register("ListMonitors", _ => ListMonitors());
        Register("ProbePlatform", _ => ProbePlatform());
        Register("TogglePause", _ =>
        {
            _host.TogglePause();
            return new JsonObject { ["paused"] = _host.IsPaused };
        });
        Register("Undo", _ => new JsonObject
        {
            ["undone"] = _actions.Undo(),
            ["canUndo"] = _host.CanUndo,
        });
        // The GNOME table has no Quit method; if a future core table adds one,
        // it keeps the host's normal shutdown path. Today `Quit` is therefore
        // not reachable over the pipe (Ctrl+C, the tray and the hotkey quit).
        if (KnownTriggers.Contains("Quit"))
        {
            Register("Quit", _ =>
            {
                _quit();
                return null;
            });
        }
        Register("DumpDecisions", _ => EmptyDump(
            "decisions",
            "the Windows host does not keep a decision journal yet"));
        Register("DumpEvents", _ => EmptyDump(
            "events",
            "the Windows host does not keep an event journal yet"));
        Register("DumpTrace", _ => EmptyDump(
            "trace",
            "the Windows host does not keep a trace buffer yet"));

        // Window queries.
        Register("ListWindows", _ => _actions.DescribeAll(_actions.Snapshot()));
        Register("LookupWindow", args =>
            TriggerArgs.Integer(args, 0) is int id ? _actions.Lookup(id) : null);
        Register("GetFloats", _ => _actions.Floats(_actions.Snapshot()));
        Register("SetSplitRatio", SetSplitRatio);

        // Focus, move and the hotkey-shaped actions.
        Register("FocusDirection", args => new JsonObject
        {
            ["focused"] = _actions.Focus(TryDirection(args) ?? FocusDirection.Right),
        });
        Register("FocusCycle", _ => new JsonObject { ["focused"] = _actions.FocusNext() });
        Register("MoveDirection", args =>
            JsonValue.Create(
                TryDirection(args) is FocusDirection direction && _actions.MoveDirection(direction)));
        Register("MoveToward", args =>
            JsonValue.Create(
                TryDirection(args) is FocusDirection direction && _actions.MoveDirection(direction)));
        Register("NudgeSplit", args =>
            JsonValue.Create(
                TryDirection(args) is FocusDirection direction &&
                _actions.Nudge(direction, TriggerArgs.Number(args, 1) ?? DefaultNudgeStep)));
        Register("ResizeFocused", args =>
            JsonValue.Create(
                TryGrow(args) is bool grow &&
                _actions.Resize(grow, TriggerArgs.Number(args, 1) ?? DefaultNudgeStep)));
        Register("CursorToCentre", _ => JsonValue.Create(_actions.CursorToCentre()));
        Register("QuitFocused", _ => JsonValue.Create(_actions.QuitFocused()));
        Register("WarpPointerToMonitor", args =>
            JsonValue.Create(
                TriggerArgs.Integer(args, 0) is int monitor &&
                _actions.WarpPointerToMonitor(monitor)));

        // Window-targeted actions.
        Register("ActivateWindow", args =>
            JsonValue.Create(TriggerArgs.Integer(args, 0) is int id && _actions.Activate(id)));
        Register("CloseWindow", args =>
            JsonValue.Create(TriggerArgs.Integer(args, 0) is int id && _actions.Close(id)));
        Register("MinimizeWindow", args =>
            JsonValue.Create(TriggerArgs.Integer(args, 0) is int id && _actions.Minimize(id)));
        Register("MaximizeWindow", args =>
            JsonValue.Create(TriggerArgs.Integer(args, 0) is int id && _actions.Maximize(id)));
        Register("UnmaximizeWindow", args =>
            JsonValue.Create(TriggerArgs.Integer(args, 0) is int id && _actions.Unmaximize(id)));
        Register("ToggleFloat", args =>
            JsonValue.Create(TriggerArgs.Integer(args, 0) is int id && _actions.ToggleFloat(id)));
        Register("MoveWindow", args =>
            JsonValue.Create(
                TriggerArgs.Integer(args, 0) is int id &&
                TriggerArgs.Number(args, 1) is double x &&
                TriggerArgs.Number(args, 2) is double y &&
                TriggerArgs.Number(args, 3) is double width &&
                TriggerArgs.Number(args, 4) is double height &&
                _actions.Move(id, x, y, width, height)));
        Register("SwapPair", args =>
            JsonValue.Create(
                TriggerArgs.Integer(args, 0) is int first &&
                TriggerArgs.Integer(args, 1) is int second &&
                _actions.SwapPair(first, second)));
        Register("SimulateResize", args =>
            JsonValue.Create(
                TriggerArgs.Integer(args, 0) is int first &&
                TriggerArgs.Integer(args, 1) is int second &&
                TriggerArgs.Number(args, 2) is double ratio &&
                _actions.SimulateResize(first, second, ratio)));
        Register("SimulateAbove", args =>
            JsonValue.Create(TriggerArgs.Integer(args, 0) is int id && _actions.SimulateAbove(id)));

        // Clients and real pointer input.
        Register("SpawnWindow", args =>
        {
            string? argv = TriggerArgs.Text(args, 0);
            return JsonValue.Create(argv is null ? 0 : _actions.Spawn(argv, TriggerArgs.Text(args, 1)));
        });
        Register("InjectPointerMove", args =>
            JsonValue.Create(
                TriggerArgs.Integer(args, 0) is int x &&
                TriggerArgs.Integer(args, 1) is int y &&
                _actions.InjectPointerMove(x, y)));

        // The bug recorder is not ported, but the controls answer with the same
        // inert shape the GNOME handler returns when its recorder is unavailable.
        Register("RecordingStatus", _ => RecordingStatus());
        Register("ToggleRecording", _ => RecordingStatus());
        Register("StartRecording", _ => JsonValue.Create("error: recorder unavailable"));
        Register("StopRecording", _ => JsonValue.Create("error: recorder unavailable"));
        Register("SubmitRecordingNote", _ => JsonValue.Create(false));
        Register("PromptSetText", _ => JsonValue.Create(false));
        Register("PromptPressSave", _ => JsonValue.Create(false));
        Register("PromptPressCancel", _ => JsonValue.Create(false));
    }

    private void Register(string name, Func<JsonNode?, JsonNode?> handler)
    {
        if (!KnownTriggers.Contains(name))
        {
            throw new InvalidOperationException($"trigger {name} is not in Triggers.All");
        }

        if (!_handlers.TryAdd(name, handler))
        {
            throw new InvalidOperationException($"trigger {name} is registered twice");
        }

        _supported.Add(name);
    }

    private JsonNode DumpState()
    {
        IReadOnlyList<Adrt.Windows.Input.Actions.MonitoredWindow> windows = _actions.Snapshot();
        var screens = new JsonArray();
        foreach (MonitorInfo monitor in _actions.Monitors())
        {
            screens.Add(new JsonObject
            {
                ["index"] = monitor.Index,
                ["connector"] = monitor.DeviceName,
                ["isPrimary"] = monitor.IsPrimary,
                ["geometry"] = TriggerActions.RectObject(monitor.Bounds),
                ["workArea"] = TriggerActions.RectObject(monitor.WorkArea),
                ["scale"] = monitor.Scale,
            });
        }

        nint foreground = Win32Window.Foreground.Handle;
        JsonObject? focused = null;
        foreach (Adrt.Windows.Input.Actions.MonitoredWindow window in windows)
        {
            if (window.Handle != foreground) continue;
            focused = _actions.Describe(window);
            break;
        }

        return new JsonObject
        {
            ["format"] = DumpSchema.DumpStateFormat,
            ["version"] = DumpSchema.DumpSchemaVersion,
            ["platform"] = "windows",
            ["paused"] = _host.IsPaused,
            ["canUndo"] = _host.CanUndo,
            ["virtualDesktopsSupported"] = _host.VirtualDesktopsSupported,
            ["activeWorkspace"] = 0,
            ["workspaces"] = 1,
            ["focused"] = foreground == 0 ? null : focused,
            ["monitors"] = screens,
            ["windows"] = _actions.DescribeAll(windows),
            ["floats"] = _actions.Floats(windows),
            ["notes"] = new JsonArray
            {
                "ratios are stored by the host but not exposed for reading",
                "the Windows host has no event/decision/trace journal yet",
            },
        };
    }

    private JsonArray ListMonitors()
    {
        var connectors = new JsonArray();
        foreach (MonitorInfo monitor in _actions.Monitors()) connectors.Add(monitor.DeviceName);
        return connectors;
    }

    private JsonObject ProbePlatform() => new()
    {
        ["platform"] = "windows",
        ["os"] = Environment.OSVersion.VersionString,
        ["architecture"] = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(),
        ["ipc"] = "named-pipe",
        ["triggers"] = Triggers.All.Count,
        ["monitors"] = _actions.Monitors().Count,
        ["virtualDesktopsSupported"] = _host.VirtualDesktopsSupported,
    };

    private JsonNode SetSplitRatio(JsonNode? args)
    {
        if (TriggerArgs.Integer(args, 0) is not int workspace) return JsonValue.Create(false);
        if (TriggerArgs.Number(args, 3) is not double ratio) return JsonValue.Create(false);

        SplitAxis? axis = TriggerArgs.Text(args, 2)?.ToLowerInvariant() switch
        {
            "horizontal" or "h" => SplitAxis.Horizontal,
            "vertical" or "v" => SplitAxis.Vertical,
            _ => null,
        };
        if (axis is not SplitAxis splitAxis) return JsonValue.Create(false);

        int? screen = TriggerArgs.Integer(args, 1);
        if (screen is null)
        {
            string? monitor = TriggerArgs.Text(args, 1);
            if (monitor is null) return JsonValue.Create(false);

            if (int.TryParse(monitor, NumberStyles.Integer, CultureInfo.InvariantCulture, out int parsed))
            {
                screen = parsed;
            }
            else
            {
                foreach (MonitorInfo candidate in _actions.Monitors())
                {
                    if (!string.Equals(candidate.DeviceName, monitor, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    screen = candidate.Index;
                    break;
                }
            }
        }

        if (screen is not int screenId) return JsonValue.Create(false);

        bool changed = _host.SetRatio(workspace, screenId, splitAxis, ratio);
        return JsonValue.Create(changed);
    }

    private static JsonObject EmptyDump(string key, string note) => new()
    {
        [key] = new JsonArray(),
        ["note"] = note,
    };

    private static JsonObject RecordingStatus() => new()
    {
        ["recording"] = false,
        ["path"] = null,
        ["elapsedMs"] = 0,
        ["bytes"] = 0,
        ["events"] = 0,
        ["snapshots"] = 0,
        ["stopReason"] = null,
        ["promptOpen"] = false,
        ["note"] = "the Windows host has no bug recorder yet",
        ["promptMechanism"] = null,
        ["promptGrab"] = false,
        ["promptFocus"] = false,
        ["promptRect"] = null,
    };

    private static JsonObject NotImplemented(string name, string reason) => new()
    {
        ["notImplemented"] = name,
        ["reason"] = reason,
    };

    private static FocusDirection? TryDirection(JsonNode? args)
    {
        string? name = TriggerArgs.Text(args, 0) ?? TriggerArgs.Property(args, "direction");
        return name?.ToLowerInvariant() switch
        {
            "left" => FocusDirection.Left,
            "right" => FocusDirection.Right,
            "up" => FocusDirection.Up,
            "down" => FocusDirection.Down,
            _ => null,
        };
    }

    private static bool? TryGrow(JsonNode? args) =>
        TriggerArgs.Text(args, 0)?.ToLowerInvariant() switch
        {
            "increase" or "grow" => true,
            "decrease" or "shrink" => false,
            _ => null,
        };

    private static bool IsFatal(Exception error) =>
        error is OutOfMemoryException or StackOverflowException or AccessViolationException;
}
