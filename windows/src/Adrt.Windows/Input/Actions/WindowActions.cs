using Adrt.Core;

namespace Adrt.Windows.Input.Actions;

/// <summary>
/// The hotkey actions, expressed through the pure core and the host's public
/// surface.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="TilingHost"/> deliberately exposes only <c>Start</c>,
/// <c>TogglePause</c>, <c>RequestRetile</c>, <c>Tick</c> and its monitor list.
/// Everything else here is built from that surface plus <c>SetWindowPos</c>
/// (<see cref="GeometryApplier"/>): focus selection is <see cref="Focus"/>,
/// swap sides are <see cref="PlacementPolicy.SwappedSides"/>, undo validation is
/// <see cref="Undo"/>, cursor placement is <see cref="Cursor"/>. No action
/// writes model state itself.
/// </para>
/// <para>
/// Known gap while W4.6 is open: the host's <see cref="TilerConfig"/> has no
/// ratios, so a nudge (or an inner-edge drag) is applied to the live rects but
/// the next host drain re-splits the pair at 50%. The action is wired and
/// reported honestly; persistence lands with the host's ratio state. A swap
/// *does* persist, because the tiler follows the windows' left/right order.
/// </para>
/// <para>
/// Float state is likewise a host (W4.3) feature: the key records the intent and
/// logs it, but <see cref="TilingHost"/> still tiles the window. The key is
/// therefore listed as stubbed rather than silently doing nothing.
/// </para>
/// </remarks>
internal sealed class WindowActions
{
    private const double MinRatio = 0.05;
    private const double MaxRatio = 0.95;
    private const double MinimumExtent = 1;

    private readonly TilingHost _host;
    private readonly WindowCatalog _catalog;
    private readonly Action<string> _log;
    private readonly double _nudgeStep;
    private readonly ChangeLog _undo = new();
    private readonly HashSet<nint> _floated = [];
    private bool _ratioWarningLogged;

    public WindowActions(TilingHost host, WindowCatalog catalog, double nudgeStep, Action<string> log)
    {
        ArgumentNullException.ThrowIfNull(host);
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(log);

        _host = host;
        _catalog = catalog;
        _nudgeStep = Math.Clamp(nudgeStep, 0.01, 0.50);
        _log = log;
    }

    /// <summary>Dispatch one binding. Returns true when the action changed something.</summary>
    public bool Run(HotkeyBinding binding)
    {
        ArgumentNullException.ThrowIfNull(binding);

        return binding.Action switch
        {
            HotkeyAction.FocusDirection => binding.Direction is { } direction
                ? FocusToward(direction)
                : Malformed(binding),
            HotkeyAction.FocusCycle => FocusCycle(),
            HotkeyAction.SwapPair => SwapFocused("swap"),
            HotkeyAction.MoveToOtherHalf => SwapFocused("move-to-other-half"),
            HotkeyAction.MoveDirection => binding.Direction is { } direction
                ? MoveDirection(direction)
                : Malformed(binding),
            HotkeyAction.NudgeSplit => binding.Direction is { } direction
                ? ShiftBoundary(direction, _nudgeStep, "nudge")
                : Malformed(binding),
            HotkeyAction.ResizeFocused => Resize(binding.Grow),
            HotkeyAction.ToggleFloat => ToggleFloat(),
            HotkeyAction.ToggleMaximize => ToggleMaximize(),
            HotkeyAction.Undo => UndoLastChange(),
            HotkeyAction.CursorToCentre => CursorToCentre(),
            HotkeyAction.QuitFocused => QuitFocused(),
            _ => Malformed(binding),
        };
    }

    private bool FocusToward(FocusDirection direction)
    {
        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        MonitoredWindow? focused = GetFocused("focus");
        if (focused is null) return false;

        var candidates = new List<FocusCandidate>(windows.Count);
        foreach (MonitoredWindow window in windows)
        {
            if (window.Handle == focused.Handle || window.Surface.Flags.Minimized) continue;
            candidates.Add(new FocusCandidate { Id = window.Surface.Id, Rect = window.Frame });
        }

        int? targetId = Focus.PickDirectional(focused.Frame, candidates, direction);
        if (targetId is null)
        {
            _log(FormattableString.Invariant($"[focus] no window to the {direction.ToString().ToLowerInvariant()}"));
            return false;
        }

        MonitoredWindow? target = windows.FirstOrDefault(window => window.Surface.Id == targetId.Value);
        return target is not null && Activate(target, $"focus {direction.ToString().ToLowerInvariant()}");
    }

