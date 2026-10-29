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

    /// <summary>The axis extent of a size.</summary>
    public static double Extent(Size size, SplitAxis axis) =>
        axis == SplitAxis.Horizontal ? size.Width : size.Height;

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

/// <summary>The outcome of observing one refused frame.</summary>
/// <param name="ShouldRetry">The host should apply <paramref name="Next"/>.</param>
/// <param name="CoolingDown">The app is inside its stubborn cooldown; leave it alone.</param>
/// <param name="Next">The next rung of the ladder, when a retry is possible.</param>
internal readonly record struct AdaptationResult(
    bool ShouldRetry,
    bool CoolingDown,
    RefusalStep? Next);

/// <summary>
/// Host-side refusal bookkeeping: observes a read-back mismatch, chooses the
/// next rung of the ladder and owns the per-app stubborn cooldown.
/// </summary>
internal sealed class Adaptation
{
    private readonly StubbornCooldown _stubborn = new();

    /// <summary>True while <paramref name="appKey"/> is cooling down.</summary>
    public bool IsStubborn(string appKey, long now) => _stubborn.IsStubborn(appKey, now);

    /// <summary>Record a final refusal and start the cooldown.</summary>
    public void NoteRefusal(string appKey, long now) => _stubborn.NoteRefusal(appKey, now);

    /// <summary>Record an accepted frame and clear the app's cooldown.</summary>
    public void NoteSuccess(string appKey) => _stubborn.NoteSuccess(appKey);

    /// <summary>Drop expired cooldowns; true when at least one was released.</summary>
    public bool Expire(long now) => _stubborn.Expire(now);

    /// <summary>
    /// Choose the next smaller tile for a refused window. A cooldown app is not
    /// retried; once the minimum rung is reached there is no next step.
    /// </summary>
    public AdaptationResult Observe(
        Rect requested,
        Rect actual,
        string appKey,
        long now,
        Rect area,
        SplitAxis axis)
    {
        if (_stubborn.IsStubborn(appKey, now))
        {
            return new AdaptationResult(false, true, null);
        }

        RefusalStep? next = PlacementRefusal.LoneStep(requested, area, axis);
        return next is { } step
            ? new AdaptationResult(true, false, step)
            : new AdaptationResult(false, false, null);
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
