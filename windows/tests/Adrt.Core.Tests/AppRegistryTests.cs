// Port of tests/core/appregistry.test.ts.
using System.Text.Json;
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class AppRegistryTests
{
    private static Rect R(double x = 0, double y = 0, double width = 960, double height = 1080) =>
        H.Rect(x, y, width, height);

    private static PlacementInput Input(string connector = "eDP-1", double slot = 0, Rect? rect = null) => new()
    {
        Connector = connector,
        Slot = slot,
        Rect = rect ?? R(),
    };

    private static AppEntry Entry(
        string appId = "files",
        double firstSeen = 1,
        double lastSeen = 2,
        double windowsSeen = 1,
        string lastTitle = "",
        bool neverTile = false,
        Dictionary<string, AppPlacement>? placements = null,
        double nextOrdinal = 1) => new()
        {
            AppId = appId,
            FirstSeen = firstSeen,
            LastSeen = lastSeen,
            WindowsSeen = windowsSeen,
            LastTitle = lastTitle,
            NeverTile = neverTile,
            Profile = new AppProfile(),
            Adapt = new AdaptRecord(),
            Placements = placements ?? new Dictionary<string, AppPlacement>(StringComparer.Ordinal),
            NextOrdinal = nextOrdinal,
        };

    private static AdaptationRecord Adaptation(
        string appId = "firefox",
        double firstSeen = 10,
        double lastSeen = 20,
        double observations = 3,
        double? unmaximizeDelayEma = null,
        double? settleTimeEma = null,
        bool? skipAnimation = null,
        double? refusedMinW = null,
        double? refusedMinH = null,
        double? acceptedW = null,
        double? acceptedH = null) => new()
        {
            AppId = appId,
            FirstSeen = firstSeen,
            LastSeen = lastSeen,
            Observations = observations,
            UnmaximizeDelayEma = unmaximizeDelayEma,
            SettleTimeEma = settleTimeEma,
            SkipAnimation = skipAnimation,
            RefusedMinW = refusedMinW,
            RefusedMinH = refusedMinH,
            AcceptedW = acceptedW,
            AcceptedH = acceptedH,
        };

    // ---- observe ----

    [Fact]
    public void ObserveAutoPopulatesOneEntryPerAppAndLogsEveryWindow()
    {
        var registry = new AppRegistry();
        registry.Observe(new AppObservation { AppId = "firefox", Title = "First", Now = 1000 });
        var entry = registry.Observe(new AppObservation { AppId = "firefox", Title = "Second", Now = 2000 });

        Assert.Equal(1, registry.Size);
        Assert.Equal(1000, entry.FirstSeen);
        Assert.Equal(2000, entry.LastSeen);
        Assert.Equal(2, entry.WindowsSeen);
        Assert.Equal("Second", entry.LastTitle);
        Assert.False(entry.NeverTile);
    }

    [Fact]
    public void ObserveClipsAPathologicalTitleAtTheEdgeInsteadOfStoringIt()
    {
        var registry = new AppRegistry();
        var entry = registry.Observe(new AppObservation { AppId = "firefox", Title = new string('x', 5_000_000) });
        Assert.True(entry.LastTitle.Length <= Text.MaxText + 1);
        Assert.EndsWith("…", entry.LastTitle);
        Assert.True(registry.ToJSON().Entries[0].LastTitle.Length <= Text.MaxText + 1);
    }

    [Fact]
    public void DoesNotDoubleNonAsciiTitlesAcrossASaveLoadRoundTrip()
    {
        var registry = new AppRegistry();
        registry.Observe(new AppObservation { AppId = "firefox", Title = "Büro – naïve façade 日本語" });
        var json = JsonSerializer.Serialize(registry.ToJSON());
        var restored = AppRegistry.FromJSON(JsonSerializer.Deserialize<AppRegistryData>(json));
        Assert.Equal("Büro – naïve façade 日本語", restored.Get("firefox")?.LastTitle);
    }

    // ---- neverTile ----

    [Fact]
    public void NeverTileIsADurableBooleanThatCanBeSetAndToggled()
    {
        var registry = new AppRegistry();
        Assert.False(registry.IsNeverTile("pavucontrol"));

        registry.SetNeverTile("pavucontrol", true, 100);
        Assert.True(registry.IsNeverTile("pavucontrol"));
        Assert.False(registry.ToggleNeverTile("pavucontrol"));
    }

    // ---- adapt ----

    [Fact]
    public void AdaptKeepsTimingHintsAndDropsEveryGeometricField()
    {
        var registry = new AppRegistry();
        registry.SetAdapt("chrome", new Dictionary<string, object?>
        {
            ["unmaximizeDelayMs"] = 40.0,
            ["settleMs"] = 120.0,
            ["skipAnimation"] = true,
            ["retries"] = 2.0,
            ["refusedMinW"] = 500.0,
            ["refusedMinH"] = 400.0,
            ["acceptedW"] = 900.0,
            ["acceptedH"] = 700.0,
        });

        var adapt = registry.AdaptFor("chrome");
        Assert.Equal(
            new AdaptRecord { UnmaximizeDelayMs = 40, SettleMs = 120, SkipAnimation = true, Retries = 2 },
            adapt);
    }

    [Fact]
    public void SanitizeAdaptIgnoresNonNumericAndUnknownKeys()
    {
        var sanitized = AppRegistry.SanitizeAdapt(new Dictionary<string, object?>
        {
            ["settleMs"] = "nope",
            ["skipAnimation"] = "yes",
            ["bogus"] = 1.0,
        });
        Assert.Equal(new AdaptRecord(), sanitized);
    }

    // ---- placements and ordinals ----

    [Fact]
    public void AssignsADurablePerAppOrdinalAndKeepsItOnRePlace()
    {
        var registry = new AppRegistry();
        var first = registry.Place("files", "win-a", Input("eDP-1", 0), 1);
        var second = registry.Place("files", "win-b", Input("eDP-1", 1), 2);

        Assert.Equal(1, first.Ordinal);
        Assert.Equal(2, second.Ordinal);

        registry.Place("files", "win-a", Input("HDMI-1", 1), 3);
        Assert.Equal(1, registry.OrdinalFor("files", "win-a"));
        Assert.Equal("HDMI-1", registry.Placement("files", "win-a")?.Connector);
    }

    [Fact]
    public void RollsTheOrdinalForwardAndNeverReusesARetiredOne()
    {
        var registry = new AppRegistry();
        registry.Place("files", "win-a", Input("eDP-1", 0));
        registry.Place("files", "win-b", Input("eDP-1", 1));
        registry.ForgetPlacement("files", "win-b");

        var replacement = registry.Place("files", "win-c", Input("eDP-1", 1));
        Assert.Equal(3, replacement.Ordinal);
    }

    [Fact]
    public void MatchesRecreatedWindowsByOrdinalInOrder()
    {
        var registry = new AppRegistry();
        registry.Place("files", "win-a", Input("eDP-1", 0));
        registry.Place("files", "win-b", Input("eDP-1", 1));

        Assert.Equal("win-b", registry.PlacementByOrdinal("files", 2)?.InstanceId);
        Assert.Equal(new double[] { 1, 2 }, registry.Placements("files").Select(placement => placement.Ordinal));
    }

    [Fact]
    public void CapsPlacementsPerAppKeepingTheNewestOrdinals()
    {
        var registry = new AppRegistry();
        var total = AppRegistry.MaxPlacementsPerApp + 12;
        for (var index = 0; index < total; index += 1)
        {
            registry.Place("files", $"win-{index}", Input("eDP-1", 0), index);
        }
        var placements = registry.Placements("files");
        Assert.Equal(AppRegistry.MaxPlacementsPerApp, placements.Count);
        Assert.Equal(total - AppRegistry.MaxPlacementsPerApp + 1, placements[0].Ordinal);
        Assert.Null(registry.OrdinalFor("files", "win-0"));
    }

    [Fact]
    public void DropsExcessPersistedPlacementsOnLoad()
    {
        var placements = new Dictionary<string, AppPlacement>(StringComparer.Ordinal);
        for (var index = 0; index < AppRegistry.MaxPlacementsPerApp + 5; index += 1)
        {
            placements[$"win-{index}"] = new AppPlacement
            {
                Ordinal = index + 1,
                Connector = "eDP-1",
                Slot = 0,
                Maximized = false,
                Fullscreen = false,
                Rect = R(),
            };
        }
        var restored = AppRegistry.FromJSON(new AppRegistryData
        {
            Version = AppRegistry.RegistryVersion,
            Entries = new[] { Entry(placements: placements, nextOrdinal: 999) },
        });
        Assert.Equal(AppRegistry.MaxPlacementsPerApp, restored.Placements("files").Count);
        Assert.Null(restored.OrdinalFor("files", "win-0"));
        Assert.NotNull(restored.OrdinalFor("files", $"win-{AppRegistry.MaxPlacementsPerApp + 4}"));
    }

    // ---- rekey ----

    [Fact]
    public void RekeyCarriesTheProvisionalEntryOntoTheRealKey()
    {
        var registry = new AppRegistry();
        registry.Observe(new AppObservation { AppId = "window:4", Title = "Firefox", Now = 100 });
        registry.Place("window:4", "win-a", Input("eDP-1", 0), 100);
        registry.SetNeverTile("window:4", true, 100);

        Assert.True(registry.Rekey("window:4", "firefox"));
        Assert.False(registry.Has("window:4"));

        var entry = registry.Get("firefox");
        Assert.Equal("firefox", entry?.AppId);
        Assert.True(entry?.NeverTile);
        Assert.Equal("Firefox", entry?.LastTitle);
        Assert.Null(registry.Get("window:4"));
        Assert.Equal(1, registry.OrdinalFor("firefox", "win-a"));
    }

    [Fact]
    public void RekeyLetsTheRealKeyWinAndUnionsNeverTile()
    {
        var registry = new AppRegistry();
        registry.Observe(new AppObservation { AppId = "window:1", Title = "provisional", Now = 100 });
        registry.SetNeverTile("window:1", true, 100);
        registry.SetAdapt("window:1", new Dictionary<string, object?> { ["settleMs"] = 50.0, ["skipAnimation"] = true }, 100);
        registry.Place("window:1", "old-a", Input("eDP-1", 0), 100);

        registry.Observe(new AppObservation { AppId = "firefox", Title = "real", Now = 200 });
        registry.SetAdapt("firefox", new Dictionary<string, object?> { ["unmaximizeDelayMs"] = 40.0 }, 200);
        registry.Place("firefox", "new-b", Input("HDMI-1", 1), 200);

        Assert.True(registry.Rekey("window:1", "firefox"));
        var entry = registry.Get("firefox")!;
        Assert.True(entry.NeverTile);
        Assert.Equal("real", entry.LastTitle);
        Assert.Equal(50, entry.Adapt.SettleMs);
        Assert.True(entry.Adapt.SkipAnimation);
        Assert.Equal(40, entry.Adapt.UnmaximizeDelayMs);
        Assert.Equal(1, registry.OrdinalFor("firefox", "new-b"));
        Assert.Equal(2, registry.OrdinalFor("firefox", "old-a"));
        Assert.Equal(2, registry.Placements("firefox").Count);
        Assert.Equal(3, registry.Get("firefox")!.NextOrdinal);
    }

    [Fact]
    public void RekeyIsANoOpForAMissingKeyOrAnIdenticalKey()
    {
        var registry = new AppRegistry();
        Assert.False(registry.Rekey("missing", "firefox"));
        registry.Observe(new AppObservation { AppId = "firefox", Now = 1 });
        Assert.False(registry.Rekey("firefox", "firefox"));
    }

    [Fact]
    public void RekeyRenumbersEveryCollidingCarriedOrdinalKeepingThemUnique()
    {
        var registry = new AppRegistry();
        registry.Place("real", "r1", Input("eDP-1", 0));
        registry.Place("real", "r2", Input("eDP-1", 1));
        registry.Place("prov", "p1", Input("HDMI-1", 0));
        registry.Place("prov", "p2", Input("HDMI-1", 1));

        Assert.True(registry.Rekey("prov", "real"));
        var ordinals = registry.Placements("real").Select(placement => placement.Ordinal).ToList();
        Assert.Equal(new double[] { 1, 2, 3, 4 }, ordinals);
        Assert.Equal(4, ordinals.Distinct().Count());
    }

    // ---- migration ----

    [Fact]
    public void MigrationFoldsLegacyAdaptationIntoTimingOnlyHints()
    {
        var registry = new AppRegistry();
        var report = registry.Migrate(
            new LegacyStores
            {
                Adaptation = new LegacyAdaptation
                {
                    Records = new Dictionary<string, AdaptationRecord?>
                    {
                        ["firefox"] = Adaptation(
                            unmaximizeDelayEma: 47.6,
                            settleTimeEma: 130.4,
                            skipAnimation: true,
                            refusedMinW: 400,
                            refusedMinH: 300,
                            acceptedW: 900,
                            acceptedH: 700),
                    },
                },
            },
            1000);

        var entry = registry.Get("firefox")!;
        Assert.Equal(10, entry.FirstSeen);
        Assert.Equal(20, entry.LastSeen);
        Assert.Equal(3, entry.WindowsSeen);
        Assert.Equal(
            new AdaptRecord { UnmaximizeDelayMs = 48, SettleMs = 130, SkipAnimation = true },
            entry.Adapt);
        Assert.Contains("firefox", report.Adapted);
    }

    [Fact]
    public void MigrationMarksBehaviorFloatsAsNeverTile()
    {
        var registry = new AppRegistry();
        var report = registry.Migrate(
            new LegacyStores
            {
                Behavior = new LegacyBehavior { Floats = new[] { "pavucontrol", "org.gnome.Calculator" } },
            },
            1000);

        Assert.True(registry.IsNeverTile("pavucontrol"));
        Assert.True(registry.IsNeverTile("org.gnome.Calculator"));
        Assert.Contains("pavucontrol", report.Floated);
    }

    [Fact]
    public void MigrationTurnsExceptionGlobsIntoNeverTileEntriesNormalised()
    {
        var registry = new AppRegistry();
        registry.Migrate(
            new LegacyStores { ExceptionApps = new[] { "org.gnome.*", "pavucontrol.desktop" } },
            1000);

        Assert.True(registry.IsNeverTile("org.gnome.*"));
        Assert.True(registry.IsNeverTile("pavucontrol"));
    }

    [Fact]
    public void MigrationIsIdempotentAndKeepsTheRecordedWindowCount()
    {
        var registry = new AppRegistry();
        var stores = new LegacyStores
        {
            Adaptation = new LegacyAdaptation
            {
                Records = new Dictionary<string, AdaptationRecord?> { ["firefox"] = Adaptation() },
            },
            Behavior = new LegacyBehavior { Floats = new[] { "firefox" } },
        };
        registry.Migrate(stores, 1000);
        registry.Migrate(stores, 2000);

        var entry = registry.Get("firefox")!;
        Assert.Equal(3, entry.WindowsSeen);
        Assert.True(entry.NeverTile);
        Assert.Equal(1, registry.Size);
    }

    // ---- pruning ----

    [Fact]
    public void PruningDropsStaleEntriesByTtlButKeepsFreshOnes()
    {
        var registry = new AppRegistry(new AppRegistryOptions { TtlMs = 1000 });
        registry.Observe(new AppObservation { AppId = "stale", Now = 0 });
        registry.Observe(new AppObservation { AppId = "fresh", Now = 900 });

        var removed = registry.Prune(1001);
        Assert.Equal(new[] { "stale" }, removed);
        Assert.True(registry.Has("fresh"));
    }

    [Fact]
    public void PruningNeverExpiresADurableNeverTileDecision()
    {
        var registry = new AppRegistry(new AppRegistryOptions { TtlMs = 1000 });
        registry.SetNeverTile("pinned", true, 0);
        registry.Observe(new AppObservation { AppId = "pinned", Now = 0 });

        Assert.Empty(registry.Prune(100000));
        Assert.True(registry.IsNeverTile("pinned"));
    }

    // ---- serialization ----

    [Fact]
    public void RoundTripsEntriesPlacementsAndTheOrdinalCounter()
    {
        var registry = new AppRegistry();
        registry.Observe(new AppObservation { AppId = "files", Title = "Files", Now = 100 });
        registry.Place("files", "win-a", Input("eDP-1", 0, R(0, 0, 960, 1080)), 100);
        registry.Place("files", "win-b", Input("eDP-1", 1, R(960, 0, 960, 1080)), 100);
        registry.ForgetPlacement("files", "win-b");

        var restored = AppRegistry.FromJSON(registry.ToJSON());
        Assert.Equal(1, restored.OrdinalFor("files", "win-a"));
        restored.Place("files", "win-c", Input("eDP-1", 1));
        Assert.Equal(3, restored.OrdinalFor("files", "win-c"));
        Assert.Equal(1, restored.Get("files")?.WindowsSeen);
    }

    [Fact]
    public void RefusesANewerRegistryVersionAndYieldsAnEmptyRegistry()
    {
        var restored = AppRegistry.FromJSON(new AppRegistryData
        {
            Version = AppRegistry.RegistryVersion + 1,
            Entries = new[] { Entry() },
        });
        Assert.Equal(0, restored.Size);
    }

    [Fact]
    public void KeepsTheFirstEntryDeterministicallyWhenDuplicateAppIdsAppear()
    {
        var restored = AppRegistry.FromJSON(new AppRegistryData
        {
            Version = AppRegistry.RegistryVersion,
            Entries = new[] { Entry(lastTitle: "first", windowsSeen: 1), Entry(lastTitle: "second", windowsSeen: 9) },
        });
        Assert.Equal(1, restored.Size);
        Assert.Equal("first", restored.Get("files")?.LastTitle);
        Assert.Equal(1, restored.Get("files")?.WindowsSeen);
    }

    [Fact]
    public void ReDerivesTheOrdinalCounterFromTheHighestPersistedPlacement()
    {
        var restored = AppRegistry.FromJSON(new AppRegistryData
        {
            Version = AppRegistry.RegistryVersion,
            Entries = new[]
            {
                Entry(
                    placements: new Dictionary<string, AppPlacement>(StringComparer.Ordinal)
                    {
                        ["win-a"] = new AppPlacement
                        {
                            Ordinal = 7,
                            Connector = "eDP-1",
                            Slot = 0,
                            Maximized = false,
                            Fullscreen = false,
                            Rect = R(),
                        },
                    },
                    nextOrdinal: 1),
            },
        });
        var placed = restored.Place("files", "win-b", Input("eDP-1", 1));
        Assert.Equal(8, placed.Ordinal);
    }

    [Fact]
    public void BoundsTheSerializedRegistryAndKeepsDurableDecisionsFirst()
    {
        var registry = new AppRegistry();
        registry.SetNeverTile("pinned", true, 1);
        for (var index = 0; index < 400; index += 1)
        {
            registry.Observe(new AppObservation
            {
                AppId = $"app-{index}",
                Title = new string('t', Text.MaxText),
                Now = index + 2,
            });
        }
        const int cap = 32 * 1024;
        var text = H.Json(registry.ToJSON(cap));
        Assert.True(Text.Utf8ByteLength(text) <= cap);
        var rounded = JsonSerializer.Deserialize<AppRegistryData>(text)!;
        Assert.Contains(rounded.Entries, item => item.AppId == "pinned" && item.NeverTile);
        Assert.True(Text.Utf8ByteLength(H.Json(registry.ToJSON())) <= AppRegistry.MaxRegistryBytes);
    }
}