    private bool FocusCycle()
    {
        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        MonitoredWindow? focused = _catalog.FindFocused();
        if (windows.Count == 0)
        {
            _log("[focus] nothing to cycle");
            return false;
        }

        var entries = new List<CycleEntry>(windows.Count);
        foreach (MonitoredWindow window in windows)
        {
            entries.Add(new CycleEntry
            {
                Id = window.Surface.Id,
                Kind = CycleEntryKind.Managed,
                Slot = window.Slot,
                Rect = window.Frame,
                Minimized = window.Surface.Flags.Minimized,
            });
        }

        int? next = Focus.CycleOrder(focused?.Surface.Id, entries);
        if (next is null) return false;

        MonitoredWindow? target = windows.FirstOrDefault(window => window.Surface.Id == next.Value);
        return target is not null && Activate(target, "cycle focus");
    }

    private bool SwapFocused(string reason)
    {
        _catalog.Refresh();
        MonitoredWindow? focused = GetFocused(reason);
        if (focused is null) return false;

        MonitoredWindow? sibling = _catalog.SiblingOf(focused);
        if (sibling is null)
        {
            _log(FormattableString.Invariant($"[{reason}] nothing to swap: the focused window is alone on its monitor"));
            return false;
        }

        return SwapWindows(focused, sibling, reason);
    }

    private bool MoveDirection(FocusDirection direction)
    {
        _catalog.Refresh();
        MonitoredWindow? focused = GetFocused("move");
        if (focused is null) return false;

        MonitoredWindow? sibling = _catalog.SiblingOf(focused);
        if (sibling is null)
        {
            _log("[move] nothing in that direction: the focused window is alone on its monitor");
            return false;
        }

        var candidate = new FocusCandidate { Id = sibling.Surface.Id, Rect = sibling.Frame };
        int? pick = Focus.PickDirectional(focused.Frame, [candidate], direction);
        if (pick is null)
        {
            _log(FormattableString.Invariant($"[move] nothing in that direction ({direction.ToString().ToLowerInvariant()})"));
            return false;
        }

        return SwapWindows(focused, sibling, "move");
    }

    private bool SwapWindows(MonitoredWindow focused, MonitoredWindow sibling, string reason)
    {
        Rect focusedRect = focused.Frame;
        Rect siblingRect = sibling.Frame;
        if (focusedRect == siblingRect) return false;

        Capture(focused, sibling);
        (int slotA, int slotB) = PlacementPolicy.SwappedSides(
            focused.Surface.Id,
            focused.Slot,
            sibling.Surface.Id,
            sibling.Slot);

        GeometryApplyResult result = GeometryApplier.ApplyBatch(
        [
            new GeometryTarget(focused.Handle, siblingRect),
            new GeometryTarget(sibling.Handle, focusedRect),
        ]);

        _log(FormattableString.Invariant(
            $"[{reason}] {Describe(focused.Handle)} <-> {Describe(sibling.Handle)} sides {slotA}/{slotB}; applied {result.Applied}/{result.Requested}"));
        _host.RequestRetile();
        return result.Applied == result.Requested;
    }

    private bool Resize(bool grow)
    {
        _catalog.Refresh();
        MonitoredWindow? focused = GetFocused("resize");
        if (focused is null) return false;

        MonitoredWindow? sibling = _catalog.SiblingOf(focused);
        if (sibling is null)
        {
            _log("[resize] nothing-to-nudge: the focused window has no pair on this monitor");
            return false;
        }

        bool vertical = IsStacked(focused.Frame, sibling.Frame, focused.Monitor);
        bool focusedFirst = vertical
            ? focused.Frame.Y <= sibling.Frame.Y
            : focused.Frame.X <= sibling.Frame.X;
        bool positive = grow == focusedFirst;
        FocusDirection direction = vertical
            ? (positive ? FocusDirection.Down : FocusDirection.Up)
            : (positive ? FocusDirection.Right : FocusDirection.Left);

        return ShiftBoundaryCore(focused, sibling, direction, _nudgeStep, "resize");
    }

    private bool ShiftBoundary(FocusDirection direction, double step, string reason)
    {
        _catalog.Refresh();
        MonitoredWindow? focused = GetFocused(reason);
        if (focused is null) return false;

        MonitoredWindow? sibling = _catalog.SiblingOf(focused);
        if (sibling is null)
        {
            _log(FormattableString.Invariant(
                $"[{reason}] nothing-to-nudge: the focused window has no pair on this monitor"));
            return false;
        }

        return ShiftBoundaryCore(focused, sibling, direction, step, reason);
    }

