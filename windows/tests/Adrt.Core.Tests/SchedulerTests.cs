// Port of tests/core/scheduler.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class SchedulerTests
{
    [Fact]
    public void SignatureCacheReportsAChangeOnlyWhenTheSignatureDiffers()
    {
        var cache = new SignatureCache();
        Assert.True(cache.Changed("ws:0", "sig-1"));
        Assert.False(cache.Changed("ws:0", "sig-1"));
        Assert.True(cache.Changed("ws:0", "sig-2"));
    }

    [Fact]
    public void SignatureCacheClearsPerKeyAndGlobally()
    {
        var cache = new SignatureCache();
        cache.Changed("a", "1");
        cache.Changed("b", "2");
        cache.Clear("a");
        Assert.Null(cache.Peek("a"));
        Assert.Equal(1, cache.Size);
        cache.ClearAll();
        Assert.Equal(0, cache.Size);
    }

    private static Placement Placement(int id, Rect rect) => new()
    {
        SurfaceId = id,
        Rect = rect,
        Layer = Layer.Tiled,
        Order = 0,
    };

    [Fact]
    public void PlanSignatureIsStableForEqualGeometryAndChangesWhenMoved()
    {
        var a = Scheduler.PlanSignature(new[] { Placement(1, H.Rect(0, 0, 10, 10)) });
        var b = Scheduler.PlanSignature(new[] { Placement(1, H.Rect(0, 0, 10, 10)) });
        var c = Scheduler.PlanSignature(new[] { Placement(1, H.Rect(1, 0, 10, 10)) });
        Assert.Equal(b, a);
        Assert.NotEqual(c, a);
    }

    [Fact]
    public void ShouldApplyPlanDoesNothingWhenThePlanIsUnchangedAndWindowsAreInPlace()
    {
        Assert.False(Scheduler.ShouldApplyPlan(mismatch: false, changed: false, alreadyTargeted: true));
        Assert.False(Scheduler.ShouldApplyPlan(mismatch: false, changed: false, alreadyTargeted: false));
    }

    [Fact]
    public void ShouldApplyPlanDoesNotReApplyAPlanTheWindowsAlreadyAimAt()
    {
        Assert.False(Scheduler.ShouldApplyPlan(mismatch: false, changed: true, alreadyTargeted: true));
    }

    [Fact]
    public void ShouldApplyPlanAppliesAGenuinelyChangedPlan()
    {
        Assert.True(Scheduler.ShouldApplyPlan(mismatch: false, changed: true, alreadyTargeted: false));
    }

    [Fact]
    public void ShouldApplyPlanAppliesOnARealDriftEvenWhenThePlanIsUnchanged()
    {
        Assert.True(Scheduler.ShouldApplyPlan(mismatch: true, changed: false, alreadyTargeted: true));
        Assert.True(Scheduler.ShouldApplyPlan(mismatch: true, changed: true, alreadyTargeted: true));
    }
}
