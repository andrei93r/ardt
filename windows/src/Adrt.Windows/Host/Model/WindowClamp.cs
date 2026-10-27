using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// The host half of the §35 clamp-to-screen pass: decide whether one live
/// window is an off-screen float and, if so, where it belongs.
/// </summary>
/// <remarks>
/// The eligibility rule is the core's (<see cref="Clamp.ShouldClampWindow"/>),
/// so minimized, maximized, fullscreen, settling and stubborn windows are left
/// alone. The clamp is idempotent and uses the work area, the same reference the
/// tiler plans against.
/// </remarks>
internal static class WindowClamp
{
    /// <summary>Compute the pulled-back rectangle for a window, or false when it is inside.</summary>
    public static bool TryTarget(
        Win32Window window, MonitorInfo? monitor, bool settling, out Rect target)
    {
        target = default;
        if (monitor is null) return false;

        Rect frame = window.FrameBounds;
        var candidate = new ClampCandidate
        {
            Ready = true,
            RoutePending = false,
            // The tracker has no fullscreen flag, so recognise the common case:
            // a frame that covers the whole monitor (including the taskbar strip)
            // is not an off-screen float and is never pulled into the work area.
            Fullscreen = CoversMonitor(frame, monitor.Bounds),
            Minimized = window.IsMinimized,
            Maximized = window.IsMaximized,
            Stubborn = false,
            Settling = settling,
            Frame = frame,
        };

        if (!Clamp.ShouldClampWindow(candidate)) return false;

        Rect clamped = Types.ClampRectToArea(frame, monitor.WorkArea, Clamp.ClampTolerancePx);
        if (Types.RectEquals(frame, clamped)) return false;

        target = clamped;
        return true;
    }

    private static bool CoversMonitor(Rect frame, Rect monitor) =>
        frame.Width > 0 &&
        frame.Height > 0 &&
        frame.X <= monitor.X + Clamp.ClampTolerancePx &&
        frame.Y <= monitor.Y + Clamp.ClampTolerancePx &&
        frame.Right >= monitor.Right - Clamp.ClampTolerancePx &&
        frame.Bottom >= monitor.Bottom - Clamp.ClampTolerancePx;
}
