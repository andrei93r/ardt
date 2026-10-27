using Adrt.Core;

namespace Adrt.Windows.Input.Actions;

/// <summary>One tileable window the input layer can address by HWND and core id.</summary>
/// <param name="Surface">The core snapshot (id, frame, flags, monitor index).</param>
/// <param name="Handle">Live HWND the id resolves to.</param>
/// <param name="Monitor">The monitor the window's frame is planned on.</param>
/// <param name="Slot">Half inferred from the live frame (0 = first/left/top).</param>
internal sealed record MonitoredWindow(Surface Surface, nint Handle, MonitorInfo Monitor, int Slot)
{
    /// <summary>The window's visible frame in physical pixels.</summary>
    public Rect Frame => Surface.Frame;

    /// <summary>Typed access to the live handle.</summary>
    public Win32Window Window => new(Handle);

    /// <summary>The screen the core planner uses for this monitor.</summary>
    public Screen ToScreen() => new()
    {
        Index = Monitor.Index,
        Connector = Monitor.DeviceName,
        Geometry = Monitor.Bounds,
        WorkArea = Monitor.WorkArea,
        Scale = Monitor.Scale,
        RefreshRate = 60,
        IsPrimary = Monitor.IsPrimary,
    };
}

/// <summary>
/// A fresh view of the tileable windows, built through the same
/// <see cref="WindowTracker"/> and classifier the host uses.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="TilingHost"/> owns its tracker privately, so the input lane keeps
/// its own instance. Ids therefore differ from the host's internal ids, but the
/// input lane only compares ids with itself; every mutation crosses back to an
/// HWND, which the host uses as well.
/// </para>
/// <para>
/// <see cref="Refresh"/> is deliberately explicit: it enumerates and reads DWM
/// frames for every known window, so it is called on focus changes and hotkey
/// actions, never from the 40 ms tick.
/// </para>
/// </remarks>
internal sealed class WindowCatalog
{
    private readonly WindowTracker _tracker = new();
    private List<MonitoredWindow> _windows = [];
    private List<MonitorInfo> _monitors = [];

    /// <summary>The windows read by the last <see cref="Refresh"/>.</summary>
    public IReadOnlyList<MonitoredWindow> Windows => _windows;

    /// <summary>The topology read by the last refresh (or monitor-only poll).</summary>
    public IReadOnlyList<MonitorInfo> Screens => _monitors;

    /// <summary>
    /// Seed any new windows, rebuild every surface and the slot guess. Returns the
    /// windows ordered by core id (the tracker guarantees that order).
    /// </summary>
    public IReadOnlyList<MonitoredWindow> Refresh()
    {
        RefreshMonitors();
        _tracker.Seed();

        var screenByMonitor = new Dictionary<nint, int>(_monitors.Count);
        foreach (MonitorInfo monitor in _monitors) screenByMonitor[monitor.Handle] = monitor.Index;

        IReadOnlyList<Surface> surfaces = _tracker.Snapshot(screenByMonitor);
        var windows = new List<MonitoredWindow>(surfaces.Count);
        foreach (Surface surface in surfaces)
        {
            if (!_tracker.TryGetHandle(surface.Id, out nint handle)) continue;
            MonitorInfo? monitor = FindMonitor(surface.ScreenId);
            if (monitor is null) continue;
            windows.Add(new MonitoredWindow(surface, handle, monitor, SlotOf(surface.Frame, monitor)));
        }

        _windows = windows;
        return _windows;
    }

    /// <summary>Re-read only the monitor topology (cheap; used for display changes).</summary>
    public IReadOnlyList<MonitorInfo> RefreshMonitors()
    {
        _monitors = [.. Monitors.Enumerate()];
        return _monitors;
    }

    /// <summary>The window with this HWND from the last refresh, or null.</summary>
    public MonitoredWindow? Find(nint handle) =>
        handle == 0 ? null : _windows.FirstOrDefault(window => window.Handle == handle);

    /// <summary>The tileable window that currently has the foreground, or null.</summary>
    public MonitoredWindow? FindFocused() => Find(Win32Window.Foreground.Handle);

    /// <summary>
    /// The focused window's pair partner on the same monitor: the other tiled,
    /// non-minimized window. Null when the focused window is alone.
    /// </summary>
    public MonitoredWindow? SiblingOf(MonitoredWindow focused) =>
        _windows
            .Where(window =>
                window.Handle != focused.Handle &&
                window.Monitor.Index == focused.Monitor.Index &&
                !window.Surface.Flags.Minimized)
            .OrderBy(window => Math.Abs(window.Frame.X - focused.Frame.X) +
                               Math.Abs(window.Frame.Y - focused.Frame.Y))
            .ThenBy(window => window.Surface.Id)
            .FirstOrDefault();

    /// <summary>
    /// Infer the half a frame occupies. The tiler splits horizontally on a
    /// landscape monitor and vertically on a portrait one, so the same predicate
    /// is used here; slots are only a comparison value for swaps and undo.
    /// </summary>
    public static int SlotOf(Rect frame, MonitorInfo monitor)
    {
        Rect area = monitor.WorkArea;
        bool vertical = monitor.Bounds.Height > monitor.Bounds.Width;
        double centre = vertical ? frame.Y + frame.Height / 2 : frame.X + frame.Width / 2;
        double middle = vertical ? area.Y + area.Height / 2 : area.X + area.Width / 2;
        return centre < middle ? 0 : 1;
    }

    private MonitorInfo? FindMonitor(int index) =>
        _monitors.FirstOrDefault(monitor => monitor.Index == index) ??
        _monitors.FirstOrDefault();
}
