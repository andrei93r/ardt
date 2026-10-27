// Port of tests/core/topology.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class TopologyTests
{
    private static TopologyScreen Screen(int index, double x, double y, double width, double height) => new()
    {
        Index = index,
        Geometry = H.Rect(x, y, width, height),
    };

    private static IReadOnlyList<TopologyScreen> MovedAndScaled(
        IReadOnlyList<TopologyScreen> screens, double dx, double dy, double scale) =>
        screens.Select(s => new TopologyScreen
        {
            Index = s.Index,
            Geometry = new Rect(
                s.Geometry.X * scale + dx,
                s.Geometry.Y * scale + dy,
                s.Geometry.Width * scale,
                s.Geometry.Height * scale),
        }).ToList();

    [Fact]
    public void OrientationOfIsPortraitOnlyWhenTheScreenIsTallerThanWide()
    {
        Assert.Equal(Orientation.L, Topology.OrientationOf(Screen(0, 0, 0, 1920, 1080)));
        Assert.Equal(Orientation.P, Topology.OrientationOf(Screen(0, 0, 0, 1080, 1920)));
        Assert.Equal(Orientation.L, Topology.OrientationOf(Screen(0, 0, 0, 1000, 1000)));
    }

    [Fact]
    public void ScreenRelationReadsARowAColumnADiagonalAndAnOverlap()
    {
        var a = Screen(0, 0, 0, 1280, 800);
        Assert.Equal(ScreenRelation.R, Topology.ScreenRelation(a, Screen(1, 1280, 0, 1280, 800)));
        Assert.Equal(ScreenRelation.L, Topology.ScreenRelation(a, Screen(1, -1280, 0, 1280, 800)));
        Assert.Equal(ScreenRelation.D, Topology.ScreenRelation(a, Screen(1, 0, 800, 1280, 800)));
        Assert.Equal(ScreenRelation.U, Topology.ScreenRelation(a, Screen(1, 0, -800, 1280, 800)));
        Assert.Equal(ScreenRelation.X, Topology.ScreenRelation(a, Screen(1, 1280, 800, 1280, 800)));
        Assert.Equal(ScreenRelation.O, Topology.ScreenRelation(a, Screen(1, 100, 100, 1280, 800)));
    }

    [Fact]
    public void TopologySignatureNamesTheCountAndEachScreenOrientation()
    {
        Assert.Equal("1:L:", Topology.TopologySignature(new[] { Screen(0, 0, 0, 1920, 1080) }));
        Assert.Equal("1:P:", Topology.TopologySignature(new[] { Screen(0, 0, 0, 1080, 1920) }));
        Assert.Equal(
            "2:LP:01R",
            Topology.TopologySignature(new[]
            {
                Screen(0, 0, 0, 1920, 1080),
                Screen(1, 1920, 0, 1080, 1920),
            }));
    }

    [Fact]
    public void TopologySignatureIsIndependentOfAbsoluteResolutionAndOrigin()
    {
        var baseScreens = new[]
        {
            Screen(0, 0, 0, 1280, 800),
            Screen(1, 1280, 0, 800, 1280),
            Screen(2, 0, 800, 1280, 800),
        };
        var expected = Topology.TopologySignature(baseScreens);
        Assert.Equal(expected, Topology.TopologySignature(MovedAndScaled(baseScreens, 4096, -512, 3)));
        Assert.Equal(expected, Topology.TopologySignature(MovedAndScaled(baseScreens, -2000, 9000, 1)));
    }

    [Fact]
    public void TopologySignatureDoesNotDependOnTheOrderTheScreensAreGivenIn()
    {
        var baseScreens = new[]
        {
            Screen(0, 0, 0, 1280, 800),
            Screen(1, 1280, 0, 800, 1280),
            Screen(2, 0, 800, 1280, 800),
        };
        var shuffled = new[] { baseScreens[2], baseScreens[0], baseScreens[1] };
        Assert.Equal(Topology.TopologySignature(baseScreens), Topology.TopologySignature(shuffled));
    }

    [Fact]
    public void TopologySignatureDistinguishesARowFromAColumnFromADiagonal()
    {
        var row = Topology.TopologySignature(new[] { Screen(0, 0, 0, 1280, 800), Screen(1, 1280, 0, 1280, 800) });
        var column = Topology.TopologySignature(new[] { Screen(0, 0, 0, 1280, 800), Screen(1, 0, 800, 1280, 800) });
        var diagonal = Topology.TopologySignature(new[] { Screen(0, 0, 0, 1280, 800), Screen(1, 1280, 800, 1280, 800) });
        Assert.Equal("2:LL:01R", row);
        Assert.Equal("2:LL:01D", column);
        Assert.Equal("2:LL:01X", diagonal);
        Assert.Equal(3, new HashSet<string> { row, column, diagonal }.Count);
    }

    [Fact]
    public void TopologySignatureExposesTheCountAndOrientationsItEncodes()
    {
        Assert.Equal(3, Topology.SignatureCount("3:LLP:01R,02D,12X"));
        Assert.Equal("LLP", Topology.SignatureOrientations("3:LLP:01R,02D,12X"));
    }

    [Fact]
    public void TheCanonicalCombinationsCoverOneToFourScreens()
    {
        var counts = Topology.TopologyCombinations.Select(c => c.Screens).Distinct().OrderBy(n => n).ToList();
        Assert.Equal(new[] { 1, 2, 3, 4 }, counts);
        Assert.True(Topology.TopologyCombinations.Count >= 16);
    }

    [Fact]
    public void TheCanonicalCombinationsHaveUniqueIdsAndUniqueSignatures()
    {
        var ids = Topology.TopologyCombinations.Select(c => c.Id).ToList();
        var signatures = Topology.TopologyCombinations.Select(c => c.Signature).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.Equal(signatures.Count, signatures.Distinct().Count());
    }

    [Fact]
    public void TheCanonicalCombinationsAgreeWithTheirOwnDeclaredSignatureAndOrientationString()
    {
        foreach (var combo in Topology.TopologyCombinations)
        {
            Assert.Equal(combo.Screens, combo.Orientations.Length);
            Assert.Equal(combo.Screens, combo.Monitors.Split(':').Length);
            Assert.Equal(Topology.CombinationSignature(combo.Orientations, combo.Arrangement), combo.Signature);
            Assert.Equal(
                Topology.TopologySignature(Topology.ComboScreens(combo.Orientations, combo.Arrangement)),
                combo.Signature);
            Assert.Equal(combo.Orientations, Topology.SignatureOrientations(combo.Signature));
            Assert.Equal(combo.Screens, Topology.SignatureCount(combo.Signature));
        }
    }

    [Fact]
    public void TheCanonicalCombinationsCoverEveryArrangementThatMatters()
    {
        bool Has(Arrangement arrangement, int screens) =>
            Topology.TopologyCombinations.Any(c => c.Arrangement == arrangement && c.Screens == screens);
        Assert.True(Has(Arrangement.Single, 1));
        Assert.True(Has(Arrangement.Row, 2));
        Assert.True(Has(Arrangement.Column, 2));
        Assert.True(Has(Arrangement.Row, 3));
        Assert.True(Has(Arrangement.Column, 3));
        Assert.True(Has(Arrangement.L, 3));
        Assert.True(Has(Arrangement.Row, 4));
        Assert.True(Has(Arrangement.Column, 4));
        Assert.True(Has(Arrangement.Grid, 4));
    }

    [Fact]
    public void ArrangementCellsLaysOutEachArrangementIntoTheCellsItNames()
    {
        Assert.Equal(new[] { (0, 0), (1, 0), (2, 0) }, Topology.ArrangementCells(Arrangement.Row, 3));
        Assert.Equal(new[] { (0, 0), (0, 1), (0, 2) }, Topology.ArrangementCells(Arrangement.Column, 3));
        Assert.Equal(new[] { (0, 0), (1, 0), (0, 1) }, Topology.ArrangementCells(Arrangement.L, 3));
        Assert.Equal(new[] { (0, 0), (1, 0), (0, 1), (1, 1) }, Topology.ArrangementCells(Arrangement.Grid, 4));
    }

    [Fact]
    public void ArrangementCellsSpellsAFewCombinationsExactly()
    {
        var byId = Topology.TopologyCombinations.ToDictionary(c => c.Id, c => c.Signature);
        Assert.Equal("1:L:", byId["1l"]);
        Assert.Equal("1:P:", byId["1p"]);
        Assert.Equal("2:LP:01R", byId["2lp-row"]);
        Assert.Equal("2:LP:01D", byId["2lp-col"]);
        Assert.Equal("3:LLP:01R,02D,12X", byId["3llp-l"]);
        Assert.Equal("3:LLP:01D,02D,12D", byId["3llp-col"]);
        Assert.Equal("4:LLPP:01R,02D,03X,12X,13D,23R", byId["4llpp-grid"]);
    }
}
