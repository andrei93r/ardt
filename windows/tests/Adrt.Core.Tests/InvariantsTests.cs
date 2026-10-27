// Port of tests/core/invariants.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class InvariantsTests
{
    private static Placement P(int id, Rect rect, int order = 0) => new()
    {
        SurfaceId = id,
        Rect = rect,
        Layer = Layer.Tiled,
        Order = order,
    };

    private static TilePlan Plan(params Placement[] placements) => new() { Placements = placements };

    private static Bounds B(double width, double height, double? x = null, double? y = null) => new()
    {
        X = x,
        Y = y,
        Width = width,
        Height = height,
    };

    [Fact]
    public void AcceptsACleanTwoWindowPlan()
    {
        var plan = Plan(P(1, H.Rect(0, 0, 960, 1080), 0), P(2, H.Rect(960, 0, 960, 1080), 1));
        Assert.Empty(Invariants.CheckPlan(plan, B(1920, 1080)));
    }

    [Fact]
    public void DetectsOverlap()
    {
        var plan = Plan(P(1, H.Rect(0, 0, 1000, 500), 0), P(2, H.Rect(500, 0, 1000, 500), 1));
        Assert.Contains(Invariants.CheckPlan(plan, B(1920, 1080)), v => v.Kind == InvariantViolationKind.Overlap);
    }

    [Fact]
    public void DetectsOutOfBoundsAndNonPositiveRects()
    {
        var plan = Plan(P(1, H.Rect(-10, 0, 0, 100)));
        var kinds = Invariants.CheckPlan(plan, B(1920, 1080)).Select(v => v.Kind).ToList();
        Assert.Contains(InvariantViolationKind.OutOfBounds, kinds);
        Assert.Contains(InvariantViolationKind.NonPositive, kinds);
    }

    [Fact]
    public void DetectsDuplicatesAndBelowMinSizes()
    {
        var plan = Plan(P(1, H.Rect(0, 0, 100, 100)), P(1, H.Rect(0, 0, 100, 100)));
        var mins = new Dictionary<int, Size> { [1] = H.Size(200, 200) };
        var violations = Invariants.CheckPlan(plan, B(1920, 1080), mins);
        Assert.Contains(violations, v => v.Kind == InvariantViolationKind.Duplicate);
        Assert.Contains(violations, v => v.Kind == InvariantViolationKind.BelowMin);
    }

    [Fact]
    public void HonoursANonZeroBoundsOrigin()
    {
        var plan = Plan(P(1, H.Rect(8, 40, 1264, 752)));
        Assert.Empty(Invariants.CheckPlan(plan, B(1280, 768, 0, 32)));
        var bad = Plan(P(1, H.Rect(8, 8, 1264, 752)));
        Assert.Contains(
            Invariants.CheckPlan(bad, B(1280, 768, 0, 32)),
            v => v.Kind == InvariantViolationKind.OutOfBounds);
    }

    [Fact]
    public void PlanIsValidMirrorsCheckPlan()
    {
        var plan = Plan(P(1, H.Rect(0, 0, 100, 100)));
        Assert.True(Invariants.PlanIsValid(plan, B(1920, 1080)));
    }
}
