// Port of tests/core/config.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class ConfigTests
{
    private const string V3 = """
        {
          "format": "adrt.config",
          "version": 3,
          "exportedAt": "2026-01-01T00:00:00.000Z",
          "settings": { "gaps-base": 8, "gesture-enabled": true },
          "tracked": {
            "adaptations": { "firefox": { "appId": "firefox", "firstSeen": 1, "lastSeen": 2, "observations": 3 } },
            "behavior": { "classes": { "firefox": { "float": false } }, "misc": true }
          }
        }
        """;

    private const string V2 = """
        {
          "format": "adrt.config",
          "version": 2,
          "exportedAt": "2025-01-01T00:00:00.000Z",
          "settings": { "gaps-base": 4 },
          "adaptations": { "code": { "appId": "code", "firstSeen": 1, "lastSeen": 1, "observations": 2 } },
          "behavior": { "floats": { "pavucontrol": true } }
        }
        """;

    private static Dictionary<string, object?> D(params (string Key, object? Value)[] entries)
    {
        var dict = new Dictionary<string, object?>();
        foreach (var (key, value) in entries) dict[key] = value;
        return dict;
    }

    [Fact]
    public void ParsesAV3Bundle()
    {
        var (bundle, errors) = Config.ParseBundle(V3);
        Assert.Empty(errors);
        Assert.Equal(3, bundle?.Version);
        Assert.Equal(3, bundle?.Tracked.Adaptations["firefox"].Observations);
    }

    [Fact]
    public void NormalizesV2TopLevelAdaptationsAndBehavior()
    {
        var (bundle, errors) = Config.ParseBundle(V2);
        Assert.Empty(errors);
        Assert.Equal("code", bundle?.Tracked.Adaptations["code"].AppId);
        Assert.Equal(
            H.Json(D(("floats", D(("pavucontrol", true))))),
            H.Json(bundle!.Tracked.Behavior));
    }

    [Fact]
    public void RejectsMalformedJson()
    {
        var (bundle, errors) = Config.ParseBundle("nope");
        Assert.Null(bundle);
        Assert.Contains("not valid JSON", errors[0]);
    }

    [Fact]
    public void RejectsAWrongFormatMarker()
    {
        var errors = new List<string>();
        Assert.Null(Config.NormalizeBundle(System.Text.Json.Nodes.JsonNode.Parse("{\"format\":\"other\"}"), errors));
        Assert.Contains("format", errors[0]);
    }

    [Fact]
    public void DropsUnsupportedSettingValues()
    {
        var json = V3.Replace(
            "\"settings\": { \"gaps-base\": 8, \"gesture-enabled\": true }",
            "\"settings\": { \"good\": 1, \"bad\": { \"a\": 1 } }");
        var (bundle, errors) = Config.ParseBundle(json);
        Assert.Contains(errors, error => error.Contains("bad"));
        Assert.Single(bundle!.Settings);
        Assert.Equal(1.0, Convert.ToDouble(bundle.Settings["good"], System.Globalization.CultureInfo.InvariantCulture));
    }

    [Fact]
    public void RoundTripsThroughSerializeBundle()
    {
        var (bundle, _) = Config.ParseBundle(V3);
        var (roundTripped, _) = Config.ParseBundle(Config.SerializeBundle(bundle!));
        Assert.Equal(H.Json(bundle), H.Json(roundTripped));
    }

    private static readonly Dictionary<string, object?> MergeBase = D(
        ("classes", D(("a", D(("float", false))))),
        ("floats", D(("pavucontrol", true))),
        ("misc", 1.0));

    [Fact]
    public void MergeRecordsDeepensOnlyClassesAndFloatsInMergeMode()
    {
        var merged = Config.MergeRecords(
            MergeBase,
            D(("classes", D(("b", D(("float", true))))), ("misc", 2.0)),
            ImportMode.Merge);
        Assert.Equal(
            H.Json(D(("a", D(("float", false))), ("b", D(("float", true))))),
            H.Json(merged.Record["classes"]));
        Assert.Equal(
            H.Json(D(("pavucontrol", true))),
            H.Json(merged.Record["floats"]));
        Assert.Equal(2.0, merged.Record["misc"]);
    }

    [Fact]
    public void MergeRecordsReplacesWholesaleInReplaceMode()
    {
        var merged = Config.MergeRecords(
            MergeBase,
            D(("classes", D(("b", D())))),
            ImportMode.Replace);
        Assert.Equal(
            H.Json(D(("classes", D(("b", D()))))),
            H.Json(merged.Record));
        Assert.Contains("classes", merged.Report.Applied);
        Assert.Contains("misc", merged.Report.Skipped);
    }

    [Fact]
    public void MergeRecordsReportsSkippedBaseKeysInMergeMode()
    {
        var merged = Config.MergeRecords(MergeBase, D(("misc", 2.0)), ImportMode.Merge);
        Assert.Equal(new[] { "misc" }, merged.Report.Applied);
        Assert.Contains("classes", merged.Report.Skipped);
    }

    private static Dictionary<string, AdaptationRecord> Adaptations(
        double lastSeen, double observations, bool? skipAnimation = null) => new()
        {
            ["firefox"] = new AdaptationRecord
            {
                AppId = "firefox",
                FirstSeen = 1,
                LastSeen = lastSeen,
                Observations = observations,
                SkipAnimation = skipAnimation,
            },
        };

    [Fact]
    public void MergeAdaptationsMergesPerAppFieldsOneLevelDeep()
    {
        var merged = Config.MergeAdaptations(
            Adaptations(1, 1),
            Adaptations(5, 4, skipAnimation: true),
            ImportMode.Merge);
        Assert.Equal(4, merged.Record["firefox"].Observations);
        Assert.True(merged.Record["firefox"].SkipAnimation);
    }

    [Fact]
    public void MergeAdaptationsReplacesInReplaceMode()
    {
        var merged = Config.MergeAdaptations(
            Adaptations(1, 1),
            new Dictionary<string, AdaptationRecord>(),
            ImportMode.Replace);
        Assert.Empty(merged.Record);
    }

    [Fact]
    public void MergeBundlesAppliesSettingsAndTracksReports()
    {
        var a = Config.ParseBundle(V3).Bundle!;
        var b = Config.ParseBundle(
            V3.Replace(
                "\"settings\": { \"gaps-base\": 8, \"gesture-enabled\": true }",
                "\"settings\": { \"gaps-base\": 16 }")).Bundle!;
        var result = Config.MergeBundles(a, b, ImportMode.Merge);
        Assert.Equal(16.0, Convert.ToDouble(result.Bundle.Settings["gaps-base"], System.Globalization.CultureInfo.InvariantCulture));
        Assert.Contains("gaps-base", result.Settings.Applied);
    }

    private static string WithRegistry(string appId) => V3.Replace(
        "\"behavior\": { \"classes\": { \"firefox\": { \"float\": false } }, \"misc\": true }",
        $"\"behavior\": {{ \"classes\": {{ \"firefox\": {{ \"float\": false }} }}, \"misc\": true }}, \"registry\": {{ \"version\": 1, \"entries\": [{{ \"appId\": \"{appId}\" }}] }}");

    [Fact]
    public void MergeBundlesCarriesTheRegistryThroughAMergeTheIncomingOneWinning()
    {
        var @base = Config.ParseBundle(WithRegistry("base")).Bundle!;
        var incoming = Config.ParseBundle(WithRegistry("incoming")).Bundle!;
        var result = Config.MergeBundles(@base, incoming, ImportMode.Merge);
        Assert.Equal(
            H.Json(new BundleRegistry { Version = 1, Entries = new object?[] { D(("appId", "incoming")) } }),
            H.Json(result.Bundle.Tracked.Registry));
    }

    [Fact]
    public void MergeBundlesKeepsTheBaseRegistryWhenTheIncomingBundleHasNone()
    {
        var @base = Config.ParseBundle(WithRegistry("base")).Bundle!;
        var incoming = Config.ParseBundle(V3).Bundle!;
        var result = Config.MergeBundles(@base, incoming, ImportMode.Merge);
        Assert.Equal(
            H.Json(new BundleRegistry { Version = 1, Entries = new object?[] { D(("appId", "base")) } }),
            H.Json(result.Bundle.Tracked.Registry));
    }
}
