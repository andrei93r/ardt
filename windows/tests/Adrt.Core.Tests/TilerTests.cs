// Port of tests/core/tiler.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class TilerTests
{
    private static TilerConfig Config(
        double gapBase = 0,
        double gapPortrait = -1,
        double gapLandscape = -1,
        MinSizePolicy minSizePolicy = MinSizePolicy.Respect,
        IReadOnlyList<string>? primaryApps = null,
        double primaryAppRatio = 0.5,
        IReadOnlyDictionary<string, double>? ratios = null,
        HashSet<string>? swapPairs = null,
        IReadOnlyList<Rule>? rules = null,
        SplitAxis? workspaceAxis = null,
        bool? reflowKeepsEdges = null,
        double? gapLeft = null,
        double? gapRight = null,
        double? gapTop = null,
        double? gapBottom = null,
        double? gapBetween = null) => new()
        {
            GapBase = gapBase,
            GapPortrait = gapPortrait,
            GapLandscape = gapLandscape,
            MinSizePolicy = minSizePolicy,
            PrimaryApps = primaryApps ?? Array.Empty<string>(),
            PrimaryAppRatio = primaryAppRatio,
            Ratios = ratios ?? new Dictionary<string, double>(),
            SwapPairs = swapPairs ?? new HashSet<string>(),
            Rules = rules ?? Array.Empty<Rule>(),
            WorkspaceAxis = workspaceAxis,
            ReflowKeepsEdges = reflowKeepsEdges,
            GapLeft = gapLeft,
            GapRight = gapRight,
            GapTop = gapTop,
            GapBottom = gapBottom,
            GapBetween = gapBetween,
        };

    private static readonly Screen Landscape = H.Screen(geometry: H.Rect(0, 0, 1920, 1080));
    private static readonly Screen Portrait = H.Screen(geometry: H.Rect(0, 0, 1080, 1920));

    private static Rule Rule(string appId, TileMode tile, bool? enabled = null) => new()
    {
        Match = new RuleMatch { AppId = appId },
        Tile = tile,
        Enabled = enabled,
    };

    private static Rect RectOf(TilePlan plan, int id) => plan.Placements.First(p => p.SurfaceId == id).Rect;

    private static IReadOnlyList<InvariantViolation> Check(TilePlan plan, double width, double height) =>
        Invariants.CheckPlan(plan, new Bounds { Width = width, Height = height });

    private static void AssertDictEqual(IReadOnlyDictionary<string, double> expected, IReadOnlyDictionary<string, double> actual)
    {
        Assert.Equal(expected.Count, actual.Count);
        foreach (var (key, value) in expected)
        {
            Assert.True(actual.TryGetValue(key, out var got), $"missing key {key}");
            Assert.Equal(value, got);
        }
    }

    // ---- computePlans — work area ----

    [Fact]
    public void TilesInsideTheWorkAreaLeavingTheTopBarAlone()
    {
        var withPanel = H.Screen(
            geometry: H.Rect(0, 0, 1920, 1080),
            workArea: H.Rect(0, 32, 1920, 1048));
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") },
            withPanel,
            Config(gapBase: 8, gapLeft: 8, gapRight: 8, gapTop: 8, gapBottom: 8));
        Assert.Empty(Check(plan, 1920, 1080));
        foreach (var placement in plan.Placements)
        {
            Assert.Equal(40, placement.Rect.Y);
            Assert.Equal(1048 - 16, placement.Rect.Height);
        }
    }

    [Fact]
    public void LeavesADocksRightEdgeAlone()
    {
        var withDock = H.Screen(
            geometry: H.Rect(0, 0, 1920, 1080),
            workArea: H.Rect(0, 0, 1840, 1080));
        var plan = Tiler.ComputePlans(new[] { H.Window(id: 1) }, withDock, Config(gapBase: 0));
        Assert.Equal(H.Rect(0, 0, 1840, 1080), plan.Placements[0].Rect);
    }

    // ---- computePlans — single window ----

    [Fact]
    public void FillsTheWholeMonitorByDefaultOuterGapsAreZero()
    {
        var plan = Tiler.ComputePlans(new[] { H.Window(id: 1) }, Landscape, Config(gapBase: 10));
        Assert.Single(plan.Placements);
        Assert.Equal(H.Rect(0, 0, 1920, 1080), plan.Placements[0].Rect);
    }

    [Fact]
    public void AppliesExplicitPerSideOuterGaps()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1) },
            Landscape,
            Config(gapBase: 0, gapLeft: 20, gapRight: 5, gapTop: 10, gapBottom: 3));
        Assert.Equal(H.Rect(20, 10, 1895, 1067), plan.Placements[0].Rect);
    }

    [Fact]
    public void KeepsTheCurrentRectWhenReflowKeepsEdgesIsOff()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1, rect: H.Rect(640, 0, 640, 1080)) },
            Landscape,
            Config(gapBase: 10, reflowKeepsEdges: false));
        Assert.Equal(H.Rect(640, 0, 640, 1080), plan.Placements[0].Rect);
    }

    [Fact]
    public void NeverShrinksBelowTheMinimumSize()
    {
        var plan = Tiler.ComputePlans(new[] { H.Window(id: 1, min: H.Size(2000, 2000)) }, Landscape, Config(gapBase: 10));
        Assert.Equal(1920, plan.Placements[0].Rect.Width);
        Assert.Equal(1080, plan.Placements[0].Rect.Height);
    }

    // ---- computePlans — landscape pair ----

    [Fact]
    public void SplitsSideBySideFlushAtTheEdgesAndGappedAtTheSplit()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") }, Landscape, Config(gapBase: 10));
        Assert.Empty(Check(plan, 1920, 1080));
        var left = plan.Placements[0];
        var right = plan.Placements[1];
        Assert.Equal(0, left.Rect.X);
        Assert.Equal(0, left.Rect.Y);
        Assert.Equal(1080, left.Rect.Height);
        Assert.Equal(left.Rect.X + left.Rect.Width + 10, right.Rect.X);
        Assert.Equal(1920 - 10, left.Rect.Width + right.Rect.Width);
    }

    [Fact]
    public void GivesThePrimaryAppItsConfiguredRatio()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1, appId: "term"), H.Window(id: 2, appId: "browser") },
            Landscape,
            Config(primaryApps: new[] { "term" }, primaryAppRatio: 0.7));
        Assert.Equal(1920 * 0.7, plan.Placements[0].Rect.Width, 1);
    }

    [Fact]
    public void UsesASavedRatioKeyedByTheWorkspacePairAndAxis()
    {
        var key = Tiler.RatioKey(Landscape.Connector, 0, SplitAxis.Horizontal);
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1, appId: "term"), H.Window(id: 2, appId: "browser") },
            Landscape,
            Config(ratios: new Dictionary<string, double> { [key] = 0.25 }));
        Assert.Equal(1920 * 0.25, plan.Placements[1].Rect.Width, 1);
        Assert.Equal(1920 * 0.75, plan.Placements[0].Rect.Width, 1);
    }

    [Fact]
    public void RoundsAFractionalSavedRatioToWholePixelsAtAnIntegerScale()
    {
        var key = Tiler.RatioKey(Landscape.Connector, 0, SplitAxis.Horizontal);
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1, appId: "term"), H.Window(id: 2, appId: "browser") },
            Landscape,
            Config(gapBase: 8, ratios: new Dictionary<string, double> { [key] = 0.2421875 }));
        var a = plan.Placements[0].Rect;
        var b = plan.Placements[1].Rect;
        foreach (var value in new[] { a.X, a.Y, a.Width, a.Height, b.X, b.Y, b.Width, b.Height })
        {
            Assert.Equal(Math.Round(value), value);
        }
        Assert.Equal(a.X + a.Width + 8, b.X);
        Assert.Equal(Landscape.Geometry.Width, b.X + b.Width);
    }

    [Fact]
    public void HonoursThePairSwapFlag()
    {
        var swapped = new HashSet<string> { Tiler.PairKey(1, 2) };
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") }, Landscape, Config(swapPairs: swapped));
        var normal = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") }, Landscape, Config());
        Assert.Equal(RectOf(normal, 2), RectOf(plan, 1));
        Assert.Equal(RectOf(normal, 1), RectOf(plan, 2));
    }

    // ---- computePlans — ratio scope ----

    [Fact]
    public void KeysARatioByTheConnectorWorkspaceAndAxis()
    {
        Assert.Equal("eDP-1:0:horizontal", Tiler.RatioKey("eDP-1", 0, SplitAxis.Horizontal));
        Assert.NotEqual(Tiler.RatioKey("eDP-1", 0, SplitAxis.Horizontal), Tiler.RatioKey("HDMI-1", 0, SplitAxis.Horizontal));
        Assert.NotEqual(Tiler.RatioKey("eDP-1", 0, SplitAxis.Horizontal), Tiler.RatioKey("eDP-1", 1, SplitAxis.Horizontal));
        Assert.NotEqual(Tiler.RatioKey("eDP-1", 0, SplitAxis.Horizontal), Tiler.RatioKey("eDP-1", 0, SplitAxis.Vertical));
    }

    [Fact]
    public void AppliesARatioOnlyToThePairItWasSetIn()
    {
        var key = Tiler.RatioKey(Landscape.Connector, 0, SplitAxis.Horizontal);
        var saved = Config(ratios: new Dictionary<string, double> { [key] = 0.25 });
        var apps = new[] { H.Window(id: 1, appId: "chrome"), H.Window(id: 2, appId: "chrome") };

        double[] Widths(TilerConfig cfg, int workspaceId = 0)
        {
            var windows = apps.Select(w => w with { WorkspaceId = workspaceId }).ToArray();
            var plan = Tiler.ComputePlans(windows, Landscape, cfg);
            return new[] { plan.Placements[0].Rect.Width, plan.Placements[1].Rect.Width };
        }

        Assert.Equal(1920 * 0.25, Widths(saved)[0], 1);
        var other = Widths(saved, workspaceId: 1);
        Assert.Equal(1920 * 0.5, other[0], 1);
        Assert.Equal(1920 * 0.5, other[1], 1);

        var otherScreen = H.Screen(index: 1, connector: "HDMI-1");
        var otherPlacements = Tiler.ComputePlans(apps, otherScreen, saved).Placements;
        Assert.Equal(1920 * 0.5, otherPlacements[0].Rect.Width, 1);
        Assert.Equal(1920 * 0.5, otherPlacements[1].Rect.Width, 1);
    }

    [Fact]
    public void RoundTripsAHyphenatedConnectorThroughKeyAndParse()
    {
        var key = Tiler.RatioKey("eDP-1", 3, SplitAxis.Vertical);
        Assert.Equal("eDP-1:3:vertical", key);
        var parts = Tiler.ParseRatioKey(key);
        Assert.NotNull(parts);
        Assert.Equal("eDP-1", parts!.Connector);
        Assert.Equal(3, parts.WorkspaceId);
        Assert.Equal(SplitAxis.Vertical, parts.Axis);
    }

    [Fact]
    public void ParsesAConnectorKeyAndRejectsALegacyAppPairKey()
    {
        var hyphenated = Tiler.ParseRatioKey("eDP-1:3:vertical");
        Assert.Equal(("eDP-1", 3, SplitAxis.Vertical), (hyphenated!.Connector, hyphenated.WorkspaceId, hyphenated.Axis));
        var numeric = Tiler.ParseRatioKey("0:3:vertical");
        Assert.Equal(("0", 3, SplitAxis.Vertical), (numeric!.Connector, numeric.WorkspaceId, numeric.Axis));
        Assert.Null(Tiler.ParseRatioKey("google-chrome|google-chrome|horizontal"));
        Assert.Null(Tiler.ParseRatioKey(":3:vertical"));
    }

    [Fact]
    public void DropsLegacyAppPairKeysFromPersistedState()
    {
        var ratios = new Dictionary<string, double>
        {
            ["google-chrome|google-chrome|horizontal"] = 0.2390625,
            [Tiler.RatioKey("HDMI-1", 0, SplitAxis.Horizontal)] = 0.3,
        };
        AssertDictEqual(
            new Dictionary<string, double> { [Tiler.RatioKey("HDMI-1", 0, SplitAxis.Horizontal)] = 0.3 },
            Tiler.SanitizeRatios(ratios));
    }

    [Fact]
    public void DropsAReapedWorkspaceRatioAndShiftsTheOnesToItsRight()
    {
        var ratios = new Dictionary<string, double>
        {
            [Tiler.RatioKey("eDP-1", 0, SplitAxis.Horizontal)] = 0.2,
            [Tiler.RatioKey("eDP-1", 1, SplitAxis.Horizontal)] = 0.3,
            [Tiler.RatioKey("eDP-1", 2, SplitAxis.Horizontal)] = 0.4,
            [Tiler.RatioKey("HDMI-1", 2, SplitAxis.Horizontal)] = 0.6,
        };
        AssertDictEqual(
            new Dictionary<string, double>
            {
                [Tiler.RatioKey("eDP-1", 0, SplitAxis.Horizontal)] = 0.2,
                [Tiler.RatioKey("eDP-1", 1, SplitAxis.Horizontal)] = 0.4,
                [Tiler.RatioKey("HDMI-1", 1, SplitAxis.Horizontal)] = 0.6,
            },
            Tiler.RemapRatiosAfterReap(ratios, new[] { 1 }));
    }

    // ---- migrateLegacyRatioKeys ----

    private static readonly Dictionary<int, string> ConnectorByIndex = new()
    {
        [0] = "eDP-1",
        [1] = "HDMI-1",
    };

    [Fact]
    public void MigrateLegacyRatioKeysMapsALegacyNumericKeyToTheLiveConnectorAtThatIndex()
    {
        AssertDictEqual(
            new Dictionary<string, double> { ["eDP-1:2:horizontal"] = 0.3 },
            Tiler.MigrateLegacyRatioKeys(
                new Dictionary<string, double> { ["0:2:horizontal"] = 0.3 }, ConnectorByIndex));
    }

    [Fact]
    public void MigrateLegacyRatioKeysDropsALegacyNumericKeyWhoseIndexHasNoLiveScreen()
    {
        Assert.Empty(Tiler.MigrateLegacyRatioKeys(
            new Dictionary<string, double> { ["5:2:horizontal"] = 0.3 }, ConnectorByIndex));
    }

    [Fact]
    public void MigrateLegacyRatioKeysLeavesAlreadyConnectorKeysUntouched()
    {
        var ratios = new Dictionary<string, double>
        {
            ["eDP-1:2:horizontal"] = 0.3,
            ["HDMI-1:0:vertical"] = 0.4,
        };
        AssertDictEqual(ratios, Tiler.MigrateLegacyRatioKeys(ratios, ConnectorByIndex));
    }

    [Fact]
    public void MigrateLegacyRatioKeysKeepsALegacyAppPairKeyForTheSanitizePassToDrop()
    {
        var migrated = Tiler.MigrateLegacyRatioKeys(
            new Dictionary<string, double> { ["google-chrome|google-chrome|horizontal"] = 0.2 },
            ConnectorByIndex);
        AssertDictEqual(
            new Dictionary<string, double> { ["google-chrome|google-chrome|horizontal"] = 0.2 },
            migrated);
        Assert.Empty(Tiler.SanitizeRatios(migrated));
    }

    // ---- computePlans — portrait pair ----

    [Fact]
    public void StacksVertically()
    {
        var plan = Tiler.ComputePlans(new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") }, Portrait, Config());
        Assert.Empty(Check(plan, 1080, 1920));
        Assert.True(plan.Placements[1].Rect.Y > plan.Placements[0].Rect.Y);
        Assert.Equal(1080, plan.Placements[0].Rect.Width);
    }

    // ---- computePlans — minimum-size policies ----

    private static readonly Screen Cramped = H.Screen(geometry: H.Rect(0, 0, 400, 300));

    [Fact]
    public void FallsBackToTheOtherAxisUnderRespect()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1, min: H.Size(300, 100)), H.Window(id: 2, appId: "b", min: H.Size(300, 100)) },
            Cramped,
            Config(minSizePolicy: MinSizePolicy.Respect));
        Assert.Equal(400, plan.Placements[0].Rect.Width);
        Assert.Equal(plan.Placements[0].Rect.Height, plan.Placements[1].Rect.Y);
    }

    [Fact]
    public void StacksBothWindowsAtMinimumSizeWhenThatFits()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1, min: H.Size(150, 100)), H.Window(id: 2, appId: "b", min: H.Size(150, 100)) },
            Cramped,
            Config(minSizePolicy: MinSizePolicy.Stack));
        Assert.Empty(Check(plan, 400, 300));
        Assert.Equal(150, plan.Placements[0].Rect.Width);
        Assert.Equal(400 - 150, plan.Placements[1].Rect.X);
    }

    [Fact]
    public void StaysNonOverlappingWhenNeitherMinimumFits()
    {
        var big = H.Size(300, 200);
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1, min: big), H.Window(id: 2, appId: "b", min: big) },
            Cramped,
            Config());
        Assert.Empty(Check(plan, 400, 300));
    }

    [Fact]
    public void IgnoresMinimumsUnderTheIgnorePolicy()
    {
        var big = H.Size(300, 200);
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1, min: big), H.Window(id: 2, appId: "b", min: big) },
            Cramped,
            Config(minSizePolicy: MinSizePolicy.Ignore));
        Assert.Empty(Check(plan, 400, 300));
        Assert.Equal(200, plan.Placements[0].Rect.Width);
    }

    // ---- computePlans — rule override ----

    [Fact]
    public void GivesTheMatchingWindowTheLeftHalf()
    {
        var rules = new[] { Rule("special", TileMode.LeftHalf) };
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "special") }, Landscape, Config(rules: rules));
        Assert.Equal(0, RectOf(plan, 2).X);
        Assert.Equal(960, RectOf(plan, 1).X);
    }

    [Fact]
    public void GivesTheMatchingWindowTheFullMonitor()
    {
        var rules = new[] { Rule("special", TileMode.Full) };
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "special") }, Landscape, Config(rules: rules));
        Assert.Single(plan.Placements);
        Assert.Equal(2, plan.Placements[0].SurfaceId);
        Assert.Equal(H.Rect(0, 0, 1920, 1080), plan.Placements[0].Rect);
    }

    [Fact]
    public void NeverTurnsAFloatRuleIntoAPlacement()
    {
        var rules = new[] { Rule("special", TileMode.Float) };
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "special") }, Landscape, Config(rules: rules));
        Assert.Equal(2, plan.Placements.Count);
        Assert.Equal(960, RectOf(plan, 2).Width);
    }

    [Fact]
    public void DoesNotLetAFloatRuleMaskAPlacementRuleOnTheOtherWindow()
    {
        var rules = new[] { Rule("floater", TileMode.Float), Rule("special", TileMode.Full) };
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1, appId: "floater"), H.Window(id: 2, appId: "special") },
            Landscape,
            Config(rules: rules));
        Assert.Single(plan.Placements);
        Assert.Equal(2, plan.Placements[0].SurfaceId);
        Assert.Equal(H.Rect(0, 0, 1920, 1080), plan.Placements[0].Rect);
    }

    [Fact]
    public void PicksTheLowestIdWindowWhenSeveralMatch()
    {
        var rules = new[] { Rule("special", TileMode.RightHalf) };
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 5, appId: "special"), H.Window(id: 2, appId: "special") },
            Landscape,
            Config(rules: rules));
        Assert.Equal(960, RectOf(plan, 2).X);
    }

    [Fact]
    public void IgnoresADisabledRuleAndFallsBackToTheNormalPair()
    {
        var rules = new[] { Rule("special", TileMode.Full, enabled: false) };
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "special") }, Landscape, Config(rules: rules));
        Assert.Equal(2, plan.Placements.Count);
        Assert.Equal(960, RectOf(plan, 2).Width);
    }

    // ---- computePlans — rule override axis ----

    private static readonly Rule[] LeftHalf = { Rule("special", TileMode.LeftHalf) };
    private static readonly Rule[] RightHalf = { Rule("special", TileMode.RightHalf) };
    private static readonly TilerWindow[] Pair = { H.Window(id: 1), H.Window(id: 2, appId: "special") };

    [Fact]
    public void PutsALeftHalfMatchOnTopOfAPortraitScreen()
    {
        var plan = Tiler.ComputePlans(Pair, Portrait, Config(rules: LeftHalf));
        Assert.Equal(H.Rect(0, 0, 1080, 960), RectOf(plan, 2));
        Assert.Equal(H.Rect(0, 960, 1080, 960), RectOf(plan, 1));
    }

    [Fact]
    public void PutsARightHalfMatchAtTheBottomOfAPortraitScreen()
    {
        var plan = Tiler.ComputePlans(Pair, Portrait, Config(rules: RightHalf));
        Assert.Equal(H.Rect(0, 960, 1080, 960), RectOf(plan, 2));
        Assert.Equal(H.Rect(0, 0, 1080, 960), RectOf(plan, 1));
    }

    [Fact]
    public void FollowsAnExplicitVerticalWorkspaceAxisOnALandscapeScreen()
    {
        var plan = Tiler.ComputePlans(Pair, Landscape, Config(rules: LeftHalf, workspaceAxis: SplitAxis.Vertical));
        Assert.Equal(H.Rect(0, 0, 1920, 540), RectOf(plan, 2));
        Assert.Equal(H.Rect(0, 540, 1920, 540), RectOf(plan, 1));
    }

    [Fact]
    public void LetsAnExplicitHorizontalWorkspaceAxisWinOverAPortraitShapedScreen()
    {
        var plan = Tiler.ComputePlans(Pair, Portrait, Config(rules: LeftHalf, workspaceAxis: SplitAxis.Horizontal));
        Assert.Equal(H.Rect(0, 0, 540, 1920), RectOf(plan, 2));
        Assert.Equal(H.Rect(540, 0, 540, 1920), RectOf(plan, 1));
    }

    [Fact]
    public void KeepsLeftRightHalvesOnALandscapeScreen()
    {
        var left = Tiler.ComputePlans(Pair, Landscape, Config(rules: LeftHalf));
        Assert.Equal(H.Rect(0, 0, 960, 1080), RectOf(left, 2));
        var right = Tiler.ComputePlans(Pair, Landscape, Config(rules: RightHalf));
        Assert.Equal(H.Rect(960, 0, 960, 1080), RectOf(right, 2));
    }

    // ---- computePlans — scale snapping ----

    [Fact]
    public void SnapsRectsToTheMonitorScaleGrid()
    {
        var scaled = H.Screen(geometry: H.Rect(0, 0, 1920, 1080), scale: 2);
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") },
            scaled,
            Config(minSizePolicy: MinSizePolicy.Ignore));
        foreach (var placement in plan.Placements)
        {
            Assert.Equal(Math.Round(placement.Rect.Width * 2), placement.Rect.Width * 2);
        }
    }

    // ---- layoutAll ----

    [Fact]
    public void LayoutAllGroupsByWorkspaceAndScreen()
    {
        var input = new TilerInput
        {
            Windows = new[]
            {
                H.Window(id: 1, workspaceId: 0, screenId: 0),
                H.Window(id: 2, appId: "b", workspaceId: 0, screenId: 0),
                H.Window(id: 3, appId: "c", workspaceId: 1, screenId: 0),
            },
            Screens = new[] { Landscape },
            Config = Config(),
        };
        var plans = Tiler.LayoutAll(input);
        Assert.Equal(2, plans.Count);
        Assert.Equal(2, plans.First(p => p.WorkspaceId == 0).Plan.Placements.Count);
        Assert.Single(plans.First(p => p.WorkspaceId == 1).Plan.Placements);
    }

    // ---- gaps ----

    [Fact]
    public void GapsDefaultToFlushOuterEdgesAndABaseSizedSplit()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") }, Landscape, Config(gapBase: 8));
        var left = plan.Placements[0];
        var right = plan.Placements[1];
        Assert.Equal(0, left.Rect.X);
        Assert.Equal(0, left.Rect.Y);
        Assert.Equal(1080, left.Rect.Height);
        Assert.Equal(8, right.Rect.X - (left.Rect.X + left.Rect.Width));
        Assert.Equal(1920 - 8, left.Rect.Width + right.Rect.Width);
    }

    [Fact]
    public void AppliesPerSideOuterGapsAndTheBetweenWindowGapTogether()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") },
            Landscape,
            Config(gapBase: 0, gapLeft: 20, gapRight: 5, gapTop: 10, gapBottom: 3, gapBetween: 7));
        Assert.Empty(Check(plan, 1920, 1080));
        Assert.Equal(H.Rect(20, 10, 944, 1067), plan.Placements[0].Rect);
        Assert.Equal(H.Rect(971, 10, 944, 1067), plan.Placements[1].Rect);
    }

    [Fact]
    public void InheritsTheBaseForNegativePerSideGapsButKeepsAnExplicitZeroFlush()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1) },
            Portrait,
            Config(gapBase: 12, gapPortrait: -1, gapLeft: -1, gapRight: 0, gapTop: -1, gapBottom: 0));
        Assert.Equal(H.Rect(12, 12, 1068, 1908), plan.Placements[0].Rect);
    }

    [Fact]
    public void ZeroGapsAreExactlyZero()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") },
            Landscape,
            Config(gapBase: 8, gapLeft: 0, gapRight: 0, gapTop: 0, gapBottom: 0, gapBetween: 0));
        Assert.Equal(H.Rect(0, 0, 960, 1080), plan.Placements[0].Rect);
        Assert.Equal(H.Rect(960, 0, 960, 1080), plan.Placements[1].Rect);
        Assert.Equal(plan.Placements[1].Rect.X, plan.Placements[0].Rect.X + plan.Placements[0].Rect.Width);
    }

    [Fact]
    public void ResolvesTheOrientationOverrideIntoTheBaseThatNegativesInherit()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1) },
            Landscape,
            Config(gapBase: 10, gapLandscape: 30, gapLeft: -1, gapRight: -1, gapTop: -1, gapBottom: -1));
        Assert.Equal(H.Rect(30, 30, 1860, 1020), plan.Placements[0].Rect);
    }

    [Fact]
    public void DefaultsTheSplitToTheOrientationResolvedBase()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") },
            Portrait,
            Config(gapBase: 8, gapPortrait: 14));
        var top = plan.Placements[0];
        var bottom = plan.Placements[1];
        Assert.Equal(0, top.Rect.Y);
        Assert.Equal(14, bottom.Rect.Y - (top.Rect.Y + top.Rect.Height));
        Assert.Equal(1920 - 14, top.Rect.Height + bottom.Rect.Height);
    }

    [Fact]
    public void ChangingGapsBetweenMovesOnlyTheSplitNotTheOuterEdges()
    {
        var basePlan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") }, Landscape, Config(gapBase: 8));
        var wider = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") },
            Landscape,
            Config(gapBase: 8, gapBetween: 30));
        var b0 = basePlan.Placements[0];
        var w0 = wider.Placements[0];
        var w1 = wider.Placements[1];
        Assert.Equal(b0.Rect.X, w0.Rect.X);
        Assert.Equal(b0.Rect.Y, w0.Rect.Y);
        Assert.Equal(b0.Rect.Height, w0.Rect.Height);
        Assert.Equal(30, w1.Rect.X - (w0.Rect.X + w0.Rect.Width));
        Assert.Equal(1920 - 30, w0.Rect.Width + w1.Rect.Width);
    }

    [Fact]
    public void AppliesGapsPerScreen()
    {
        var second = H.Screen(index: 1, geometry: H.Rect(0, 0, 1080, 1920));
        var input = new TilerInput
        {
            Windows = new[]
            {
                H.Window(id: 1, workspaceId: 0, screenId: 0),
                H.Window(id: 2, appId: "b", workspaceId: 0, screenId: 1),
            },
            Screens = new[] { Landscape, second },
            Config = Config(
                gapBase: 10,
                gapLandscape: 20,
                gapPortrait: 40,
                gapLeft: -1,
                gapRight: -1,
                gapTop: -1,
                gapBottom: -1),
        };
        var plans = Tiler.LayoutAll(input);
        Rect On(int screenId) => plans.First(p => p.ScreenId == screenId).Plan.Placements[0].Rect;
        Assert.Equal(H.Rect(20, 20, 1880, 1040), On(0));
        Assert.Equal(H.Rect(40, 40, 1000, 1840), On(1));
    }

    [Fact]
    public void ResolveGapsTreatsAnUnsetOuterSideAsZeroANegativeOneAsTheBaseAndUnsetBetweenAsTheBase()
    {
        var first = Tiler.ResolveGaps(Config(gapBase: 8), Landscape);
        Assert.Equal(new Gaps { Left = 0, Right = 0, Top = 0, Bottom = 0, Between = 8 }, first);
        var second = Tiler.ResolveGaps(Config(gapBase: 8, gapLeft: -1, gapBetween: -1), Landscape);
        Assert.Equal(new Gaps { Left = 8, Right = 0, Top = 0, Bottom = 0, Between = 8 }, second);
    }

    // ---- sides follow relative position ----

    [Fact]
    public void KeepsTheWindowThatIsVisuallyOnTheLeftOnTheLeftWhateverTheIds()
    {
        var left = H.Window(id: 2, appId: "b", rect: H.Rect(0, 0, 400, 600));
        var right = H.Window(id: 1, appId: "a", rect: H.Rect(1000, 0, 400, 600));
        var plan = Tiler.ComputePlans(new[] { right, left }, Landscape, Config());
        Placement At(int id) => plan.Placements.First(p => p.SurfaceId == id);
        Assert.True(At(2).Rect.X < At(1).Rect.X);
        Assert.Equal(0, At(2).Order);
        Assert.Equal(1, At(1).Order);
    }

    [Fact]
    public void FallsBackToTheIdWhenTheWindowsOverlapExactly()
    {
        var a = H.Window(id: 1, appId: "a", rect: H.Rect(0, 0, 400, 600));
        var b = H.Window(id: 2, appId: "b", rect: H.Rect(0, 0, 400, 600));
        var plan = Tiler.ComputePlans(new[] { b, a }, Landscape, Config());
        Assert.Equal(0, plan.Placements.First(p => p.SurfaceId == 1).Order);
        Assert.Equal(1, plan.Placements.First(p => p.SurfaceId == 2).Order);
    }

    [Fact]
    public void OrdersAStackedVerticalPairTopToBottomByY()
    {
        var top = H.Window(id: 2, appId: "b", rect: H.Rect(0, 0, 800, 300));
        var bottom = H.Window(id: 1, appId: "a", rect: H.Rect(0, 700, 800, 300));
        var plan = Tiler.ComputePlans(new[] { bottom, top }, Portrait, Config());
        Placement At(int id) => plan.Placements.First(p => p.SurfaceId == id);
        Assert.True(At(2).Rect.Y < At(1).Rect.Y);
    }

    // ---- vertical workspaces ----

    [Fact]
    public void StacksAPairTopBottomOnALandscapeMonitorWhenTheWorkspaceLayoutIsVertical()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") },
            Landscape,
            Config(workspaceAxis: SplitAxis.Vertical));
        var top = RectOf(plan, 1);
        var bottom = RectOf(plan, 2);
        Assert.True(top.Y < bottom.Y);
        Assert.Equal(1920, top.Width);
        Assert.Equal(bottom.Height, top.Height);
    }

    [Fact]
    public void KeepsAHorizontalPairWhenTheWorkspaceLayoutIsHorizontal()
    {
        var plan = Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") },
            Landscape,
            Config(workspaceAxis: SplitAxis.Horizontal));
        Assert.True(RectOf(plan, 1).X < RectOf(plan, 2).X);
    }

    [Fact]
    public void HonoursAnExplicitSlotOverTheGeometricGuess()
    {
        var left = H.Rect(0, 0, 800, 600);
        var plan = Tiler.ComputePlans(
            new[]
            {
                H.Window(id: 1, rect: left, screenId: 0) with { Slot = 1 },
                H.Window(id: 2, appId: "b", rect: left) with { Slot = 0 },
            },
            Landscape,
            Config());
        Assert.True(RectOf(plan, 2).X < RectOf(plan, 1).X);
    }
}
