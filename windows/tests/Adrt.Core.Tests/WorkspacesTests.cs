// Port of tests/core/workspaces.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class WorkspacesTests
{
    private static Win Win(int id) => new() { Id = id };

    private static Ws Ws(int id, Win?[]? slots = null, Win[]? minimized = null, Win[]? floats = null) => new()
    {
        Id = id,
        Slots = slots ?? new Win?[] { null, null },
        Minimized = minimized ?? Array.Empty<Win>(),
        Floats = floats ?? Array.Empty<Win>(),
    };

    private static State State(Ws[] workspaces, int viewed = 0) => new()
    {
        Workspaces = workspaces,
        Viewed = viewed,
    };

    [Fact]
    public void HoldsWindowsIsTrueForAVisibleMinimizedOrFloatingWindow()
    {
        Assert.True(Workspaces.HoldsWindows(Ws(0, new Win?[] { Win(1), null })));
        Assert.True(Workspaces.HoldsWindows(Ws(0, null, new[] { Win(1) })));
        Assert.True(Workspaces.HoldsWindows(Ws(0, null, null, new[] { Win(1) })));
    }

    [Fact]
    public void HoldsWindowsIsFalseForAnEmptyWorkspace()
    {
        Assert.False(Workspaces.HoldsWindows(Ws(0)));
    }

    [Fact]
    public void SpareIndexIsTheTrailingEmptyWorkspace()
    {
        Assert.Equal(1, Workspaces.SpareIndex(State(new[] { Ws(0, new Win?[] { Win(1), null }), Ws(1) })));
    }

    [Fact]
    public void SpareIndexIsTheLastWorkspaceEvenWhenOccupied()
    {
        Assert.Equal(1, Workspaces.SpareIndex(State(new[] { Ws(0, new Win?[] { Win(1), null }), Ws(1, new Win?[] { Win(2), null }) })));
    }

    [Fact]
    public void ReapsAnEmptyWorkspaceThatIsNotTheSpare()
    {
        var plan = Workspaces.ReapPlan(State(new[] { Ws(0), Ws(1, new Win?[] { Win(1), null }), Ws(2) }));
        Assert.Equal(new[] { 0 }, plan.Reap);
    }

    [Fact]
    public void NeverReapsTheSpare()
    {
        var plan = Workspaces.ReapPlan(State(new[] { Ws(0, new Win?[] { Win(1), null }), Ws(1) }));
        Assert.Empty(plan.Reap);
    }

    [Fact]
    public void RelocatesTheOccupantOfAWorkspaceThatHoldsOnlyMinimizedWindowsIntoTheLeft()
    {
        var plan = Workspaces.ReapPlan(State(new[] { Ws(0, new Win?[] { Win(1), null }), Ws(1, null, new[] { Win(2) }), Ws(2) }));
        Assert.Equal(new[] { (2, 0) }, plan.Relocate.Select(move => (move.Id, move.To)));
        Assert.Equal(new[] { 1 }, plan.Reap);
    }

    [Fact]
    public void RelocatesItToTheRightWhenTheLeftHoldsNothing()
    {
        var plan = Workspaces.ReapPlan(State(new[] { Ws(0, null, new[] { Win(2) }), Ws(1, new Win?[] { Win(3), null }), Ws(2) }));
        Assert.Equal(new[] { (2, 1) }, plan.Relocate.Select(move => (move.Id, move.To)));
    }

    [Fact]
    public void LeavesTheLastWorkspaceAsItIsWhenNoNeighbourHoldsWindows()
    {
        var plan = Workspaces.ReapPlan(State(new[] { Ws(0, null, new[] { Win(2) }) }));
        Assert.Empty(plan.Relocate);
        Assert.Empty(plan.Reap);
    }

    [Fact]
    public void KeepsAWorkspaceAliveWhenAFloatPinsIt()
    {
        var plan = Workspaces.ReapPlan(State(new[] { Ws(0, null, null, new[] { Win(2) }), Ws(1) }));
        Assert.Empty(plan.Reap);
    }

    [Fact]
    public void ReapsEveryEmptyWorkspaceWhereverItSitsLeavingOneSpare()
    {
        var plan = Workspaces.ReapPlan(State(new[] { Ws(0), Ws(1, new Win?[] { Win(1), null }), Ws(2), Ws(3) }));
        Assert.Equal(new[] { 0, 2 }, plan.Reap);
    }
}
