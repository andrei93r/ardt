// Port of tests/core/fractional-scaling.test.ts and identity.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class FractionalScalingTests
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
        GapBetween = gapBase,
    };

    private static TilePlan PairOn(Rect area, double scale, double gap = 0) =>
        Tiler.ComputePlans(
            new[] { H.Window(id: 1), H.Window(id: 2, appId: "b") },
            H.Screen(geometry: area, scale: scale),
            Config(gap));

    private static (Rect First, Rect Second) Ordered(TilePlan plan)
    {
        var rects = plan.Placements
            .OrderBy(p => p.Rect.X)
            .ThenBy(p => p.Rect.Y)
            .Select(p => p.Rect)
            .ToArray();
        return (rects[0], rects[1]);
    }

    private static void ExpectInside(Rect area, Rect r)
    {
        Assert.True(r.X >= area.X);
        Assert.True(r.Y >= area.Y);
        Assert.True(r.X + r.Width <= area.X + area.Width);
        Assert.True(r.Y + r.Height <= area.Y + area.Height);
    }

    private static double JsRound(double value) => Math.Floor(value + 0.5);

    private static void ExpectMeet(Rect a, Rect b, bool xAxis, double scale)
    {
        var aEnd = xAxis ? a.X + a.Width : a.Y + a.Height;
        var bStart = xAxis ? b.X : b.Y;
        Assert.Equal(JsRound(aEnd * scale), JsRound(bStart * scale));
        Assert.True(aEnd <= bStart + 0.5 / scale);
    }

    public static TheoryData<double, Rect> Cases => new()
    {
        { 1.25, H.Rect(2, 0, 1278, 800) },
        { 1.5, H.Rect(1, 0, 1278, 800) },
        { 1.75, H.Rect(1, 1, 1275, 799) },
        { 2, H.Rect(1, 0, 1278, 800) },
    };

    [Theory]
    [MemberData(nameof(Cases))]
    public void MakesThePairMeetExactlyInsideTheWorkArea(double scale, Rect area)
    {
        var plan = PairOn(area, scale);
        Assert.Empty(Invariants.CheckPlan(plan, BoundsOf(area)));
        var (left, right) = Ordered(plan);
        ExpectMeet(left, right, xAxis: true, scale);
        ExpectInside(area, left);
        ExpectInside(area, right);
        var step = 1 / scale;
        Assert.True(left.X - area.X < step + 1e-9);
        Assert.True(area.X + area.Width - (right.X + right.Width) < step + 1e-9);
    }

    private static Bounds BoundsOf(Rect area) => new()
    {
        X = area.X,
        Y = area.Y,
        Width = area.Width,
        Height = area.Height,
    };

    [Fact]
    public void KeepsTheConfiguredBetweenWindowGapAndNeverOverlaps()
    {
        var area = H.Rect(1, 0, 1278, 800);
        var plan = PairOn(area, 1.5, 10);
        var (left, right) = Ordered(plan);
        var gap = right.X - (left.X + left.Width);
        Assert.True(gap >= -0.5 / 1.5);
        Assert.True(Math.Abs(gap - 10) <= 1 / 1.5 + 1e-9);
        ExpectInside(area, left);
        ExpectInside(area, right);
    }

    [Fact]
    public void ReconcilesAVerticalSplitTheSameWayOnAPortraitMonitor()
    {
        var area = H.Rect(0, 1, 800, 1278);
        var plan = PairOn(area, 1.5);
        var (top, bottom) = Ordered(plan);
        ExpectMeet(top, bottom, xAxis: false, scale: 1.5);
        ExpectInside(area, top);
        ExpectInside(area, bottom);
    }

    [Fact]
    public void HandlesAnOffsetOriginMonitorAtAFractionalScale()
    {
        var area = H.Rect(1921, 0, 1278, 800);
        var plan = PairOn(area, 1.5);
        var (left, right) = Ordered(plan);
        ExpectMeet(left, right, xAxis: true, scale: 1.5);
        ExpectInside(area, left);
        ExpectInside(area, right);
        Assert.True(left.X >= area.X);
        Assert.True(right.X + right.Width >= area.X + area.Width - 1 / 1.5 - 1e-9);
    }

    [Fact]
    public void KeepsIntegerScalesByteIdentical()
    {
        var one = PairOn(H.Rect(0, 0, 1920, 1080), 1, 10);
        var two = PairOn(H.Rect(0, 0, 1920, 1080), 2, 10);
        foreach (var plan in new[] { one, two })
        {
            Assert.Equal(H.Rect(0, 0, 955, 1080), plan.Placements[0].Rect);
            Assert.Equal(H.Rect(965, 0, 955, 1080), plan.Placements[1].Rect);
        }
    }

    [Fact]
    public void LayoutAllKeepsEachMonitorPairAdjacentAndInsideItsOwnWorkArea()
    {
        var small = H.Screen(index: 0, connector: "M0", geometry: H.Rect(2, 0, 1278, 800), scale: 1.25);
        var large = H.Screen(index: 1, connector: "M1", geometry: H.Rect(1282, 0, 1276, 800), scale: 1.75);
        var plans = Tiler.LayoutAll(new TilerInput
        {
            Windows = new[]
            {
                H.Window(id: 1, workspaceId: 0, screenId: 0),
                H.Window(id: 2, appId: "b", workspaceId: 0, screenId: 0),
                H.Window(id: 3, appId: "c", workspaceId: 0, screenId: 1),
                H.Window(id: 4, appId: "d", workspaceId: 0, screenId: 1),
            },
            Screens = new[] { small, large },
            Config = Config(),
        });
        Assert.Equal(2, plans.Count);
        foreach (var entry in plans)
        {
            var area = entry.ScreenId == 0 ? H.Rect(2, 0, 1278, 800) : H.Rect(1282, 0, 1276, 800);
            Assert.Empty(Invariants.CheckPlan(entry.Plan, BoundsOf(area)));
            var (left, right) = Ordered(entry.Plan);
            ExpectMeet(left, right, xAxis: true, scale: entry.ScreenId == 0 ? 1.25 : 1.75);
            ExpectInside(area, left);
            ExpectInside(area, right);
        }
    }

    [Fact]
    public void SnapRectInwardShrinksToTheGridFromTheInsideAndIsNeverLargerThanTheInput()
    {
        var snapped = Types.SnapRectInward(H.Rect(1, 1, 1278, 800), 1.25);
        Assert.Equal(1.6, snapped.X);
        Assert.Equal(1.6, snapped.Y);
        Assert.Equal(1276.8, snapped.Width, 6);
        Assert.Equal(799.2, snapped.Height, 6);
    }

    [Fact]
    public void SnapRectInwardIsANoOpAtScale1AndAtIntegerScales()
    {
        var rect = H.Rect(3, 5, 1279, 801);
        Assert.Equal(rect, Types.SnapRectInward(rect, 1));
        Assert.Equal(rect, Types.SnapRectInward(rect, 2));
    }
}

