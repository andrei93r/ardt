// Port of tests/core/replay.test.ts.
using System.Text.Json;
using System.Text.Json.Nodes;
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class ReplayTests
{
    private static TilerConfig Config(double gapBase = 0) => new()
    {
        GapBase = gapBase,
        GapPortrait = -1,
        GapLandscape = -1,
        MinSizePolicy = MinSizePolicy.Respect,
        PrimaryApps = Array.Empty<string>(),
        PrimaryAppRatio = 0.5,
        Ratios = new Dictionary<string, double>(),
        SwapPairs = new HashSet<string>(),
        Rules = Array.Empty<Rule>(),
    };

    private static readonly Screen Monitor = H.Screen(geometry: H.Rect(0, 0, 1920, 1080));

    private static ReplayEnv Env(ScreenClass screenClass = ScreenClass.Dynamic) => new()
    {
        Screen = screenClass,
        Axis = Axis.Horizontal,
        Monitor = Monitor,
        Config = Config(gapBase: 8),
    };

    private static TraceWindow Window(
        int id,
        string? appId = null,
        string? title = null,
        SurfaceKind? kind = SurfaceKind.Normal,
        int screenId = 0,
        Rect? rect = null,
        Size? min = null,
        Size? max = null,
        bool? maximized = null,
        bool? fullscreen = null) => new()
        {
            Id = id,
            AppId = appId ?? $"app{id}",
            Title = title ?? $"window {id}",
            Kind = kind,
            ScreenId = screenId,
            Rect = rect ?? H.Rect(0, 0, 800, 600),
            Min = min ?? H.Size(100, 100),
            Max = max ?? H.Size(10000, 10000),
            Maximized = maximized,
            Fullscreen = fullscreen,
        };

    private static TraceWorkspace Workspace(
        int id,
        int?[]? slots = null,
        int[]? minimized = null,
        int[]? floats = null) => new()
        {
            Id = id,
            Slots = slots ?? new int?[] { null, null },
            Minimized = minimized ?? Array.Empty<int>(),
            Floats = floats ?? Array.Empty<int>(),
        };

    private static Dictionary<string, JsonElement> Fields(params (string Key, object? Value)[] entries)
    {
        var output = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var (key, value) in entries) output[key] = JsonSerializer.SerializeToElement(value);
        return output;
    }

    private static TraceEntry Event(int seq, string name, object? fields = null, double? at = null)
    {
        Dictionary<string, JsonElement>? dictionary = fields switch
        {
            null => null,
            Dictionary<string, JsonElement> map => map,
            _ => throw new ArgumentException("fields must be a dictionary"),
        };
        return new TraceEntry
        {
            Seq = seq,
            Source = "gnome",
            Event = name,
            At = at ?? seq * 1000,
            Fields = dictionary,
        };
    }

    private static Trace Trace(TraceInitial initial, IReadOnlyList<TraceEntry> events, IReadOnlyList<TraceEntry>? decisions = null) => new()
    {
        Version = 1,
        Initial = initial,
        Events = events,
        Decisions = decisions,
    };

    private static TraceInitial Initial(int viewed, TraceWorkspace[] workspaces, TraceWindow[] windows) => new()
    {
        Viewed = viewed,
        Workspaces = workspaces,
        Windows = windows,
    };

    private static JsonNode? Field(TraceEntry entry, string name) =>
        entry.Fields is not null && entry.Fields.TryGetValue(name, out var value)
            ? JsonNode.Parse(value.GetRawText())
            : null;

    private static int PlacementsCount(JsonNode? plan) => plan!["placements"]!.AsArray().Count;

    private static IEnumerable<int> SurfaceIds(JsonNode? plan) =>
        plan!["placements"]!.AsArray().Select(placement => placement!["surfaceId"]!.GetValue<int>());

    [Fact]
    public void RoutesTwoWindowsAsASplitAndCreatesAWorkspaceToTheRightForTheThird()
    {
        var trace = Trace(
            Initial(0, new[] { Workspace(0, new int?[] { 1, null }), Workspace(1) }, new[] { Window(1, maximized: true) }),
            new[]
            {
                Event(1, "window-opened", Fields(("id", 2), ("workspace", 0))),
                Event(2, "layout"),
                Event(3, "window-opened", Fields(("id", 3), ("workspace", 0))),
                Event(4, "layout"),
            });

        var decisions = Replay.Run(trace, Env());
        Assert.Equal(
            new[] { "routeNewWindow", "computePlans", "routeNewWindow", "computePlans", "computePlans" },
            decisions.Select(decision => decision.Event));

        Assert.Equal(2, Field(decisions[0], "window")!.GetValue<int>());
        Assert.Equal(0, Field(decisions[0], "workspace")!.GetValue<int>());
        Assert.Equal(1, Field(decisions[0], "slot")!.GetValue<int>());
        Assert.Equal("right-slot", Field(decisions[0], "note")!.GetValue<string>());
        Assert.Equal(2, PlacementsCount(Field(decisions[1], "plan")));

        Assert.Equal(3, Field(decisions[2], "window")!.GetValue<int>());
        Assert.Equal(0, Field(decisions[2], "workspace")!.GetValue<int>());
        Assert.Equal(1, Field(decisions[2], "slot")!.GetValue<int>());
        Assert.True(Field(decisions[2], "createRight")!.GetValue<bool>());
        Assert.True(Field(decisions[2], "maximize")!.GetValue<bool>());
        Assert.Equal("workspace-created", Field(decisions[2], "note")!.GetValue<string>());
        Assert.Equal(1, Field(decisions[2], "view")!.GetValue<int>());

        Assert.Equal("computePlans", decisions[4].Event);
        Assert.Equal(2, Field(decisions[4], "workspace")!.GetValue<int>());
        Assert.Equal(new[] { 3 }, SurfaceIds(Field(decisions[4], "plan")));
    }

    [Fact]
    public void MaximizesALoneArrivalOnAnEmptyViewedWorkspace()
    {
        var trace = Trace(
            Initial(0, new[] { Workspace(0), Workspace(1) }, Array.Empty<TraceWindow>()),
            new[] { Event(1, "window-opened", Fields(("id", 1), ("workspace", 0))) });
        var decision = Replay.Run(trace, Env())[0];
        Assert.Equal("routeNewWindow", decision.Event);
        Assert.Equal(1, Field(decision, "window")!.GetValue<int>());
        Assert.Equal(0, Field(decision, "workspace")!.GetValue<int>());
        Assert.Equal(1, Field(decision, "slot")!.GetValue<int>());
        Assert.True(Field(decision, "maximize")!.GetValue<bool>());
    }

    [Fact]
    public void ReapsAnEmptiedWorkspaceAndMovesTheViewToTheNearestOneThatHoldsWindows()
    {
        var trace = Trace(
            Initial(
                1,
                new[] { Workspace(0, new int?[] { 1, null }), Workspace(1, new int?[] { 2, null }), Workspace(2) },
                new[] { Window(1), Window(2, maximized: true) }),
            new[] { Event(1, "window-closed", Fields(("id", 2))), Event(2, "layout") });

        var decisions = Replay.Run(trace, Env());
        Assert.Equal("reapPlan", decisions[0].Event);
        Assert.Equal(new[] { 1 }, Field(decisions[0], "reap")!.AsArray().Select(node => node!.GetValue<int>()));
        Assert.Equal(0, Field(decisions[0], "view")!.GetValue<int>());
        Assert.Equal("computePlans", decisions[1].Event);
        Assert.Equal(0, Field(decisions[1], "workspace")!.GetValue<int>());
        Assert.Equal(1, PlacementsCount(Field(decisions[1], "plan")));
    }

    [Fact]
    public void KeepsAWorkspaceThatStillHoldsASurvivorAndReapsNothing()
    {
        var trace = Trace(
            Initial(0, new[] { Workspace(0, new int?[] { 1, 2 }), Workspace(1) }, new[] { Window(1), Window(2) }),
            new[] { Event(1, "window-closed", Fields(("id", 2))), Event(2, "layout") });
        var decisions = Replay.Run(trace, Env());
        Assert.Equal(new[] { "computePlans" }, decisions.Select(d => d.Event));
        Assert.Equal(1, PlacementsCount(Field(decisions[0], "plan")));
    }

    [Fact]
    public void RelocatesTheOccupantOfAWorkspaceThatOnlyHoldsAMinimizedWindowThenReapsIt()
    {
        var trace = Trace(
            Initial(
                1,
                new[] { Workspace(0, new int?[] { 1, null }), Workspace(1, new int?[] { 2, null }), Workspace(2) },
                new[] { Window(1), Window(2) }),
            new[] { Event(1, "window-minimized", Fields(("id", 2))) });

        var decision = Replay.Run(trace, Env())[0];
        Assert.Equal("reapPlan", decision.Event);
        Assert.Equal(new[] { 1 }, Field(decision, "reap")!.AsArray().Select(node => node!.GetValue<int>()));
        Assert.Equal(
            H.Json(new[] { new { id = 2, to = 0 } }),
            H.Json(Field(decision, "relocate")));
        Assert.Equal(0, Field(decision, "view")!.GetValue<int>());
    }

    [Fact]
    public void UnmaximizeJoinsTheLeftNeighbourWhenItHoldsExactlyOneWindowIntoSlotOne()
    {
        var trace = Trace(
            Initial(
                1,
                new[] { Workspace(0, new int?[] { 1, null }), Workspace(1, new int?[] { 2, null }), Workspace(2) },
                new[] { Window(1), Window(2, maximized: true) }),
            new[] { Event(1, "window-unmaximized", Fields(("id", 2), ("workspace", 1))) });

        var decisions = Replay.Run(trace, Env());
        Assert.Equal("unmaximizeWindow", decisions[0].Event);
        Assert.Equal(2, Field(decisions[0], "window")!.GetValue<int>());
        Assert.Equal(0, Field(decisions[0], "workspace")!.GetValue<int>());
        Assert.Equal(1, Field(decisions[0], "slot")!.GetValue<int>());
        Assert.Equal("unmaximize-joins-left", Field(decisions[0], "note")!.GetValue<string>());
        Assert.Equal("reapPlan", decisions[1].Event);
        Assert.Equal(new[] { 1 }, Field(decisions[1], "reap")!.AsArray().Select(node => node!.GetValue<int>()));
        Assert.Equal(0, Field(decisions[1], "view")!.GetValue<int>());
    }

    [Fact]
    public void UnmaximizeJoinsTheRightNeighbourWhenTheLeftCannotPair()
    {
        var trace = Trace(
            Initial(
                1,
                new[]
                {
                    Workspace(0, new int?[] { 1, 3 }),
                    Workspace(1, new int?[] { 2, null }),
                    Workspace(2, new int?[] { 4, null }),
                    Workspace(3),
                },
                new[] { Window(1), Window(2, maximized: true), Window(3), Window(4) }),
            new[] { Event(1, "window-unmaximized", Fields(("id", 2), ("workspace", 1))) });

        var decisions = Replay.Run(trace, Env());
        Assert.Equal("unmaximizeWindow", decisions[0].Event);
        Assert.Equal(2, Field(decisions[0], "window")!.GetValue<int>());
        Assert.Equal(2, Field(decisions[0], "workspace")!.GetValue<int>());
        Assert.Equal(1, Field(decisions[0], "slot")!.GetValue<int>());
        Assert.Equal("unmaximize-joins-right", Field(decisions[0], "note")!.GetValue<string>());
        Assert.Equal(new[] { 1 }, Field(decisions[1], "reap")!.AsArray().Select(n => n!.GetValue<int>()));
        Assert.Equal(0, Field(decisions[1], "view")!.GetValue<int>());
    }

    [Fact]
    public void UnmaximizeParksTheWindowMinimizedInTheLeftNeighbourWhenNeitherNeighbourCanPair()
    {
        var trace = Trace(
            Initial(
                1,
                new[]
                {
                    Workspace(0, new int?[] { 1, 3 }),
                    Workspace(1, new int?[] { 2, null }),
                    Workspace(2, new int?[] { 4, 5 }),
                    Workspace(3),
                },
                new[] { Window(1), Window(2, maximized: true), Window(3), Window(4), Window(5) }),
            new[] { Event(1, "window-unmaximized", Fields(("id", 2), ("workspace", 1))) });

        var decisions = Replay.Run(trace, Env());
        Assert.Equal("unmaximizeWindow", decisions[0].Event);
        Assert.Equal(2, Field(decisions[0], "window")!.GetValue<int>());
        Assert.Equal(0, Field(decisions[0], "workspace")!.GetValue<int>());
        Assert.Equal(new[] { 2 }, Field(decisions[0], "minimize")!.AsArray().Select(n => n!.GetValue<int>()));
        Assert.Equal("unmaximize-parks-left", Field(decisions[0], "note")!.GetValue<string>());
        Assert.Equal(new[] { 1 }, Field(decisions[1], "reap")!.AsArray().Select(n => n!.GetValue<int>()));
        Assert.Equal(0, Field(decisions[1], "view")!.GetValue<int>());
    }

    private static readonly Trace DeterminismTrace = Trace(
        Initial(0, new[] { Workspace(0, new int?[] { 1, null }), Workspace(1) }, new[] { Window(1, maximized: true) }),
        new[]
        {
            Event(1, "window-opened", Fields(("id", 2), ("workspace", 0))),
            Event(2, "window-opened", Fields(("id", 3), ("workspace", 0))),
            Event(3, "window-opened", Fields(("id", 4), ("workspace", 0))),
            Event(4, "window-closed", Fields(("id", 2))),
            Event(5, "window-unmaximized", Fields(("id", 4), ("workspace", 1))),
            Event(6, "layout"),
        });

    [Fact]
    public void ReplaysARecordedTraceToIdenticalDecisions()
    {
        var recorded = Trace(DeterminismTrace.Initial, DeterminismTrace.Events, Replay.Run(DeterminismTrace, Env()));
        Assert.True(Replay.SameDecisions(Replay.Run(recorded, Env()), recorded.Decisions ?? Array.Empty<TraceEntry>()));
    }

    [Fact]
    public void ReplaysTheSameTraceTwiceToTheSameDecisions()
    {
        Assert.True(Replay.SameDecisions(Replay.Run(DeterminismTrace, Env()), Replay.Run(DeterminismTrace, Env())));
    }

    [Fact]
    public void IgnoresTimingATraceDifferingOnlyInItsAtFieldsAndOrderReplaysTheSame()
    {
        var reversed = DeterminismTrace.Events
            .Reverse()
            .Select((entry, index) => entry with { At = 9_000_000 - index * 7 })
            .ToList();
        var retimed = Trace(DeterminismTrace.Initial, reversed);
        Assert.True(Replay.SameDecisions(Replay.Run(DeterminismTrace, Env()), Replay.Run(retimed, Env())));
    }

    [Fact]
    public void SameDecisionsDistinguishesRunsOnDifferentScreenClasses()
    {
        var trace = Trace(
            Initial(0, new[] { Workspace(0, new int?[] { 1, null }), Workspace(1) }, new[] { Window(1, maximized: true) }),
            new[]
            {
                Event(1, "window-opened", Fields(("id", 2), ("workspace", 0))),
                Event(2, "window-opened", Fields(("id", 3), ("workspace", 0))),
            });
        Assert.False(Replay.SameDecisions(Replay.Run(trace, Env(ScreenClass.Dynamic)), Replay.Run(trace, Env(ScreenClass.Single))));
    }

    [Fact]
    public void SameDecisionsTreatsOnlyTheAtFieldAsInsignificant()
    {
        var baseEvent = Event(1, "window-opened", Fields(("id", 2), ("workspace", 0)));
        var a = new[] { baseEvent };
        var retimed = new[] { baseEvent with { At = baseEvent.At + 12345 } };
        Assert.True(Replay.SameDecisions(a, retimed));
        var changed = new[] { baseEvent with { Fields = Fields(("id", 2), ("workspace", 0), ("slot", 0)) } };
        Assert.False(Replay.SameDecisions(a, changed));
    }
}
