using System.Diagnostics;
using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// The tiling loop: pump events → coalesced drain → core plan → geometry, plus
/// the W4 model behaviours (maximize ladder, clamp, self-heal, undo, focus).
/// </summary>
/// <remarks>
/// <para>
/// Every screen is modelled as workspace 0 (one workspace containing all
/// screens), which is what stages W3/W4 need before workspaces land. On each
/// drain the host snapshots the tileable windows, asks
/// <see cref="Tiler.LayoutAll"/> for a plan per workspace/screen, and applies
/// the placements with <see cref="GeometryApplier"/> in one batch.
/// </para>
/// <para>
/// Guards keep the host from fighting itself: a placement whose rectangle the
/// window already occupies is not applied, location-change events for a window
/// we just moved are ignored for a short window (our own
/// <c>SetWindowPos</c> echoes back through the hook), and a user move/resize
/// drag is left alone until it ends. The periodic sweep reaps handles whose
/// destroy event was missed and re-plans when the tileable set changed.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class TilingHost
{
    private static readonly TimeSpan DebounceQuiet = TimeSpan.FromMilliseconds(50);
    private static readonly TimeSpan SelfMoveSuppression = TimeSpan.FromMilliseconds(750);
    private static readonly TimeSpan SelfHealInterval = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan UndoSettle = TimeSpan.FromMilliseconds(1200);
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
    private readonly MaximizeLadder _maximize = new();
    private readonly PlacementHistory _history = new();
    private readonly Action<string> _log;
    private readonly Dictionary<nint, long> _selfMovedAt = [];
    private readonly Dictionary<int, int> _slots = [];
    private readonly List<MonitorInfo> _monitors = [];
    private nint _userDragging;
    private bool _paused;
    private long _lastSweepAt;
    private long _suppressRetileFrom;
    private string? _lastSignature;

    /// <summary>Create a host over a started (or about-to-start) pump.</summary>
    /// <param name="pump">The WinEvent pump the host drains.</param>
    /// <param name="log">Receives one line per applied batch; defaults to the console.</param>
    public TilingHost(WindowEventPump pump, Action<string>? log = null)
    {
        ArgumentNullException.ThrowIfNull(pump);
        _pump = pump;
        _log = log ?? Console.WriteLine;
        _lastSweepAt = Stopwatch.GetTimestamp();
    }

    /// <summary>True while tiling is paused; events keep being drained but no plan is applied.</summary>
    public bool IsPaused => _paused;

    /// <summary>Last monitor topology the host planned against.</summary>
    public IReadOnlyList<MonitorInfo> Monitors => _monitors;

    /// <summary>True when there is a placement batch that <see cref="UndoLast"/> can revert.</summary>
    public bool CanUndo => _history.Size > 0;

    /// <summary>Seed the tracker with the windows already on screen and read the topology.</summary>
    public void Start()
    {
        _tracker.Seed();
        RefreshTopology();
        _lastSweepAt = Stopwatch.GetTimestamp();
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

        bool reaped = SweepIfDue();
        if (_paused) return false;

        // The periodic sweep is the repair path for a missed destroy/classification
        // event, so it plans immediately instead of waiting for another event.
        if (reaped) return !IsRetileSuppressed() && Retile();

        if (!_tracker.TryBeginDrain(quiet)) return false;
        if (IsRetileSuppressed()) return false;
        return Retile();
    }

    /// <summary>
    /// §13: revert the last placement batch — all windows it moved, with the
    /// geometry and maximize state they had before it. Validated as a whole via
    /// the core undo rule; an impossible change is not partially applied.
    /// </summary>
    /// <returns>True when the change was restored.</returns>
    public bool UndoLast()
    {
        Change? change = _history.Take();
        if (change is null)
        {
            _log("[undo] nothing to undo");
            return false;
        }

        IReadOnlyList<Surface> surfaces = SnapshotSurfaces();
        var live = new List<LiveInstance>(surfaces.Count);
        foreach (Surface surface in surfaces)
        {
            live.Add(new LiveInstance
            {
                Id = surface.Id,
                Workspace = WindowTracker.SingleWorkspaceId,
                Slot = _slots.TryGetValue(surface.Id, out int slot) ? slot : null,
            });
        }

        UndoValidation validation = Undo.ValidateChange(change, live);
        if (!validation.Ok)
        {
            _log(Inv($"[undo] impossible ({validation.Problem}); nothing changed"));
            return false;
        }

        long now = Stopwatch.GetTimestamp();
        var geometry = new List<GeometryTarget>(change.Instances.Count);
        foreach (InstanceConfig instance in change.Instances)
        {
            if (!_tracker.TryGetHandle(instance.Id, out nint handle)) continue;

            var window = new Win32Window(handle);
            if (!window.IsValid || !window.IsVisible) continue;

            if (instance.Maximized != window.IsMaximized)
            {
                window.Show(instance.Maximized ? NativeMethods.SW_MAXIMIZE : NativeMethods.SW_RESTORE);
                if (instance.Maximized) _maximize.NoteMaximized(instance.Id);
                else _maximize.NoteRestored(instance.Id);
                _selfMovedAt[handle] = now;
            }

            // A maximized window owns its frame; only the restored state gets
            // the saved rectangle back.
            if (!instance.Maximized && instance.Rect.Width > 0 && instance.Rect.Height > 0)
            {
                geometry.Add(new GeometryTarget(handle, instance.Rect));
            }

            if (instance.Slot is int restoredSlot) _slots[instance.Id] = restoredSlot;
            else _slots.Remove(instance.Id);
        }

        if (geometry.Count > 0)
        {
            GeometryApplyResult result = GeometryApplier.ApplyBatch(geometry);
            foreach (GeometryTarget target in geometry) _selfMovedAt[target.Window] = now;
            _log(Inv($"[undo] geometry {result.Applied}/{result.Requested}"));
        }

        _suppressRetileFrom = Stopwatch.GetTimestamp();
        _lastSignature = null;
        _log(Inv($"[undo] restored {change.Instances.Count} window(s)"));
        return true;
    }

    /// <summary>
    /// §6/§17: focus the next managed window on the current screen (slot order,
    /// wrapping). Does nothing when the foreground window is not tracked.
    /// </summary>
    /// <returns>True when the OS accepted the focus change.</returns>
    public bool FocusNext()
    {
        IReadOnlyList<Surface> surfaces = SnapshotSurfaces();
        if (!TryResolveForeground(surfaces, out Surface? current) || current is null) return false;

        int? next = FocusNavigator.Next(current, surfaces, _slots);
        if (next is null || next.Value == current.Id)
        {
            _log("[focus] no next window");
            return false;
        }

        return FocusSurface(next.Value);
    }

    /// <summary>§6/§17: focus the nearest window in <paramref name="direction"/>.</summary>
    /// <returns>True when the OS accepted the focus change.</returns>
    public bool FocusDirection(Adrt.Core.FocusDirection direction)
    {
        IReadOnlyList<Surface> surfaces = SnapshotSurfaces();
        if (!TryResolveForeground(surfaces, out Surface? current) || current is null) return false;

        Rect currentRect = current.Frame;
        if (_tracker.TryGetHandle(current.Id, out nint currentHandle))
        {
            var window = new Win32Window(currentHandle);
            if (window.IsValid) currentRect = window.FrameBounds;
        }

        int? next = FocusNavigator.Direction(current, currentRect, surfaces, direction);
        if (next is null)
        {
            _log(Inv($"[focus] nothing to the {direction}"));
            return false;
        }

        return FocusSurface(next.Value);
    }

    private bool FocusSurface(int surfaceId)
    {
        if (!_tracker.TryGetHandle(surfaceId, out nint handle)) return false;

        var window = new Win32Window(handle);
        if (!window.IsValid) return false;

        if (!NativeMethods.SetForegroundWindow(handle))
        {
            // Windows can refuse a foreground change (the foreground lock). The
            // safe fallback is to skip rather than steal focus with tricks.
            _log(Inv($"[focus] OS refused 0x{handle.ToInt64():X}; skipped"));
            return false;
        }

        _log(Inv($"[focus] 0x{handle.ToInt64():X}"));
        return true;
    }

    private bool TryResolveForeground(IReadOnlyList<Surface> surfaces, out Surface? current)
    {
        current = null;
        nint foreground = Win32Window.Foreground.Handle;
        if (foreground == 0 || !_tracker.TryGetId(foreground, out int id)) return false;

        foreach (Surface surface in surfaces)
        {
            if (surface.Id == id)
            {
                current = surface;
                return true;
            }
        }

        return false;
    }

    private bool Retile()
    {
        // §11.3: no reflow while the user is dragging. The gesture's end event
        // marks the tracker dirty, so the pair is planned immediately after.
        if (_userDragging != 0) return false;

        RefreshTopology();

        var screenByMonitor = new Dictionary<nint, int>(_monitors.Count);
        var screens = new List<Screen>(_monitors.Count);
        foreach (MonitorInfo monitor in _monitors)
        {
            screenByMonitor[monitor.Handle] = monitor.Index;
            screens.Add(ToScreen(monitor));
        }

        IReadOnlyList<Surface> surfaces = _tracker.Snapshot(screenByMonitor);
        MaximizeActions maximizeActions = _maximize.Observe(surfaces);
        if (!maximizeActions.IsEmpty && ApplyMaximize(maximizeActions))
        {
            // A restore changes the flags the planner reads, and a minimize drops
            // the window from the active set; refresh before planning.
            surfaces = _tracker.Snapshot(screenByMonitor);
        }

        _lastSignature = TileSignature.For(surfaces);

        List<TilerWindow> windows = SelectWindows(surfaces);
        _log(Inv($"[debug] monitors={screens.Count} tracked={_tracker.TrackedCount} surfaces={surfaces.Count} windows={windows.Count}"));

        bool moved = false;
        if (windows.Count > 0)
        {
            IReadOnlyList<WorkspacePlan> plans = Tiler.LayoutAll(new TilerInput
            {
                Windows = windows,
                Screens = screens,
                Config = Configuration,
            });

            var placements = new List<Placement>();
            foreach (WorkspacePlan plan in plans) placements.AddRange(plan.Plan.Placements);

            _log(Inv($"[debug] plans={plans.Count} placements={placements.Count}"));
            moved = Apply(placements, surfaces);
        }

        // The clamp runs after the plan: a tiled window is already inside its
        // work area, so this pass only repairs a float/drag the plan left out.
        moved |= ClampToWorkAreas(surfaces);
        return moved;
    }

    /// <summary>
    /// The windows the planner may move. Classification already dropped floats,
    /// dialogs and above/tool windows; the remaining checks are the W4 guards
    /// that keep a maximized or minimized window out of a half-tile.
    /// </summary>
    private static List<TilerWindow> SelectWindows(IReadOnlyList<Surface> surfaces)
    {
        var windows = new List<TilerWindow>(surfaces.Count);
        foreach (Surface surface in surfaces)
        {
            if (surface.Layer != Layer.Tiled) continue;
            if (Types.NonTileableKinds.Contains(surface.Kind)) continue;

            SurfaceFlags flags = surface.Flags;
            if (flags.Minimized || flags.Maximized || flags.Floating || flags.Fullscreen) continue;
            if (flags.Transient || flags.Above || flags.SkipTaskbar) continue;

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

    private bool ApplyMaximize(MaximizeActions actions)
    {
        bool changed = false;
        long now = Stopwatch.GetTimestamp();

        foreach (int id in actions.Restore)
        {
            if (!_tracker.TryGetHandle(id, out nint handle)) continue;

            var window = new Win32Window(handle);
            if (!window.IsValid || !window.IsMaximized) continue;

            if (window.Show(NativeMethods.SW_RESTORE))
            {
                _maximize.NoteRestored(id);
                _selfMovedAt[handle] = now;
                changed = true;
                _log(Inv($"[max] restore 0x{handle.ToInt64():X} to form a pair"));
            }
        }

        foreach (int id in actions.Minimize)
        {
            if (!_tracker.TryGetHandle(id, out nint handle)) continue;

            var window = new Win32Window(handle);
            if (!window.IsValid || window.IsMinimized) continue;

            if (window.Show(NativeMethods.SW_MINIMIZE))
            {
                _selfMovedAt[handle] = now;
                changed = true;
                _log(Inv($"[max] minimize 0x{handle.ToInt64():X} behind the maximized window"));
            }
        }

        return changed;
    }

    private bool Apply(IReadOnlyList<Placement> placements, IReadOnlyList<Surface> surfaces)
    {
        if (placements.Count == 0) return false;

        var screenById = new Dictionary<int, int>(surfaces.Count);
        foreach (Surface surface in surfaces) screenById[surface.Id] = surface.ScreenId;

        // The undo entry describes the configuration *before* this batch, so
        // capture the slots it held before the new plan replaces them.
        var previousSlots = new Dictionary<int, int?>(placements.Count);
        foreach (Placement placement in placements)
        {
            previousSlots[placement.SurfaceId] =
                _slots.TryGetValue(placement.SurfaceId, out int previousSlot) ? previousSlot : null;
        }

        _slots.Clear();
        foreach (Placement placement in placements)
        {
            _slots[placement.SurfaceId] = SlotKey(screenById, placement.SurfaceId, placement.Order);
        }

        var targets = new List<GeometryTarget>(placements.Count);
        var before = new List<PlacedWindow>(placements.Count);
        foreach (Placement placement in placements)
        {
            if (placement.Layer != Layer.Tiled) continue;
            if (!_tracker.TryGetHandle(placement.SurfaceId, out nint handle)) continue;

            var window = new Win32Window(handle);
            if (!window.IsValid || !window.IsVisible) continue;
            // Never move a window whose frame is not the frame the plan describes.
            if (window.IsMinimized || window.IsMaximized || window.IsCloaked) continue;
            // Above/tool windows are classified out of the tracker; this is the
            // last, cheap guard against a classification that raced a style change.
            if (window.IsTopmost || window.IsToolWindow || window.IsNoActivate) continue;
            if (placement.Rect.Width <= 0 || placement.Rect.Height <= 0) continue;

            Rect current = window.FrameBounds;
            if (Near(current, placement.Rect)) continue;

            targets.Add(new GeometryTarget(handle, placement.Rect));
            before.Add(new PlacedWindow(
                placement.SurfaceId,
                previousSlots[placement.SurfaceId],
                current,
                window.IsMaximized));
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

        // The pre-batch frames make this the single undo entry (§13).
        if (result.Applied > 0) _history.Record(before);

        _log(Inv(
            $"[tile] applied {result.Applied}/{result.Requested}, ",
            $"{result.Mismatches.Count} mismatch(es)"));
        return result.Applied > 0;
    }

    /// <summary>
    /// Slots are unique per screen in this single-workspace stage. Encoding the
    /// screen in the key lets the core undo validation check slot ownership
    /// without two monitors' slot 0 windows colliding.
    /// </summary>
    private static int SlotKey(IReadOnlyDictionary<int, int> screenById, int surfaceId, int order)
    {
        int screenId = screenById.TryGetValue(surfaceId, out int id) ? id : 0;
        return (screenId * 2) + order;
    }

    private bool ClampToWorkAreas(IReadOnlyList<Surface> surfaces)
    {
        // The user owns the geometry until the gesture ends, so the clamp never
        // races a drag.
        if (_userDragging != 0) return false;

        var monitors = new Dictionary<nint, MonitorInfo>(_monitors.Count);
        foreach (MonitorInfo monitor in _monitors) monitors[monitor.Handle] = monitor;

        bool moved = false;
        long now = Stopwatch.GetTimestamp();
        foreach (Surface surface in surfaces)
        {
            if (!_tracker.TryGetHandle(surface.Id, out nint handle)) continue;

            var window = new Win32Window(handle);
            if (!window.IsValid || !window.IsVisible || window.IsCloaked) continue;
            if (!monitors.TryGetValue(window.MonitorHandle, out MonitorInfo? monitor) || monitor is null) continue;

            bool settling = IsSelfMove(handle, now);
            if (!WindowClamp.TryTarget(window, monitor, settling, out Rect target)) continue;
            if (!GeometryApplier.Apply(new GeometryTarget(handle, target))) continue;

            _selfMovedAt[handle] = now;
            moved = true;
            _log(Inv(
                $"[clamp] 0x{handle.ToInt64():X} -> ",
                $"{target.X:0},{target.Y:0} {target.Width:0}x{target.Height:0}"));
        }

        return moved;
    }

    /// <summary>
    /// Drop handles whose destroy event was missed and re-plan when the tileable
    /// set (not its geometry) changed. Runs at most once a second on the host
    /// thread; all state it touches is single-threaded.
    /// </summary>
    private bool SweepIfDue()
    {
        long now = Stopwatch.GetTimestamp();
        if (Stopwatch.GetElapsedTime(_lastSweepAt, now) < SelfHealInterval) return false;
        _lastSweepAt = now;

        IReadOnlyList<Surface> surfaces = _tracker.Snapshot(ScreenMap());
        PruneState(surfaces);

        string signature = TileSignature.For(surfaces);
        if (_lastSignature is null)
        {
            _lastSignature = signature;
            return false;
        }

        if (signature == _lastSignature) return false;

        _log("[heal] tileable set changed; re-planning");
        _tracker.RequestRetile();
        return true;
    }

    private void PruneState(IReadOnlyList<Surface> surfaces)
    {
        var live = new HashSet<int>(surfaces.Count);
        foreach (Surface surface in surfaces) live.Add(surface.Id);

        foreach (int id in _slots.Keys.ToArray())
        {
            if (!live.Contains(id)) _slots.Remove(id);
        }

        _maximize.Prune(live);

        foreach (nint handle in _selfMovedAt.Keys.ToArray())
        {
            if (!NativeMethods.IsWindow(handle)) _selfMovedAt.Remove(handle);
        }
    }

    private bool IsRetileSuppressed() =>
        _suppressRetileFrom != 0 && Stopwatch.GetElapsedTime(_suppressRetileFrom) < UndoSettle;

    private Dictionary<nint, int> ScreenMap()
    {
        var map = new Dictionary<nint, int>(_monitors.Count);
        foreach (MonitorInfo monitor in _monitors) map[monitor.Handle] = monitor.Index;
        return map;
    }

    private IReadOnlyList<Surface> SnapshotSurfaces()
    {
        RefreshTopology();
        return _tracker.Snapshot(ScreenMap());
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
