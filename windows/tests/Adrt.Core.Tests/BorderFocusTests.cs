// Port of tests/core/border.test.ts and focus.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class BorderTests
{
    [Fact]
    public void ShowsAtTheFocusedWindowRectOnceThePlacementIsSettled()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(10, 10, 100, 100));
        border.Settle();
        Assert.True(border.ShouldShow);
        Assert.Equal(H.Rect(10, 10, 100, 100), border.Rect);
    }

    [Fact]
    public void StaysHiddenWithoutFocus()
    {
        var border = new BorderState();
        Assert.False(border.ShouldShow);
        Assert.Null(border.Rect);
    }

    [Fact]
    public void HidesWhileAnySuppressionIsActiveAndReappearsWhenCleared()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(0, 0, 10, 10));
        border.Settle();
        border.Suppress(SuppressionReason.WorkspaceSwitch);
        Assert.False(border.ShouldShow);
        border.Suppress(SuppressionReason.Drag);
        Assert.Equal(2, border.ActiveSuppressions.Count);
        border.Unsuppress(SuppressionReason.WorkspaceSwitch);
        Assert.False(border.ShouldShow);
        border.Unsuppress(SuppressionReason.Drag);
        Assert.True(border.ShouldShow);
    }

    [Fact]
    public void FollowsTheFocusedWindowRectUpdates()
    {
        var border = new BorderState();
        border.SetFocus(7, H.Rect(0, 0, 10, 10));
        border.Settle();
        border.UpdateRect(H.Rect(50, 50, 20, 20));
        Assert.Equal(H.Rect(50, 50, 20, 20), border.Rect);
    }

    [Fact]
    public void IgnoresRectUpdatesWithoutFocus()
    {
        var border = new BorderState();
        border.UpdateRect(H.Rect(50, 50, 20, 20));
        Assert.Null(border.Rect);
    }

    [Fact]
    public void HidesOnClearFocusAndReportsFocusId()
    {
        var border = new BorderState();
        border.SetFocus(3, H.Rect(0, 0, 10, 10));
        border.Settle();
        Assert.Equal(3, border.FocusedId);
        border.ClearFocus();
        Assert.False(border.ShouldShow);
        Assert.Null(border.FocusedId);
    }

    [Fact]
    public void ReportsASnapshot()
    {
        var border = new BorderState();
        Assert.Equal(new BorderSnapshot { Visible = false, Rect = null }, border.Snapshot());
        border.SetFocus(1, H.Rect(1, 2, 3, 4));
        border.Settle();
        Assert.Equal(new BorderSnapshot { Visible = true, Rect = H.Rect(1, 2, 3, 4) }, border.Snapshot());
    }

    [Fact]
    public void DoesNotTreatDuplicateSuppressionsAsTwo()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(0, 0, 1, 1));
        border.Settle();
        border.Suppress(SuppressionReason.Pause);
        border.Suppress(SuppressionReason.Pause);
        border.Unsuppress(SuppressionReason.Pause);
        Assert.True(border.ShouldShow);
    }

    [Fact]
    public void DoesNotDrawAFreshFocusUntilThePlacementIsSettled()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(10, 10, 100, 100));
        Assert.False(border.ShouldShow);
        Assert.Null(border.Rect);
        Assert.False(border.IsSettled);
        Assert.Equal(1, border.FocusedId);

        border.Settle();
        Assert.True(border.IsSettled);
        Assert.True(border.ShouldShow);
        Assert.Equal(H.Rect(10, 10, 100, 100), border.Rect);
    }

    [Fact]
    public void ReHidesOnANewFocusEvenIfThePreviousOneWasSettled()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(0, 0, 10, 10));
        border.Settle();
        Assert.True(border.ShouldShow);
        border.SetFocus(2, H.Rect(20, 20, 10, 10));
        Assert.False(border.ShouldShow);
        Assert.False(border.IsSettled);
    }

    [Fact]
    public void ARepeatedStatePassForTheSameWindowDoesNotUnsettleIt()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(10, 10, 100, 100));
        border.Settle();
        Assert.True(border.ShouldShow);
        border.SetFocusFromState(1, H.Rect(10, 10, 100, 100));
        Assert.True(border.IsSettled);
        Assert.True(border.ShouldShow);
    }

    [Fact]
    public void AStatePassSettlesWhenNoFocusSignalIsOwed()
    {
        var border = new BorderState();
        border.SetFocusFromState(1, H.Rect(10, 10, 100, 100));
        Assert.True(border.IsSettled);
        Assert.True(border.ShouldShow);
    }

    [Fact]
    public void AStatePassDoesNotSettleWhileAFocusSignalIsStillOwed()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(10, 10, 100, 100));
        border.SetFocusFromState(1, H.Rect(10, 10, 100, 100));
        Assert.False(border.IsSettled);
        Assert.False(border.ShouldShow);
    }

    [Fact]
    public void AStatePassDoesNotSettleOnAnIntermediateFrameWhileAPlacementIsOwed()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(10, 10, 100, 100));
        border.SetFocusFromState(1, H.Rect(40, 40, 100, 100));
        Assert.False(border.IsSettled);
        Assert.False(border.ShouldShow);
        border.Settle();
        Assert.True(border.IsSettled);
        Assert.Equal(H.Rect(40, 40, 100, 100), border.Rect);
    }

    [Fact]
    public void UpdateRectAloneDoesNotSettleOnlyTheModelMay()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(0, 0, 10, 10));
        border.UpdateRect(H.Rect(5, 5, 10, 10));
        Assert.False(border.ShouldShow);
        border.Settle();
        Assert.Equal(H.Rect(5, 5, 10, 10), border.Rect);
    }

    [Fact]
    public void ClearFocusDropsTheSettledFlag()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(0, 0, 10, 10));
        border.Settle();
        Assert.True(border.IsSettled);
        border.ClearFocus();
        Assert.False(border.IsSettled);
    }

    [Fact]
    public void SuppressionStillWinsOverASettledBorder()
    {
        var border = new BorderState();
        border.Suppress(SuppressionReason.WorkspaceSwitch);
        border.SetFocus(1, H.Rect(0, 0, 10, 10));
        border.Settle();
        Assert.False(border.ShouldShow);
        border.Unsuppress(SuppressionReason.WorkspaceSwitch);
        Assert.True(border.ShouldShow);
    }

    [Fact]
    public void SettleIfMovedRefusesToSettleWhileTheFrameIsStillThePrePlacementOne()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(10, 10, 100, 100));
        border.SettleIfMoved(H.Rect(10, 10, 100, 100));
        Assert.False(border.IsSettled);
        Assert.False(border.ShouldShow);
    }

    [Fact]
    public void SettleIfMovedSettlesOnceTheWindowHasActuallyMoved()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(10, 10, 100, 100));
        border.SettleIfMoved(H.Rect(40, 40, 100, 100));
        Assert.True(border.IsSettled);
        Assert.Equal(H.Rect(40, 40, 100, 100), border.Rect);
    }

    [Fact]
    public void SettleIfMovedTreatsABareResizeAsMovementToo()
    {
        var border = new BorderState();
        border.SetFocus(1, H.Rect(10, 10, 100, 100));
        border.SettleIfMoved(H.Rect(10, 10, 120, 100));
        Assert.True(border.IsSettled);
        Assert.Equal(H.Rect(10, 10, 120, 100), border.Rect);
    }

    [Fact]
    public void SettleIfMovedIsANoOpWithoutFocus()
    {
        var border = new BorderState();
        border.SettleIfMoved(H.Rect(0, 0, 10, 10));
        Assert.False(border.IsSettled);
        Assert.False(border.ShouldShow);
    }
}