public class IdentityTests
{
    private static ProcessEnv ProcessEnv(int pid, int ppid, params (string Key, string Value)[] entries) => new()
    {
        Pid = pid,
        Ppid = ppid,
        Environ = string.Join('\0', entries.Select(entry => $"{entry.Key}={entry.Value}")),
    };

    [Fact]
    public void NormalizeIdentityStripsATrailingDesktop()
    {
        Assert.Equal("org.gnome.Nautilus", Identity.NormalizeIdentity("org.gnome.Nautilus.desktop"));
        Assert.Equal("firefox", Identity.NormalizeIdentity("firefox.desktop"));
    }

    [Fact]
    public void NormalizeIdentityStripsATrailingAppImageSuffix()
    {
        Assert.Equal("/home/u/Apps/Foo", Identity.NormalizeIdentity("/home/u/Apps/Foo.AppImage"));
        Assert.Equal("/home/u/Apps/Foo", Identity.NormalizeIdentity("/home/u/Apps/FooAppImage"));
    }

    [Fact]
    public void NormalizeIdentityNeverCasefoldsAPathAndNeverRealpathsIt()
    {
        Assert.Equal("/home/u/Apps/MyApp", Identity.NormalizeIdentity("/home/u/Apps/MyApp.AppImage"));
        Assert.Equal("/home/u/Symlink/To/App", Identity.NormalizeIdentity("/home/u/Symlink/To/App"));
        Assert.Equal("Code", Identity.NormalizeIdentity("Code"));
    }

