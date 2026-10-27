// Port of tests/core/normalize.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class NormalizeTests
{
    private static readonly Rect Area = H.Rect(0, 0, 1000, 800); // 800 000 px²

    private static NormalizeWindow Win(
        int id, double x, double y, double w, double h,
        double? visibleArea = null, bool managed = true, bool fullscreen = false, bool floating = false) => new()
        {
            Id = id,
            Rect = H.Rect(x, y, w, h),
            VisibleArea = visibleArea ?? w * h,
            Managed = managed,
            Fullscreen = fullscreen,
            Floating = floating,
        };

    private static void AssertDecisionEqual(NormalizeDecision expected, NormalizeDecision actual)
    {
        Assert.Equal(expected.Kind, actual.Kind);
        Assert.Equal(expected.Maximize, actual.Maximize);
        Assert.Equal(expected.Minimize, actual.Minimize);
        Assert.Equal(
            expected.Slots.Select(slot => (slot.Id, slot.Slot)),
            actual.Slots.Select(slot => (slot.Id, slot.Slot)));
    }

    [Fact]
    public void DoesNothingWithNoManagedWindows()
    {
        var decision = Normalize.NormalizePlan(Array.Empty<NormalizeWindow>(), Area);
        Assert.Equal(NormalizeDecisionKind.None, decision.Kind);
        Assert.Empty(decision.Maximize);
        Assert.Empty(decision.Minimize);
        Assert.Empty(decision.Slots);
    }

    [Fact]
    public void MaximizesALoneManagedWindow()
    {
        var decision = Normalize.NormalizePlan(new[] { Win(1, 0, 0, 400, 300) }, Area);
        Assert.Equal(NormalizeDecisionKind.Lone, decision.Kind);
        Assert.Equal(new[] { 1 }, decision.Maximize);
        Assert.Empty(decision.Minimize);
    }

    [Fact]
    public void MaximizesADominantWindowAndMinimizesTheRest()
    {
        var big = Win(1, 0, 0, 900, 700); // 630 000 = 78.75%
        var small = Win(2, 900, 0, 200, 200);
        var decision = Normalize.NormalizePlan(new[] { big, small }, Area);
        Assert.Equal(NormalizeDecisionKind.Dominant, decision.Kind);
        Assert.Equal(new[] { 1 }, decision.Maximize);
        Assert.Equal(new[] { 2 }, decision.Minimize);
    }

    [Fact]
    public void TreatsExactlyTheThresholdAsDominating()
    {
        var covering = Win(1, 0, 0, 1000, 800 * Normalize.DominanceThreshold); // exactly 70%
        var other = Win(2, 0, 0, 100, 100);
        Assert.Equal(NormalizeDecisionKind.Dominant, Normalize.NormalizePlan(new[] { covering, other }, Area).Kind);
    }

    [Fact]
    public void PairsTheTopTwoByVisibleSurfaceAndMinimizesTheRest()
    {
        var a = Win(1, 0, 0, 400, 300); // 120 000
        var b = Win(2, 450, 0, 300, 300); // 90 000
        var c = Win(3, 0, 400, 100, 100); // 10 000
        var decision = Normalize.NormalizePlan(new[] { a, b, c }, Area);
        Assert.Equal(NormalizeDecisionKind.Pair, decision.Kind);
        Assert.Equal(new[] { (1, 0), (2, 1) }, decision.Slots.Select(slot => (slot.Id, slot.Slot)));
        Assert.Equal(new[] { 3 }, decision.Minimize);
    }

    [Fact]
    public void PutsTheLeftmostOfTheTwoMostVisibleWindowsInTheLeftSlot()
    {
        var right = Win(1, 600, 0, 400, 400); // more visible, but right
        var left = Win(2, 0, 0, 300, 300);
        var decision = Normalize.NormalizePlan(new[] { right, left }, Area);
        Assert.Equal(new[] { (2, 0), (1, 1) }, decision.Slots.Select(slot => (slot.Id, slot.Slot)));
    }

    [Fact]
    public void IgnoresFloatsAndNeverMinimizesThem()
    {
        var floating = Win(1, 0, 0, 400, 300, managed: false, floating: true);
        var a = Win(2, 0, 0, 400, 300);
        var b = Win(3, 500, 0, 400, 300);
        var decision = Normalize.NormalizePlan(new[] { floating, a, b }, Area);
        Assert.Equal(NormalizeDecisionKind.Pair, decision.Kind);
        Assert.Empty(decision.Minimize);
        Assert.Empty(decision.Maximize);
        Assert.Equal(new[] { 2, 3 }, decision.Slots.Select(slot => slot.Id));
    }

    [Fact]
    public void LeavesAFullscreenWindowUntouchedAndNormalisesTheRest()
    {
        var fullscreen = Win(1, 0, 0, 1000, 800, managed: false, fullscreen: true);
        var only = Win(2, 0, 0, 400, 300);
        var decision = Normalize.NormalizePlan(new[] { fullscreen, only }, Area);
        Assert.Equal(NormalizeDecisionKind.Lone, decision.Kind);
        Assert.Equal(new[] { 2 }, decision.Maximize);
        Assert.Empty(decision.Minimize);
    }

    [Fact]
    public void IgnoresAFloatWhenChoosingTheDominantWindow()
    {
        var floatingBig = Win(1, 0, 0, 1000, 800, managed: false, floating: true);
        var small = Win(2, 0, 0, 100, 100);
        var decision = Normalize.NormalizePlan(new[] { floatingBig, small }, Area);
        Assert.Equal(NormalizeDecisionKind.Lone, decision.Kind);
        Assert.Equal(new[] { 2 }, decision.Maximize);
    }

    [Fact]
    public void UsesAVariableThresholdForTheTestsToVary()
    {
        var half = Win(1, 0, 0, 1000, 400); // 50%
        var other = Win(2, 0, 500, 100, 100);
        Assert.Equal(NormalizeDecisionKind.Pair, Normalize.NormalizePlan(new[] { half, other }, Area).Kind);
        Assert.Equal(NormalizeDecisionKind.Dominant, Normalize.NormalizePlan(new[] { half, other }, Area, 0.4).Kind);
    }

    [Fact]
    public void RectAreaIsNeverNegative()
    {
        Assert.Equal(0, Normalize.RectArea(H.Rect(0, 0, -5, 5)));
    }

    // ---- The rewritten scan must match the original filter/sort implementation ----

    private static NormalizeDecision ReferenceNormalize(
        IReadOnlyList<NormalizeWindow> windows, Rect area, double threshold = Normalize.DominanceThreshold)
    {
        var managed = windows.Where(win => win.Managed && !win.Floating && !win.Fullscreen).ToList();
        if (managed.Count == 0)
        {
            return new NormalizeDecision
            {
                Kind = NormalizeDecisionKind.None,
                Maximize = Array.Empty<int>(),
                Minimize = Array.Empty<int>(),
                Slots = Array.Empty<NormalizeSlot>(),
            };
        }
        if (managed.Count == 1)
        {
            return new NormalizeDecision
            {
                Kind = NormalizeDecisionKind.Lone,
                Maximize = new[] { managed[0].Id },
                Minimize = Array.Empty<int>(),
                Slots = Array.Empty<NormalizeSlot>(),
            };
        }

        int Rank(NormalizeWindow a, NormalizeWindow b)
        {
            if (a.VisibleArea != b.VisibleArea) return b.VisibleArea.CompareTo(a.VisibleArea);
            if (a.Rect.X != b.Rect.X) return a.Rect.X.CompareTo(b.Rect.X);
            return a.Id.CompareTo(b.Id);
        }

        var total = Normalize.RectArea(area);
        var dominant = total > 0 ? managed.Where(win => win.VisibleArea >= threshold * total).ToList() : new List<NormalizeWindow>();
        if (dominant.Count > 0)
        {
            var top = dominant.OrderBy(win => win, Comparer<NormalizeWindow>.Create(Rank)).First();
            return new NormalizeDecision
            {
                Kind = NormalizeDecisionKind.Dominant,
                Maximize = new[] { top.Id },
                Minimize = managed.Where(win => win.Id != top.Id).Select(win => win.Id).ToList(),
                Slots = Array.Empty<NormalizeSlot>(),
            };
        }

        var ranked = managed.OrderBy(win => win, Comparer<NormalizeWindow>.Create(Rank)).ToList();
        var pair = ranked.Take(2).ToList();
        var rest = ranked.Skip(2).Select(win => win.Id).ToList();
        var leftmost = pair
            .OrderBy(win => win.Rect.X)
            .ThenBy(win => win.Id)
            .ToList();
        return new NormalizeDecision
        {
            Kind = NormalizeDecisionKind.Pair,
            Maximize = Array.Empty<int>(),
            Minimize = rest,
            Slots = new[]
            {
                new NormalizeSlot { Id = leftmost[0].Id, Slot = 0 },
                new NormalizeSlot { Id = leftmost[1].Id, Slot = 1 },
            },
        };
    }

    private static Func<double> Lcg(uint seed)
    {
        var state = seed;
        return () =>
        {
            state = unchecked(state * 1664525u + 1013904223u);
            return state / 4294967296.0;
        };
    }

    [Fact]
    public void BreaksADominantTieByLeftmostPositionThenId()
    {
        var total = Normalize.RectArea(Area);
        NormalizeWindow Covering(int id, double x)
        {
            var win = Win(id, x, 0, 200, 200);
            return win with { VisibleArea = total };
        }

        Assert.Equal(new[] { 6 }, Normalize.NormalizePlan(new[] { Covering(5, 500), Covering(6, 100) }, Area).Maximize);
        Assert.Equal(new[] { 3 }, Normalize.NormalizePlan(new[] { Covering(9, 100), Covering(3, 100) }, Area).Maximize);
    }

    [Fact]
    public void BreaksAPairTieOnSurfaceByPositionThenId()
    {
        var a = Win(1, 100, 0, 200, 200);
        var b = Win(2, 50, 0, 200, 200);
        var c = Win(3, 400, 0, 100, 100);
        var decision = Normalize.NormalizePlan(new[] { a, b, c }, Area);
        Assert.Equal(new[] { (2, 0), (1, 1) }, decision.Slots.Select(slot => (slot.Id, slot.Slot)));
        Assert.Equal(new[] { 3 }, decision.Minimize);
    }

    [Fact]
    public void BreaksAPairTieOnPositionByTheStableId()
    {
        var a = Win(7, 0, 0, 200, 200);
        var b = Win(2, 0, 0, 200, 200);
        var c = Win(9, 400, 0, 100, 100);
        Assert.Equal(
            new[] { (2, 0), (7, 1) },
            Normalize.NormalizePlan(new[] { a, b, c }, Area).Slots.Select(slot => (slot.Id, slot.Slot)));
    }

    [Fact]
    public void MatchesTheOriginalFilterSortImplementationOn1000RandomInputs()
    {
        var rand = Lcg(0x1234abcd);
        int Pick(int n) => (int)Math.Floor(rand() * n);
        for (var iter = 0; iter < 1000; iter += 1)
        {
            var count = Pick(6);
            var windows = new List<NormalizeWindow>();
            for (var i = 0; i < count; i += 1)
            {
                windows.Add(new NormalizeWindow
                {
                    Id = Pick(5), // duplicate ids on purpose
                    Rect = H.Rect(Pick(4) * 250, 0, 1 + Pick(4) * 250, 1 + Pick(4) * 200),
                    VisibleArea = Pick(6) * 100000, // coarse buckets force ties
                    Managed = rand() > 0.25,
                    Fullscreen = rand() > 0.8,
                    Floating = rand() > 0.8,
                });
            }
            var threshold = rand() > 0.5 ? Normalize.DominanceThreshold : 0.4;
            AssertDecisionEqual(ReferenceNormalize(windows, Area, threshold), Normalize.NormalizePlan(windows, Area, threshold));
        }
    }
}
