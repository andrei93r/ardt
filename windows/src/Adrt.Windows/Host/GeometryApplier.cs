using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>One window and the visible rectangle (physical pixels) it should occupy.</summary>
/// <param name="Window">Target HWND.</param>
/// <param name="Rect">Desired DWM extended frame bounds, in physical pixels.</param>
public readonly record struct GeometryTarget(nint Window, Rect Rect);

/// <summary>A window whose post-apply frame differs from the requested rectangle.</summary>
/// <param name="Window">The window read back.</param>
/// <param name="Requested">Rectangle requested by the planner.</param>
/// <param name="Actual">Rectangle the window actually took.</param>
public readonly record struct GeometryMismatch(nint Window, Rect Requested, Rect Actual);

/// <summary>Result of one batch apply.</summary>
/// <param name="Requested">Number of live windows in the batch.</param>
/// <param name="Applied">Number of windows the OS accepted (partial only when the deferred batch had to fall back to individual calls).</param>
/// <param name="Mismatches">Windows whose read-back differs by more than one physical pixel.</param>
public readonly record struct GeometryApplyResult(
    int Requested,
    int Applied,
    IReadOnlyList<GeometryMismatch> Mismatches)
{
    /// <summary>True when every requested window accepted its rectangle exactly.</summary>
    public bool IsExact => Requested > 0 && Applied == Requested && Mismatches.Count == 0;
}

/// <summary>
/// Applies geometry batches and reads the result back.
/// </summary>
/// <remarks>
/// <para>
/// Input rectangles are <em>visible</em> bounds (what DWM reports for
/// <c>DWMWA_EXTENDED_FRAME_BOUNDS</c>). Windows' <c>SetWindowPos</c> wants the
/// outer window rectangle, so each target is expanded by its measured
/// <see cref="Win32Window.FrameMargins"/> before the batch runs. This keeps the
/// tiler's math in one coordinate system and the invisible border out of it.
/// </para>
/// <para>
/// A batch is applied with <c>BeginDeferWindowPos</c>/<c>EndDeferWindowPos</c>
/// and <c>SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOSENDCHANGING</c>, so the OS
/// settles all windows in one pass without raising focus or z-order changes.
/// Windows are allowed to refuse (minimum sizes, apps that ignore moves); the
/// read-back is the honest answer and feeds the model's refusal ladder.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public static class GeometryApplier
{
    private const double TolerancePixels = 1.0;

    private const uint ApplyFlags =
        NativeMethods.SWP_NOACTIVATE |
        NativeMethods.SWP_NOZORDER |
        NativeMethods.SWP_NOSENDCHANGING;

    /// <summary>Apply a single window and report whether the OS accepted the call.</summary>
    public static bool Apply(GeometryTarget target) => ApplyBatch([target]).Applied == 1;

    /// <summary>
    /// Apply all live windows as one deferred batch, then read every window back.
    /// Dead handles are skipped, never treated as errors.
    /// </summary>
    public static GeometryApplyResult ApplyBatch(IReadOnlyList<GeometryTarget> targets)
    {
        ArgumentNullException.ThrowIfNull(targets);

        var prepared = new List<PreparedWindow>(targets.Count);
        var requested = new List<GeometryTarget>(targets.Count);

        foreach (GeometryTarget target in targets)
        {
            if (target.Window == 0 || !NativeMethods.IsWindow(target.Window)) continue;

            FrameMargins margins = new Win32Window(target.Window).FrameMargins;
            prepared.Add(new PreparedWindow(target.Window, ToWindowRect(target.Rect, margins)));
            requested.Add(target);
        }

        if (prepared.Count == 0) return new GeometryApplyResult(0, 0, []);

        int applied = prepared.Count == 1
            ? (ApplyOne(prepared[0]) ? 1 : 0)
            : ApplyDeferred(prepared);

        var mismatches = new List<GeometryMismatch>();
        foreach (GeometryTarget target in requested)
        {
            Rect actual = ReadBack(target.Window);
            if (!WithinTolerance(target.Rect, actual))
            {
                mismatches.Add(new GeometryMismatch(target.Window, target.Rect, actual));
            }
        }

        return new GeometryApplyResult(requested.Count, applied, mismatches);
    }

    /// <summary>
    /// Read a window's visible frame back. Returns an empty rectangle when the
    /// window disappeared between apply and read.
    /// </summary>
    public static Rect ReadBack(nint window) => new Win32Window(window).FrameBounds;

    private static int ApplyDeferred(List<PreparedWindow> prepared)
    {
        nint position = NativeMethods.BeginDeferWindowPos(prepared.Count);
        if (position == 0) return ApplyEach(prepared);

        foreach (PreparedWindow item in prepared)
        {
            position = NativeMethods.DeferWindowPos(
                position,
                item.Window,
                0,
                item.Rect.Left,
                item.Rect.Top,
                item.Rect.Right - item.Rect.Left,
                item.Rect.Bottom - item.Rect.Top,
                ApplyFlags);

            if (position == 0)
            {
                // The batch handle is unusable from here on; release it and fall
                // back to individual calls so one bad window cannot block the pair.
                NativeMethods.EndDeferWindowPos(0);
                return ApplyEach(prepared);
            }
        }

        return NativeMethods.EndDeferWindowPos(position) ? prepared.Count : 0;
    }

    private static int ApplyEach(List<PreparedWindow> prepared)
    {
        int applied = 0;
        foreach (PreparedWindow item in prepared)
        {
            if (ApplyOne(item)) applied++;
        }

        return applied;
    }

    private static bool ApplyOne(PreparedWindow item) =>
        NativeMethods.SetWindowPos(
            item.Window,
            0,
            item.Rect.Left,
            item.Rect.Top,
            item.Rect.Right - item.Rect.Left,
            item.Rect.Bottom - item.Rect.Top,
            ApplyFlags);

    private static NativeMethods.RECT ToWindowRect(Rect visible, FrameMargins margins) => new()
    {
        Left = Round(visible.X) - margins.Left,
        Top = Round(visible.Y) - margins.Top,
        Right = Round(visible.Right) + margins.Right,
        Bottom = Round(visible.Bottom) + margins.Bottom,
    };

    private static int Round(double value) => (int)Math.Round(value, MidpointRounding.AwayFromZero);

    private static bool WithinTolerance(Rect requested, Rect actual) =>
        Math.Abs(requested.X - actual.X) <= TolerancePixels &&
        Math.Abs(requested.Y - actual.Y) <= TolerancePixels &&
        Math.Abs(requested.Width - actual.Width) <= TolerancePixels &&
        Math.Abs(requested.Height - actual.Height) <= TolerancePixels;

    private readonly record struct PreparedWindow(nint Window, NativeMethods.RECT Rect);
}
