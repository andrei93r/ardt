using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Adrt.Core;
using Adrt.Windows.Input;
using Adrt.Windows.Input.Actions;

namespace Adrt.Windows;

/// <summary>
/// The IPC lane's window actions, expressed through the same
/// <see cref="WindowActions"/> the hotkeys use plus the few operations that need
/// an explicit window id.
/// </summary>
/// <remarks>
/// <para>
/// The hotkey table is keyed by <see cref="HotkeyAction"/>, not by the IPC
/// trigger name, so the action triggers are translated here into a synthetic
/// binding and dispatched through <see cref="WindowActions.Run"/>. That keeps
/// swap/nudge/resize/focus/cursor policy in one place: the core's
/// <see cref="PlacementPolicy"/>, <see cref="Focus"/> and <see cref="Cursor"/>,
/// applied by <see cref="GeometryApplier"/>.
/// </para>
/// <para>
/// Window-targeted triggers resolve their <c>u</c> argument through the same
/// <see cref="WindowCatalog"/> the hotkey lane uses. The catalog is the IPC
/// lane's own tracker (the host's is private), so the ids it reports in
/// <c>ListWindows</c>/<c>DumpState</c> are the ids these triggers accept.
/// </para>
/// </remarks>
internal sealed class TriggerActions
{
    private readonly TilingHost _host;
    private readonly Action<string> _log;
    private readonly WindowCatalog _catalog = new();
    private readonly WindowActions _actions;
    private readonly double _nudgeStep;

    public TriggerActions(TilingHost host, double nudgeStep, Action<string> log)
    {
        ArgumentNullException.ThrowIfNull(host);
        ArgumentNullException.ThrowIfNull(log);

        _host = host;
        _log = log;
        _nudgeStep = nudgeStep;
        _actions = new WindowActions(host, _catalog, nudgeStep, log);
    }

    /// <summary>Re-read the tileable windows and the topology.</summary>
    public IReadOnlyList<MonitoredWindow> Snapshot() => _catalog.Refresh();

    /// <summary>The host's planned topology, with a live enumeration before the first drain.</summary>
    public IReadOnlyList<MonitorInfo> Monitors()
    {
        IReadOnlyList<MonitorInfo> monitors = _host.Monitors;
        return monitors.Count > 0 ? monitors : _catalog.RefreshMonitors();
    }

    /// <summary>Host-level directional focus (§6/§17).</summary>
    public bool Focus(FocusDirection direction) => _host.FocusDirection(direction);

    /// <summary>Host-level focus cycle.</summary>
    public bool FocusNext() => _host.FocusNext();

    /// <summary>Host-level undo of the last applied placement batch.</summary>
    public bool Undo() => _host.UndoLast();

    /// <summary>Move the shared edge of the focused pair by <paramref name="step"/>.</summary>
    public bool Nudge(FocusDirection direction, double step) =>
        Run(HotkeyAction.NudgeSplit, direction, grow: false, step);

    /// <summary>Grow or shrink the focused window's share.</summary>
    public bool Resize(bool grow, double step) =>
        Run(HotkeyAction.ResizeFocused, direction: null, grow, step);

    /// <summary>Move the focused window toward <paramref name="direction"/> (a swap for a pair).</summary>
    public bool MoveDirection(FocusDirection direction) =>
        Run(HotkeyAction.MoveDirection, direction, grow: false, step: null);

    /// <summary>Put the focused window in the other half.</summary>
    public bool MoveToOtherHalf() =>
        Run(HotkeyAction.MoveToOtherHalf, direction: null, grow: false, step: null);

    /// <summary>Warp the pointer to the focused window's centre.</summary>
    public bool CursorToCentre() =>
        Run(HotkeyAction.CursorToCentre, direction: null, grow: false, step: null);

    /// <summary>Close the focused window.</summary>
    public bool QuitFocused() =>
        Run(HotkeyAction.QuitFocused, direction: null, grow: false, step: null);

    /// <summary>Focus one window by its catalog id.</summary>
    public bool Activate(int id)
    {
        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        MonitoredWindow? window = Find(windows, "activate", id);
        if (window is null) return false;

        bool ok = NativeMethods.SetForegroundWindow(window.Handle);
        _log(Inv($"[activate] 0x{window.Handle.ToInt64():X}: {(ok ? "focused" : "refused")}"));
        return ok;
    }

    /// <summary>Close one window by its catalog id.</summary>
    public bool Close(int id)
    {
        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        MonitoredWindow? window = Find(windows, "close", id);
        if (window is null) return false;

        bool ok = InputNativeMethods.PostMessage(window.Handle, InputNativeMethods.WM_CLOSE, 0, 0);
        _log(Inv($"[close] WM_CLOSE -> 0x{window.Handle.ToInt64():X}: {(ok ? "posted" : "refused")}"));
        return ok;
    }

