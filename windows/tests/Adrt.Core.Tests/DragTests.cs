// Port of tests/core/drag.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class DragTests
{
    private static readonly Rect Area = H.Rect(0, 0, 1200, 800);
    private static readonly Env Env = new() { Screen = ScreenClass.Dynamic, Axis = Axis.Horizontal };
    private static readonly Screen Screen = H.Screen(geometry: Area);

    private static readonly TilerConfig Config = new()
    {
        GapBase = 0,
        GapPortrait = -1,
        GapLandscape = -1,
        MinSizePolicy = MinSizePolicy.Respect,
        PrimaryApps = Array.Empty<string>(),
        PrimaryAppRatio = 0.5,
        Ratios = new Dictionary<string, double>(),
        SwapPairs = new HashSet<string>(),
        Rules = Array.Empty<Rule>(),
    };

    private static Win Win(int id) => new() { Id = id };

    private static Ws Ws(int id, Win?[]? slots = null) => new()
    {
        Id = id,
        Slots = slots ?? new Win?[] { null, null },
        Minimized = Array.Empty<Win>(),
    };

    private static State State(Ws[] workspaces, int viewed = 0) => new()
    {
        Workspaces = workspaces,
        Viewed = viewed,
    };

    private static TilerWindow Twin(int id, string appId, Rect placed, int? slot = null) =>
        H.Window(id: id, appId: appId, rect: placed, min: H.Size(0, 0), max: H.Size(0, 0)) with { Slot = slot };

    private static DragInput Input(
        TilerWindow dragged,
        IReadOnlyDictionary<int, IReadOnlyList<TilerWindow>> othersByWorkspace,
        Rect dropped,
        int workspace,
        Direction? from,
        int? crossed,
        bool samePlane,
        State? state = null,
        bool managed = true) => new()
        {
            State = state ?? State(new[] { Ws(0), Ws(1) }),
            Env = Env,
            Id = dragged.Id,
            Screen = Screen,
            Config = Config,
            Managed = managed,
            SamePlane = samePlane,
            Dragged = dragged,
            OthersByWorkspace = othersByWorkspace,
            Dropped = dropped,
            Workspace = workspace,
            From = from,
            Crossed = crossed,
        };

    private static Dictionary<int, IReadOnlyList<TilerWindow>> Others(params (int Workspace, TilerWindow[] Windows)[] entries)
    {
        var output = new Dictionary<int, IReadOnlyList<TilerWindow>>();
        foreach (var (workspace, windows) in entries) output[workspace] = windows;
        return output;
    }

    [Fact]
    public void SwappedSidesTradesTwoKnownDifferentSides()
    {
        Assert.Equal((1, 0), PlacementPolicy.SwappedSides(1, 0, 2, 1));
    }

    [Fact]
    public void SwappedSidesReversesTheIdOrderWhenTheSidesAreEqualOrUnknown()
    {
        Assert.Equal((1, 0), PlacementPolicy.SwappedSides(1, 1, 2, 1));
        Assert.Equal((0, 1), PlacementPolicy.SwappedSides(2, null, 1, null));
    }

    [Fact]
    public void ACrossPlaneFreeSlotTakesTheSideItCameFrom()
    {
        var dragged = Twin(2, "b", H.Rect(700, 0, 600, 800));
        var resident = Twin(1, "a", H.Rect(0, 0, 600, 800), 0);
        var outcome = Drag.DragOutcome(Input(
            dragged,
            Others((0, new[] { resident })),
            H.Rect(700, 0, 600, 800),
            0,
            Direction.Right,
            null,
            samePlane: false,
            state: State(new[] { Ws(0, new Win?[] { Win(1), null }), Ws(1) })))!;
        var slot = Assert.IsType<SlotDragOutcome>(outcome);
        Assert.Equal(0, slot.Workspace);
        Assert.Equal(1, slot.Slot);
        Assert.Equal(H.Rect(600, 0, 600, 800), slot.Rect);
    }

    [Fact]
    public void AFreeSlotFromTheLeftTakesSlotZero()
    {
        var dragged = Twin(2, "b", H.Rect(50, 0, 600, 800));
        var resident = Twin(1, "a", H.Rect(600, 0, 600, 800), 1);
        var outcome = Drag.DragOutcome(Input(
            dragged,
            Others((0, new[] { resident })),
            H.Rect(50, 0, 600, 800),
            0,
            Direction.Left,
            null,
            samePlane: false,
            state: State(new[] { Ws(0, new Win?[] { null, Win(1) }), Ws(1) })))!;
        var slot = Assert.IsType<SlotDragOutcome>(outcome);
        Assert.Equal(0, slot.Slot);
        Assert.Equal(H.Rect(0, 0, 600, 800), slot.Rect);
    }

    [Fact]
    public void ASamePlaneMoveThatCrossesItsSiblingSwapsAndLandsOnTheCrossedTile()
    {
        var dragged = Twin(1, "a", H.Rect(700, 0, 600, 800), 1);
        var sibling = Twin(2, "b", H.Rect(600, 0, 600, 800), 1);
        var outcome = Drag.DragOutcome(Input(
            dragged,
            Others((0, new[] { sibling })),
            H.Rect(596, 0, 600, 800),
            0,
            null,
            2,
            samePlane: true))!;
        var swap = Assert.IsType<SwapDragOutcome>(outcome);
        Assert.Equal(2, swap.With);
        Assert.Equal(H.Rect(600, 0, 600, 800), swap.Rect);
    }

    [Fact]
    public void AnExplicitSwapTradesTwoKnownSides()
    {
        var dragged = Twin(1, "a", H.Rect(0, 0, 600, 800), 0);
        var sibling = Twin(2, "b", H.Rect(600, 0, 600, 800), 1);
        var outcome = Drag.DragOutcome(Input(
            dragged,
            Others((0, new[] { sibling })),
            H.Rect(600, 0, 600, 800),
            0,
            null,
            2,
            samePlane: true))!;
        Assert.Equal(H.Rect(600, 0, 600, 800), outcome.Rect);
    }

    [Fact]
    public void MaximisesAloneOnTheEmptyTargetWorkspace()
    {
        var dragged = Twin(2, "b", H.Rect(300, 300, 600, 400));
        var outcome = Drag.DragOutcome(Input(
            dragged,
            Others((1, Array.Empty<TilerWindow>())),
            H.Rect(300, 300, 600, 400),
            1,
            Direction.Right,
            null,
            samePlane: false,
            state: State(new[] { Ws(0, new Win?[] { Win(1), Win(3) }), Ws(1) })))!;
        var maximize = Assert.IsType<MaximizeDragOutcome>(outcome);
        Assert.Equal(1, maximize.Workspace);
        Assert.Equal(Area, maximize.Rect);
    }

    [Fact]
    public void FloatsWhereDroppedWhenTheFullTargetHasNothingToCross()
    {
        var dropped = H.Rect(260, 140, 500, 420);
        var dragged = Twin(3, "c", dropped);
        var outcome = Drag.DragOutcome(Input(
            dragged,
            Others((0, new[]
            {
                Twin(1, "a", H.Rect(0, 0, 600, 800), 0),
                Twin(2, "b", H.Rect(600, 0, 600, 800), 1),
            })),
            dropped,
            0,
            Direction.Left,
            null,
            samePlane: false,
            state: State(new[] { Ws(0, new Win?[] { Win(1), Win(2) }), Ws(1) })))!;
        var floatOutcome = Assert.IsType<FloatDragOutcome>(outcome);
        Assert.Equal(0, floatOutcome.Workspace);
        Assert.Equal(dropped, floatOutcome.Rect);
    }

    [Fact]
    public void ReturnsToItsOwnTileWhenASamePlaneMoveCrossesNothing()
    {
        var dragged = Twin(2, "b", H.Rect(612, 0, 590, 800), 1);
        var sibling = Twin(1, "a", H.Rect(0, 0, 600, 800), 0);
        var outcome = Drag.DragOutcome(Input(
            dragged,
            Others((0, new[] { sibling })),
            H.Rect(612, 0, 590, 800),
            0,
            null,
            null,
            samePlane: true))!;
        var none = Assert.IsType<NoneDragOutcome>(outcome);
        Assert.Equal(0, none.Workspace);
        Assert.Equal(H.Rect(600, 0, 600, 800), none.Rect);
    }

    private static DragInput Crossing(bool managed)
    {
        var dragged = Twin(1, "a", H.Rect(700, 0, 600, 800), 1);
        var sibling = Twin(2, "b", H.Rect(600, 0, 600, 800), 1);
        return Input(
            dragged,
            Others((0, new[] { sibling })),
            H.Rect(596, 0, 600, 800),
            0,
            null,
            2,
            samePlane: true,
            managed: managed);
    }

    [Fact]
    public void AnUnmanagedWindowCrossingATileHasNoLandingDecision()
    {
        Assert.Null(Drag.DragOutcome(Crossing(false)));
    }

    [Fact]
    public void AManagedWindowCrossingATileStillSwaps()
    {
        var swap = Assert.IsType<SwapDragOutcome>(Drag.DragOutcome(Crossing(true)));
        Assert.Equal(2, swap.With);
    }

    [Fact]
    public void AnUnmanagedCrossPlaneDragHasNoLandingDecisionEither()
    {
        var dragged = Twin(2, "b", H.Rect(700, 0, 600, 800));
        var resident = Twin(1, "a", H.Rect(0, 0, 600, 800), 0);
        Assert.Null(Drag.DragOutcome(Input(
            dragged,
            Others((0, new[] { resident })),
            H.Rect(700, 0, 600, 800),
            0,
            Direction.Right,
            null,
            samePlane: false,
            state: State(new[] { Ws(0, new Win?[] { Win(1), null }), Ws(1) }),
            managed: false)));
    }
}