public class FocusTests
{
    private static readonly Rect Left = H.Rect(0, 0, 960, 1080);
    private static readonly Rect Right = H.Rect(960, 0, 960, 1080);
    private static readonly Rect Top = H.Rect(0, 0, 1920, 540);
    private static readonly Rect Bottom = H.Rect(0, 540, 1920, 540);
    private static readonly Rect OtherMonitor = H.Rect(1920, 0, 960, 1080);

    private static FocusCandidate Cand(int id, Rect rect) => new() { Id = id, Rect = rect };

    private static readonly FocusCandidate LeftCand = Cand(1, Left);
    private static readonly FocusCandidate RightCand = Cand(2, Right);
    private static readonly FocusCandidate TopCand = Cand(3, Top);
    private static readonly FocusCandidate BottomCand = Cand(4, Bottom);
    private static readonly FocusCandidate FarCand = Cand(5, OtherMonitor);

    [Fact]
    public void PickDirectionalFollowsASideBySidePair()
    {
        Assert.Equal(2, Focus.PickDirectional(Left, new[] { RightCand, FarCand }, FocusDirection.Right));
        Assert.Equal(1, Focus.PickDirectional(Right, new[] { LeftCand, FarCand }, FocusDirection.Left));
        Assert.Null(Focus.PickDirectional(Left, new[] { RightCand }, FocusDirection.Up));
        Assert.Null(Focus.PickDirectional(Left, new[] { RightCand }, FocusDirection.Down));
    }