    /// <summary>Minimize one window by its catalog id.</summary>
    public bool Minimize(int id)
    {
        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        MonitoredWindow? window = Find(windows, "minimize", id);
        if (window is null) return false;

        bool ok = window.Window.Show(NativeMethods.SW_MINIMIZE);
        _log(Inv($"[minimize] 0x{window.Handle.ToInt64():X}: {(ok ? "ok" : "refused")}"));
        _host.RequestRetile();
        return ok;
    }

    /// <summary>Maximize one window by its catalog id.</summary>
    public bool Maximize(int id)
    {
        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        MonitoredWindow? window = Find(windows, "maximize", id);
        if (window is null) return false;

        bool ok = window.Window.Show(NativeMethods.SW_MAXIMIZE);
        _log(Inv($"[maximize] 0x{window.Handle.ToInt64():X}: {(ok ? "ok" : "refused")}"));
        _host.RequestRetile();
        return ok;
    }

    /// <summary>Restore one maximized window by its catalog id.</summary>
    public bool Unmaximize(int id)
    {
        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        MonitoredWindow? window = Find(windows, "unmaximize", id);
        if (window is null) return false;

        bool ok = window.Window.Show(NativeMethods.SW_RESTORE);
        _log(Inv($"[unmaximize] 0x{window.Handle.ToInt64():X}: {(ok ? "ok" : "refused")}"));
        _host.RequestRetile();
        return ok;
    }

    /// <summary>Toggle the window's persisted float state (§6).</summary>
    public bool ToggleFloat(int id)
    {
        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        MonitoredWindow? window = Find(windows, "float", id);
        if (window is null) return false;

        bool floating = _host.ToggleFloat(id);
        _log(Inv(
            $"[float] 0x{window.Handle.ToInt64():X} -> {(floating ? "floating" : "tiled")}"));
        return floating;
    }

    /// <summary>Place one window directly, emulating a drag/overview drop.</summary>
    public bool Move(int id, double x, double y, double width, double height)
    {
        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        MonitoredWindow? window = Find(windows, "move-window", id);
        if (window is null) return false;

        if (!double.IsFinite(x) || !double.IsFinite(y) ||
            !double.IsFinite(width) || !double.IsFinite(height) ||
            width <= 0 || height <= 0)
        {
            _log(Inv($"[move-window] invalid rectangle {x},{y} {width}x{height}"));
            return false;
        }

        var rect = new Rect(x, y, width, height);
        bool ok = GeometryApplier.Apply(new GeometryTarget(window.Handle, rect));
        _log(Inv(
            $"[move-window] 0x{window.Handle.ToInt64():X} -> ",
            $"{x:0},{y:0} {width:0}x{height:0}: {(ok ? "applied" : "refused")}"));
        return ok;
    }

    /// <summary>Swap two windows' frames, persisting the new sides (§13).</summary>
    public bool SwapPair(int firstId, int secondId)
    {
        if (firstId == secondId)
        {
            _log("[swap] a window cannot swap with itself");
            return false;
        }

        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        MonitoredWindow? first = Find(windows, "swap", firstId);
        MonitoredWindow? second = Find(windows, "swap", secondId);
        if (first is null || second is null) return false;

        Rect firstRect = first.Frame;
        Rect secondRect = second.Frame;
        if (firstRect == secondRect) return false;

        (int slotA, int slotB) = PlacementPolicy.SwappedSides(
            firstId,
            first.Slot,
            secondId,
            second.Slot);

        GeometryApplyResult result = GeometryApplier.ApplyBatch(
        [
            new GeometryTarget(first.Handle, secondRect),
            new GeometryTarget(second.Handle, firstRect),
        ]);

        _log(Inv(
            $"[swap] 0x{first.Handle.ToInt64():X} <-> 0x{second.Handle.ToInt64():X} ",
            $"sides {slotA}/{slotB}; applied {result.Applied}/{result.Requested}"));
        _host.RequestRetile();
        return result.Applied == result.Requested;
    }

    /// <summary>Set the split ratio of the pair without moving the windows first.</summary>
    public bool SimulateResize(int firstId, int secondId, double ratio)
    {
        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        MonitoredWindow? first = Find(windows, "simulate-resize", firstId);
        MonitoredWindow? second = Find(windows, "simulate-resize", secondId);
        if (first is null || second is null) return false;

        SplitAxis axis = first.Monitor.Bounds.Width >= first.Monitor.Bounds.Height
            ? SplitAxis.Horizontal
            : SplitAxis.Vertical;

        bool changed = _host.SetRatio(
            first.Surface.WorkspaceId,
            first.Surface.ScreenId,
            axis,
            ratio);
        _log(Inv(
            $"[simulate-resize] {firstId}/{secondId} ",
            $"{(axis == SplitAxis.Horizontal ? "horizontal" : "vertical")} = {ratio:0.###}: ",
            $"{(changed ? "stored" : "unchanged")}"));
        return changed;
    }

