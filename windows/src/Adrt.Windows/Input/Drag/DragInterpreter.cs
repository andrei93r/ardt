using Adrt.Core;

namespace Adrt.Windows.Input.Drag;

/// <summary>What one completed user drag meant.</summary>
/// <param name="Window">The dragged HWND.</param>
/// <param name="Mode">Resize on a shared inner edge, or a move.</param>
/// <param name="Start">Frame when the drag started.</param>
/// <param name="End">Frame when it ended.</param>
/// <param name="Ratio">Dragged window's share of the work area along the resize axis, clamped to 5-95%.</param>
/// <param name="Detail">Human-readable interpretation for the log.</param>
internal sealed record DragReport(
    nint Window,
    AdjustMode Mode,
    Rect Start,
    Rect End,
    double? Ratio,
    string Detail);

/// <summary>
/// Reads the OS-owned window drag and classifies it through the pure core.
/// </summary>
/// <remarks>
/// <para>
/// Windows runs the move/size loop itself, and <see cref="TilingHost"/> already
/// consumes the pump's <c>MoveSizeStart</c>/<c>MoveSizeEnd</c> events (and
/// suppresses its own planning during a drag). The input lane cannot drain the
/// same queue twice, so it learns the same state from
/// <c>GetGUIThreadInfo(GUI_INMOVESIZE)</c> on the host tick. <see cref="Observe"/>
/// is the event-shaped entry point for the day the host exposes its filtered
/// stream; both paths feed the identical interpreter.
/// </para>
/// <para>
/// On release, <see cref="Adjust.ClassifyAdjust"/> decides move versus inner-edge
/// resize (the W5.3 "one edge moved" rule). A resize records the resulting
/// split share; the host's ratio storage (W4.6) is what will make that share
/// survive the next drain. A move needs no action: the tiler follows the
/// windows' left/right order, so dragging across already swaps the pair.
/// </para>
/// </remarks>
internal sealed class DragInterpreter
{
    private const double MinRatio = 0.05;
    private const double MaxRatio = 0.95;

    private readonly Action<string> _log;
    private bool _active;
    private nint _window;
    private Rect _start;

    public DragInterpreter(Action<string> log)
    {
        ArgumentNullException.ThrowIfNull(log);
        _log = log;
    }

    /// <summary>The last completed interpretation, or null before the first drag.</summary>
    public DragReport? LastReport { get; private set; }

    /// <summary>True while a drag is in progress.</summary>
    public bool IsDragging => _active;

    /// <summary>Feed a raw pump event (the direct path once the host exposes them).</summary>
    public void Observe(in WindowEvent rawEvent)
    {
        switch (rawEvent.Kind)
        {
            case WindowEventKind.MoveSizeStart:
                Begin(rawEvent.Window);
                break;
            case WindowEventKind.MoveSizeEnd:
                End();
                break;
            default:
                break;
        }
    }

    /// <summary>Poll the foreground thread's move/size state; call once per host tick.</summary>
    public void Poll()
    {
        var info = new InputNativeMethods.GUITHREADINFO
        {
            cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<InputNativeMethods.GUITHREADINFO>(),
        };

        bool moving = InputNativeMethods.GetGUIThreadInfo(0, ref info) &&
                      (info.flags & InputNativeMethods.GUI_INMOVESIZE) != 0;

        if (moving && !_active)
        {
            nint handle = info.hwndMoveSize != 0 ? info.hwndMoveSize : Win32Window.Foreground.Handle;
            Begin(handle);
        }
        else if (!moving && _active)
        {
            End();
        }
    }

    private void Begin(nint handle)
    {
        if (handle == 0 || _active) return;

        var window = new Win32Window(handle);
        if (!window.IsValid) return;

        Rect frame = window.FrameBounds;
        if (frame.Width <= 0 || frame.Height <= 0) return;

        _active = true;
        _window = handle;
        _start = frame;
    }

    private DragReport? End()
    {
        if (!_active) return null;
        _active = false;

        var window = new Win32Window(_window);
        if (!window.IsValid) return null;

        Rect end = window.FrameBounds;
        if (end.Width <= 0 || end.Height <= 0) return null;

        AdjustMode mode = Adjust.ClassifyAdjust(_start, end);
        double? ratio = null;
        string detail;

        if (mode == AdjustMode.Resize)
        {
            bool horizontal = Math.Abs(end.Width - _start.Width) > Math.Abs(end.Height - _start.Height);
            MonitorInfo? monitor = MonitorOf(end);
            if (monitor is null)
            {
                detail = "inner-edge resize";
            }
            else
            {
                Rect area = monitor.WorkArea;
                double extent = horizontal ? area.Width : area.Height;
                double size = horizontal ? end.Width : end.Height;
                ratio = extent <= 0 ? null : Math.Clamp(size / extent, MinRatio, MaxRatio);
                detail = ratio is { } share
                    ? FormattableString.Invariant(
                        $"inner-edge resize on the {(horizontal ? "horizontal" : "vertical")} axis; share {share:0.###}")
                    : "inner-edge resize";
            }
        }
        else
        {
            detail = "move";
        }

        var report = new DragReport(_window, mode, _start, end, ratio, detail);
        LastReport = report;
        _log(FormattableString.Invariant(
            $"[drag] 0x{_window.ToInt64():X}: {detail}; {_start.X:0},{_start.Y:0} {_start.Width:0}x{_start.Height:0} -> {end.X:0},{end.Y:0} {end.Width:0}x{end.Height:0}"));
        return report;
    }

    private static MonitorInfo? MonitorOf(Rect frame)
    {
        IReadOnlyList<MonitorInfo> monitors = Monitors.Enumerate();
        MonitorInfo? best = null;
        double bestArea = 0;
        foreach (MonitorInfo monitor in monitors)
        {
            Rect bounds = monitor.Bounds;
            double width = Math.Min(frame.Right, bounds.Right) - Math.Max(frame.X, bounds.X);
            double height = Math.Min(frame.Bottom, bounds.Bottom) - Math.Max(frame.Y, bounds.Y);
            if (width <= 0 || height <= 0) continue;
            double area = width * height;
            if (area <= bestArea) continue;
            bestArea = area;
            best = monitor;
        }

        return best ?? (monitors.Count > 0 ? monitors[0] : null);
    }
}
