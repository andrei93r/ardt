// Port of tests/core/queue.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class QueueTests
{
    private sealed class FakeClock : TimeProvider
    {
        public double NowMs { get; set; }

        public override DateTimeOffset GetUtcNow() =>
            DateTimeOffset.FromUnixTimeMilliseconds((long)NowMs);
    }

    [Fact]
    public void HandsAPushedEventBackOnTheNextDrain()
    {
        var q = new EventQueue();
        q.Push(Lane.Layout, "win-1", "retile", new Dictionary<string, object?> { ["reason"] = "test" });
        var drained = q.Drain();
        Assert.Single(drained);
        Assert.Equal(Lane.Layout, drained[0].Lane);
        Assert.Equal("win-1", drained[0].Key);
        Assert.Equal("retile", drained[0].Kind);
        Assert.Equal(H.Json(new Dictionary<string, object?> { ["reason"] = "test" }), H.Json(drained[0].Data));
    }

    [Fact]
    public void CoalescesTheSameKeyIntoOneEntryKeepingTheEarliestPosition()
    {
        var q = new EventQueue();
        q.Push(Lane.Layout, "a", "first", new Dictionary<string, object?> { ["n"] = 1.0 });
        q.Push(Lane.Layout, "b", "other", new Dictionary<string, object?> { ["n"] = 2.0 });
        q.Push(Lane.Layout, "a", "second", new Dictionary<string, object?> { ["n"] = 3.0 });
        var drained = q.Drain();
        Assert.Equal(new[] { "a", "b" }, drained.Select(e => e.Key));
        Assert.Equal("second", drained[0].Kind);
        Assert.Equal(H.Json(new Dictionary<string, object?> { ["n"] = 3.0 }), H.Json(drained[0].Data));
    }

    [Fact]
    public void KeepsDifferentKeysApart()
    {
        var q = new EventQueue();
        q.Push(Lane.Layout, "a", "x");
        q.Push(Lane.Layout, "b", "y");
        q.Push(Lane.Layout, "c", "z");
        Assert.Equal(3, q.Pending);
        Assert.Equal(new[] { "a", "b", "c" }, q.Drain().Select(e => e.Key));
    }

    [Fact]
    public void DrainsLane1BeforeLane2BeforeLane3()
    {
        var q = new EventQueue();
        q.Push(Lane.Maintenance, "c", "maintenance");
        q.Push(Lane.Feedback, "a", "feedback");
        q.Push(Lane.Layout, "b", "layout");
        Assert.Equal(new[] { Lane.Feedback, Lane.Layout, Lane.Maintenance }, q.Drain().Select(e => e.Lane));
    }

    [Fact]
    public void KeepsInsertionOrderInsideOneLane()
    {
        var q = new EventQueue();
        q.Push(Lane.Layout, "z", "first");
        q.Push(Lane.Layout, "y", "second");
        q.Push(Lane.Layout, "x", "third");
        Assert.Equal(new[] { "z", "y", "x" }, q.Drain().Select(e => e.Key));
    }

    [Fact]
    public void TreatsTheSameKeyInTwoLanesAsTwoEvents()
    {
        var q = new EventQueue();
        q.Push(Lane.Feedback, "same", "feedback");
        q.Push(Lane.Layout, "same", "layout");
        var drained = q.Drain();
        Assert.Equal(2, drained.Count);
        Assert.Equal(new[] { Lane.Feedback, Lane.Layout }, drained.Select(e => e.Lane));
    }

    [Fact]
    public void EmptiesOnDrainAndDrainingAgainGivesNothing()
    {
        var q = new EventQueue();
        q.Push(Lane.Layout, "a", "x");
        Assert.Single(q.Drain());
        Assert.Empty(q.Drain());
        Assert.Equal(0, q.Pending);
    }

    [Fact]
    public void ReportsWhetherAPushNeedsTheDrainToBeArmed()
    {
        var q = new EventQueue();
        Assert.True(q.Push(Lane.Layout, "a", "x"));
        Assert.False(q.Push(Lane.Layout, "b", "y"));
        q.Drain();
        Assert.True(q.Push(Lane.Layout, "c", "z"));
    }

    [Fact]
    public void CountsPerLaneAndPicksTheHighestNonEmptyLane()
    {
        var q = new EventQueue();
        q.Push(Lane.Feedback, "a", "x");
        q.Push(Lane.Feedback, "b", "y");
        q.Push(Lane.Maintenance, "c", "z");
        Assert.Equal(2, q.Depth(Lane.Feedback));
        Assert.Equal(0, q.Depth(Lane.Layout));
        Assert.Equal(1, q.Depth(Lane.Maintenance));
        Assert.Equal(Lane.Feedback, q.HighestLane());
        q.Drain();
        Assert.Null(q.HighestLane());
    }

    [Fact]
    public void AnswersWhetherAKeyIsAlreadyQueued()
    {
        var q = new EventQueue();
        q.Push(Lane.Layout, "a", "x");
        Assert.True(q.Has("a"));
        Assert.False(q.Has("aims"));
    }

    [Fact]
    public void ForgetsAKeyAfterADrain()
    {
        var q = new EventQueue();
        q.Push(Lane.Layout, "a", "x");
        Assert.True(q.Has("a"));
        q.Drain();
        Assert.False(q.Has("a"));
    }

    [Fact]
    public void ForgetsAKeyAfterAClear()
    {
        var q = new EventQueue();
        q.Push(Lane.Layout, "a", "x");
        q.Clear();
        Assert.False(q.Has("a"));
    }

    [Fact]
    public void KeepsAKeyPresentWhileTheSameKeySitsInTwoLanes()
    {
        var q = new EventQueue();
        q.Push(Lane.Feedback, "same", "feedback");
        q.Push(Lane.Layout, "same", "layout");
        Assert.True(q.Has("same"));
        q.Drain();
        Assert.False(q.Has("same"));
    }

    [Fact]
    public void ReusesOneDrainBufferSoALaterDrainInvalidatesTheEarlierResult()
    {
        var q = new EventQueue();
        q.Push(Lane.Layout, "a", "x");
        var first = q.Drain();
        Assert.Equal(new[] { "a" }, first.Select(e => e.Key));
        q.Push(Lane.Layout, "b", "y");
        var second = q.Drain();
        Assert.Same(first, second);
        Assert.Equal(new[] { "b" }, second.Select(e => e.Key));
    }

    [Fact]
    public void StampsEachEventFromTheInjectedClock()
    {
        var clock = new FakeClock { NowMs = 1000 };
        var q = new EventQueue(clock);
        q.Push(Lane.Layout, "a", "x");
        clock.NowMs = 1500;
        q.Push(Lane.Layout, "b", "y");
        var drained = q.Drain();
        Assert.Equal(1000, drained[0].At);
        Assert.Equal(1500, drained[1].At);
        Assert.True(q.DrainAge(2000, drained) > 0);
    }

    [Fact]
    public void ReportsTheOldestWaitInADrainedBatchNotTheNewest()
    {
        var clock = new FakeClock { NowMs = 1000 };
        var q = new EventQueue(clock);
        q.Push(Lane.Layout, "a", "x");
        clock.NowMs = 1500;
        q.Push(Lane.Layout, "b", "y");
        clock.NowMs = 2000;
        var drained = q.Drain();
        Assert.Equal(1000, q.DrainAge(2000, drained));
    }

    [Fact]
    public void ReportsZeroForAnEmptyDrainedBatch()
    {
        var q = new EventQueue();
        Assert.Equal(0, q.DrainAge(5000, Array.Empty<QueuedEvent>()));
    }

    [Fact]
    public void ClearsEverythingWithoutDraining()
    {
        var q = new EventQueue();
        q.Push(Lane.Feedback, "a", "x");
        q.Push(Lane.Layout, "b", "y");
        q.Clear();
        Assert.Equal(0, q.Pending);
        Assert.Empty(q.Drain());
    }

    [Fact]
    public void DrainsABurstOfManyKeysExactlyOnceEach()
    {
        var q = new EventQueue();
        for (var i = 0; i < 500; i += 1)
        {
            q.Push(Lane.Layout, $"w{i}", "retile", new Dictionary<string, object?> { ["i"] = (double)i });
        }
        for (var i = 0; i < 500; i += 1)
        {
            q.Push(Lane.Layout, $"w{i}", "retile", new Dictionary<string, object?> { ["i"] = (double)(i + 1000) });
        }
        var drained = q.Drain();
        Assert.Equal(500, drained.Count);
        Assert.Equal(H.Json(new Dictionary<string, object?> { ["i"] = 1000.0 }), H.Json(drained[0].Data));
        Assert.Equal(0, q.Pending);
    }
}
