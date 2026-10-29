using System.Diagnostics;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>How much of its requested tile a window is currently being offered.</summary>
internal enum RefusalStage
{
    /// <summary>The whole work area (a lone window).</summary>
    Full,

    /// <summary>A half share of the split.</summary>
    Half,

    /// <summary>The smallest share the host will try (§16: one sixth of the split).</summary>
    Minimum,
}

/// <summary>A fallback rectangle and the rung of the ladder it belongs to.</summary>
internal readonly record struct RefusalStep(Rect Rect, RefusalStage Stage);

/// <summary>
/// The host half of the §10 refusal ladder. Windows cannot query another
/// process's minimum size, so the ladder is driven by the size the window
/// actually took on read-back: the sibling adapts to the remainder first
/// (<see cref="PlacementPolicy.RefusalLadder"/>), then the refusing window is
/// stepped down to a smaller share.
/// </summary>
internal static class PlacementRefusal
{
    /// <summary>§16's escape share: one sixth of the split extent.</summary>
    public const double MinimumShare = 1.0 / 6.0;

    /// <summary>The axis extent of a rectangle.</summary>
    public static double Extent(Rect rect, SplitAxis axis) =>
        axis == SplitAxis.Horizontal ? rect.Width : rect.Height;

    /// <summary>Which rung a requested tile sits on, from its extent relative to the work area.</summary>
    public static RefusalStage StageFor(Rect target, Rect area, SplitAxis axis)
    {
        double extent = Extent(target, axis);
        double total = Extent(area, axis);
        if (total <= 0 || extent >= total * 0.9) return RefusalStage.Full;
        if (extent <= total / 3) return RefusalStage.Minimum;
        return RefusalStage.Half;
    }

    /// <summary>
    /// The next smaller tile for a window that has no sibling to adapt: full →
    /// half, half → the minimum share. Null once the minimum rung is reached.
    /// </summary>
    public static RefusalStep? LoneStep(Rect target, Rect area, SplitAxis axis)
    {
        RefusalStage stage = StageFor(target, area, axis);
        return stage switch
        {
            RefusalStage.Full => new RefusalStep(
                FromStart(area, axis, area.X, area.Y, 0.5),
                RefusalStage.Half),
            RefusalStage.Half => new RefusalStep(
                FromStart(area, axis, area.X, area.Y, MinimumShare),
                RefusalStage.Minimum),
            _ => null,
        };
    }

    /// <summary>A rectangle flush to the leading edge of the area, at a fraction of the axis.</summary>
    public static Rect FromStart(Rect area, SplitAxis axis, double startX, double startY, double fraction)
    {
        double extent = Math.Max(0, Extent(area, axis) * fraction);
        return axis == SplitAxis.Horizontal
            ? new Rect(startX, area.Y, extent, area.Height)
            : new Rect(area.X, startY, area.Width, extent);
    }

    /// <summary>A rectangle of <paramref name="extent"/> beginning at a point on the axis.</summary>
    public static Rect FromOffset(Rect area, SplitAxis axis, double offset, double extent)
    {
        double clamped = Math.Max(0, Math.Min(extent, Extent(area, axis)));
        if (axis == SplitAxis.Horizontal)
        {
            double x = Math.Max(area.X, Math.Min(offset, area.Right - clamped));
            return new Rect(x, area.Y, clamped, area.Height);
        }

        double y = Math.Max(area.Y, Math.Min(offset, area.Bottom - clamped));
        return new Rect(area.X, y, area.Width, clamped);
    }

    /// <summary>A rectangle of <paramref name="extent"/> ending at a point on the axis.</summary>
    public static Rect EndingAt(Rect area, SplitAxis axis, double endpoint, double extent)
    {
        double clamped = Math.Max(0, Math.Min(extent, Extent(area, axis)));
        return FromOffset(area, axis, endpoint - clamped, clamped);
    }

    /// <summary>True when <paramref name="first"/> is on the leading side of <paramref name="second"/>.</summary>
    public static bool IsFirstAlongAxis(Rect first, Rect second, SplitAxis axis) =>
        axis == SplitAxis.Horizontal
            ? first.X <= second.X
            : first.Y <= second.Y;
}