    private bool ShiftBoundaryCore(
        MonitoredWindow focused,
        MonitoredWindow sibling,
        FocusDirection direction,
        double step,
        string reason)
    {
        bool vertical = IsStacked(focused.Frame, sibling.Frame, focused.Monitor);
        bool focusedFirst = vertical
            ? focused.Frame.Y <= sibling.Frame.Y
            : focused.Frame.X <= sibling.Frame.X;
        MonitoredWindow first = focusedFirst ? focused : sibling;
        MonitoredWindow second = focusedFirst ? sibling : focused;

        Rect area = focused.Monitor.WorkArea;
        double extent = vertical ? area.Height : area.Width;
        double origin = vertical ? area.Y : area.X;
        if (extent <= 0) return false;

        Rect firstRect = first.Frame;
        Rect secondRect = second.Frame;
        double boundary = vertical
            ? (firstRect.Y + firstRect.Height + secondRect.Y) / 2
            : (firstRect.X + firstRect.Width + secondRect.X) / 2;

        double sign = direction is FocusDirection.Left or FocusDirection.Up ? -1 : 1;
        double target = boundary + (sign * step * extent);
        double clamped = Math.Clamp(target, origin + (MinRatio * extent), origin + (MaxRatio * extent));
        if (Math.Abs(clamped - boundary) < 0.5)
        {
            _log(FormattableString.Invariant($"[{reason}] resize-limit: the pair is already at the 5-95% limit"));
            return false;
        }

        Capture(focused, sibling);

        Rect firstNext;
        Rect secondNext;
        if (vertical)
        {
            firstNext = firstRect with { Height = Math.Max(MinimumExtent, clamped - firstRect.Y) };
            secondNext = secondRect with
            {
                Y = clamped,
                Height = Math.Max(MinimumExtent, secondRect.Bottom - clamped),
            };
        }
        else
        {
            firstNext = firstRect with { Width = Math.Max(MinimumExtent, clamped - firstRect.X) };
            secondNext = secondRect with
            {
                X = clamped,
                Width = Math.Max(MinimumExtent, secondRect.Right - clamped),
            };
        }

        GeometryApplyResult result = GeometryApplier.ApplyBatch(
        [
            new GeometryTarget(first.Handle, firstNext),
            new GeometryTarget(second.Handle, secondNext),
        ]);

        _log(FormattableString.Invariant(
            $"[{reason}] split {boundary:0.#} -> {clamped:0.#} on {(vertical ? "vertical" : "horizontal")} axis; applied {result.Applied}/{result.Requested}"));
        WarnRatioNotPersisted();
        return result.Applied == result.Requested;
    }

    private bool ToggleMaximize()
    {
        _catalog.Refresh();
        MonitoredWindow? focused = GetFocused("maximize");
        if (focused is null) return false;

        Capture(focused);
        bool maximized = focused.Window.IsMaximized;
        bool ok = focused.Window.Show(maximized ? InputNativeMethods.SW_RESTORE : InputNativeMethods.SW_MAXIMIZE);
        _log(FormattableString.Invariant(
            $"[maximize] {Describe(focused.Handle)} -> {(maximized ? "restore" : "maximize")}: {(ok ? "ok" : "refused")}"));

        // The host re-plans after the state change: a restored window rejoins its
        // half, a maximized one leaves the pair (the tiler fills its sibling).
        _host.RequestRetile();
        return ok;
    }

    private bool ToggleFloat()
    {
        _catalog.Refresh();
        MonitoredWindow? focused = GetFocused("float");
        if (focused is null) return false;

        bool floating;
        if (_floated.Remove(focused.Handle))
        {
            floating = false;
        }
        else
        {
            _floated.Add(focused.Handle);
            floating = true;
        }

        _log(FormattableString.Invariant(
            $"[float] {Describe(focused.Handle)} -> {(floating ? "floating" : "tiled")}; TilingHost has no float state yet (W4.3), so the next retile still tiles it"));
        return true;
    }

    private bool UndoLastChange()
    {
        Change? change = _undo.Take();
        if (change is null)
        {
            _log("[undo] nothing to undo");
            return false;
        }

        IReadOnlyList<MonitoredWindow> windows = _catalog.Refresh();
        var live = new List<LiveInstance>(windows.Count);
        foreach (MonitoredWindow window in windows)
        {
            live.Add(new LiveInstance
            {
                Id = window.Surface.Id,
                Workspace = window.Surface.WorkspaceId,
                Slot = window.Slot,
            });
        }

        UndoValidation validation = Undo.ValidateChange(change, live);
        if (!validation.Ok)
        {
            _log(FormattableString.Invariant(
                $"[undo] rejected: {validation.Problem?.ToString() ?? "unknown"}; the change can no longer be restored"));
            return false;
        }

        var targets = new List<GeometryTarget>(change.Instances.Count);
        var maximizeAfter = new List<nint>();
        foreach (InstanceConfig instance in change.Instances)
        {
            MonitoredWindow? window = windows.FirstOrDefault(candidate => candidate.Surface.Id == instance.Id);
            if (window is null) continue;

            Win32Window liveWindow = window.Window;
            bool wasMaximized = liveWindow.IsMaximized;
            if (liveWindow.IsMinimized || wasMaximized) liveWindow.Show(InputNativeMethods.SW_RESTORE);
            targets.Add(new GeometryTarget(window.Handle, instance.Rect));
            if (instance.Maximized) maximizeAfter.Add(window.Handle);
        }

        if (targets.Count == 0)
        {
            _log("[undo] rejected: none of the windows still exist");
            return false;
        }

        GeometryApplyResult result = GeometryApplier.ApplyBatch(targets);
        foreach (nint handle in maximizeAfter) _ = new Win32Window(handle).Show(InputNativeMethods.SW_MAXIMIZE);

        _log(FormattableString.Invariant(
            $"[undo] restored {result.Applied}/{result.Requested} window(s) from the single undo slot"));
        _host.RequestRetile();
        return result.Applied > 0;
    }

