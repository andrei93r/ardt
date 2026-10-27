// Port of tests/core/classify.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class ClassifyTests
{
    private static ClassifyConfig Config(
        IReadOnlyList<string>? exceptionApps = null,
        IReadOnlyList<Rule>? rules = null,
        bool heuristicModalDetect = false) => new()
        {
            ExceptionApps = exceptionApps ?? Array.Empty<string>(),
            Rules = rules ?? Array.Empty<Rule>(),
            HeuristicModalDetect = heuristicModalDetect,
        };

    private static Rule Rule(string? appId, TileMode tile, string? title = null)
    {
        return new Rule
        {
            Match = new RuleMatch { AppId = appId, Title = title },
            Tile = tile,
        };
    }

    private static Classification Classify(Surface surface, ClassifyConfig? config = null) =>
        Adrt.Core.Classify.ClassifySurface(surface, config ?? Config());

    [Fact]
    public void MapsAPlainNormalWindowToTiled()
    {
        Assert.Equal(Layer.Tiled, Adrt.Core.Classify.LayerFor(H.Surface()));
    }

    [Fact]
    public void TreatsTransientModalAndAttachedDialogsAsModal()
    {
        Assert.Equal(Layer.Modal, Adrt.Core.Classify.LayerFor(H.Surface(flags: new SurfaceFlags { Transient = true })));
        Assert.Equal(Layer.Modal, Adrt.Core.Classify.LayerFor(H.Surface(flags: new SurfaceFlags { Modal = true })));
        Assert.Equal(Layer.Modal, Adrt.Core.Classify.LayerFor(H.Surface(flags: new SurfaceFlags { AttachedDialog = true })));
        Assert.Equal(Layer.Modal, Adrt.Core.Classify.LayerFor(H.Surface(kind: SurfaceKind.Dialog)));
        Assert.Equal(Layer.Modal, Adrt.Core.Classify.LayerFor(H.Surface(kind: SurfaceKind.Modal)));
    }

    [Fact]
    public void TreatsAboveAndFloatingAsFloating()
    {
        Assert.Equal(Layer.Floating, Adrt.Core.Classify.LayerFor(H.Surface(flags: new SurfaceFlags { Above = true })));
        Assert.Equal(Layer.Floating, Adrt.Core.Classify.LayerFor(H.Surface(flags: new SurfaceFlags { Floating = true })));
    }

    [Fact]
    public void NeverTilesAWindowThatCarriesTheAboveFlag()
    {
        var verdict = Classify(H.Surface(flags: new SurfaceFlags { Above = true }));
        Assert.False(verdict.Tileable);
        Assert.Equal(SkipReason.Above, verdict.Reason);
    }

    [Fact]
    public void TreatsSkipTaskbarChromeAsBackground()
    {
        Assert.Equal(Layer.Background, Adrt.Core.Classify.LayerFor(H.Surface(kind: SurfaceKind.Skip)));
    }

    [Fact]
    public void GivesModalPrecedenceOverFloating()
    {
        Assert.Equal(
            Layer.Modal,
            Adrt.Core.Classify.LayerFor(H.Surface(flags: new SurfaceFlags { Modal = true, Above = true })));
    }

    [Fact]
    public void AcceptsAHealthyNormalWindow()
    {
        var result = Classify(H.Surface());
        Assert.True(result.Tileable);
        Assert.Null(result.Reason);
        Assert.Equal(Layer.Tiled, result.Layer);
    }

    public static TheoryData<SkipReason, Surface> RejectCases => new()
    {
        { SkipReason.SkipTaskbar, H.Surface(flags: new SurfaceFlags { SkipTaskbar = true }) },
        { SkipReason.OverrideRedirect, H.Surface(flags: new SurfaceFlags { OverrideRedirect = true }) },
        { SkipReason.OnAllWorkspaces, H.Surface(flags: new SurfaceFlags { Sticky = true }) },
        { SkipReason.Fullscreen, H.Surface(flags: new SurfaceFlags { Fullscreen = true }) },
        { SkipReason.Floating, H.Surface(flags: new SurfaceFlags { Floating = true }) },
        { SkipReason.NonTileableKind, H.Surface(kind: SurfaceKind.Dialog) },
        { SkipReason.MinEqualsMax, H.Surface(min: H.Size(500, 100), max: H.Size(500, 10000)) },
        { SkipReason.Transient, H.Surface(flags: new SurfaceFlags { Transient = true }) },
        { SkipReason.Modal, H.Surface(flags: new SurfaceFlags { Modal = true }) },
        { SkipReason.AttachedDialog, H.Surface(flags: new SurfaceFlags { AttachedDialog = true }) },
    };

    [Theory]
    [MemberData(nameof(RejectCases))]
    public void RejectsWithReason(SkipReason reason, Surface input)
    {
        var result = Classify(input);
        Assert.False(result.Tileable);
        Assert.Equal(reason, result.Reason);
    }

    [Fact]
    public void TilesAWindowWhoseOnAllWorkspacesFlagComesFromItsMonitor()
    {
        var result = Classify(H.Surface(flags: new SurfaceFlags { OnAllWorkspaces = true }));
        Assert.True(result.Tileable);
        Assert.Null(result.Reason);
        Assert.Equal(Layer.Tiled, result.Layer);
    }

    [Fact]
    public void RejectsAppsMatchedByTheExceptionList()
    {
        var result = Classify(H.Surface(appId: "org.gnome.Nautilus"), Config(exceptionApps: new[] { "org.gnome.*" }));
        Assert.False(result.Tileable);
        Assert.Equal(SkipReason.ExceptionApp, result.Reason);
    }

    [Fact]
    public void FloatsAWindowMatchedByAFloatRule()
    {
        var result = Classify(
            H.Surface(appId: "pavucontrol"),
            Config(rules: new[] { Rule("pavucontrol", TileMode.Float) }));
        Assert.False(result.Tileable);
        Assert.Equal(SkipReason.RuleFloat, result.Reason);
        Assert.Equal(Layer.Floating, result.Layer);
        Assert.False(result.Modal);
    }

    [Theory]
    [InlineData(TileMode.Full)]
    [InlineData(TileMode.LeftHalf)]
    public void DoesNotStopTilingForAPlacementRule(TileMode tile)
    {
        var result = Classify(H.Surface(appId: "special"), Config(rules: new[] { Rule("special", tile) }));
        Assert.True(result.Tileable);
        Assert.Null(result.Reason);
        Assert.Equal(Layer.Tiled, result.Layer);
    }

    [Fact]
    public void IgnoresAnEnabledFloatRuleThatDoesNotMatch()
    {
        var result = Classify(H.Surface(appId: "app"), Config(rules: new[] { Rule("other", TileMode.Float) }));
        Assert.True(result.Tileable);
        Assert.Null(result.Reason);
    }

    [Fact]
    public void MarksTransientModalAndAttachedWindowsAsModals()
    {
        Assert.True(Classify(H.Surface(flags: new SurfaceFlags { Transient = true })).Modal);
        Assert.True(Classify(H.Surface(flags: new SurfaceFlags { Modal = true })).Modal);
        Assert.True(Classify(H.Surface(flags: new SurfaceFlags { AttachedDialog = true })).Modal);
        Assert.False(Classify(H.Surface(flags: new SurfaceFlags { SkipTaskbar = true })).Modal);
    }

    [Fact]
    public void GivesTheActiveWindowHighlightToATileAndToAModalOnly()
    {
        Assert.True(Adrt.Core.Classify.GetsActiveHighlight(Classify(H.Surface())));
        Assert.True(Adrt.Core.Classify.GetsActiveHighlight(Classify(H.Surface(flags: new SurfaceFlags { Transient = true }))));
        Assert.False(Adrt.Core.Classify.GetsActiveHighlight(Classify(H.Surface(flags: new SurfaceFlags { SkipTaskbar = true }))));
        Assert.False(Adrt.Core.Classify.GetsActiveHighlight(Classify(H.Surface(flags: new SurfaceFlags { Above = true }))));
        Assert.False(Adrt.Core.Classify.GetsActiveHighlight(Classify(H.Surface(flags: new SurfaceFlags { Floating = true }))));
    }

    [Fact]
    public void ActsOnAMatchingFloatRuleButLeavesANonMatchingOneAlone()
    {
        var floatRules = new[] { Rule("pavucontrol", TileMode.Float) };
        Assert.Equal(SkipReason.RuleFloat, Classify(H.Surface(appId: "pavucontrol"), Config(rules: floatRules)).Reason);
        Assert.True(Classify(H.Surface(appId: "something-else"), Config(rules: floatRules)).Tileable);
    }

    [Fact]
    public void DetectsAHeuristicModalWhenTheParentTitleIsLive()
    {
        var child = H.Surface(title: "Save As — Text Editor");
        Assert.True(Adrt.Core.Classify.HeuristicModal(child, new[] { "Text Editor" }));
        var result = Adrt.Core.Classify.ClassifySurface(
            child,
            Config(heuristicModalDetect: true),
            new HeuristicContext { LiveTitles = new[] { "Text Editor" } });
        Assert.False(result.Tileable);
        Assert.Equal(SkipReason.HeuristicModal, result.Reason);
        Assert.Equal(Layer.Modal, result.Layer);
    }

    [Fact]
    public void AcceptsATitleWithADashSuffixThatIsNotALiveWindow()
    {
        var child = H.Surface(title: "Save As — Text Editor");
        Assert.False(Adrt.Core.Classify.HeuristicModal(child, new[] { "Something Else" }));
        Assert.True(Adrt.Core.Classify.ClassifySurface(
            child,
            Config(heuristicModalDetect: true),
            new HeuristicContext { LiveTitles = new[] { "Something Else" } }).Tileable);
    }

    [Fact]
    public void IgnoresTheHeuristicWhenDisabled()
    {
        var child = H.Surface(title: "Save As — Text Editor");
        Assert.True(Adrt.Core.Classify.ClassifySurface(
            child,
            Config(),
            new HeuristicContext { LiveTitles = new[] { "Text Editor" } }).Tileable);
    }

    [Fact]
    public void PlacesAnIgnoredWindowInTheFloatingLayer()
    {
        Assert.Equal(
            Layer.Floating,
            Classify(H.Surface(appId: "x", flags: new SurfaceFlags { SkipTaskbar = true })).Layer);
    }

    [Fact]
    public void ExposesFrameAndMinSizesButDoesNotNeedThemForAPlainReject()
    {
        var input = H.Surface(min: H.Size(200, 200), frame: H.Rect(10, 10, 100, 100));
        Assert.True(Classify(input).Tileable);
    }
}