/// <summary>
/// What the host should do after reading a window's frame back against the tile
/// it was asked to take.
/// </summary>
/// <param name="Accepted">The window took the requested rectangle (within the clamp tolerance).</param>
/// <param name="Refused">The window read back a different rectangle, so it refused the tile.</param>
/// <param name="Next">The next target to try, or null when the ladder has no smaller rung.</param>
/// <param name="SiblingAdapted">True when the sibling can take the remainder instead.</param>
/// <param name="SiblingExtent">The sibling's new extent along the split axis.</param>
/// <param name="Escaped">True when the pair cannot exist (the sibling could not adapt either).</param>
/// <param name="CoolingDown">True while the app is inside its 10 s refusal cooldown.</param>
internal readonly record struct AdaptationResult(
    bool Accepted,
    bool Refused,
    RefusalStep? Next,
    bool SiblingAdapted,
    double SiblingExtent,
    bool Escaped,
    bool CoolingDown)
{
    /// <summary>True when there is another target the host should apply.</summary>
    public bool ShouldRetry => Next is not null;
}

/// <summary>
/// Host-side driver for the §10 refusal ladder, fed by read-back rather than by
/// a minimum size.
/// </summary>
/// <remarks>
/// <para>
/// Windows cannot query another process's minimum size, so the host requests a
/// tile, reads the frame back, and this helper decides the next move:
/// </para>
/// <list type="number">
///   <item>the read-back matches the request (within
///   <see cref="Clamp.ClampTolerancePx"/>) — accepted, and the app leaves its
///   refusal cooldown;</item>
///   <item>the refusing window keeps the size it insists on and the sibling
///   takes the remainder, clamped to the sibling's own minimum
///   (<see cref="PlacementPolicy.RefusalLadder"/>);</item>
///   <item>the sibling cannot adapt, so the requested tile is stepped down one
///   rung (full → half → the §16 minimum of one sixth);</item>
///   <item>there is no smaller rung left, so the app enters the per-app 10 s
///   cooldown (<see cref="StubbornCooldown"/>) and the host stops fighting it.</item>
/// </list>
/// <para>
/// This is a host helper only: the core stays pure, and the caller owns applying
/// <see cref="AdaptationResult.Next"/> and the sibling's new extent.
/// </para>
/// </remarks>
internal sealed class Adaptation
{
    private readonly StubbornCooldown _cooldown = new();

    /// <summary>How long an app is left alone after its last refusal (§12).</summary>
    public static TimeSpan CooldownDuration => StubbornCooldown.Duration;

    /// <summary>
    /// Compare a requested placement with the frame read back.
    /// </summary>
    /// <param name="requested">The placement the host asked for.</param>
    /// <param name="actual">The frame the window reported after the apply.</param>
    /// <param name="appId">The app whose refusal is remembered; use <see cref="StubbornCooldown.KeyFor"/> for unknown apps.</param>
    /// <param name="now">A timestamp on the same clock as <see cref="StubbornCooldown"/> (Stopwatch ticks).</param>
    /// <param name="area">The work area the tile belongs to.</param>
    /// <param name="axis">The split axis.</param>
    /// <param name="siblingMinimum">The sibling's minimum extent, or null for a lone window.</param>
    /// <param name="gap">The between-window gap already removed from the split.</param>
    public AdaptationResult Observe(
        Placement requested,
        Rect actual,
        string appId,
        long now,
        Rect area,
        SplitAxis axis,
        double? siblingMinimum = null,
        double gap = 0)
    {
        string key = appId.Length > 0 ? appId : FormattableString.Invariant($"#{requested.SurfaceId}");
        return ObserveCore(requested.Rect, actual, key, now, area, axis, siblingMinimum, gap);
    }

    /// <summary>Compare a requested rectangle with the frame read back.</summary>
    public AdaptationResult Observe(
        Rect requested,
        Rect actual,
        string appId,
        long now,
        Rect area,
        SplitAxis axis,
        double? siblingMinimum = null,
        double gap = 0) =>
        ObserveCore(requested, actual, appId, now, area, axis, siblingMinimum, gap);

    /// <summary>True while the app is inside its 10 s refusal cooldown.</summary>
    public bool IsCoolingDown(string appId, long now) => _cooldown.IsStubborn(appId, now);

    /// <summary>The app accepted its tile, so it is trusted again.</summary>
    public void NoteSuccess(string appId) => _cooldown.NoteSuccess(appId);

    /// <summary>Drop expired cooldown entries; true when at least one was released.</summary>
    public bool Expire(long now) => _cooldown.Expire(now);

    /// <summary>Number of apps currently cooling down (diagnostics).</summary>
    public int ActiveCooldownCount(long now) => _cooldown.ActiveCount(now);

