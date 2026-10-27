// Port of tests/core/undo.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class UndoTests
{
    private static InstanceConfig Instance(
        int id,
        int workspace = 0,
        int? slot = null,
        bool maximized = false,
        bool floating = false) => new()
        {
            Id = id,
            Workspace = workspace,
            Slot = slot,
            Rect = H.Rect(0, 0, 100, 100),
            Maximized = maximized,
            Floating = floating,
        };

    [Fact]
    public void HoldsOneChangeAndConsumingItLeavesNothing()
    {
        var log = new ChangeLog();
        Assert.Equal(0, log.Size);
        Assert.True(log.Set(new Change { Instances = new[] { Instance(1) } }));
        Assert.Equal(1, log.Size);
        Assert.Equal(1, log.Take()?.Instances[0].Id);
        Assert.Null(log.Take());
        Assert.Equal(0, log.Size);
    }

    [Fact]
    public void OverwritesThePreviousChangeThereIsNeverAStack()
    {
        var log = new ChangeLog();
        log.Set(new Change { Instances = new[] { Instance(1) } });
        log.Set(new Change { Instances = new[] { Instance(2) } });
        Assert.Equal(2, log.Take()?.Instances[0].Id);
        Assert.Null(log.Take());
    }

    [Fact]
    public void IgnoresAnEmptyChangeSoItCannotMaskTheRealOne()
    {
        var log = new ChangeLog();
        log.Set(new Change { Instances = new[] { Instance(1) } });
        Assert.False(log.Set(new Change { Instances = Array.Empty<InstanceConfig>() }));
        Assert.Equal(1, log.Take()?.Instances[0].Id);
    }

    [Fact]
    public void CopiesTheChangeAndItsRatios()
    {
        var log = new ChangeLog();
        var ratios = new Dictionary<string, double> { ["a|b|horizontal"] = 0.25 };
        var instances = new[] { Instance(1) };
        log.Set(new Change { Instances = instances, Ratios = ratios });
        ratios["a|b|horizontal"] = 0.9;
        instances[0] = instances[0] with { Rect = H.Rect(999, 0, 100, 100) };
        var taken = log.Take();
        Assert.Equal(0.25, taken?.Ratios?["a|b|horizontal"]);
        Assert.Equal(0, taken?.Instances[0].Rect.X);
    }

    private static IReadOnlyList<LiveInstance> Live(params (int Id, int Workspace, int? Slot)[] entries) =>
        entries.Select(entry => new LiveInstance { Id = entry.Id, Workspace = entry.Workspace, Slot = entry.Slot }).ToList();

    [Fact]
    public void AcceptsAChangeWhoseInstancesAllStillExist()
    {
        var change = new Change
        {
            Instances = new[] { Instance(1, slot: 0), Instance(2, slot: 1) },
        };
        var validation = Undo.ValidateChange(change, Live((1, 0, 0), (2, 0, 1)));
        Assert.True(validation.Ok);
        Assert.Null(validation.Problem);
    }

    [Fact]
    public void RefusesWhenAnInstanceIsGone()
    {
        var change = new Change { Instances = new[] { Instance(1), Instance(2) } };
        var validation = Undo.ValidateChange(change, Live((1, 0, null)));
        Assert.False(validation.Ok);
        Assert.Equal(UndoProblem.InstanceGone, validation.Problem);
    }

    [Fact]
    public void RefusesWhenASlotItNeedsIsTakenByAnOutsider()
    {
        var change = new Change { Instances = new[] { Instance(1, slot: 0) } };
        var validation = Undo.ValidateChange(change, Live((1, 0, 1), (9, 0, 0)));
        Assert.False(validation.Ok);
        Assert.Equal(UndoProblem.SlotTaken, validation.Problem);
    }

    [Fact]
    public void AllowsASwapWhereTheOtherSlotIsHeldByTheChangeItself()
    {
        var change = new Change
        {
            Instances = new[] { Instance(1, slot: 1, workspace: 0), Instance(2, slot: 0, workspace: 0) },
        };
        var validation = Undo.ValidateChange(change, Live((1, 0, 1), (2, 0, 0)));
        Assert.True(validation.Ok);
        Assert.Null(validation.Problem);
    }

    [Fact]
    public void IgnoresASlotOnADifferentWorkspace()
    {
        var change = new Change { Instances = new[] { Instance(1, slot: 0, workspace: 0) } };
        var validation = Undo.ValidateChange(change, Live((1, 0, null), (9, 1, 0)));
        Assert.True(validation.Ok);
        Assert.Null(validation.Problem);
    }
}
