// Port of src/core/focus.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;

namespace Adrt.Core;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum FocusDirection
{
    [JsonStringEnumMemberName("left")] Left,
    [JsonStringEnumMemberName("right")] Right,
    [JsonStringEnumMemberName("up")] Up,
    [JsonStringEnumMemberName("down")] Down,
}

public sealed record FocusCandidate
{
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("rect")] public required Rect Rect { get; init; }
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum CycleEntryKind
{
    [JsonStringEnumMemberName("managed")] Managed,
    [SuppressMessage("Naming", "CA1720:Identifier contains type name", Justification = "Wire name is 'float'.")]
    [JsonStringEnumMemberName("float")] Float,
}

/// <summary>One step of the focus cycle: a managed window or a float on the plane.</summary>
public sealed record CycleEntry
{
    [JsonPropertyName("id")] public required int Id { get; init; }

    /// <summary>Managed windows cycle in slot order; floats after them, left to right.</summary>
    [JsonPropertyName("kind")] public required CycleEntryKind Kind { get; init; }

    /// <summary>The slot, for a managed window.</summary>
    [JsonPropertyName("slot")] public int? Slot { get; init; }

    /// <summary>Position, for a float: left to right, then a stable tiebreak.</summary>
    [JsonPropertyName("rect")] public Rect? Rect { get; init; }

    /// <summary>
    /// Compositor stacking position, used to order a perfect overlap when a lap
    /// starts. The caller snapshots the resulting sequence for the duration of the
    /// lap (`CycleSequence`), so raising a float does not re-order the lap.
    /// </summary>
    [JsonPropertyName("z")] public int? Z { get; init; }

    [JsonPropertyName("minimized")] public bool? Minimized { get; init; }
}

/// <summary>
/// Directional focus selection (§14) and the focus cycle (§6/§17). Pure: the
/// caller supplies the focused rect and the candidate windows of the *current
/// workspace* (any monitor).
/// </summary>
public static class Focus
{
    /// <summary>
    /// The rect a float without one compares as. Shared so the sort comparator does
    /// not allocate a fresh literal on every call for every rect-less entry.
    /// </summary>
    private static readonly Rect OriginRect = new(0, 0, 0, 0);

    private static int CompareCycle(CycleEntry a, CycleEntry b)
    {
        if (a.Kind != b.Kind) return a.Kind == CycleEntryKind.Managed ? -1 : 1;
        if (a.Kind == CycleEntryKind.Managed)
        {
            var sa = a.Slot ?? 0;
            var sb = b.Slot ?? 0;
            if (sa != sb) return sa - sb;
            return a.Id - b.Id;
        }
        var ra = a.Rect ?? OriginRect;
        var rb = b.Rect ?? OriginRect;
        var dx = ra.X - rb.X;
        if (Math.Abs(dx) > 1) return dx < 0 ? -1 : 1;
        var dy = ra.Y - rb.Y;
        if (Math.Abs(dy) > 1) return dy < 0 ? -1 : 1;
        // Perfect overlap: the stacking order (§6/§17). Focusing a float raises it,
        // so this order is only used when a lap *starts*; the caller snapshots the
        // resulting sequence and keeps it for the whole lap. The stable id is the
        // fallback when two floats report the same stacking position.
        var dz = (a.Z ?? 0) - (b.Z ?? 0);
        if (dz != 0) return dz;
        return a.Id - b.Id;
    }

    /// <summary>
    /// The full focus-cycle sequence of a plane: the managed windows in slot order,
    /// then the floats left to right, a perfect overlap by stacking order and the id
    /// as the final tiebreak. Minimized windows are skipped. Built once per lap so
    /// that focusing a float (which raises it) cannot re-order the lap in flight.
    /// </summary>
    public static IReadOnlyList<int> CycleSequence(IReadOnlyList<CycleEntry> entries)
    {
        // One pass to drop the minimized entries, one in-place sort, one pass to
        // project the ids. That removes the filter/map callback allocations and the
        // intermediate array `map` would build; the order (position within 1px, then
        // stacking, then id) is unchanged.
        var live = new List<CycleEntry>();
        foreach (var entry in entries)
        {
            if (entry.Minimized != true) live.Add(entry);
        }
        live.Sort(CompareCycle);
        var ids = new List<int>(live.Count);
        foreach (var entry in live) ids.Add(entry.Id);
        return ids;
    }

