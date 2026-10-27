using System.Diagnostics;
using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// The W3 tiling loop: pump events → coalesced drain → core plan → geometry.
/// </summary>
/// <remarks>
/// <para>
/// Every screen is modelled as workspace 0 (one workspace containing all
/// screens), which is what stage W3 needs before workspaces land. On each drain
/// the host snapshots the tileable windows, asks <see cref="Tiler.LayoutAll"/>
/// for a plan per workspace/screen, and applies the placements with
/// <see cref="GeometryApplier"/> in one batch.
/// </para>
/// <para>
/// Two guards keep the host from fighting itself: a placement whose rectangle
/// the window already occupies is not applied, and location-change events for a
/// window we just moved are ignored for a short window (our own
/// <c>SetWindowPos</c> echoes back through the hook). A user move/resize drag is
/// also left alone until it ends.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class TilingHost
{
    private static readonly TimeSpan DebounceQuiet = TimeSpan.FromMilliseconds(50);
    private static readonly TimeSpan SelfMoveSuppression = TimeSpan.FromMilliseconds(750);
    private const double TolerancePixels = 1.0;
    private const double AssumedRefreshRate = 60;

    /// <summary>Half split, flush to the work area, no ratio memory yet.</summary>
    private static readonly TilerConfig Configuration = new()
    {
        GapBase = 0,
        GapPortrait = 0,
        GapLandscape = 0,
        GapLeft = 0,
        GapRight = 0,
        GapTop = 0,
        GapBottom = 0,
        GapBetween = 0,
        MinSizePolicy = MinSizePolicy.Respect,
        PrimaryApps = Array.Empty<string>(),
        PrimaryAppRatio = 0.5,
        Ratios = new Dictionary<string, double>(),
        SwapPairs = [],
        Rules = Array.Empty<Rule>(),
    };

    private readonly WindowEventPump _pump;
    private readonly WindowTracker _tracker = new();
    private readonly Action<string> _log;
    private readonly Dictionary<nint, long> _selfMovedAt = [];
    private readonly List<MonitorInfo> _monitors = [];
    private nint _userDragging;
    private bool _paused;

    /// <summary>Create a host over a started (or about-to-start) pump.</summary>
    /// <param name="pump">The WinEvent pump the host drains.</param>
    /// <param name="log">Receives one line per applied batch; defaults to the console.</param>
    public TilingHost(WindowEventPump pump, Action<string>? log = null)
    {
        ArgumentNullException.ThrowIfNull(pump);
        _pump = pump;
        _log = log ?? Console.WriteLine;
    }

    /// <summary>True while tiling is paused; events keep being drained but no plan is applied.</summary>
    public bool IsPaused => _paused;

    /// <summary>Last monitor topology the host planned against.</summary>
    public IReadOnlyList<MonitorInfo> Monitors => _monitors;

    /// <summary>Seed the tracker with the windows already on screen and read the topology.</summary>
    public void Start()
    {
        _tracker.Seed();
        RefreshTopology();
        _log("[host] tiling started; one workspace (0) across all screens.");
    }

    /// <summary>Pause/resume; resuming requests a fresh plan.</summary>
    public void TogglePause()
    {
        _paused = !_paused;
        _log(_paused ? "[host] paused" : "[host] resumed");
        if (!_paused) _tracker.RequestRetile();
    }

    /// <summary>Force a plan on the next tick (display change, resume, self-heal).</summary>
    public void RequestRetile() => _tracker.RequestRetile();

    /// <summary>Drain events and, once they have been quiet for 50 ms, plan and apply.</summary>
    /// <returns>True when at least one window was moved.</returns>
    public bool Tick() => Tick(DebounceQuiet);

    /// <summary>Drain events and plan if the stream has been quiet for <paramref name="quiet"/>.</summary>
    public bool Tick(TimeSpan quiet)
    {
        _tracker.Observe(FilterEvents(_pump.Drain()));

        if (_paused || !_tracker.TryBeginDrain(quiet)) return false;
        return Retile();
    }

    private bool Retile()
    {
        RefreshTopology();

        var screenByMonitor = new Dictionary<nint, int>(_monitors.Count);
        var screens = new List<Screen>(_monitors.Count);
        foreach (MonitorInfo monitor in _monitors)
        {
            screenByMonitor[monitor.Handle] = monitor.Index;
            screens.Add(ToScreen(monitor));
        }

        IReadOnlyList<Surface> surfaces = _tracker.Snapshot(screenByMonitor);
        List<TilerWindow> windows = SelectWindows(surfaces);
        if (windows.Count == 0) return false;

        IReadOnlyList<WorkspacePlan> plans = Tiler.LayoutAll(new TilerInput
        {
            Windows = windows,
            Screens = screens,
            Config = Configuration,
        });

        var placements = new List<Placement>();
        foreach (WorkspacePlan plan in plans) placements.AddRange(plan.Plan.Placements);

        return Apply(placements);
    }

    /// <summary>
    /// The tileable windows the planner may move. Minimized windows keep their
    /// place (the core's "minimized holds no slot" rule lands with workspaces);
    /// maximized and floating ones are not part of the half-split yet.
    /// </summary>
    private static List<TilerWindow> SelectWindows(IReadOnlyList<Surface> surfaces)
    {
        var windows = new List<TilerWindow>(surfaces.Count);
        foreach (Surface surface in surfaces)
        {
            if (surface.Flags.Minimized || surface.Flags.Maximized || surface.Flags.Floating) continue;

            windows.Add(new TilerWindow
            {
                Id = surface.Id,
                AppId = surface.AppId,
                Title = surface.Title,
                Kind = surface.Kind,
                Rect = surface.Frame,
                Min = surface.Min,
                Max = surface.Max,
                ScreenId = surface.ScreenId,
                WorkspaceId = WindowTracker.SingleWorkspaceId,
            });
        }

        return windows;
    }

    private bool Apply(IReadOnlyList<Placement> placements)
    {
        var targets = new List<GeometryTarget>(placements.Count);
        foreach (Placement placement in placements)
        {
            if (placement.Layer != Layer.Tiled) continue;
            if (!_tracker.TryGetHandle(placement.SurfaceId, out nint handle)) continue;

            var window = new Win32Window(handle);
            if (!window.IsValid || !window.IsVisible) continue;
            // Never move a window whose frame is not the frame the plan describes.
            if (window.IsMinimized || window.IsMaximized || window.IsCloaked) continue;
            if (placement.Rect.Width <= 0 || placement.Rect.Height <= 0) continue;
            if (Near(window.FrameBounds, placement.Rect)) continue;

            targets.Add(new GeometryTarget(handle, placement.Rect));
        }

        if (targets.Count == 0) return false;

        GeometryApplyResult result = GeometryApplier.ApplyBatch(targets);
        long now = Stopwatch.GetTimestamp();
        foreach (GeometryTarget target in targets)
        {
            _selfMovedAt[target.Window] = now;
            _log(Inv(
                $"[tile] 0x{target.Window.ToInt64():X} -> ",
                $"{target.Rect.X:0},{target.Rect.Y:0} {target.Rect.Width:0}x{target.Rect.Height:0}"));
        }

        _log(Inv(
            $"[tile] applied {result.Applied}/{result.Requested}, ",
            $"{result.Mismatches.Count} mismatch(es)"));
        return result.Applied > 0;
    }

    /// <summary>
    /// Drop the events our own apply and a user's drag produce. The pump skips
    /// our process, but <c>SetWindowPos</c> still delivers location changes, and
    /// planning on those would loop forever (or fight a drag).
    /// </summary>
    private IReadOnlyList<WindowEvent> FilterEvents(IReadOnlyList<WindowEvent> events)
    {
        if (events.Count == 0) return events;

        List<WindowEvent>? kept = null;
        long now = Stopwatch.GetTimestamp();
        for (int index = 0; index < events.Count; index++)
        {
            WindowEvent rawEvent = events[index];
            bool drop = false;

            if (rawEvent.Kind == WindowEventKind.MoveSizeStart)
            {
                _userDragging = rawEvent.Window;
            }
            else if (rawEvent.Kind == WindowEventKind.MoveSizeEnd)
            {
                _userDragging = 0;
            }
            else if (rawEvent.Kind == WindowEventKind.LocationChange)
            {
                drop = rawEvent.Window == _userDragging || IsSelfMove(rawEvent.Window, now);
            }

            if (drop)
            {
                if (kept is null)
                {
                    kept = new List<WindowEvent>(events.Count);
                    for (int copy = 0; copy < index; copy++) kept.Add(events[copy]);
                }

                continue;
            }

            kept?.Add(rawEvent);
        }

        return kept ?? events;
    }

    private bool IsSelfMove(nint handle, long now)
    {
        if (!_selfMovedAt.TryGetValue(handle, out long movedAt)) return false;
        if (Stopwatch.GetElapsedTime(movedAt, now) < SelfMoveSuppression) return true;

        _selfMovedAt.Remove(handle);
        return false;
    }

    private void RefreshTopology()
    {
        IReadOnlyList<MonitorInfo> current = Adrt.Windows.Monitors.Enumerate();
        if (SameTopology(_monitors, current)) return;

        _monitors.Clear();
        _monitors.AddRange(current);

        _log(Inv($"[display] {current.Count} screen(s):"));
        foreach (MonitorInfo monitor in current) _log("  " + FormatMonitor(monitor));
    }

    private static bool SameTopology(IReadOnlyList<MonitorInfo> left, IReadOnlyList<MonitorInfo> right)
    {
        if (left.Count != right.Count) return false;
        for (int index = 0; index < left.Count; index++)
        {
            if (left[index] != right[index]) return false;
        }

        return true;
    }

    private static Screen ToScreen(MonitorInfo monitor) => new()
    {
        Index = monitor.Index,
        Connector = monitor.DeviceName,
        Geometry = monitor.Bounds,
        WorkArea = monitor.WorkArea,
        Scale = monitor.Scale,
        RefreshRate = AssumedRefreshRate,
        IsPrimary = monitor.IsPrimary,
    };

    private static bool Near(Rect left, Rect right) =>
        Math.Abs(left.X - right.X) <= TolerancePixels &&
        Math.Abs(left.Y - right.Y) <= TolerancePixels &&
        Math.Abs(left.Width - right.Width) <= TolerancePixels &&
        Math.Abs(left.Height - right.Height) <= TolerancePixels;

    private static string FormatMonitor(MonitorInfo monitor) => Inv(
        $"monitor {monitor.Index}: {monitor.DeviceName} ",
        $"{monitor.Bounds.Width:0}x{monitor.Bounds.Height:0} at {monitor.Bounds.X:0},{monitor.Bounds.Y:0} ",
        $"work {monitor.WorkArea.X:0},{monitor.WorkArea.Y:0} ",
        $"{monitor.WorkArea.Width:0}x{monitor.WorkArea.Height:0} ",
        $"scale {monitor.Scale:0.##}{(monitor.IsPrimary ? " primary" : "")}");

    private static string Inv(params FormattableString[] parts) =>
        string.Concat(parts.Select(part => FormattableString.Invariant(part)));
}