    [Fact]
    public void PickDirectionalFollowsAStackedPair()
    {
        Assert.Equal(4, Focus.PickDirectional(Top, new[] { BottomCand }, FocusDirection.Down));
        Assert.Equal(3, Focus.PickDirectional(Bottom, new[] { TopCand }, FocusDirection.Up));
        Assert.Null(Focus.PickDirectional(Top, new[] { BottomCand }, FocusDirection.Left));
    }

    [Fact]
    public void PickDirectionalReachesAWindowOnAnotherMonitor()
    {
        Assert.Equal(5, Focus.PickDirectional(Right, new[] { FarCand }, FocusDirection.Right));
        Assert.Equal(2, Focus.PickDirectional(FarCand.Rect, new[] { RightCand }, FocusDirection.Left));
    }

    [Fact]
    public void PickDirectionalPrefersTheCandidateThatOverlapsOnThePerpendicularAxis()
    {
        var current = H.Rect(0, 0, 960, 540);
        var aligned = Cand(10, H.Rect(960, 0, 960, 540));
        var offset = Cand(11, H.Rect(960, 900, 960, 180));
        Assert.Equal(10, Focus.PickDirectional(current, new[] { offset, aligned }, FocusDirection.Right));
    }

    [Fact]
    public void PickDirectionalFallsBackToADiagonalCandidateWhenNothingOverlaps()
    {
        var diagonal = Cand(12, H.Rect(1200, 1200, 400, 300));
        Assert.Equal(12, Focus.PickDirectional(Left, new[] { diagonal }, FocusDirection.Right));
    }

    [Fact]
    public void PickDirectionalIgnoresCandidatesBehindTheCurrentWindow()
    {
        Assert.Null(Focus.PickDirectional(Right, new[] { LeftCand }, FocusDirection.Right));
    }

    [Fact]
    public void PickDirectionalBreaksAnEqualDistanceTieByCandidateOrder()
    {
        var current = H.Rect(0, 0, 100, 100);
        var first = Cand(21, H.Rect(150, 0, 100, 100));
        var second = Cand(22, H.Rect(150, 0, 100, 100));
        Assert.Equal(21, Focus.PickDirectional(current, new[] { first, second }, FocusDirection.Right));
        Assert.Equal(22, Focus.PickDirectional(current, new[] { second, first }, FocusDirection.Right));
    }

    private static CycleEntry Managed(int id, int slot) => new()
    {
        Id = id,
        Kind = CycleEntryKind.Managed,
        Slot = slot,
    };

    private static CycleEntry Float(int id, double x, double y, int z = 0, bool minimized = false) => new()
    {
        Id = id,
        Kind = CycleEntryKind.Float,
        Rect = H.Rect(x, y, 200, 150),
        Z = z,
        Minimized = minimized,
    };

    [Fact]
    public void CycleOrderWalksManagedWindowsInSlotOrderThenFloatsLeftToRight()
    {
        var entries = new[] { Managed(5, 1), Float(9, 100, 0), Managed(4, 0), Float(8, 10, 0) };
        Assert.Equal(4, Focus.CycleOrder(null, entries));
        Assert.Equal(5, Focus.CycleOrder(4, entries));
        Assert.Equal(8, Focus.CycleOrder(5, entries));
        Assert.Equal(9, Focus.CycleOrder(8, entries));
    }

    [Fact]
    public void CycleOrderWrapsAroundAndSkipsMinimizedWindows()
    {
        var entries = new[]
        {
            Managed(1, 0),
            Managed(2, 1) with { Minimized = true },
            Float(3, 0, 0),
        };
        Assert.Equal(3, Focus.CycleOrder(1, entries));
        Assert.Equal(1, Focus.CycleOrder(3, entries));
    }