    private AdaptationResult ObserveCore(
        Rect requested,
        Rect actual,
        string appKey,
        long now,
        Rect area,
        SplitAxis axis,
        double? siblingMinimum,
        double gap)
    {
        if (Took(requested, actual))
        {
            _cooldown.NoteSuccess(appKey);
            return new AdaptationResult(true, false, null, false, 0, false, false);
        }

        // A degenerate read is not a refusal: the window has not committed a
        // frame yet (the same reason Clamp.ShouldClampWindow ignores it).
        bool cooling = _cooldown.IsStubborn(appKey, now);
        if (actual.Width <= 0 || actual.Height <= 0)
        {
            return new AdaptationResult(false, false, null, false, 0, false, cooling);
        }

        double areaExtent = PlacementRefusal.Extent(area, axis);
        if (areaExtent <= 0)
        {
            return new AdaptationResult(false, true, null, false, 0, false, cooling);
        }

        double split = Math.Max(0, areaExtent - Math.Max(0, gap));
        double keep = Math.Min(PlacementRefusal.Extent(actual, axis), split);
        bool escaped = false;

        if (siblingMinimum is double minimum && split > 0)
        {
            (double sibling, bool siblingEscaped) =
                PlacementPolicy.RefusalLadder(keep, minimum, split);
            escaped = siblingEscaped;

            if (!siblingEscaped)
            {
                // The refusing window keeps what it insisted on; the sibling
                // takes the remainder, still flush to its side of the area.
                double offset = axis == SplitAxis.Horizontal ? actual.X : actual.Y;
                Rect keepRect = PlacementRefusal.FromOffset(area, axis, offset, keep);
                var step = new RefusalStep(
                    keepRect,
                    PlacementRefusal.StageFor(keepRect, area, axis));
                return new AdaptationResult(false, true, step, true, sibling, false, cooling);
            }
        }

        // The pair cannot exist or there is no sibling: step the requested tile
        // down one rung. Null means the minimum was already refused.
        RefusalStep? next = PlacementRefusal.LoneStep(requested, area, axis);
        if (next is null)
        {
            _cooldown.NoteRefusal(appKey, now);
            return new AdaptationResult(false, true, null, false, 0, escaped, true);
        }

        return new AdaptationResult(false, true, next, false, 0, escaped, cooling);
    }

    /// <summary>
    /// Whether the window took the requested rectangle. The tolerance is the
    /// clamp's own: a frame includes a small invisible resize border.
    /// </summary>
    public static bool Took(Rect requested, Rect actual)
    {
        if (requested.Width <= 0 || requested.Height <= 0) return true;

        double tolerance = Clamp.ClampTolerancePx;
        return Math.Abs(actual.X - requested.X) <= tolerance
            && Math.Abs(actual.Y - requested.Y) <= tolerance
            && Math.Abs(actual.Width - requested.Width) <= tolerance
            && Math.Abs(actual.Height - requested.Height) <= tolerance;
    }
}

/// <summary>
/// Per-app stubborn cooldown (§12). A window that refuses the geometry is not
/// fought every drain: its app is remembered for a short cooldown while the
/// planner leaves its frame alone. Cooldown-only — no minimum size is learned.
/// </summary>
internal sealed class StubbornCooldown
{
    /// <summary>How long a refused app is left alone.</summary>
    public static readonly TimeSpan Duration = TimeSpan.FromSeconds(10);

    private readonly Dictionary<string, long> _until = new(StringComparer.Ordinal);

    /// <summary>The key for a surface: its app id, or the surface id for unknown apps.</summary>
    public static string KeyFor(Surface surface) =>
        surface.AppId.Length > 0 ? surface.AppId : FormattableString.Invariant($"#{surface.Id}");

    /// <summary>True while the app is inside its refusal cooldown.</summary>
    public bool IsStubborn(string appKey, long now) =>
        _until.TryGetValue(appKey, out long until) && now < until;

    /// <summary>Start (or restart) the cooldown after a final refusal.</summary>
    public void NoteRefusal(string appKey, long now)
    {
        long duration = (long)(Duration.TotalSeconds * Stopwatch.Frequency);
        _until[appKey] = now + duration;
    }

    /// <summary>A window accepted its frame, so its app is trusted again.</summary>
    public void NoteSuccess(string appKey) => _until.Remove(appKey);

    /// <summary>Drop expired entries and return true when at least one was released.</summary>
    public bool Expire(long now)
    {
        bool any = false;
        foreach (var (key, until) in _until.ToArray())
        {
            if (now < until) continue;
            _until.Remove(key);
            any = true;
        }

        return any;
    }

    /// <summary>Number of apps currently cooling down (for diagnostics/logging).</summary>
    public int ActiveCount(long now)
    {
        int count = 0;
        foreach (long until in _until.Values)
        {
            if (now < until) count++;
        }

        return count;
    }
}