    [Fact]
    public void NormalizeIdentityTrimsSurroundingSpaceButKeepsInteriorCharacters()
    {
        Assert.Equal("kitty", Identity.NormalizeIdentity("  kitty  "));
        Assert.Equal("org.gnome.Nautilus", Identity.NormalizeIdentity("  org.gnome.Nautilus.desktop  "));
    }

    [Fact]
    public void IsProvisionalRecognisesTheSessionOnlyWindowKey()
    {
        Assert.True(Identity.IsProvisional("window:12"));
        Assert.False(Identity.IsProvisional("window:"));
        Assert.False(Identity.IsProvisional("firefox"));
    }

    [Fact]
    public void AppFamilyCasefoldsForGroupingOnly()
    {
        Assert.Equal("google-chrome", Identity.AppFamily("Google-Chrome.desktop"));
        Assert.Equal("firefox", Identity.AppFamily("Firefox"));
    }

    [Fact]
    public void AppFamilyKeepsDebFlatpakAndSnapInstallsAsDifferentFamilies()
    {
        Assert.NotEqual(Identity.AppFamily("spotify"), Identity.AppFamily("com.spotify.Client"));
        Assert.NotEqual(Identity.AppFamily("nautilus"), Identity.AppFamily("org.gnome.Nautilus"));
    }

    [Fact]
    public void ReadEnvValueReadsANulSeparatedVariableAndIgnoresTheRest()
    {
        const string environ = "HOME=/home/u\0APPIMAGE=/opt/Foo.AppImage\0PATH=/usr/bin";
        Assert.Equal("/opt/Foo.AppImage", Identity.ReadEnvValue(environ, "APPIMAGE"));
        Assert.Null(Identity.ReadEnvValue(environ, "MISSING"));
        Assert.Null(Identity.ReadEnvValue("", "APPIMAGE"));
    }

    [Fact]
    public void FindAppImageWalksFromTheWindowProcessUpToTheLauncher()
    {
        var processes = new[]
        {
            ProcessEnv(100, 50, ("HOME", "/home/u")),
            ProcessEnv(50, 1, ("APPIMAGE", "/home/u/Apps/Foo.AppImage")),
        };
        Assert.Equal("/home/u/Apps/Foo.AppImage", Identity.FindAppImage(100, processes));
    }

    [Fact]
    public void FindAppImageSurvivesChromiumZeroingItsOwnEnvironment()
    {
        var processes = new[]
        {
            new ProcessEnv { Pid = 100, Ppid = 50, Environ = "" },
            ProcessEnv(50, 1, ("APPDIR", "/tmp/.mount_Foo9xZ"), ("APPIMAGE", "/home/u/Apps/Foo.AppImage")),
        };
        Assert.Equal("/home/u/Apps/Foo.AppImage", Identity.FindAppImage(100, processes));
    }

    [Fact]
    public void FindAppImageReturnsNullWithoutAnAppImageStoppingAtAnUnreadableAncestor()
    {
        var processes = new[] { ProcessEnv(100, 50, ("HOME", "/home/u")) };
        Assert.Null(Identity.FindAppImage(100, processes));
    }

    [Fact]
    public void ResolveIdentityPrefersTheTrackerDesktopIdAndNormalisesIt()
    {
        var identity = Identity.ResolveIdentity(new IdentityProbe
        {
            DesktopId = "org.gnome.Nautilus.desktop",
            SandboxedAppId = "com.example.Sandbox",
            GtkApplicationId = "gtk-id",
            WmClass = "nautilus",
            WindowSeq = 1,
        });
        Assert.Equal("org.gnome.Nautilus", identity.Key);
        Assert.Equal(IdentitySource.DesktopId, identity.Source);
        Assert.False(identity.Provisional);
        Assert.Equal("org.gnome.Nautilus.desktop", identity.Raw);
    }

