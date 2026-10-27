// Port of src/core/invariants.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum InvariantViolationKind
{
    [JsonStringEnumMemberName("out-of-bounds")] OutOfBounds,
    [JsonStringEnumMemberName("overlap")] Overlap,
    [JsonStringEnumMemberName("non-positive")] NonPositive,
    [JsonStringEnumMemberName("below-min")] BelowMin,
    [JsonStringEnumMemberName("duplicate")] Duplicate,
}

public sealed record InvariantViolation
{
    [JsonPropertyName("kind")] public required InvariantViolationKind Kind { get; init; }
    [JsonPropertyName("surfaceId")] public int? SurfaceId { get; init; }
    [JsonPropertyName("detail")] public required string Detail { get; init; }
}

/// <summary>The monitor a plan must stay inside; `x`/`y` default to 0.</summary>
public sealed record Bounds
{
    [JsonPropertyName("x")] public double? X { get; init; }
    [JsonPropertyName("y")] public double? Y { get; init; }
    [JsonPropertyName("width")] public required double Width { get; init; }
    [JsonPropertyName("height")] public required double Height { get; init; }
}

/// <summary>
/// Post-conditions a plan must satisfy (§36): every placement is inside the
/// monitor, positive-sized, unique, non-overlapping and at or above its minimum.
/// </summary>
public static class Invariants
{
    private const double Tolerance = 1;

    private static bool Intersect(Rect a, Rect b) =>
        a.X < b.X + b.Width - Tolerance &&
        b.X < a.X + a.Width - Tolerance &&
        a.Y < b.Y + b.Height - Tolerance &&
        b.Y < a.Y + a.Height - Tolerance;

    public static IReadOnlyList<InvariantViolation> CheckPlan(
        TilePlan plan,
        Bounds bounds,
        IReadOnlyDictionary<int, Size>? mins = null)
    {
        var violations = new List<InvariantViolation>();
        var seen = new HashSet<int>();
        var originX = bounds.X ?? 0;
        var originY = bounds.Y ?? 0;
        var right = originX + bounds.Width;
        var bottom = originY + bounds.Height;

        foreach (var placement in plan.Placements)
        {
            var surfaceId = placement.SurfaceId;
            var rect = placement.Rect;
            if (seen.Contains(surfaceId))
            {
                violations.Add(new InvariantViolation
                {
                    Kind = InvariantViolationKind.Duplicate,
                    SurfaceId = surfaceId,
                    Detail = $"surface {surfaceId} placed more than once",
                });
            }
            seen.Add(surfaceId);

            if (rect.Width <= 0 || rect.Height <= 0)
            {
                violations.Add(new InvariantViolation
                {
                    Kind = InvariantViolationKind.NonPositive,
                    SurfaceId = surfaceId,
                    Detail = $"surface {surfaceId} has non-positive size",
                });
            }

            if (
                rect.X < originX - Tolerance ||
                rect.Y < originY - Tolerance ||
                rect.X + rect.Width > right + Tolerance ||
                rect.Y + rect.Height > bottom + Tolerance
            )
            {
                violations.Add(new InvariantViolation
                {
                    Kind = InvariantViolationKind.OutOfBounds,
                    SurfaceId = surfaceId,
                    Detail = $"surface {surfaceId} is outside the monitor",
                });
            }

            if (mins is not null && mins.TryGetValue(surfaceId, out var min) &&
                (rect.Width < min.Width - Tolerance || rect.Height < min.Height - Tolerance))
            {
                violations.Add(new InvariantViolation
                {
                    Kind = InvariantViolationKind.BelowMin,
                    SurfaceId = surfaceId,
                    Detail = $"surface {surfaceId} is below its minimum size",
                });
            }
        }

        for (var i = 0; i < plan.Placements.Count; i++)
        {
            for (var j = i + 1; j < plan.Placements.Count; j++)
            {
                if (Intersect(plan.Placements[i].Rect, plan.Placements[j].Rect))
                {
                    violations.Add(new InvariantViolation
                    {
                        Kind = InvariantViolationKind.Overlap,
                        SurfaceId = plan.Placements[j].SurfaceId,
                        Detail = $"surfaces {plan.Placements[i].SurfaceId} and {plan.Placements[j].SurfaceId} overlap",
                    });
                }
            }
        }

        return violations;
    }

    public static bool PlanIsValid(TilePlan plan, Bounds bounds, IReadOnlyDictionary<int, Size>? mins = null) =>
        CheckPlan(plan, bounds, mins).Count == 0;
}
