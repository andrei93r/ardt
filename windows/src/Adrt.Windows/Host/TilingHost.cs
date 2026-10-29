using System.Diagnostics;
using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// The tiling loop: pump events → coalesced drain → core plan → geometry, plus
/// the W4 model behaviours (maximize ladder, floats, ratios, refusal ladder,
/// clamp, self-heal, undo, focus, virtual-desktop workspaces).
/// </summary>
/// <remarks>
/// <para>
/// On each drain the host snapshots the tileable windows, asks
/// <see cref="Tiler.LayoutAll"/> for a plan per workspace/screen, and applies
/// the placements with <see cref="GeometryApplier"/> in one batch. Workspace ids
/// come from the documented <c>IVirtualDesktopManager</c> when it is available
/// (each desktop maps to a session workspace); otherwise every screen stays in
/// workspace 0, the legal single-desktop mode.
/// </para>
/// <para>
/// Guards keep the host from fighting itself: a placement whose rectangle the
/// window already occupies is not applied, location-change events for a window
/// we just moved are ignored for a short window (our own
/// <c>SetWindowPos</c> echoes back through the hook), and a user move/resize
/// drag is left alone until it ends. A window that refuses its tile is stepped
/// down the core refusal ladder and its app then cools down; the periodic sweep
/// reaps handles whose destroy event was missed and re-plans when the tileable
/// set changed.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class TilingHost
{
    private static readonly TimeSpan DebounceQuiet = TimeSpan.FromMilliseconds(50);
    private static readonly TimeSpan SelfMoveSuppression = TimeSpan.FromMilliseconds(750);
    private static readonly TimeSpan SelfHealInterval = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan UndoSettle = TimeSpan.FromMilliseconds(1200);
    private static readonly TimeSpan DesktopPollInterval = TimeSpan.FromSeconds(1);
    private const double TolerancePixels = 1.0;
    private const double RefusalTolerancePixels = Clamp.ClampTolerancePx;
    private const double AssumedRefreshRate = 60;

    /// <summary>
    /// Base configuration: half split, flush to the work area. The live copy
    /// (<see cref="_configuration"/>) adds the persisted ratios.
    /// </summary>
    private static readonly TilerConfig DefaultConfiguration = new()
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
    private readonly FocusLap _focusLap = new();
    private readonly FloatState _floats;
    private readonly RatioStore _ratios;
    private readonly IVirtualDesktopHost _desktops;
    private readonly Adaptation _adaptation = new();
    private readonly Action<string> _log;
    private readonly Dictionary<nint, long> _selfMovedAt = [];
    private readonly Dictionary<int, int> _slots = [];
    private readonly List<MonitorInfo> _monitors = [];
    private TilerConfig _configuration;
    private nint _userDragging;
    private bool _paused;
    private long _lastSweepAt;
    private long _lastDesktopPollAt;
    private Guid _lastDesktopId;
    private int _activeWorkspace;
    private long _suppressRetileFrom;
    private string? _lastSignature;

    private readonly record struct RefusalAttempt(
        Surface Surface,
        nint Handle,
        Rect Requested,
        Rect Actual,
        bool PairTried);

    /// <summary>Create a host over a started (or about-to-start) pump.</summary>
    /// <param name="pump">The WinEvent pump the host drains.</param>
    /// <param name="log">Receives one line per applied batch; defaults to the console.</param>
    public TilingHost(WindowEventPump pump, Action<string>? log = null)
    {
        ArgumentNullException.ThrowIfNull(pump);
        _pump = pump;
        _log = log ?? Console.WriteLine;
        _floats = new FloatState(_log);
        _ratios = new RatioStore(_log);
        _desktops = new VirtualDesktops(_log);
        _configuration = DefaultConfiguration with { Ratios = _ratios.Snapshot() };
        _lastSweepAt = Stopwatch.GetTimestamp();
    }

    /// <summary>True while tiling is paused; events keep being drained but no plan is applied.</summary>
    public bool IsPaused => _paused;

    /// <summary>Last monitor topology the host planned against.</summary>
    public IReadOnlyList<MonitorInfo> Monitors => _monitors;

    /// <summary>True when there is a placement batch that <see cref="UndoLast"/> can revert.</summary>
    public bool CanUndo => _history.Size > 0;

    /// <summary>
    /// True when the documented Windows virtual-desktop API is available. False
    /// means the host keeps the legal single-desktop default and
    /// <see cref="TryMoveWorkspaceToDesktop"/> always returns false.
    /// </summary>
    public bool VirtualDesktopsSupported => _desktops.IsSupported;

    /// <summary>The workspace id mapped to the active virtual desktop (0 when unsupported).</summary>
    public int ActiveWorkspace => _activeWorkspace;

    /// <summary>A snapshot of the floating surface ids.</summary>
    public IReadOnlyCollection<int> FloatingWindows => _floats.Ids;

    /// <summary>A copy of the persisted split ratios, keyed by <c>connector:workspace:axis</c>.</summary>
    public IReadOnlyDictionary<string, double> Ratios => _ratios.Snapshot();

    /// <summary>Read the stored ratio for a workspace on a screen; 0.5 when unset.</summary>
    public double GetRatio(int workspaceId, int screenId, SplitAxis axis)
    {
        RefreshTopology();
        return TryConnector(screenId, out string connector)
            ? _ratios.Get(connector, workspaceId, axis)
            : 0.5;
    }

    /// <summary>
    /// Move one window to the virtual desktop mapped to <paramref name="workspaceId"/>.
    /// The workspace must have been observed this session; false in single-desktop
    /// mode or for an unknown workspace.
    /// </summary>
    public bool MoveToWorkspace(int surfaceId, int workspaceId)
    {
        if (!_desktops.IsSupported)
        {
            _log("[desktops] not supported; workspace stays on the single desktop");
            return false;
        }

        if (!_tracker.TryGetHandle(surfaceId, out nint handle)) return false;
        if (!_desktops.TryMoveToWorkspace(handle, workspaceId)) return false;

        _focusLap.Reset();
        _tracker.RequestRetile();
        _log(Inv($"[desktops] surface {surfaceId} -> workspace {workspaceId}"));
        return true;
    }

    /// <summary>
    /// Reap a workspace: drop its desktop mapping and shift the ratios to its
    /// right down one via <see cref="Tiler.RemapRatiosAfterReap"/>. The active
    /// workspace is never reaped.
    /// </summary>
    public bool ReapWorkspace(int workspaceId)
    {
        if (workspaceId < 0 || workspaceId == _activeWorkspace) return false;

        bool mapped = _desktops.ForgetWorkspace(workspaceId);
        bool remapped = _ratios.RemapAfterReap([workspaceId]);
        if (!mapped && !remapped) return false;

        _activeWorkspace = _desktops.ActiveWorkspace;
        RefreshConfiguration();
        _focusLap.Reset();
        _tracker.RequestRetile();
        _log(Inv($"[reap] workspace {workspaceId}; ratios remapped"));
        return true;
    }

    /// <summary>
    /// Move every tracked window of <paramref name="workspaceId"/> to
    /// <paramref name="desktopId"/>. The desktop id must come from Windows; the
    /// host never invents one.
    /// </summary>
    /// <returns>True when at least one window was moved; false when unsupported, the id is empty, or no window moved.</returns>
    public bool TryMoveWorkspaceToDesktop(int workspaceId, Guid desktopId)
    {
        if (!_desktops.IsSupported)
        {
            _log("[desktops] not supported; workspace stays on the single desktop");
            return false;
        }

        if (workspaceId < 0 || desktopId == Guid.Empty)
        {
            _log(Inv($"[desktops] invalid request ws={workspaceId} desktop={desktopId}"));
            return false;
        }

        IReadOnlyList<Surface> surfaces = SnapshotSurfaces();
        int moved = 0;
        foreach (Surface surface in surfaces)
        {
            if (surface.WorkspaceId != workspaceId) continue;
            if (!_tracker.TryGetHandle(surface.Id, out nint handle)) continue;
            if (_desktops.TryMoveToDesktop(handle, desktopId)) moved++;
        }

        _log(Inv(
            $"[desktops] workspace {workspaceId} -> {desktopId}: moved {moved} window(s)"));
        if (moved > 0)
        {
            _focusLap.Reset();
            _tracker.RequestRetile();
        }

        return moved > 0;
    }

    /// <summary>Seed the tracker with the windows already on screen and read the topology.</summary>
    public void Start()
    {
        _tracker.Seed();
        RefreshTopology();

        // Ratios are keyed by connector, so load them after the first topology
        // read (and migrate any old index-keyed file). Floats are keyed by the
        // session-scoped surface id, so re-bind the saved records to live windows.
        _ratios.Load(ConnectorByIndex());
        RefreshConfiguration();

        // Probe the active desktop before mapping surfaces so workspace 0 is the
        // desktop the user is looking at, then re-bind saved floats.
        _desktops.Refresh();
        _lastDesktopId = _desktops.CurrentDesktopId ?? Guid.Empty;
        _activeWorkspace = _desktops.ActiveWorkspace;
        _floats.Load();
        _floats.Restore(SnapshotCore());

        _lastDesktopPollAt = Stopwatch.GetTimestamp();
        _lastSweepAt = _lastDesktopPollAt;

        string desktopMode = _desktops.IsSupported
            ? FormattableString.Invariant($"virtual desktops ({_desktops.WorkspaceCount} mapped)")
            : "single-desktop mode";
        _log(Inv(
            $"[host] tiling started; {desktopMode}, ",
            $"{_floats.Ids.Count} float(s), {_ratios.Snapshot().Count} ratio(s)."));
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

    /// <summary>
    /// §6: flip one window between the tiled pair and the floating layer. A
    /// floating window stays where it is and is excluded from the planner; its
    /// former sibling fills the screen on the next drain.
    /// </summary>
    /// <param name="surfaceId">The tracker's surface id for the window.</param>
    /// <returns>The new floating state (false when the window is tiled).</returns>
    public bool ToggleFloat(int surfaceId)
    {
        Surface? surface = SurfaceById(surfaceId);
        if (surface is null)
        {
            _log(Inv($"[float] surface {surfaceId} is not tracked; ignored"));
            return IsFloating(surfaceId);
        }

        bool floating = _floats.Toggle(surfaceId, surface.AppId, surface.Title);
        _log(Inv(
            $"[float] surface {surfaceId} ({surface.AppId}) -> {(floating ? "floating" : "tiled")}"));
        _tracker.RequestRetile();
        return floating;
    }

    /// <summary>True when <paramref name="surfaceId"/> is on the floating layer (§6).</summary>
    public bool IsFloating(int surfaceId) => _floats.IsFloating(surfaceId);

    /// <summary>
    /// §10: store the split ratio for a workspace on a screen. The value is the
    /// sorted-first app's share along <paramref name="axis"/>, clamped to
    /// 0.05-0.95 and persisted; the next drain lays the pair out with it.
    /// </summary>
    /// <returns>True when the request was valid and stored (an unchanged value is a no-op success).</returns>
    public bool SetRatio(int workspaceId, int screenId, SplitAxis axis, double ratio)
    {
        if (workspaceId < 0 || screenId < 0 || !double.IsFinite(ratio))
        {
            _log(Inv($"[ratio] invalid request ws={workspaceId} screen={screenId} value={ratio:0.###}"));
            return false;
        }

        RefreshTopology();
        if (!TryConnector(screenId, out string connector))
        {
            _log(Inv($"[ratio] no screen {screenId}; ignored"));
            return false;
        }

        bool changed = _ratios.Set(connector, workspaceId, axis, ratio);
        if (changed) RefreshConfiguration();

        string key = Tiler.RatioKey(connector, workspaceId, axis);
        _log(Inv($"[ratio] {key} = {_ratios.Get(connector, workspaceId, axis):0.###}"));
        if (changed) _tracker.RequestRetile();
        return true;
    }

    /// <summary>
    /// §10/§5: shift the saved ratios after workspaces are reaped, so a ratio
    /// keeps its workspace and a stale key is never reused. The single-workspace
    /// stage never reaps one; this is the hook the workspace layer calls.
    /// </summary>
    /// <returns>True when the persisted table changed.</returns>
    public bool RemapRatiosAfterReap(IReadOnlyList<int> reaped)
    {
        ArgumentNullException.ThrowIfNull(reaped);
        if (reaped.Count == 0) return false;
        if (!_ratios.RemapAfterReap(reaped)) return false;

        RefreshConfiguration();
        _log(Inv($"[ratio] remapped after reaping workspace(s) {string.Join(",", reaped)}"));
        _tracker.RequestRetile();
        return true;
    }

    /// <summary>Drain events and, once they have been quiet for 50 ms, plan and apply.</summary>
    /// <returns>True when at least one window was moved.</returns>
    public bool Tick() => Tick(DebounceQuiet);

    /// <summary>Drain events and plan if the stream has been quiet for <paramref name="quiet"/>.</summary>
    public bool Tick(TimeSpan quiet)
    {
        IReadOnlyList<WindowEvent> events = FilterEvents(_pump.Drain());
        ForgetDestroyedFloats(events);
        _tracker.Observe(events);

        bool switched = PollDesktopSwitch();
        bool reaped = SweepIfDue();
        if (_paused) return false;

        // The periodic sweep is the repair path for a missed destroy/classification
        // event, so it plans immediately instead of waiting for another event.
        if (reaped || switched) return !IsRetileSuppressed() && Retile();

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
                Workspace = surface.WorkspaceId,
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
        _focusLap.Reset();
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

        int? next = _focusLap.Next(current, surfaces, _slots, _floats.Floating);
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

        var screens = new List<Screen>(_monitors.Count);
        foreach (MonitorInfo monitor in _monitors)
        {
            screens.Add(ToScreen(monitor));
        }

        IReadOnlyList<Surface> surfaces = SnapshotCore();
        MaximizeActions maximizeActions = _maximize.Observe(surfaces);
        if (!maximizeActions.IsEmpty && ApplyMaximize(maximizeActions))
        {
            // A restore changes the flags the planner reads, and a minimize drops
            // the window from the active set; refresh before planning.
            surfaces = SnapshotCore();
        }

        _lastSignature = TileSignature.For(surfaces);
        _focusLap.Reset();

        List<TilerWindow> windows = SelectWindows(surfaces);
        _log(Inv($"[debug] monitors={screens.Count} tracked={_tracker.TrackedCount} surfaces={surfaces.Count} windows={windows.Count}"));

        bool moved = false;
        if (windows.Count > 0)
        {
            IReadOnlyList<WorkspacePlan> plans = Tiler.LayoutAll(new TilerInput
            {
                Windows = windows,
                Screens = screens,
                Config = _configuration,
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
    /// that keep a maximized or minimized window out of a half-tile, plus the
    /// host's explicit float set (§6).
    /// </summary>
    private List<TilerWindow> SelectWindows(IReadOnlyList<Surface> surfaces)
    {
        var windows = new List<TilerWindow>(surfaces.Count);
        foreach (Surface surface in surfaces)
        {
            if (surface.Layer != Layer.Tiled) continue;
            if (Types.NonTileableKinds.Contains(surface.Kind)) continue;
            if (_floats.IsFloating(surface.Id)) continue;

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
                WorkspaceId = surface.WorkspaceId,
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
        var surfaceById = new Dictionary<int, Surface>(surfaces.Count);
        foreach (Surface surface in surfaces)
        {
            screenById[surface.Id] = surface.ScreenId;
            surfaceById[surface.Id] = surface;
        }
        long now = Stopwatch.GetTimestamp();

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
        var requestedByWindow = new Dictionary<nint, Placement>(placements.Count);
        foreach (Placement placement in placements)
        {
            if (placement.Layer != Layer.Tiled) continue;
            if (!surfaceById.TryGetValue(placement.SurfaceId, out Surface? surface)) continue;
            if (_adaptation.IsStubborn(StubbornCooldown.KeyFor(surface), now)) continue;
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
            requestedByWindow[handle] = placement;
            before.Add(new PlacedWindow(
                placement.SurfaceId,
                surface.WorkspaceId,
                previousSlots[placement.SurfaceId],
                current,
                window.IsMaximized));
        }

        if (targets.Count == 0) return false;

        GeometryApplyResult result = GeometryApplier.ApplyBatch(targets);
        foreach (GeometryTarget target in targets)
        {
            _selfMovedAt[target.Window] = now;
            _log(Inv(
                $"[tile] 0x{target.Window.ToInt64():X} -> ",
                $"{target.Rect.X:0},{target.Rect.Y:0} {target.Rect.Width:0}x{target.Rect.Height:0}"));
        }

        // The pre-batch frames make this the single undo entry (§13). A retry may
        // move a sibling only, so record after the ladder has run.
        var mismatchedHandles = new HashSet<nint>(result.Mismatches.Count);
        foreach (GeometryMismatch mismatch in result.Mismatches) mismatchedHandles.Add(mismatch.Window);
        foreach (GeometryTarget target in targets)
        {
            if (mismatchedHandles.Contains(target.Window)) continue;
            if (!requestedByWindow.TryGetValue(target.Window, out Placement? accepted)) continue;
            if (!surfaceById.TryGetValue(accepted.SurfaceId, out Surface? acceptedSurface)) continue;
            _adaptation.NoteSuccess(StubbornCooldown.KeyFor(acceptedSurface));
        }

        _log(Inv(
            $"[tile] applied {result.Applied}/{result.Requested}, ",
            $"{result.Mismatches.Count} mismatch(es)"));

        bool moved = result.Applied > 0;
        moved |= AdaptMismatches(result.Mismatches, requestedByWindow, surfaces, now);
        if (moved) _history.Record(before);
        return moved;
    }

    /// <summary>
    /// §10: feed the read-back mismatches to the refusal ladder. The pair's
    /// sibling adapts to the size the refusing window insisted on
    /// (<see cref="PlacementPolicy.RefusalLadder"/>); when even that cannot fit,
    /// the window steps down full → half → minimum. A window still refusing at
    /// the bottom is left alone for its app's stubborn cooldown.
    /// </summary>
    private bool AdaptMismatches(
        IReadOnlyList<GeometryMismatch> mismatches,
        IReadOnlyDictionary<nint, Placement> requestedByWindow,
        IReadOnlyList<Surface> surfaces,
        long now)
    {
        if (mismatches.Count == 0) return false;

        var surfaceById = new Dictionary<int, Surface>(surfaces.Count);
        foreach (Surface surface in surfaces) surfaceById[surface.Id] = surface;

        var requestedBySurface = new Dictionary<int, Rect>(requestedByWindow.Count);
        foreach (Placement placement in requestedByWindow.Values)
        {
            requestedBySurface[placement.SurfaceId] = placement.Rect;
        }

        var pending = new List<RefusalAttempt>(mismatches.Count);
        foreach (GeometryMismatch mismatch in mismatches)
        {
            if (!requestedByWindow.TryGetValue(mismatch.Window, out Placement? placement)) continue;
            if (!surfaceById.TryGetValue(placement.SurfaceId, out Surface? surface)) continue;
            if (mismatch.Actual.Width <= 0 || mismatch.Actual.Height <= 0) continue;
            pending.Add(new RefusalAttempt(surface, mismatch.Window, placement.Rect, mismatch.Actual, PairTried: false));
        }

        if (pending.Count == 0) return false;

        bool moved = false;
        for (int attempt = 0; attempt < 2 && pending.Count > 0; attempt++)
        {
            var retries = new List<GeometryTarget>(pending.Count);
            var retryMeta = new List<RefusalAttempt>(pending.Count);
            var next = new List<RefusalAttempt>(pending.Count);

            foreach (RefusalAttempt state in pending)
            {
                string appKey = StubbornCooldown.KeyFor(state.Surface);
                if (_adaptation.IsStubborn(appKey, now))
                {
                    _log(Inv($"[adapt] {appKey} cooling down"));
                    continue;
                }

                if (!TryAdaptationArea(state.Surface.ScreenId, out Rect area, out SplitAxis axis)) continue;

                Surface? sibling = FindPairSibling(state.Surface, surfaceById, requestedBySurface);
                bool pairHandled = false;
                if (sibling is not null &&
                    !state.PairTried &&
                    PlacementRefusal.StageFor(state.Requested, area, axis) != RefusalStage.Minimum)
                {
                    pairHandled = TryBuildPairRetry(
                        state, sibling, requestedBySurface, area, axis, retries, retryMeta, out bool escaped);
                    if (pairHandled && !escaped)
                    {
                        // The refusing window keeps the frame it chose; the sibling
                        // adapted, so this pair is resolved for this pass.
                        _adaptation.NoteSuccess(appKey);
                    }
                }

                if (pairHandled) continue;

                AdaptationResult adaptation = _adaptation.Observe(
                    state.Requested, state.Actual, appKey, now, area, axis);
                if (adaptation.ShouldRetry && adaptation.Next is RefusalStep step &&
                    step.Rect.Width > 0 && step.Rect.Height > 0)
                {
                    retries.Add(new GeometryTarget(state.Handle, step.Rect));
                    retryMeta.Add(state with { Requested = step.Rect, PairTried = true });
                    continue;
                }

                if (adaptation.CoolingDown)
                {
                    _log(Inv($"[adapt] {appKey} cooling down"));
                }

                next.Add(state with { PairTried = true });
            }

            if (retries.Count == 0)
            {
                pending = next;
                break;
            }

            GeometryApplyResult retryResult = GeometryApplier.ApplyBatch(retries);
            moved |= retryResult.Applied > 0;
            foreach (GeometryTarget target in retries) _selfMovedAt[target.Window] = now;

            var failed = new HashSet<nint>(retryResult.Mismatches.Count);
            foreach (GeometryMismatch mismatch in retryResult.Mismatches) failed.Add(mismatch.Window);

            foreach (RefusalAttempt meta in retryMeta)
            {
                if (!failed.Contains(meta.Handle))
                {
                    _adaptation.NoteSuccess(StubbornCooldown.KeyFor(meta.Surface));
                    continue;
                }

                Rect actual = GeometryApplier.ReadBack(meta.Handle);
                if (actual.Width <= 0 || actual.Height <= 0) actual = meta.Actual;
                next.Add(meta with { Actual = actual });
            }

            _log(Inv($"[adapt] attempt {attempt + 1}: retried {retries.Count}, applied {retryResult.Applied}"));
            pending = next;
            if (retryResult.Mismatches.Count == 0) break;
        }

        foreach (RefusalAttempt state in pending)
        {
            string appKey = StubbornCooldown.KeyFor(state.Surface);
            if (_adaptation.IsStubborn(appKey, now)) continue;

            _adaptation.NoteRefusal(appKey, now);
            _log(Inv(
                $"[adapt] {appKey} refused; stubborn for {StubbornCooldown.Duration.TotalSeconds:0}s"));
        }

        return moved;
    }

    /// <summary>
    /// Adapt the pair to the frame the refusing window actually took. Returns
    /// true when the pair produced a follow-up target (or the refusing window is
    /// resolved because the sibling adapted); <paramref name="escaped"/> means
    /// both windows were stepped down to minimum shares.
    /// </summary>
    private bool TryBuildPairRetry(
        RefusalAttempt state,
        Surface sibling,
        IReadOnlyDictionary<int, Rect> requestedBySurface,
        Rect area,
        SplitAxis axis,
        List<GeometryTarget> retries,
        List<RefusalAttempt> retryMeta,
        out bool escaped)
    {
        escaped = false;
        if (!_tracker.TryGetHandle(sibling.Id, out nint siblingHandle)) return false;

        Rect siblingRequested = requestedBySurface.TryGetValue(sibling.Id, out Rect requested)
            ? requested
            : sibling.Frame;
        double total = PlacementRefusal.Extent(area, axis);
        if (total <= 0) return false;

        double keep = Types.Clamp(PlacementRefusal.Extent(state.Actual, axis), 1, total);
        double siblingMinimum = PlacementRefusal.Extent(sibling.Min, axis);
        (double siblingExtent, bool giveUp) = PlacementPolicy.RefusalLadder(keep, siblingMinimum, total);
        bool refusingFirst = PlacementRefusal.IsFirstAlongAxis(state.Requested, siblingRequested, axis);
        double start = axis == SplitAxis.Horizontal ? area.X : area.Y;
        double end = axis == SplitAxis.Horizontal ? area.Right : area.Bottom;

        if (giveUp)
        {
            escaped = true;
            double minimum = Math.Max(1, total * PlacementRefusal.MinimumShare);
            double remainder = Math.Max(1, total - minimum);
            Rect refusingRect = refusingFirst
                ? PlacementRefusal.FromOffset(area, axis, start, minimum)
                : PlacementRefusal.FromOffset(area, axis, end - minimum, minimum);
            Rect siblingRect = refusingFirst
                ? PlacementRefusal.FromOffset(area, axis, start + minimum, remainder)
                : PlacementRefusal.FromOffset(area, axis, start, remainder);

            refusingRect = Types.ClampRectToArea(refusingRect, area);
            siblingRect = Types.ClampRectToArea(siblingRect, area);
            if (refusingRect.Width > 0 && refusingRect.Height > 0)
            {
                retries.Add(new GeometryTarget(state.Handle, refusingRect));
                retryMeta.Add(state with { Requested = refusingRect, PairTried = true });
            }

            if (siblingRect.Width > 0 && siblingRect.Height > 0)
            {
                retries.Add(new GeometryTarget(siblingHandle, siblingRect));
                retryMeta.Add(new RefusalAttempt(sibling, siblingHandle, siblingRect, sibling.Frame, PairTried: true));
            }

            return true;
        }

        double offset = refusingFirst
            ? axis == SplitAxis.Horizontal ? state.Actual.Right : state.Actual.Bottom
            : axis == SplitAxis.Horizontal ? state.Actual.X : state.Actual.Y;
        Rect adapted = refusingFirst
            ? PlacementRefusal.FromOffset(area, axis, offset, siblingExtent)
            : PlacementRefusal.EndingAt(area, axis, offset, siblingExtent);
        adapted = Types.ClampRectToArea(adapted, area);
        if (adapted.Width <= 0 || adapted.Height <= 0) return true;

        if (!Near(sibling.Frame, adapted, RefusalTolerancePixels))
        {
            retries.Add(new GeometryTarget(siblingHandle, adapted));
            retryMeta.Add(new RefusalAttempt(sibling, siblingHandle, adapted, sibling.Frame, PairTried: true));
        }

        return true;
    }

    /// <summary>The other planned window on the same workspace and screen, or null.</summary>
    private Surface? FindPairSibling(
        Surface surface,
        IReadOnlyDictionary<int, Surface> surfaceById,
        IReadOnlyDictionary<int, Rect> requestedBySurface)
    {
        Surface? found = null;
        foreach (Surface candidate in surfaceById.Values)
        {
            if (candidate.Id == surface.Id) continue;
            if (candidate.ScreenId != surface.ScreenId) continue;
            if (candidate.WorkspaceId != surface.WorkspaceId) continue;
            if (!requestedBySurface.ContainsKey(candidate.Id)) continue;
            if (_floats.IsFloating(candidate.Id)) continue;
            if (found is not null) return null;
            found = candidate;
        }

        return found;
    }

    /// <summary>The work area and split axis a surface's tile belongs to.</summary>
    private bool TryAdaptationArea(int screenId, out Rect area, out SplitAxis axis)
    {
        foreach (MonitorInfo monitor in _monitors)
        {
            if (monitor.Index != screenId) continue;

            area = monitor.WorkArea;
            axis = _configuration.WorkspaceAxis
                ?? (monitor.Bounds.Height > monitor.Bounds.Width
                    ? SplitAxis.Vertical
                    : SplitAxis.Horizontal);
            return true;
        }

        area = default;
        axis = SplitAxis.Horizontal;
        return false;
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
            bool stubborn = _adaptation.IsStubborn(StubbornCooldown.KeyFor(surface), now);
            if (!WindowClamp.TryTarget(window, monitor, settling, stubborn, out Rect target)) continue;
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

        bool released = _adaptation.Expire(now);

        IReadOnlyList<Surface> surfaces = SnapshotCore();
        PruneState(surfaces);

        string signature = TileSignature.For(surfaces);
        if (_lastSignature is null)
        {
            _lastSignature = signature;
            return false;
        }

        if (signature == _lastSignature)
        {
            if (!released) return false;
            _log("[adapt] stubborn cooldown expired; retrying");
            _tracker.RequestRetile();
            return true;
        }

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

        // A float may be on another virtual desktop (and therefore absent from
        // this desktop's snapshot) without having been destroyed, so the sweep
        // checks the handle, not the current surface list.
        int forgottenFloats = 0;
        foreach (int floatId in _floats.Ids.ToArray())
        {
            if (_tracker.TryGetHandle(floatId, out nint floatHandle) && NativeMethods.IsWindow(floatHandle)) continue;
            if (_floats.Forget(floatId)) forgottenFloats++;
        }

        if (forgottenFloats > 0)
        {
            _log(Inv($"[float] forgot {forgottenFloats} window(s) that no longer exist"));
            _focusLap.Reset();
        }

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
        return SnapshotCore();
    }

    /// <summary>
    /// Snapshot the tracker and decorate each surface with the workspace id of
    /// its virtual desktop. In single-desktop mode every window stays workspace 0.
    /// </summary>
    private IReadOnlyList<Surface> SnapshotCore()
    {
        IReadOnlyList<Surface> surfaces = _tracker.Snapshot(ScreenMap());
        if (!_desktops.IsSupported) return surfaces;

        var mapped = new List<Surface>(surfaces.Count);
        foreach (Surface surface in surfaces)
        {
            if (_tracker.TryGetHandle(surface.Id, out nint handle) &&
                _desktops.TryGetWorkspaceForWindow(handle, out int workspaceId))
            {
                mapped.Add(surface with { WorkspaceId = workspaceId });
            }
            else
            {
                mapped.Add(surface);
            }
        }

        return mapped;
    }

    /// <summary>
    /// §5.5: poll the documented virtual-desktop API once a second and re-plan
    /// when the user switches desktops. The platform has no switch notification,
    /// so a poll is the portable detection path.
    /// </summary>
    private bool PollDesktopSwitch()
    {
        long now = Stopwatch.GetTimestamp();
        if (Stopwatch.GetElapsedTime(_lastDesktopPollAt, now) < DesktopPollInterval) return false;
        _lastDesktopPollAt = now;
        if (!_desktops.IsSupported) return false;

        Guid before = _lastDesktopId;
        _desktops.Refresh();
        Guid after = _desktops.CurrentDesktopId ?? Guid.Empty;
        if (after == Guid.Empty) return false;

        _activeWorkspace = _desktops.ActiveWorkspace;
        if (before == Guid.Empty)
        {
            _lastDesktopId = after;
            return false;
        }

        if (after == before) return false;

        _lastDesktopId = after;
        _slots.Clear();
        _focusLap.Reset();
        _tracker.Seed();
        _tracker.RequestRetile();
        _log(Inv($"[desktops] switched to desktop {after} (workspace {_activeWorkspace}); re-planning"));
        return true;
    }

    /// <summary>
    /// §6: a destroyed window is no longer a float. Done before the tracker
    /// consumes the destroy event, while the handle → id mapping still exists.
    /// </summary>
    private void ForgetDestroyedFloats(IReadOnlyList<WindowEvent> events)
    {
        foreach (WindowEvent rawEvent in events)
        {
            if (rawEvent.Kind != WindowEventKind.Destroy) continue;
            if (_tracker.TryGetId(rawEvent.Window, out int surfaceId)) _floats.Forget(surfaceId);
        }
    }

    private Surface? SurfaceById(int surfaceId)
    {
        foreach (Surface surface in SnapshotSurfaces())
        {
            if (surface.Id == surfaceId) return surface;
        }

        return null;
    }

    private void RefreshConfiguration() =>
        _configuration = DefaultConfiguration with { Ratios = _ratios.Snapshot() };

    private Dictionary<int, string> ConnectorByIndex()
    {
        var map = new Dictionary<int, string>(_monitors.Count);
        foreach (MonitorInfo monitor in _monitors) map[monitor.Index] = monitor.DeviceName;
        return map;
    }

    private bool TryConnector(int screenId, out string connector)
    {
        foreach (MonitorInfo monitor in _monitors)
        {
            if (monitor.Index != screenId) continue;
            connector = monitor.DeviceName;
            return true;
        }

        connector = string.Empty;
        return false;
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

    private static bool Near(Rect left, Rect right) => Near(left, right, TolerancePixels);

    private static bool Near(Rect left, Rect right, double tolerance) =>
        Math.Abs(left.X - right.X) <= tolerance &&
        Math.Abs(left.Y - right.Y) <= tolerance &&
        Math.Abs(left.Width - right.Width) <= tolerance &&
        Math.Abs(left.Height - right.Height) <= tolerance;

    private static string FormatMonitor(MonitorInfo monitor) => Inv(
        $"monitor {monitor.Index}: {monitor.DeviceName} ",
        $"{monitor.Bounds.Width:0}x{monitor.Bounds.Height:0} at {monitor.Bounds.X:0},{monitor.Bounds.Y:0} ",
        $"work {monitor.WorkArea.X:0},{monitor.WorkArea.Y:0} ",
        $"{monitor.WorkArea.Width:0}x{monitor.WorkArea.Height:0} ",
        $"scale {monitor.Scale:0.##}{(monitor.IsPrimary ? " primary" : "")}");

    private static string Inv(params FormattableString[] parts) =>
        string.Concat(parts.Select(part => FormattableString.Invariant(part)));
}