    /// <summary>
    /// §6/§17 focus cycle order: the managed windows of the current screen and
    /// workspace in slot order, then the floats left to right (a perfect overlap by
    /// stacking order, the id as the final tiebreak); minimized windows are skipped.
    /// Returns the next id after `current`, wrapping, or the first entry when
    /// `current` is not in the cycle. Null when there is nothing to focus.
    ///
    /// `order` is an optional lap snapshot from `CycleSequence`: when the caller
    /// keeps it for the duration of a lap, the order is fixed and a float that is
    /// raised by focusing it cannot move within the lap.
    /// </summary>
    public static int? CycleOrder(
        int? current,
        IReadOnlyList<CycleEntry> entries,
        IReadOnlyList<int>? order = null)
    {
        var live = order ?? CycleSequence(entries);
        if (live.Count == 0) return null;
        var index = current == null ? -1 : IndexOf(live, current.Value);
        if (index < 0) return live[0];
        return live[(index + 1) % live.Count];
    }

    /// <summary>
    /// The nearest candidate in `direction`, relative to `current`.
    ///
    /// Candidates must begin beyond `current` on that axis. On the first pass they
    /// must also overlap `current` on the perpendicular axis, which is what makes
    /// the choice follow the layout — left/right for a side-by-side pair, up/down
    /// for a stacked one — and what lets it reach another monitor. If nothing
    /// overlaps (an offset layout), a second pass drops that requirement.
    /// </summary>
    public static int? PickDirectional(
        Rect current,
        IReadOnlyList<FocusCandidate> candidates,
        FocusDirection direction)
    {
        var horizontal = direction == FocusDirection.Left || direction == FocusDirection.Right;
        // left/up measure from the far edge of `current`, right/down from the near
        // edge, so a single flag replaces the nested ternaries per candidate.
        var backwards = direction == FocusDirection.Left || direction == FocusDirection.Up;
        // One pass tracks both answers the two passes used to compute separately: the
        // nearest overlapping candidate (the preferred one) and the nearest candidate
        // overall (the fallback). No closure is allocated per call.
        int? best = null;
        var bestDistance = double.PositiveInfinity;
        int? overlapBest = null;
        var overlapDistance = double.PositiveInfinity;
        foreach (var candidate in candidates)
        {
            var q = candidate.Rect;
            double along;
            if (horizontal)
            {
                along = backwards
                    ? current.X - (q.X + q.Width)
                    : q.X - (current.X + current.Width);
            }
            else
            {
                along = backwards
                    ? current.Y - (q.Y + q.Height)
                    : q.Y - (current.Y + current.Height);
            }
            if (along < -1) continue;
            if (along < bestDistance)
            {
                bestDistance = along;
                best = candidate.Id;
            }
            // Only an `along` that can beat the current overlapping best needs the
            // overlap test; everything else can never win it.
            if (along < overlapDistance)
            {
                var overlap = horizontal
                    ? Math.Min(current.Y + current.Height, q.Y + q.Height) - Math.Max(current.Y, q.Y)
                    : Math.Min(current.X + current.Width, q.X + q.Width) - Math.Max(current.X, q.X);
                if (overlap > 0)
                {
                    overlapDistance = along;
                    overlapBest = candidate.Id;
                }
            }
        }
        return overlapBest ?? best;
    }

    private static int IndexOf(IReadOnlyList<int> values, int value)
    {
        for (var i = 0; i < values.Count; i++)
        {
            if (values[i] == value) return i;
        }
        return -1;
    }
}