    [Fact]
    public void ResolveIdentityIgnoresADesktopIdThatIsTheProvisionalWindowKey()
    {
        var identity = Identity.ResolveIdentity(new IdentityProbe
        {
            DesktopId = "window:7",
            SandboxedAppId = "com.spotify.Client",
            WindowSeq = 7,
        });
        Assert.Equal("com.spotify.Client", identity.Key);
        Assert.Equal(IdentitySource.SandboxedAppId, identity.Source);
    }

    [Fact]
    public void ResolveIdentityFallsToTheSandboxedAppIdWhenThereIsNoDesktopId()
    {
        var identity = Identity.ResolveIdentity(new IdentityProbe
        {
            SandboxedAppId = "com.spotify.Client",
            GtkApplicationId = "spotify",
            WindowSeq = 2,
        });
        Assert.Equal("com.spotify.Client", identity.Key);
        Assert.Equal(IdentitySource.SandboxedAppId, identity.Source);
    }

    [Fact]
    public void ResolveIdentityFallsToTheGtkApplicationId()
    {
        var identity = Identity.ResolveIdentity(new IdentityProbe
        {
            GtkApplicationId = "org.gnome.Terminal",
            WmClass = "gnome-terminal-server",
            WindowSeq = 3,
        });
        Assert.Equal("org.gnome.Terminal", identity.Key);
        Assert.Equal(IdentitySource.GtkApplicationId, identity.Source);
    }

    [Fact]
    public void ResolveIdentityResolvesAnAppImageFromTheProcessAncestorsIgnoringTheMountPath()
    {
        var processes = new[]
        {
            new ProcessEnv { Pid = 400, Ppid = 300, Environ = "" },
            ProcessEnv(300, 1, ("APPDIR", "/tmp/.mount_RandomPerRun"), ("APPIMAGE", "/home/u/Apps/MyEditor.AppImage")),
        };
        var identity = Identity.ResolveIdentity(new IdentityProbe
        {
            Pid = 400,
            Processes = processes,
            WmClass = "myeditor",
            WindowSeq = 4,
        });
        Assert.Equal("/home/u/Apps/MyEditor", identity.Key);
        Assert.Equal(IdentitySource.AppImage, identity.Source);
    }

    [Fact]
    public void ResolveIdentityFallsToWmClassWhenNothingElseIsKnown()
    {
        var identity = Identity.ResolveIdentity(new IdentityProbe { WmClass = "kitty", WindowSeq = 5 });
        Assert.Equal("kitty", identity.Key);
        Assert.Equal(IdentitySource.WmClass, identity.Source);
    }

    [Fact]
    public void ResolveIdentityFallsToTheSessionOnlyWindowKey()
    {
        var identity = Identity.ResolveIdentity(new IdentityProbe { WindowSeq = 42 });
        Assert.Equal("window:42", identity.Key);
        Assert.Equal(IdentitySource.Window, identity.Source);
        Assert.True(identity.Provisional);
        Assert.Null(identity.Raw);
    }

    [Fact]
    public void ResolveIdentityRecordsEveryRawValueItSawForTheJournal()
    {
        var identity = Identity.ResolveIdentity(new IdentityProbe
        {
            DesktopId = "firefox.desktop",
            SandboxedAppId = null,
            GtkApplicationId = "firefox-gtk",
            WmClass = "Navigator",
            WindowSeq = 9,
        });
        Assert.Equal("firefox.desktop", identity.RawValues[IdentitySource.DesktopId]);
        Assert.Equal("firefox-gtk", identity.RawValues[IdentitySource.GtkApplicationId]);
        Assert.Equal("Navigator", identity.RawValues[IdentitySource.WmClass]);
        Assert.Null(identity.RawValues[IdentitySource.AppImage]);
        Assert.Null(identity.RawValues[IdentitySource.Window]);
    }
}