    /// <summary>Mark a window always-on-top the way the GNOME test hook does.</summary>
    public bool SimulateAbove(int id)
    {
        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        MonitoredWindow? window = Find(windows, "simulate-above", id);
        if (window is null) return false;

        long style = window.Window.ExtendedStyle;
        _ = NativeMethods.SetWindowLongPtr(
            window.Handle,
            NativeMethods.GWL_EXSTYLE,
            (nint)(style | NativeMethods.WS_EX_TOPMOST));
        _ = NativeMethods.SetWindowPos(
            window.Handle,
            (nint)(-1), // HWND_TOPMOST
            0,
            0,
            0,
            0,
            NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_NOACTIVATE);
        _log(Inv($"[simulate-above] 0x{window.Handle.ToInt64():X} -> topmost"));
        _host.RequestRetile();
        return true;
    }

    /// <summary>Park the pointer at the centre of monitor <paramref name="index"/>.</summary>
    public bool WarpPointerToMonitor(int index)
    {
        MonitorInfo? monitor = null;
        foreach (MonitorInfo candidate in Monitors())
        {
            if (candidate.Index != index) continue;
            monitor = candidate;
            break;
        }

        if (monitor is null)
        {
            _log(Inv($"[warp-pointer] no monitor {index}"));
            return false;
        }

        Point centre = Cursor.RectCentre(monitor.Bounds);
        bool ok = InputNativeMethods.SetCursorPos(
            (int)Math.Round(centre.X, MidpointRounding.AwayFromZero),
            (int)Math.Round(centre.Y, MidpointRounding.AwayFromZero));
        _log(Inv($"[warp-pointer] monitor {index} -> {centre.X:0},{centre.Y:0}: {(ok ? "ok" : "refused")}"));
        return ok;
    }

    /// <summary>Warp the pointer to an absolute point (the real <c>InjectPointerMove</c>).</summary>
    public bool InjectPointerMove(int x, int y)
    {
        bool ok = InputNativeMethods.SetCursorPos(x, y);
        _log(Inv($"[inject-pointer] {x},{y}: {(ok ? "ok" : "refused")}"));
        return ok;
    }

    /// <summary>Launch a client process and return its pid (0 when it could not start).</summary>
    public int Spawn(string argvJson, string? envJson)
    {
        IReadOnlyList<string> argv = ParseArgv(argvJson);
        if (argv.Count == 0)
        {
            _log("[spawn] empty argv");
            return 0;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = argv[0],
            UseShellExecute = false,
        };

        for (int index = 1; index < argv.Count; index++) startInfo.ArgumentList.Add(argv[index]);
        foreach (var (key, value) in ParseEnvironment(envJson)) startInfo.Environment[key] = value;

        try
        {
            using Process? process = Process.Start(startInfo);
            int pid = process?.Id ?? 0;
            _log(Inv($"[spawn] {argv[0]} -> pid {pid}"));
            return pid;
        }
        catch (Exception error) when (
            error is Win32Exception or InvalidOperationException or IOException or ArgumentException)
        {
            _log(Inv($"[spawn] {argv[0]} failed: {error.Message}"));
            return 0;
        }
    }

    /// <summary>One window as a <c>DumpState</c>/<c>LookupWindow</c> object.</summary>
    public JsonObject Describe(MonitoredWindow window)
    {
        SurfaceFlags flags = window.Surface.Flags;
        return new JsonObject
        {
            ["id"] = window.Surface.Id,
            ["cls"] = window.Surface.AppId,
            ["title"] = window.Surface.Title,
            ["handle"] = window.Handle.ToInt64(),
            ["rect"] = RectObject(window.Frame),
            ["workspace"] = window.Surface.WorkspaceId,
            ["monitor"] = window.Monitor.Index,
            ["slot"] = window.Slot,
            ["layer"] = (int)window.Surface.Layer,
            ["maximized"] = flags.Maximized,
            ["minimized"] = flags.Minimized,
            ["fullscreen"] = flags.Fullscreen,
            ["above"] = flags.Above,
            ["transient"] = flags.Transient,
            ["floating"] = _host.IsFloating(window.Surface.Id),
            ["focused"] = window.Handle == Win32Window.Foreground.Handle,
        };
    }

