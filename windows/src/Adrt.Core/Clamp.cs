// Port of src/core/clamp.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>
/// §35: the pure eligibility rule for the clamp-to-screen pass. The adapter owns
/// the pass and the compositor writes; this decides *which* windows it may touch.
/// </summary>
public sealed record ClampCandidate
{
    /// <summary>The window has been adopted and its first frame has arrived.</summary>
    [JsonPropertyName("ready")] public required bool Ready { get; init; }

    /// <summary>§3/§11: a mapped newcomer whose placement has not been decided yet.</summary>
    [JsonPropertyName("routePending")] public required bool RoutePending { get; init; }

    [JsonPropertyName("fullscreen")] public required bool Fullscreen { get; init; }
    [JsonPropertyName("minimized")] public required bool Minimized { get; init; }

    /// <summary>
    /// The window is maximized. Mutter owns that window's frame: it reports the
    /// maximized *frame* including the invisible resize border, so it is a couple
    /// of pixels wider and taller than the monitor. Clamping it to the monitor
    /// means resizing a maximized window, and the only way to resize one is to
    /// unmaximize it first — the window then flashes to its restored size and the
    /// next pass maximizes it again.
    /// </summary>
    [JsonPropertyName("maximized")] public required bool Maximized { get; init; }

    /// <summary>§12: an app that has demonstrably refused geometry is not fought.</summary>
    [JsonPropertyName("stubborn")] public required bool Stubborn { get; init; }

    /// <summary>
    /// §11: the tiler is mid-transition for this window — an animation is live or an
    /// apply has just landed. The frame read now is an intermediate step toward a
    /// target the tiler already chose, not an off-screen float.
    /// </summary>
    [JsonPropertyName("settling")] public required bool Settling { get; init; }

    /// <summary>The window's frame as the compositor currently reports it.</summary>
    [JsonPropertyName("frame")] public required Rect Frame { get; init; }
}

public static class Clamp
{
    /// <summary>
    /// The slack, in pixels, the clamp pass allows on every side.
    ///
    /// The compositor reports a window's *frame*, and a frame includes the
    /// toplevel's invisible client-side-decoration border: a window adrt placed
    /// exactly in its slot is read back up to two pixels wider and one taller.
    /// Without the slack the clamp reads that as an off-screen float, resizes the
    /// window, and the next pass reads the same border again — a permanent 1 px
    /// resize loop that showed up as a tiled pair jittering by a pixel or two.
    /// </summary>
    public const double ClampTolerancePx = 4;

    /// <summary>
    /// Whether the clamp pass may move this window back inside its monitor.
    ///
    /// A window that is not adopted yet, is still waiting to be routed, or reports
    /// a degenerate (not-yet-committed) frame is **not** an off-screen float.
    /// Clamping it asks the compositor to place a zero-sized rect at the work-area
    /// origin, which a slow Wayland client (Chrome, VS Code) renders as a
    /// jump/tear — and the clamp's own retry ladder then races the tile apply that
    /// is routing the same window, so the window oscillates between the origin and
    /// its tile. Fullscreen and minimized windows own their frame and a stubborn
    /// client is never fought.
    ///
    /// A window the tiler is currently moving (`settling`) is likewise not an
    /// off-screen float: its frame is an intermediate step toward a target the
    /// tiler already chose. Clamping it writes a rect derived from that
    /// intermediate frame and races the animation — the window jumps, and the
    /// clamp's own apply resets the "recently moved" clock so the next drain
    /// clamps again. Chrome and VS Code skip adrt's animation entirely, so the
    /// tiler's apply is their whole transition and this race is what read as the
    /// live jump/tear.
    ///
    /// A **maximized** window is left alone for the same reason: its frame belongs
    /// to Mutter (it includes the invisible resize border, so it is a few pixels
    /// wider than the monitor) and resizing it means unmaximizing it first, which
    /// flashes the window to its restored size — a maximized lone window then
    /// flickers between full screen and half width on every pass.
    /// </summary>
    public static bool ShouldClampWindow(ClampCandidate candidate)
    {
        if (!candidate.Ready || candidate.RoutePending || candidate.Settling) return false;
        if (candidate.Fullscreen || candidate.Minimized || candidate.Maximized || candidate.Stubborn) return false;
        if (candidate.Frame.Width <= 0 || candidate.Frame.Height <= 0) return false;
        return true;
    }
}
