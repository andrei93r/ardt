// Port of tests/core/placement.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class PlacementTests
{
    private static Win Win(int id) => new() { Id = id };

    private static Ws Ws(int id, Win?[]? slots = null, Win[]? minimized = null) => new()
    {
        Id = id,
        Slots = slots ?? new Win?[] { null, null },
        Minimized = minimized ?? Array.Empty<Win>(),
    };

    private static State State(Ws[] workspaces, int viewed = 0) => new()
    {
        Workspaces = workspaces,
        Viewed = viewed,
    };

    private static Env Env(ScreenClass screen = ScreenClass.Dynamic, Axis axis = Axis.Horizontal) => new()
    {
        Screen = screen,
        Axis = axis,
    };

    [Fact]
    public void FreeSlotReportsZeroWhenOnlyTheSecondSlotIsTaken()
    {
        Assert.Equal(0, PlacementPolicy.FreeSlot(Ws(0, new Win?[] { null, Win(2) })));
    }

    [Fact]
    public void FreeSlotReportsOneWhenTheFirstSlotIsTaken()
    {
        Assert.Equal(1, PlacementPolicy.FreeSlot(Ws(0, new Win?[] { Win(1), null })));
    }

    [Fact]
    public void FreeSlotReportsNullWhenBothSlotsAreTaken()
    {
        Assert.Null(PlacementPolicy.FreeSlot(Ws(0, new Win?[] { Win(1), Win(2) })));
    }

    [Fact]
    public void FreeSlotIgnoresMinimizedWindows()
    {
        Assert.Equal(1, PlacementPolicy.FreeSlot(Ws(0, new Win?[] { Win(1), null }, new[] { Win(9) })));
    }

    [Fact]
    public void SideSlotFromTheLeftTakesSlotZero()
    {
        Assert.Equal(0, PlacementPolicy.SideSlot(Direction.Left));
    }

    [Fact]
    public void SideSlotFromTheRightTakesSlotOne()
    {
        Assert.Equal(1, PlacementPolicy.SideSlot(Direction.Right));
    }

    [Fact]
    public void SideSlotFromAboveTakesSlotZero()
    {
        Assert.Equal(0, PlacementPolicy.SideSlot(Direction.Above));
    }

    [Fact]
    public void SideSlotFromBelowTakesSlotOne()
    {
        Assert.Equal(1, PlacementPolicy.SideSlot(Direction.Below));
    }

    [Fact]
    public void SideSlotWithNoDirectionMeansSlotOne()
    {
        Assert.Equal(1, PlacementPolicy.SideSlot(null));
    }

    [Fact]
    public void RouteNewWindowSplitsAMaximizedSingle()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), null }), Ws(1) });
        var decision = PlacementPolicy.RouteNewWindow(state, Env(), Win(2));
        Assert.Equal(0, decision.Workspace);
        Assert.Equal(1, decision.Slot);
    }

    [Fact]
    public void RouteNewWindowTakesTheFreeSlotWhenTheWorkspaceHoldsOneWindow()
    {
        var state = State(new[] { Ws(0, new Win?[] { null, Win(1) }), Ws(1) });
        var decision = PlacementPolicy.RouteNewWindow(state, Env(), Win(2));
        Assert.Equal(0, decision.Workspace);
        Assert.Equal(0, decision.Slot);
    }

    [Fact]
    public void RouteNewWindowLandsAloneOnAnEmptyViewedWorkspaceMaximized()
    {
        var state = State(new[] { Ws(0), Ws(1) });
        var decision = PlacementPolicy.RouteNewWindow(state, Env(), Win(2));
        Assert.Equal(0, decision.Workspace);
        Assert.Equal(1, decision.Slot);
        Assert.True(decision.Maximize);
    }

    [Fact]
    public void RouteNewWindowMaximizesANewcomerOnAWorkspaceThatOnlyLooksEmpty()
    {
        var state = State(new[] { Ws(0, null, new[] { Win(9) }), Ws(1) });
        var decision = PlacementPolicy.RouteNewWindow(state, Env(), Win(2));
        Assert.Equal(0, decision.Workspace);
        Assert.True(decision.Maximize);
    }

    [Fact]
    public void RouteNewWindowCreatesAWorkspaceImmediatelyRightWhenTheViewedOneIsFull()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }), Ws(1) });
        var decision = PlacementPolicy.RouteNewWindow(state, Env(), Win(3));
        Assert.Equal(0, decision.Workspace);
        Assert.Equal(1, decision.Slot);
        Assert.True(decision.CreateRight);
        Assert.True(decision.Maximize);
    }

    [Fact]
    public void RouteNewWindowNeverScansNeighbours()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }), Ws(1, new Win?[] { Win(9), null }) });
        var decision = PlacementPolicy.RouteNewWindow(state, Env(), Win(3));
        Assert.True(decision.CreateRight);
        Assert.True(decision.Maximize);
    }

    [Fact]
    public void RouteNewWindowRoutesOnTheWindowOwnWorkspaceWhenItOpensOffView()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }), Ws(1) }, viewed: 1);
        var decision = PlacementPolicy.RouteNewWindow(state, Env(), Win(3), null, 0);
        Assert.Equal(0, decision.Workspace);
        Assert.True(decision.CreateRight);
        Assert.True(decision.Maximize);
    }

    [Fact]
    public void RouteNewWindowOverflowsToAFloatOnASingleWorkspaceScreen()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }) });
        var decision = PlacementPolicy.RouteNewWindow(state, Env(ScreenClass.Single), Win(3));
        Assert.Equal(0, decision.Workspace);
        Assert.True(decision.Float);
    }

    [Fact]
    public void RouteNewWindowFillsAnExistingWorkspaceOnAFixedScreenRightFirst()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }), Ws(1, new Win?[] { Win(9), null }), Ws(2) });
        var decision = PlacementPolicy.RouteNewWindow(state, Env(ScreenClass.Fixed), Win(3));
        Assert.Equal(1, decision.Workspace);
        Assert.Equal(1, decision.Slot);
    }

    [Fact]
    public void RouteNewWindowFloatsOnAFixedScreenWhenEveryWorkspaceIsFull()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }), Ws(1, new Win?[] { Win(9), Win(10) }) });
        var decision = PlacementPolicy.RouteNewWindow(state, Env(ScreenClass.Fixed), Win(3));
        Assert.True(decision.Float);
    }

    [Fact]
    public void RouteNewWindowGivesAWindowThatCannotFitAShareItsOwnWorkspace()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), null }), Ws(1) });
        var decision = PlacementPolicy.RouteNewWindow(state, Env(), Win(2), null, null, doesNotFit: true);
        Assert.Equal(0, decision.Workspace);
        Assert.Equal(0, decision.Slot);
        Assert.True(decision.CreateRight);
    }

    [Fact]
    public void RouteNewWindowLetsTheTriggerKeepASingleWorkspaceScreenAndMinimizesTheRest()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }) });
        var decision = PlacementPolicy.RouteNewWindow(state, Env(ScreenClass.Single), Win(3), null, null, doesNotFit: true);
        Assert.Equal(0, decision.Workspace);
        Assert.True(decision.InPlace);
        Assert.True(decision.Maximize);
        Assert.Equal(new[] { 1, 2 }, decision.Minimize);
    }

    [Fact]
    public void UnmaximizeJoinsTheLeftWorkspaceWhenItHoldsExactlyOneWindowIntoSlotOne()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), null }), Ws(1, new Win?[] { Win(2), null }) });
        var decision = PlacementPolicy.UnmaximizeWindow(state, Env(), 1, 2);
        Assert.Equal(0, decision.Workspace);
        Assert.Equal(1, decision.Slot);
    }

    [Fact]
    public void UnmaximizeJoinsTheRightOneWhenTheLeftCannotPair()
    {
        var state = State(new[]
        {
            Ws(0, new Win?[] { Win(1), Win(3) }),
            Ws(1, new Win?[] { Win(2), null }),
            Ws(2, new Win?[] { Win(4), null }),
        });
        var decision = PlacementPolicy.UnmaximizeWindow(state, Env(), 1, 2);
        Assert.Equal(2, decision.Workspace);
        Assert.Equal(1, decision.Slot);
    }

    [Fact]
    public void UnmaximizeParksMinimizedInTheLeftWhenNeitherNeighbourCanPair()
    {
        var state = State(new[]
        {
            Ws(0, new Win?[] { Win(1), Win(3) }),
            Ws(1, new Win?[] { Win(2), null }),
            Ws(2, new Win?[] { Win(4), Win(5) }),
        });
        var decision = PlacementPolicy.UnmaximizeWindow(state, Env(), 1, 2);
        Assert.Equal(0, decision.Workspace);
        Assert.Equal(new[] { 2 }, decision.Minimize);
    }

    [Fact]
    public void UnmaximizeParksInTheLeftWhenTheRightNeighbourIsEmpty()
    {
        var state = State(new[]
        {
            Ws(0, new Win?[] { Win(1), Win(3) }),
            Ws(1, new Win?[] { Win(2), null }),
            Ws(2),
        });
        var decision = PlacementPolicy.UnmaximizeWindow(state, Env(), 1, 2);
        Assert.Equal(0, decision.Workspace);
        Assert.Equal(new[] { 2 }, decision.Minimize);
    }

    [Fact]
    public void UnmaximizeParksInTheRightWhenThereIsNoLeftNeighbour()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(2), null }), Ws(1, new Win?[] { Win(4), Win(5) }) });
        var decision = PlacementPolicy.UnmaximizeWindow(state, Env(), 0, 2);
        Assert.Equal(1, decision.Workspace);
        Assert.Equal(new[] { 2 }, decision.Minimize);
    }

    [Fact]
    public void UnmaximizeStaysWhereItIsWhenNoNeighbourHoldsWindows()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(2), null }), Ws(1) });
        var decision = PlacementPolicy.UnmaximizeWindow(state, Env(), 0, 2);
        Assert.Equal(0, decision.Workspace);
        Assert.Equal(new[] { 2 }, decision.Minimize);
    }

    [Fact]
    public void UnmaximizeJoinsANeighbourThatHoldsOnlyAMinimizedWindow()
    {
        var state = State(new[] { Ws(0, null, new[] { Win(1) }), Ws(1, new Win?[] { Win(2), null }) });
        var decision = PlacementPolicy.UnmaximizeWindow(state, Env(), 1, 2);
        Assert.Equal(0, decision.Workspace);
        Assert.Equal(1, decision.Slot);
    }

    [Fact]
    public void UnmaximizeSaysToUnmaximizeInPlaceOnASingleWorkspaceScreen()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }) });
        var decision = PlacementPolicy.UnmaximizeWindow(state, Env(ScreenClass.Single), 0, 2);
        Assert.Equal(0, decision.Workspace);
        Assert.True(decision.InPlace);
    }

    [Fact]
    public void MinimizeRelocationMovesItIntoTheLeftNeighbourWhenThatHoldsWindows()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), null }), Ws(1, null, new[] { Win(2) }) });
        Assert.Equal(0, PlacementPolicy.MinimizeRelocation(state, 1)?.To);
    }

    [Fact]
    public void MinimizeRelocationMovesItRightWhenTheLeftHoldsNothing()
    {
        var state = State(new[] { Ws(0, null, new[] { Win(2) }), Ws(1, new Win?[] { Win(3), null }) });
        Assert.Equal(1, PlacementPolicy.MinimizeRelocation(state, 0)?.To);
    }

    [Fact]
    public void MinimizeRelocationLeavesItAloneWhenNoNeighbourHoldsWindows()
    {
        var state = State(new[] { Ws(0, null, new[] { Win(2) }) });
        Assert.Null(PlacementPolicy.MinimizeRelocation(state, 0));
    }

    [Fact]
    public void EscapeSizeKeepsAWindowWiderThanASixthAtItsOwnSize()
    {
        Assert.Equal(700, PlacementPolicy.EscapeSize(1200, 700));
    }

    [Fact]
    public void EscapeSizeClampsATinyWindowUpToOneSixthOfTheScreen()
    {
        Assert.Equal(200, PlacementPolicy.EscapeSize(1200, 80));
    }

    [Fact]
    public void EscapeSizeClampsAHugeWindowDownToTheFullScreen()
    {
        Assert.Equal(1200, PlacementPolicy.EscapeSize(1200, 2000));
    }

    [Fact]
    public void ImpossibleSplitOnADynamicScreenGivesTheReactorItsOwnWorkspace()
    {
        var outcome = PlacementPolicy.ImpossibleSplit(Env(), Win(1), Win(2));
        Assert.Equal(1, outcome.Keep);
        Assert.Equal(2, outcome.GiveWay);
        Assert.Equal(GiveWayTo.OwnWorkspace, outcome.GiveWayTo);
    }

    [Fact]
    public void ImpossibleSplitOnASingleWorkspaceScreenMinimizesTheReactor()
    {
        var outcome = PlacementPolicy.ImpossibleSplit(Env(ScreenClass.Single), Win(1), Win(2));
        Assert.Equal(1, outcome.Keep);
        Assert.Equal(2, outcome.GiveWay);
        Assert.Equal(GiveWayTo.Minimized, outcome.GiveWayTo);
    }

    [Fact]
    public void RefusalLadderLetsTheSiblingAdaptToTheRemainder()
    {
        var (sibling, escaped) = PlacementPolicy.RefusalLadder(700, 200, 1280);
        Assert.Equal(580, sibling);
        Assert.False(escaped);
    }

    [Fact]
    public void RefusalLadderGivesTheSiblingAtLeastItsMinimumWhenTheRemainderIsSmaller()
    {
        Assert.True(PlacementPolicy.RefusalLadder(900, 500, 1280).Escaped);
    }

    [Fact]
    public void RefusalLadderHandsTheWholeRemainderToASiblingThatCanUseIt()
    {
        var (sibling, escaped) = PlacementPolicy.RefusalLadder(100, 200, 1280);
        Assert.Equal(1180, sibling);
        Assert.False(escaped);
    }

    [Fact]
    public void RefusalLadderEscapesWhenTheRefusingWindowAloneExceedsTheSplit()
    {
        Assert.True(PlacementPolicy.RefusalLadder(2000, 100, 1280).Escaped);
    }

    [Fact]
    public void DropPlacementACrossScreenArrivalTakesTheSideItCameFrom()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), null }), Ws(1) });
        var fromLeft = Assert.IsType<SlotDropResult>(PlacementPolicy.DropPlacement(state, Env(), 2, 0, Direction.Left, null));
        Assert.Equal(0, fromLeft.Workspace);
        Assert.Equal(0, fromLeft.Slot);
        var fromRight = Assert.IsType<SlotDropResult>(PlacementPolicy.DropPlacement(state, Env(), 2, 0, Direction.Right, null));
        Assert.Equal(0, fromRight.Workspace);
        Assert.Equal(1, fromRight.Slot);
    }

    [Fact]
    public void DropPlacementWithoutASideAFreeSlotWinsOnTheSlotOneDefault()
    {
        var state = State(new[] { Ws(0, new Win?[] { null, Win(1) }), Ws(1) });
        var result = Assert.IsType<SlotDropResult>(PlacementPolicy.DropPlacement(state, Env(), 2, 0, null, null));
        Assert.Equal(0, result.Workspace);
        Assert.Equal(0, result.Slot);
    }

    [Fact]
    public void DropPlacementAFreeSlotBeatsACrossing()
    {
        var state = State(new[] { Ws(0, new Win?[] { null, Win(1) }), Ws(1) });
        var result = Assert.IsType<SlotDropResult>(PlacementPolicy.DropPlacement(state, Env(), 2, 0, null, 1));
        Assert.Equal(0, result.Workspace);
        Assert.Equal(0, result.Slot);
    }

    [Fact]
    public void DropPlacementSwapsWithACrossedWindowOnlyWhenThereIsNoFreeSlot()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }), Ws(1) });
        var result = Assert.IsType<SwapDropResult>(PlacementPolicy.DropPlacement(state, Env(), 9, 0, null, 2));
        Assert.Equal(0, result.Workspace);
        Assert.Equal(2, result.With);
    }

    [Fact]
    public void DropPlacementFloatsOnAFullWorkspaceWhenNothingWasCrossed()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }), Ws(1) });
        var result = Assert.IsType<FloatDropResult>(PlacementPolicy.DropPlacement(state, Env(), 9, 0, null, null));
        Assert.Equal(0, result.Workspace);
    }

    [Fact]
    public void DropPlacementMaximisesOnTheEmptyTrailingWorkspace()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), null }), Ws(1) });
        var result = Assert.IsType<MaximizeDropResult>(PlacementPolicy.DropPlacement(state, Env(), 2, 1, null, null));
        Assert.Equal(1, result.Workspace);
    }

    [Fact]
    public void DropPlacementNeverSwapsOnASingleWorkspaceScreen()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }) });
        var result = Assert.IsType<FloatDropResult>(
            PlacementPolicy.DropPlacement(state, Env(ScreenClass.Single), 9, 0, null, 2));
        Assert.Equal(0, result.Workspace);
    }

    [Fact]
    public void DropPlacementRoutesAFixedScreenToTheNearestWorkspaceWithRoom()
    {
        var state = State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }), Ws(1, new Win?[] { Win(3), null }), Ws(2) });
        var result = Assert.IsType<SlotDropResult>(
            PlacementPolicy.DropPlacement(state, Env(ScreenClass.Fixed), 9, 0, null, 2));
        Assert.Equal(1, result.Workspace);
        Assert.Equal(1, result.Slot);
    }
}
