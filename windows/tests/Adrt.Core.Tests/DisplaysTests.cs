// Port of tests/core/displays.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class DisplaysTests
{
    private static readonly Screen Primary = H.Screen(
        index: 0, connector: "eDP-1", isPrimary: true, geometry: H.Rect(0, 0, 1920, 1080));
    private static readonly Screen Right = H.Screen(
        index: 1, connector: "DP-1", isPrimary: false, geometry: H.Rect(1920, 0, 1920, 1080));
    private static readonly Screen Left = H.Screen(
        index: 1, connector: "DP-1", isPrimary: false, geometry: H.Rect(-1920, 0, 1920, 1080));
    private static readonly Screen Above = H.Screen(
        index: 1, connector: "DP-1", isPrimary: false, geometry: H.Rect(0, -1080, 1920, 1080));
    private static readonly Screen Below = H.Screen(
        index: 1, connector: "DP-1", isPrimary: false, geometry: H.Rect(0, 1080, 1920, 1080));

    private static DisplayWindow Win(
        int id, bool? maximized = null, bool? fullscreen = null, Rect? rect = null, int? z = null) => new()
        {
            Id = id,
            Maximized = maximized,
            Fullscreen = fullscreen,
            Rect = rect,
            Z = z,
        };

    private static DisplayWorkspace Ws(
        int id,
        int onScreen,
        DisplayWindow?[]? slots = null,
        DisplayWindow[]? minimized = null,
        DisplayWindow[]? floats = null) => new()
        {
            Id = id,
            Screen = onScreen,
            Slots = slots ?? new DisplayWindow?[] { null, null },
            Minimized = minimized ?? Array.Empty<DisplayWindow>(),
            Floats = floats ?? Array.Empty<DisplayWindow>(),
        };

    private static DisplayState State(Screen[] screens, DisplayWorkspace[] workspaces, int viewed) => new()
    {
        Screens = screens,
        Workspaces = workspaces,
        Viewed = viewed,
    };

    private static RememberedWindow Remembered(
        int id,
        int workspace = 0,
        int? slot = null,
        bool minimized = false,
        bool floating = false,
        bool maximized = false,
        bool fullscreen = false,
        Rect? rect = null,
        int? z = null) => new()
        {
            Id = id,
            Workspace = workspace,
            Slot = slot,
            Minimized = minimized,
            Floating = floating,
            Maximized = maximized,
            Fullscreen = fullscreen,
            Rect = rect ?? H.Rect(0, 0, 0, 0),
            Z = z,
        };

    private static MemoryEntry Entry(string connector, double at, IReadOnlyList<RememberedWindow> windows) => new()
    {
        Connector = connector,
        At = at,
        Windows = windows,
    };

    private static DisplayEnv NoTtl(double now = 1000, double ttlMs = 30 * 60 * 1000) => new()
    {
        Now = now,
        TtlMs = ttlMs,
    };

    [Fact]
    public void HoldsWindowsAndVisibleCountCountVisibleMinimizedAndFloatingWindows()
    {
        Assert.False(Displays.HoldsWindows(Ws(1, 0)));
        Assert.True(Displays.HoldsWindows(Ws(1, 0, new DisplayWindow?[] { Win(1), null })));
        Assert.True(Displays.HoldsWindows(Ws(1, 0, null, new[] { Win(1) })));
        Assert.True(Displays.HoldsWindows(Ws(1, 0, null, null, new[] { Win(1) })));
        Assert.Equal(2, Displays.VisibleCount(Ws(1, 0, new DisplayWindow?[] { Win(1), Win(2) }, new[] { Win(3) })));
        Assert.Equal(0, Displays.VisibleCount(Ws(1, 0, null, new[] { Win(3) })));
    }

    [Fact]
    public void ARescueScreenToTheRightRescuesToTheRight()
    {
        Assert.Equal(
            new RescueSideResult(DisplaySide.Right, false),
            Displays.RescueSide(Right, Primary, new[] { Primary, Right }));
    }

    [Fact]
    public void ARescueScreenToTheLeftRescuesToTheLeft()
    {
        Assert.Equal(
            new RescueSideResult(DisplaySide.Left, false),
            Displays.RescueSide(Left, Primary, new[] { Primary, Left }));
    }

    [Fact]
    public void ARescueScreenAboveIsTreatedAsLeft()
    {
        Assert.Equal(DisplaySide.Left, Displays.RescueSide(Above, Primary, new[] { Primary, Above }).Side);
    }

    [Fact]
    public void ARescueScreenBelowIsTreatedAsLeft()
    {
        Assert.Equal(DisplaySide.Left, Displays.RescueSide(Below, Primary, new[] { Primary, Below }).Side);
    }

    [Fact]
    public void RescueGoesLeftmostWhenOtherScreensWereAlreadyToTheLeft()
    {
        var far = H.Screen(index: 2, connector: "HDMI-1", isPrimary: false, geometry: H.Rect(-3840, 0, 1920, 1080));
        var near = H.Screen(index: 1, connector: "DP-1", isPrimary: false, geometry: H.Rect(-1920, 0, 1920, 1080));
        Assert.Equal(
            new RescueSideResult(DisplaySide.Left, true),
            Displays.RescueSide(far, Primary, new[] { Primary, near, far }));
    }

    [Fact]
    public void DisconnectMovesAVanishedPairToOneFreshWorkspaceAdjacentRightViewUnchanged()
    {
        var prev = State(
            new[] { Primary, Right },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                Ws(11, 0),
                Ws(20, 1, new DisplayWindow?[] { Win(2), Win(3) }),
            },
            10);
        var next = State(
            new[] { Primary },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(11, 0) },
            10);

        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());

        var expectedMoves = new[]
        {
            new DisplayMove
            {
                Id = 2,
                Create = new NewWorkspace { Key = -1, Anchor = 10, Side = DisplaySide.Right, Screen = 0 },
                Slot = 0,
            },
            new DisplayMove
            {
                Id = 3,
                Create = new NewWorkspace { Key = -1, Anchor = 10, Side = DisplaySide.Right, Screen = 0 },
                Slot = 1,
            },
        };
        Assert.Equal(H.Json(expectedMoves), H.Json(plan.Moves));
        var expectedRemember = new[]
        {
            Entry("DP-1", 1000, new[]
            {
                Remembered(2, workspace: 0, slot: 0),
                Remembered(3, workspace: 0, slot: 1),
            }),
        };
        Assert.Equal(H.Json(expectedRemember), H.Json(plan.Remember));
        Assert.Empty(plan.Forget);
    }

    [Fact]
    public void DisconnectCreatesExactlyTwoFreshWorkspacesForAPairPlusASingleKeepingTheOrder()
    {
        var prev = State(
            new[] { Primary, Right },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                Ws(20, 1, new DisplayWindow?[] { Win(2), Win(3) }),
                Ws(21, 1, new DisplayWindow?[] { Win(4), null }),
            },
            10);
        var next = State(
            new[] { Primary },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(11, 0) },
            10);

        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());

        Assert.Equal(
            new[] { (2, -1), (3, -1), (4, -2) },
            plan.Moves.Select(move => (move.Id, move.Create?.Key ?? 0)));
        var single = plan.Moves[2];
        Assert.Equal(4, single.Id);
        Assert.Equal(0, single.Slot);
        Assert.True(single.Maximize);
        Assert.All(plan.Moves, move => Assert.Equal(DisplaySide.Right, move.Create?.Side));
    }

    [Fact]
    public void DisconnectRescuesToTheLeftWhenTheVanishedScreenSatOnTheLeft()
    {
        var prev = State(
            new[] { Primary, Left },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                Ws(20, 1, new DisplayWindow?[] { Win(2), Win(3) }),
            },
            10);
        var next = State(
            new[] { Primary },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(11, 0) },
            10);

        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());

        Assert.All(plan.Moves, move => Assert.Equal(DisplaySide.Left, move.Create?.Side));
        Assert.All(plan.Moves, move => Assert.True(move.Create?.Leftmost != true));
    }

    [Fact]
    public void DisconnectTreatsAboveAndBelowAsLeft()
    {
        foreach (var geometry in new[] { Above, Below })
        {
            var prev = State(
                new[] { Primary, geometry },
                new[]
                {
                    Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                    Ws(20, 1, new DisplayWindow?[] { Win(2), Win(3) }),
                },
                10);
            var next = State(
                new[] { Primary },
                new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(11, 0) },
                10);
            var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());
            Assert.All(plan.Moves, move => Assert.Equal(DisplaySide.Left, move.Create?.Side));
        }
    }

    [Fact]
    public void DisconnectInsertsLeftmostWhenOtherScreensWereAlreadyToTheLeft()
    {
        var far = H.Screen(index: 2, connector: "HDMI-1", isPrimary: false, geometry: H.Rect(-3840, 0, 1920, 1080));
        var near = H.Screen(index: 1, connector: "DP-1", isPrimary: false, geometry: H.Rect(-1920, 0, 1920, 1080));
        var prev = State(
            new[] { Primary, near, far },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                Ws(20, 2, new DisplayWindow?[] { Win(2), Win(3) }),
            },
            10);
        var next = State(
            new[] { Primary, near },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(11, 0), Ws(30, 1) },
            10);

        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());

        Assert.Equal(2, plan.Moves.Count);
        Assert.Equal(DisplaySide.Left, plan.Moves[0].Create?.Side);
        Assert.True(plan.Moves[0].Create?.Leftmost);
    }

    [Fact]
    public void DisconnectGivesTwoVanishedScreensDistinctCreatedWorkspaceKeys()
    {
        var second = H.Screen(index: 2, connector: "HDMI-1", isPrimary: false, geometry: H.Rect(3840, 0, 1920, 1080));
        var prev = State(
            new[] { Primary, Right, second },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                Ws(20, 1, new DisplayWindow?[] { Win(2), null }),
                Ws(30, 2, new DisplayWindow?[] { Win(3), null }),
            },
            10);
        var next = State(
            new[] { Primary },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(11, 0) },
            10);

        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());

        Assert.Equal(new int?[] { -1, -2 }, plan.Moves.Select(move => move.Create?.Key));
        Assert.Equal(new[] { "DP-1", "HDMI-1" }, plan.Remember.Select(record => record.Connector));
    }

    [Fact]
    public void DisconnectNeverScavengesAFreeSlotOnAWorkspaceThatWasNotTheVanishedScreens()
    {
        var prev = State(
            new[] { Primary, Right },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                Ws(20, 1, new DisplayWindow?[] { Win(2), Win(3) }),
            },
            10);
        var next = State(
            new[] { Primary },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(11, 0) },
            10);

        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());

        Assert.Equal(2, plan.Moves.Count);
        Assert.All(plan.Moves, move =>
        {
            Assert.NotNull(move.Create);
            Assert.Null(move.Workspace);
        });
    }

    [Fact]
    public void DisconnectPreservesMinimizedFloatsAndFullscreenAndRecordsThemInMemory()
    {
        var prev = State(
            new[] { Primary, Right },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                Ws(20, 1, new DisplayWindow?[] { Win(2, fullscreen: true), null }, new[] { Win(3) },
                    new[] { Win(4, rect: H.Rect(10, 20, 300, 200)) }),
            },
            10);
        var next = State(
            new[] { Primary },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(11, 0) },
            10);

        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());

        var expectedMoves = new[]
        {
            new DisplayMove
            {
                Id = 2,
                Create = new NewWorkspace { Key = -1, Anchor = 10, Side = DisplaySide.Right, Screen = 0 },
                Slot = 0,
                Maximize = true,
                Fullscreen = true,
            },
            new DisplayMove
            {
                Id = 3,
                Create = new NewWorkspace { Key = -1, Anchor = 10, Side = DisplaySide.Right, Screen = 0 },
                Minimize = true,
            },
            new DisplayMove
            {
                Id = 4,
                Create = new NewWorkspace { Key = -1, Anchor = 10, Side = DisplaySide.Right, Screen = 0 },
                Float = true,
                Rect = H.Rect(10, 20, 300, 200),
            },
        };
        Assert.Equal(H.Json(expectedMoves), H.Json(plan.Moves));
        var expectedWindows = new[]
        {
            Remembered(2, workspace: 0, slot: 0, maximized: false, fullscreen: true),
            Remembered(3, workspace: 0, minimized: true),
            Remembered(4, workspace: 0, floating: true, rect: H.Rect(10, 20, 300, 200)),
        };
        Assert.Equal(H.Json(expectedWindows), H.Json(plan.Remember[0].Windows));
    }

    [Fact]
    public void DisconnectCarriesARescuedFloatFrameAndStackingIntoThePlanAndMemory()
    {
        var prev = State(
            new[] { Primary, Right },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                Ws(20, 1, null, null, new[] { Win(4, rect: H.Rect(10, 20, 300, 200), z: 5) }),
            },
            10);
        var next = State(
            new[] { Primary },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(11, 0) },
            10);

        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());

        var expectedMoves = new[]
        {
            new DisplayMove
            {
                Id = 4,
                Create = new NewWorkspace { Key = -1, Anchor = 10, Side = DisplaySide.Right, Screen = 0 },
                Float = true,
                Rect = H.Rect(10, 20, 300, 200),
                Z = 5,
            },
        };
        Assert.Equal(H.Json(expectedMoves), H.Json(plan.Moves));
        var expectedWindows = new[]
        {
            Remembered(4, workspace: 0, floating: true, rect: H.Rect(10, 20, 300, 200), z: 5),
        };
        Assert.Equal(H.Json(expectedWindows), H.Json(plan.Remember[0].Windows));
    }

    [Fact]
    public void DisconnectDoesNotRerouteARescuedWindowASurvivingScreenAlreadyDisplays()
    {
        var prev = State(
            new[] { Primary, Right },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                Ws(20, 1, new DisplayWindow?[] { Win(2), Win(3) }),
            },
            10);
        var next = State(
            new[] { Primary },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(2), null }), Ws(11, 0) },
            10);

        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());

        Assert.Equal(new[] { 3 }, plan.Moves.Select(move => move.Id));
        Assert.Equal(new[] { 2, 3 }, plan.Remember[0].Windows.Select(window => window.Id));
    }

    [Fact]
    public void DisconnectRescuesToTheNewPrimaryWhenTheVanishedScreenWasThePrimary()
    {
        var prev = State(
            new[] { Primary, Right },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                Ws(20, 1, new DisplayWindow?[] { Win(2), Win(3) }),
            },
            10);
        var newPrimary = H.Screen(
            index: 0, connector: "DP-1", isPrimary: true, geometry: H.Rect(1920, 0, 1920, 1080));
        var next = State(
            new[] { newPrimary },
            new[] { Ws(20, 0, new DisplayWindow?[] { Win(2), Win(3) }), Ws(21, 0) },
            20);

        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());

        Assert.All(plan.Moves, move => Assert.Equal(0, move.Create?.Screen));
        Assert.All(plan.Moves, move => Assert.Equal(DisplaySide.Left, move.Create?.Side));
    }

    [Fact]
    public void DisconnectDoesNotCreateWorkspacesWhenThePrimaryCannot()
    {
        var prev = State(
            new[] { Primary, Right },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                Ws(20, 1, new DisplayWindow?[] { Win(2), Win(3) }),
            },
            10);
        var next = State(
            new[] { Primary },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(11, 0) },
            10);

        var env = NoTtl();
        env = env with { Classes = new Dictionary<string, ScreenClass> { ["eDP-1"] = ScreenClass.Single } };
        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), env);

        Assert.Empty(plan.Moves);
        Assert.Equal("DP-1", plan.Remember[0].Connector);
    }

    // ---- reconnect ----

    private static readonly DisplayState ReconnectPrev =
        State(new[] { Primary }, new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }) }, 10);

    private static readonly DisplayState ReconnectNext =
        State(
            new[] { Primary, Right },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(20, 1) },
            10);

    private static DisplayEnv Env(double now, double ttlMs, params int[] alive) => new()
    {
        Now = now,
        TtlMs = ttlMs,
        Alive = alive,
    };

    [Fact]
    public void ReconnectPutsRememberedWindowsBackIntoTheirSlotsMinimizedFloatingAndFullscreen()
    {
        var memory = new[]
        {
            Entry("DP-1", 0, new[]
            {
                Remembered(2, slot: 0),
                Remembered(3, slot: 1, fullscreen: true),
                Remembered(4, minimized: true),
                Remembered(5, floating: true, rect: H.Rect(100, 100, 400, 300)),
            }),
        };

        var plan = Displays.DisplayPlan(ReconnectPrev, ReconnectNext, memory, Env(500, 30 * 60 * 1000, 2, 3, 4, 5));

        var expectedMoves = new[]
        {
            new DisplayMove { Id = 2, Workspace = 20, Screen = 1, Slot = 0 },
            new DisplayMove { Id = 3, Workspace = 20, Screen = 1, Slot = 1, Fullscreen = true },
            new DisplayMove { Id = 4, Workspace = 20, Screen = 1, Minimize = true },
            new DisplayMove
            {
                Id = 5,
                Workspace = 20,
                Screen = 1,
                Float = true,
                Rect = H.Rect(100, 100, 400, 300),
            },
        };
        Assert.Equal(H.Json(expectedMoves), H.Json(plan.Moves));
        Assert.DoesNotContain(plan.Moves, move => move.Create is not null);
        Assert.Equal(H.Json(new[] { Entry("DP-1", 500, memory[0].Windows) }), H.Json(plan.Remember));
    }

    [Fact]
    public void ReconnectLeavesAWindowOpenedWhileTheScreenWasAwayExactlyWhereItIs()
    {
        var withNewcomer = State(
            new[] { Primary, Right },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(9), null }), Ws(20, 1) },
            10);
        var memory = new[] { Entry("DP-1", 0, new[] { Remembered(2, slot: 0) }) };

        var plan = Displays.DisplayPlan(ReconnectPrev, withNewcomer, memory, Env(500, 30 * 60 * 1000, 2, 9));

        Assert.Equal(new[] { 2 }, plan.Moves.Select(move => move.Id));
        Assert.DoesNotContain(plan.Moves, move => move.Id == 9);
    }

    [Fact]
    public void ReconnectReplaysPartiallyWhenTheRememberedSlotHasSinceBeenTaken()
    {
        var taken = State(
            new[] { Primary, Right },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(20, 1, new DisplayWindow?[] { Win(9), null }) },
            10);
        var memory = new[] { Entry("DP-1", 0, new[] { Remembered(2, slot: 0) }) };

        var plan = Displays.DisplayPlan(ReconnectPrev, taken, memory, Env(500, 30 * 60 * 1000, 2, 9));

        Assert.Empty(plan.Moves);
        Assert.Equal(new[] { 2 }, plan.Remember[0].Windows.Select(window => window.Id));
    }

    [Fact]
    public void ReconnectDropsWindowsThatNoLongerExistFromMemory()
    {
        var memory = new[] { Entry("DP-1", 0, new[] { Remembered(2, slot: 0), Remembered(7, slot: 1) }) };

        var plan = Displays.DisplayPlan(ReconnectPrev, ReconnectNext, memory, Env(500, 30 * 60 * 1000, 2));

        Assert.Equal(new[] { 2 }, plan.Moves.Select(move => move.Id));
        Assert.Equal(new[] { 2 }, plan.Remember[0].Windows.Select(window => window.Id));
    }

    [Fact]
    public void ReconnectNeverCreatesBeyondTheMemory()
    {
        var memory = new[] { Entry("DP-1", 0, new[] { Remembered(2, workspace: 1, slot: 0) }) };

        var plan = Displays.DisplayPlan(ReconnectPrev, ReconnectNext, memory, Env(500, 30 * 60 * 1000, 2));

        Assert.Empty(plan.Moves);
    }

    [Fact]
    public void ReconnectReplaysAFloatToItsExactFrameAndStackingOnTheReconnectedScreen()
    {
        var memory = new[]
        {
            Entry("DP-1", 0, new[] { Remembered(5, floating: true, rect: H.Rect(100, 100, 400, 300), z: 7) }),
        };

        var plan = Displays.DisplayPlan(ReconnectPrev, ReconnectNext, memory, Env(500, 30 * 60 * 1000, 5));

        var expectedMoves = new[]
        {
            new DisplayMove
            {
                Id = 5,
                Workspace = 20,
                Screen = 1,
                Float = true,
                Rect = H.Rect(100, 100, 400, 300),
                Z = 7,
            },
        };
        Assert.Equal(H.Json(expectedMoves), H.Json(plan.Moves));
    }

    // ---- memory TTL ----

    private static readonly DisplayState TtlPrev =
        State(new[] { Primary }, new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }) }, 10);

    private static readonly MemoryEntry[] TtlMemory =
    {
        Entry("DP-1", 0, new[] { Remembered(2, slot: 0) }),
    };

    [Fact]
    public void MemoryTtlForgetsAConnectorWhoseMemoryHasExpired()
    {
        var plan = Displays.DisplayPlan(TtlPrev, TtlPrev, TtlMemory, Env(10_000, 1000));
        Assert.Equal(new[] { "DP-1" }, plan.Forget);
        Assert.Empty(plan.Moves);
    }

    [Fact]
    public void MemoryTtlKeepsAConnectorWhoseMemoryIsStillFresh()
    {
        var plan = Displays.DisplayPlan(TtlPrev, TtlPrev, TtlMemory, Env(500, 1000));
        Assert.Empty(plan.Forget);
    }

    [Fact]
    public void MemoryTtlDoesNotReplayOrKeepAnExpiredReconnect()
    {
        var plan = Displays.DisplayPlan(TtlPrev, ReconnectNext, TtlMemory, Env(10_000, 1000, 2));
        Assert.Empty(plan.Moves);
        Assert.Equal(new[] { "DP-1" }, plan.Forget);
    }

    [Fact]
    public void MemoryTtlNeverForgetsAConnectorItIsRememberingInTheSamePass()
    {
        var vanished = State(
            new[] { Primary, Right },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), null }),
                Ws(20, 1, new DisplayWindow?[] { Win(2), Win(3) }),
            },
            10);
        var after = State(
            new[] { Primary },
            new[] { Ws(10, 0, new DisplayWindow?[] { Win(1), null }), Ws(11, 0) },
            10);
        var stale = new[] { Entry("DP-1", 0, Array.Empty<RememberedWindow>()) };

        var plan = Displays.DisplayPlan(vanished, after, stale, Env(10_000, 1000));
        Assert.Empty(plan.Forget);
        Assert.Equal("DP-1", plan.Remember[0].Connector);
    }

    // ---- primary change ----

    [Fact]
    public void PrimaryChangeMovesNoWindowBetweenScreensTheExtraWindowBecomesAFloat()
    {
        var prev = State(
            new[] { Primary, Right },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), Win(2) }),
                Ws(11, 0, new DisplayWindow?[] { Win(3), null }),
                Ws(20, 1, new DisplayWindow?[] { Win(4), null }),
            },
            10);
        var next = State(
            new[]
            {
                H.Screen(
                    index: 0,
                    connector: Primary.Connector,
                    isPrimary: false,
                    geometry: Primary.Geometry),
                H.Screen(
                    index: 1,
                    connector: Right.Connector,
                    isPrimary: true,
                    geometry: Right.Geometry),
            },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), Win(2) }),
                Ws(11, 0, new DisplayWindow?[] { Win(3), null }),
                Ws(20, 1, new DisplayWindow?[] { Win(4), null }),
            },
            10);

        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());

        Assert.Equal(H.Json(new[] { new DisplayMove { Id = 3, Workspace = 10, Float = true } }), H.Json(plan.Moves));
        Assert.DoesNotContain(plan.Moves, move => move.Id is 1 or 2 or 4);
    }

    [Fact]
    public void PrimaryChangeMovesNothingWhenTheOldPrimaryHadOnlyItsSurvivingWorkspace()
    {
        var prev = State(
            new[] { Primary, Right },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), Win(2) }),
                Ws(20, 1, new DisplayWindow?[] { Win(4), null }),
            },
            10);
        var next = State(
            new[]
            {
                H.Screen(
                    index: 0,
                    connector: Primary.Connector,
                    isPrimary: false,
                    geometry: Primary.Geometry),
                H.Screen(
                    index: 1,
                    connector: Right.Connector,
                    isPrimary: true,
                    geometry: Right.Geometry),
            },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), Win(2) }),
                Ws(20, 1, new DisplayWindow?[] { Win(4), null }),
            },
            10);

        var plan = Displays.DisplayPlan(prev, next, Array.Empty<MemoryEntry>(), NoTtl());

        Assert.Empty(plan.Moves);
    }

    [Fact]
    public void AnUnchangedPrimaryProducesNoPlan()
    {
        var prev = State(
            new[] { Primary, Right },
            new[]
            {
                Ws(10, 0, new DisplayWindow?[] { Win(1), Win(2) }),
                Ws(20, 1, new DisplayWindow?[] { Win(4), null }),
            },
            10);
        var plan = Displays.DisplayPlan(prev, prev, Array.Empty<MemoryEntry>(), NoTtl());
        Assert.Empty(plan.Moves);
        Assert.Empty(plan.Remember);
        Assert.Empty(plan.Forget);
    }
}