    private bool CursorToCentre()
    {
        _catalog.Refresh();
        MonitoredWindow? focused = GetFocused("cursor");
        if (focused is null) return false;

        Point centre = Cursor.CentreInWorkArea(focused.Frame, focused.Monitor.WorkArea);
        bool ok = InputNativeMethods.SetCursorPos((int)Math.Round(centre.X), (int)Math.Round(centre.Y));
        _log(FormattableString.Invariant(
            $"[cursor] -> {centre.X:0},{centre.Y:0} for {Describe(focused.Handle)}: {(ok ? "ok" : "refused")}"));
        return ok;
    }

    private bool QuitFocused()
    {
        _catalog.Refresh();
        MonitoredWindow? focused = GetFocused("quit-focused");
        if (focused is null) return false;

        bool ok = InputNativeMethods.PostMessage(focused.Handle, InputNativeMethods.WM_CLOSE, 0, 0);
        _log(FormattableString.Invariant(
            $"[quit-focused] WM_CLOSE -> {Describe(focused.Handle)}: {(ok ? "posted" : "refused")}"));
        return ok;
    }

    private bool Activate(MonitoredWindow target, string reason)
    {
        bool activated = InputNativeMethods.SetForegroundWindow(target.Handle);
        if (!activated)
        {
            // The foreground lock can refuse a background process; a minimized
            // window must be restored before it can take focus at all.
            Win32Window window = target.Window;
            if (window.IsMinimized) window.Show(InputNativeMethods.SW_RESTORE);
            activated = InputNativeMethods.SetForegroundWindow(target.Handle);
        }

        _log(activated
            ? FormattableString.Invariant($"[focus] {Describe(target.Handle)} ({reason})")
            : FormattableString.Invariant($"[focus] {Describe(target.Handle)} refused by the foreground lock; {reason} not applied"));
        return activated;
    }

    private MonitoredWindow? GetFocused(string action)
    {
        MonitoredWindow? focused = _catalog.FindFocused();
        if (focused is null) _log(FormattableString.Invariant($"[{action}] no focused tileable window"));
        return focused;
    }

    private void Capture(params MonitoredWindow[] windows)
    {
        var instances = new List<InstanceConfig>(windows.Length);
        foreach (MonitoredWindow window in windows)
        {
            instances.Add(new InstanceConfig
            {
                Id = window.Surface.Id,
                Workspace = window.Surface.WorkspaceId,
                Slot = window.Slot,
                Rect = window.Frame,
                Maximized = window.Surface.Flags.Maximized,
                Floating = window.Surface.Flags.Floating,
            });
        }

        _undo.Set(new Change { Instances = instances });
    }

    private void WarnRatioNotPersisted()
    {
        if (_ratioWarningLogged) return;
        _ratioWarningLogged = true;
        _log("[nudge] note: TilingHost has no ratio state yet (W4.6); the next drain re-splits the pair at 50%");
    }

    private static bool IsStacked(Rect first, Rect second, MonitorInfo monitor)
    {
        const double tolerance = 2;
        bool xDisjoint = first.Right <= second.X + tolerance || second.Right <= first.X + tolerance;
        bool yDisjoint = first.Bottom <= second.Y + tolerance || second.Bottom <= first.Y + tolerance;
        if (xDisjoint && !yDisjoint) return false;
        if (yDisjoint && !xDisjoint) return true;
        return monitor.Bounds.Height > monitor.Bounds.Width;
    }

    private bool Malformed(HotkeyBinding binding)
    {
        _log(FormattableString.Invariant(
            $"[input] {binding.Trigger} ({binding.Label}) has no direction/grow data; check HotkeyTable"));
        return false;
    }

    private static string Describe(nint handle) => FormattableString.Invariant($"0x{handle.ToInt64():X}");
}