    [Fact]
    public void CycleSequenceBreaksAPerfectOverlapByStackingOrderWhenALapStarts()
    {
        Assert.Equal(new[] { 2, 1 }, Focus.CycleSequence(new[] { Float(1, 0, 0, 5), Float(2, 0, 0, 1) }));
        Assert.Equal(new[] { 1, 2 }, Focus.CycleSequence(new[] { Float(1, 0, 0, 3), Float(2, 0, 0, 3) }));
    }

    [Fact]
    public void CycleOrderKeepsALapFixedWhenFocusingAFloatRaisesIt()
    {
        var start = new[] { Managed(4, 0), Float(1, 0, 0, 5), Float(2, 0, 0, 1) };
        var order = Focus.CycleSequence(start);
        Assert.Equal(new[] { 4, 2, 1 }, order);
        Assert.Equal(2, Focus.CycleOrder(4, start, order));
        var raised = new[] { Managed(4, 0), Float(1, 0, 0, 5), Float(2, 0, 0, 9) };
        Assert.Equal(1, Focus.CycleOrder(2, raised, order));
        Assert.Equal(4, Focus.CycleOrder(1, raised, order));
    }

    [Fact]
    public void CycleOrderDoesNotChangeTheRestOfTheLapWhenFocusRaisesAFloat()
    {
        var before = new[] { Float(1, 0, 0, 1), Float(2, 0, 0, 5), Float(3, 300, 0, 2) };
        var order = Focus.CycleSequence(before);
        Assert.Equal(new[] { 1, 2, 3 }, order);
        Assert.Equal(2, Focus.CycleOrder(1, before, order));
        var after = new[] { Float(1, 0, 0, 9), Float(2, 0, 0, 5), Float(3, 300, 0, 2) };
        Assert.Equal(new[] { 2, 1, 3 }, Focus.CycleSequence(after));
        Assert.Equal(2, Focus.CycleOrder(1, after, order));
        Assert.Equal(3, Focus.CycleOrder(2, after, order));
    }

    [Fact]
    public void CycleOrderKeepsManagedWindowsFirstInSlotOrderRegardlessOfFloatStacking()
    {
        var entries = new[] { Float(1, 0, 0, 9), Managed(2, 1), Managed(3, 0) };
        Assert.Equal(3, Focus.CycleOrder(null, entries));
        Assert.Equal(2, Focus.CycleOrder(3, entries));
        Assert.Equal(1, Focus.CycleOrder(2, entries));
    }

    [Fact]
    public void CycleOrderSkipsAMinimizedFloat()
    {
        var entries = new[] { Managed(1, 0), Float(2, 0, 0, 1, minimized: true), Float(3, 0, 0, 5) };
        Assert.Equal(3, Focus.CycleOrder(1, entries));
        Assert.Equal(1, Focus.CycleOrder(3, entries));
    }

    [Fact]
    public void CycleOrderReturnsNullWhenThereIsNothingToCycle()
    {
        Assert.Null(Focus.CycleOrder(null, Array.Empty<CycleEntry>()));
        Assert.Null(Focus.CycleOrder(1, new[] { Managed(1, 0) with { Minimized = true } }));
    }

    [Fact]
    public void CycleOrderStartsAtTheFirstEntryWhenTheCurrentWindowIsNotInTheCycle()
    {
        Assert.Equal(1, Focus.CycleOrder(99, new[] { Managed(1, 0), Managed(2, 1) }));
    }

    [Fact]
    public void CycleSequenceTreatsAPositionDifferenceWithinOnePxAsATieThenUsesTheId()
    {
        Assert.Equal(new[] { 1, 2 }, Focus.CycleSequence(new[] { Float(2, 0.5, 0, 0), Float(1, 0, 0, 0) }));
    }

    [Fact]
    public void CycleSequenceOrdersFloatsByPositionOnceTheGapExceedsTheOnePxTolerance()
    {
        Assert.Equal(new[] { 2, 1 }, Focus.CycleSequence(new[] { Float(1, 5, 0, 3), Float(2, 0, 0, 9) }));
    }
}