    /// <summary>Every tileable window as a JSON array.</summary>
    public JsonArray DescribeAll(IReadOnlyList<MonitoredWindow> windows)
    {
        var result = new JsonArray();
        foreach (MonitoredWindow window in windows) result.Add(Describe(window));
        return result;
    }

    /// <summary>Look one window up by its catalog id, or null when it is not tracked.</summary>
    public JsonNode? Lookup(int id)
    {
        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        foreach (MonitoredWindow window in windows)
        {
            if (window.Surface.Id == id) return Describe(window);
        }

        return null;
    }

    /// <summary>The GNOME float shape: app id -> floating surface ids.</summary>
    public JsonObject Floats(IReadOnlyList<MonitoredWindow> windows)
    {
        var floats = new JsonObject();
        foreach (MonitoredWindow window in windows)
        {
            if (!_host.IsFloating(window.Surface.Id)) continue;

            string appId = window.Surface.AppId.Length > 0
                ? window.Surface.AppId
                : FormattableString.Invariant($"#{window.Surface.Id}");
            if (floats[appId] is not JsonArray ids)
            {
                ids = new JsonArray();
                floats[appId] = ids;
            }

            ids.Add(window.Surface.Id);
        }

        return new JsonObject
        {
            ["windows"] = floats,
            ["neverTile"] = new JsonArray(),
        };
    }

    /// <summary>The rectangle shape every dump uses.</summary>
    public static JsonObject RectObject(Rect rect) => new()
    {
        ["x"] = rect.X,
        ["y"] = rect.Y,
        ["width"] = rect.Width,
        ["height"] = rect.Height,
    };

    private bool Run(HotkeyAction action, FocusDirection? direction, bool grow, double? step)
    {
        var binding = new HotkeyBinding(
            Id: 0,
            Trigger: "Ipc",
            Label: "ipc",
            Action: action,
            Modifiers: HotkeyModifiers.None,
            VirtualKey: 0,
            Direction: direction,
            Grow: grow);

        WindowActions actions = _actions;
        if (step is double value && Math.Abs(value - _nudgeStep) > 1e-9)
        {
            // The trigger carries its own step (the hotkey table uses the
            // configured one). A throwaway instance keeps the shared action
            // object's undo slot untouched for the next hotkey.
            actions = new WindowActions(_host, _catalog, value, _log);
        }

        return actions.Run(binding);
    }

    private MonitoredWindow? Find(
        IReadOnlyList<MonitoredWindow> windows,
        string action,
        int id)
    {
        foreach (MonitoredWindow window in windows)
        {
            if (window.Surface.Id == id) return window;
        }

        _log(Inv($"[{action}] no tracked window with id {id}"));
        return null;
    }

    private static IReadOnlyList<string> ParseArgv(string argvJson)
    {
        string text = argvJson.Trim();
        if (text.StartsWith('['))
        {
            try
            {
                if (JsonNode.Parse(text) is JsonArray array)
                {
                    var parts = new List<string>(array.Count);
                    foreach (JsonNode? node in array)
                    {
                        if (node is JsonValue value &&
                            value.TryGetValue(out string? part) &&
                            !string.IsNullOrEmpty(part))
                        {
                            parts.Add(part);
                        }
                    }

                    return parts;
                }
            }
            catch (JsonException)
            {
                // A legacy space-separated command string that happens to start
                // with '[': fall through to the split.
            }
        }

        return text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
    }

    private static IReadOnlyList<(string Key, string Value)> ParseEnvironment(string? envJson)
    {
        var environment = new List<(string Key, string Value)>();
        if (string.IsNullOrWhiteSpace(envJson)) return environment;

        string text = envJson.Trim();
        if (text is "null" or "{}" or "[]") return environment;

        JsonNode? root;
        try
        {
            root = JsonNode.Parse(text);
        }
        catch (JsonException)
        {
            return environment;
        }

        if (root is JsonObject obj)
        {
            foreach (var pair in obj)
            {
                if (pair.Value is JsonValue value && value.TryGetValue(out string? textValue))
                {
                    environment.Add((pair.Key, textValue));
                }
            }
        }
        else if (root is JsonArray array)
        {
            foreach (JsonNode? node in array)
            {
                if (node is not JsonValue value || !value.TryGetValue(out string? entry)) continue;

                int separator = entry.IndexOf('=', StringComparison.Ordinal);
                if (separator > 0)
                {
                    environment.Add((entry[..separator], entry[(separator + 1)..]));
                }
            }
        }

        return environment;
    }

    private static string Inv(params FormattableString[] parts) =>
        string.Concat(parts.Select(part => FormattableString.Invariant(part)));
}
