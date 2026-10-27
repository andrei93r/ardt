// Port of src/core/normalize.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum NormalizeDecisionKind
{
    [JsonStringEnumMemberName("none")] None,
    [JsonStringEnumMemberName("lone")] Lone,
    [JsonStringEnumMemberName("dominant")] Dominant,
    [JsonStringEnumMemberName("pair")] Pair,
}

/// <summary>One window as the normaliser sees it.</summary>
public sealed record NormalizeWindow
{
    [JsonPropertyName("id")] public required int Id { get; init; }

    /// <summary>The window's rect, used to choose the leftmost of the pair.</summary>
    [JsonPropertyName("rect")] public required Rect Rect { get; init; }

    /// <summary>
    /// Visible surface in square logical pixels: the window's own area minus
    /// whatever is stacked above it on the same workspace. Zero for a hidden
    /// window.
    /// </summary>
    [JsonPropertyName("visibleArea")] public required double VisibleArea { get; init; }

    /// <summary>A managed tile (tileable, not floating, not fullscreen, not minimized).</summary>
    [JsonPropertyName("managed")] public required bool Managed { get; init; }

    [JsonPropertyName("fullscreen")] public required bool Fullscreen { get; init; }
    [JsonPropertyName("floating")] public required bool Floating { get; init; }
}

/// <summary>The slot a paired window is assigned.</summary>
public sealed record NormalizeSlot
{
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("slot")] public required int Slot { get; init; }
}

/// <summary>What the adapter must do to normalise one workspace.</summary>
public sealed record NormalizeDecision
{
    [JsonPropertyName("kind")] public required NormalizeDecisionKind Kind { get; init; }

    /// <summary>Windows to maximize (in place; the lone law).</summary>
    [JsonPropertyName("maximize")] public required IReadOnlyList<int> Maximize { get; init; }

    /// <summary>Windows to minimize.</summary>
    [JsonPropertyName("minimize")] public required IReadOnlyList<int> Minimize { get; init; }

    /// <summary>The pair's slots, leftmost first.</summary>
    [JsonPropertyName("slots")] public required IReadOnlyList<NormalizeSlot> Slots { get; init; }
}

/// <summary>
/// §20 startup, adoption and enable-time normalisation.
///
/// Pure: given the managed windows of one workspace and the work area they are
/// fitted to, decide what the layout should be on **every enable**, including a
/// mid-session enable. The three branches are, in order (§20):
///
///   1. one managed window  -> it is maximized (the lone law);
///   2. one window covers at least `DominanceThreshold` of the work area ->
///      it is maximized and every other managed window on that workspace is
///      minimized;
///   3. otherwise the two windows with the most visible surface pair up (the
///      leftmost of the two takes the left slot) and the rest are minimized.
///
/// Floats and dialogs are never normalised, and a **fullscreen** window is left
/// untouched: it is the "does not fit" case and moves only on its own transition
/// (§16). The work area is the surface the windows are fitted to, so the
/// threshold is a fraction of its area.
/// </summary>
public static class Normalize
{
    /// <summary>§20: a window covering this fraction of the work area dominates it.</summary>
    public const double DominanceThreshold = 0.7;

    private static NormalizeDecision EmptyDecision(NormalizeDecisionKind kind) => new()
    {
        Kind = kind,
        Maximize = Array.Empty<int>(),
        Minimize = Array.Empty<int>(),
        Slots = Array.Empty<NormalizeSlot>(),
    };

    /// <summary>Area of a rect, never negative.</summary>
    public static double RectArea(Rect rect) => Math.Max(0, rect.Width) * Math.Max(0, rect.Height);

    /// <summary>
    /// Ranking comparator: most visible surface first, then leftmost, then id, so
    /// ties are deterministic. One definition replaces the two inline copies the
    /// dominant and pair branches used to carry.
    /// </summary>
    private static int ByVisibleThenPosition(NormalizeWindow a, NormalizeWindow b)
    {
        var visible = b.VisibleArea - a.VisibleArea;
        if (visible != 0 && !double.IsNaN(visible)) return visible < 0 ? -1 : 1;
        var x = a.Rect.X - b.Rect.X;
        if (x != 0 && !double.IsNaN(x)) return x < 0 ? -1 : 1;
        return a.Id - b.Id;
    }

    /// <summary>
    /// The normalisation decision for one workspace. `windows` may contain floats,
    /// fullscreen windows and dialogs; they are ignored, never minimised.
    /// </summary>
    public static NormalizeDecision NormalizePlan(
        IReadOnlyList<NormalizeWindow> windows,
        Rect area,
        double threshold = DominanceThreshold)
    {
        // One pass builds the managed set. The dominant branch below needs no further
        // copy: a single scan finds its top, and the pair branch sorts this array in
        // place (safe — the sorted order is only consumed there).
        var managed = new List<NormalizeWindow>();
        foreach (var win in windows)
        {
            if (win.Managed && !win.Floating && !win.Fullscreen) managed.Add(win);
        }
        if (managed.Count == 0) return EmptyDecision(NormalizeDecisionKind.None);
        if (managed.Count == 1)
        {
            var lone = EmptyDecision(NormalizeDecisionKind.Lone);
            return lone with { Maximize = new[] { managed[0].Id } };
        }

        var total = RectArea(area);
        // The ranking's first element, found without sorting. Ties keep the earliest
        // index, matching a stable sort.
        var top = managed[0];
        for (var i = 1; i < managed.Count; i += 1)
        {
            if (ByVisibleThenPosition(managed[i], top) < 0) top = managed[i];
        }

        // The top-ranked entry has the maximum visible surface, so dominance exists
        // exactly when it qualifies; when it does, it is the entry the old sort
        // picked. The rest are minimised in their original order.
        if (total > 0 && top.VisibleArea >= threshold * total)
        {
            var id = top.Id;
            var minimized = new List<int>();
            foreach (var win in managed)
            {
                if (win.Id != id) minimized.Add(win.Id);
            }
            var dominant = EmptyDecision(NormalizeDecisionKind.Dominant);
            return dominant with { Maximize = new[] { id }, Minimize = minimized };
        }

        // The two with the most visible surface become the pair; the leftmost takes
        // the left slot. Ties on surface fall back to position, then id, so the
        // decision is deterministic.
        var sorted = managed
            .OrderBy(win => win, Comparer<NormalizeWindow>.Create(ByVisibleThenPosition))
            .ToList();
        var first = sorted[0];
        var second = sorted[1];
        var rest = new List<int>();
        for (var i = 2; i < sorted.Count; i += 1) rest.Add(sorted[i].Id);
        var leftFirst =
            first.Rect.X < second.Rect.X || (first.Rect.X == second.Rect.X && first.Id < second.Id);
        var left = leftFirst ? first : second;
        var right = leftFirst ? second : first;
        var pair = EmptyDecision(NormalizeDecisionKind.Pair);
        return pair with
        {
            Minimize = rest,
            Slots = new[]
            {
                new NormalizeSlot { Id = left.Id, Slot = 0 },
                new NormalizeSlot { Id = right.Id, Slot = 1 },
            },
        };
    }
}
