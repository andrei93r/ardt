// Port of tests/core/profiles.test.ts, ringbuffer.test.ts, rotation.test.ts, text.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class ProfilesTests
{
    [Fact]
    public void ResolvesTheChromeFamily()
    {
        Assert.Same(Profiles.All["chrome-family"], Profiles.ProfileFor("google-chrome"));
        Assert.Same(Profiles.All["chrome-family"], Profiles.ProfileFor("brave-browser"));
    }

    [Fact]
    public void ResolvesElectronApps()
    {
        Assert.Same(Profiles.All["electron"], Profiles.ProfileFor("code"));
        Assert.Same(Profiles.All["default"], Profiles.ProfileFor("org.telegram.desktop"));
    }

    [Fact]
    public void ResolvesGtkTerminalsIncludingReverseDnsIds()
    {
        Assert.Same(Profiles.All["gtk-terminal"], Profiles.ProfileFor("org.gnome.Terminal"));
        Assert.Same(Profiles.All["gtk-terminal"], Profiles.ProfileFor("kitty"));
    }

    [Fact]
    public void ResolvesJetBrainsIdesWithoutAnimation()
    {
        Assert.Same(Profiles.All["java-swing"], Profiles.ProfileFor("jetbrains-idea"));
        Assert.False(Profiles.ProfileFor("jetbrains-idea").Animate);
    }

    [Fact]
    public void FallsBackToDefault()
    {
        Assert.Same(Profiles.All["default"], Profiles.ProfileFor("totally-unknown"));
    }

    [Fact]
    public void IsCaseInsensitive()
    {
        Assert.Same(Profiles.All["chrome-family"], Profiles.ProfileFor("Google-Chrome"));
    }
}

public class RingBufferTests
{
    [Fact]
    public void StartsEmpty()
    {
        var ring = new RingBuffer<int>(3);
        Assert.Equal(0, ring.Length);
        Assert.Empty(ring.Tail(5));
        Assert.Empty(ring.TailWhere(_ => true, 5));
        Assert.Empty(ring.Tail(0));
    }

    [Fact]
    public void KeepsInsertionOrderWhileBelowCapacity()
    {
        var ring = new RingBuffer<int>(5);
        foreach (var n in new[] { 1, 2, 3 }) ring.Push(n);
        Assert.Equal(3, ring.Length);
        Assert.Equal(new[] { 1, 2, 3 }, ring.Tail(10));
    }

    [Fact]
    public void OverwritesTheOldestItemOnceFullPreservingOrder()
    {
        var ring = new RingBuffer<int>(3);
        foreach (var n in new[] { 1, 2, 3, 4, 5 }) ring.Push(n);
        Assert.Equal(3, ring.Length);
        Assert.Equal(new[] { 3, 4, 5 }, ring.Tail(10));
    }

    [Fact]
    public void ReturnsTheLastNItemsOldestFirst()
    {
        var ring = new RingBuffer<int>(5);
        foreach (var n in new[] { 1, 2, 3, 4, 5 }) ring.Push(n);
        Assert.Equal(new[] { 4, 5 }, ring.Tail(2));
        Assert.Equal(new[] { 5 }, ring.Tail(1));
        Assert.Equal(new[] { 1, 2, 3, 4, 5 }, ring.Tail(99));
    }

    [Fact]
    public void WrapsAroundManyTimesWithoutGrowing()
    {
        var ring = new RingBuffer<int>(4);
        for (var n = 0; n < 1000; n++) ring.Push(n);
        Assert.Equal(4, ring.Length);
        Assert.Equal(new[] { 996, 997, 998, 999 }, ring.Tail(4));
    }

    [Fact]
    public void FiltersAndKeepsTheLastNMatchesInOrder()
    {
        var ring = new RingBuffer<int>(5);
        foreach (var n in new[] { 1, 2, 3, 4, 5, 6 }) ring.Push(n);
        static bool Even(int n) => n % 2 == 0;
        Assert.Equal(new[] { 2, 4, 6 }, ring.TailWhere(Even, 10));
        Assert.Equal(new[] { 4, 6 }, ring.TailWhere(Even, 2));
        Assert.Empty(ring.TailWhere(Even, 0));
        Assert.Empty(ring.TailWhere(_ => false, 2));
    }

    [Fact]
    public void ClearsEveryItem()
    {
        var ring = new RingBuffer<string>(3);
        ring.Push("a");
        ring.Push("b");
        ring.Clear();
        Assert.Equal(0, ring.Length);
        Assert.Empty(ring.Tail(10));
        ring.Push("c");
        Assert.Equal(new[] { "c" }, ring.Tail(10));
    }

    [Fact]
    public void IsInertAtAZeroOrNegativeCapacity()
    {
        foreach (var capacity in new[] { 0, -3 })
        {
            var ring = new RingBuffer<int>(capacity);
            ring.Push(1);
            Assert.Equal(0, ring.Length);
            Assert.Empty(ring.Tail(10));
        }
    }
}

public class RotationTests
{
    [Fact]
    public void ShouldRotateAtOrAboveTheThreshold()
    {
        Assert.False(Rotation.ShouldRotate(999, 1000));
        Assert.True(Rotation.ShouldRotate(1000, 1000));
        Assert.True(Rotation.ShouldRotate(5000, 1000));
    }

    [Fact]
    public void ShouldRotateNeverRotatesWhenTheCapIsDisabled()
    {
        Assert.False(Rotation.ShouldRotate(1e12, 0));
        Assert.False(Rotation.ShouldRotate(1e12, -5));
    }

    [Fact]
    public void PartPathNamesPartsAfterTheDayFile()
    {
        const string fileBase = "/home/u/.local/share/adrt/history/2026-09-30.jsonl";
        Assert.Equal(fileBase, Rotation.PartPath(fileBase, 1));
        Assert.Equal("/home/u/.local/share/adrt/history/2026-09-30.2.jsonl", Rotation.PartPath(fileBase, 2));
        Assert.Equal("/home/u/.local/share/adrt/history/2026-09-30.7.jsonl", Rotation.PartPath(fileBase, 7));
    }

    [Fact]
    public void PartsToPruneKeepsTheNewestParts()
    {
        Assert.Empty(Rotation.PartsToPrune(3, 5));
        Assert.Empty(Rotation.PartsToPrune(5, 5));
        Assert.Equal(new[] { 7, 6 }, Rotation.PartsToPrune(7, 5));
    }

    [Fact]
    public void PartsToPruneAlwaysKeepsAtLeastTheLivePart()
    {
        Assert.Equal(new[] { 4, 3, 2 }, Rotation.PartsToPrune(4, 0));
        Assert.Equal(new[] { 4, 3, 2 }, Rotation.PartsToPrune(4, 1));
    }

    [Fact]
    public void RetentionDefaultsToExactly31Days()
    {
        Assert.Equal(31, Rotation.LogRetentionDays);
    }

    private static DateTimeOffset Now => new(new DateTime(2026, 10, 18, 12, 0, 0, DateTimeKind.Local));

    [Fact]
    public void RetentionComputesADayBasedCutoff31DaysBack()
    {
        Assert.Equal("2026-09-17", Rotation.RetentionCutoffDay(Now));
        Assert.Equal("2026-10-17", Rotation.RetentionCutoffDay(Now, 1));
        Assert.Equal("2026-09-17", Rotation.RetentionCutoffDay(Now, 31));
    }

    [Fact]
    public void RetentionKeepsTheCutoffDayAndExpiresTheDayBeforeIt()
    {
        Assert.False(Rotation.IsDayExpired("2026-09-18", Now));
        Assert.False(Rotation.IsDayExpired("2026-09-17", Now));
        Assert.True(Rotation.IsDayExpired("2026-09-16", Now));
        Assert.True(Rotation.IsDayExpired("2025-01-01", Now));
    }

    [Fact]
    public void RetentionFallsBackTo31DaysForANonsensicalSetting()
    {
        Assert.Equal("2026-09-17", Rotation.RetentionCutoffDay(Now, 0));
        Assert.Equal("2026-09-17", Rotation.RetentionCutoffDay(Now, double.NaN));
    }
}

public class TextTests
{
    [Fact]
    public void ClipTextKeepsANormalTitle()
    {
        Assert.Equal("New Tab - Google Chrome", Text.ClipText("New Tab - Google Chrome"));
    }

    [Fact]
    public void ClipTextBoundsAPathologicalTitle()
    {
        var output = Text.ClipText(new string('x', 5_000_000));
        Assert.True(output.Length <= Text.MaxText + 1);
        Assert.EndsWith("…", output);
    }

    [Fact]
    public void ClipTextStripsControlCharacters()
    {
        Assert.Equal("a b c", Text.ClipText("a\u0000b\u001fc"));
    }

    [Fact]
    public void ClipTextReturnsEmptyForNonStrings()
    {
        Assert.Equal("", Text.ClipText(null));
        Assert.Equal("", Text.ClipText(42));
    }

    [Fact]
    public void Utf8ByteLengthCountsBytesNotUtf16CodeUnits()
    {
        Assert.Equal(0, Text.Utf8ByteLength(""));
        Assert.Equal(3, Text.Utf8ByteLength("abc"));
        Assert.Equal(2, Text.Utf8ByteLength("é"));
        Assert.Equal(9, Text.Utf8ByteLength("日本語"));
        Assert.Equal(4, Text.Utf8ByteLength("😀"));
    }

    [Fact]
    public void Utf8ByteLengthMatchesTextEncoderForMixedText()
    {
        const string text = "café — 日本語 🚀";
        Assert.Equal(System.Text.Encoding.UTF8.GetByteCount(text), Text.Utf8ByteLength(text));
    }

    [Fact]
    public void ClipPayloadBoundsStringsAtAnyDepth()
    {
        var payload = new Dictionary<string, object?>
        {
            ["id"] = 7,
            ["title"] = new string('y', 10_000_000),
            ["nested"] = new Dictionary<string, object?>
            {
                ["deep"] = new Dictionary<string, object?>
                {
                    ["list"] = new List<object?> { new string('z', 1_000_000) },
                },
            },
        };
        var output = (Dictionary<string, object?>)Text.ClipPayload(payload)!;
        Assert.Equal(7, output["id"]);
        Assert.True(((string)output["title"]!).Length <= Text.MaxLogText + 1);
        var nested = (Dictionary<string, object?>)output["nested"]!;
        var deep = (Dictionary<string, object?>)nested["deep"]!;
        // The TS depth limit (3) turns the list itself into the ellipsis; a string
        // indexed with [0] is its first character, so both shapes are short.
        var listValue = deep["list"]!;
        if (listValue is string ellipsis)
        {
            Assert.True(ellipsis.Length <= Text.MaxLogText + 1);
        }
        else
        {
            var list = (List<object?>)listValue;
            Assert.True(((string)list[0]!).Length <= Text.MaxLogText + 1);
        }
    }

    [Fact]
    public void ClipPayloadLeavesNumbersAndBooleansAlone()
    {
        var output = Text.ClipPayload(new Dictionary<string, object?>
        {
            ["a"] = 1,
            ["b"] = true,
            ["c"] = null,
        });
        Assert.Equal(
            H.Json(new Dictionary<string, object?> { ["a"] = 1, ["b"] = true, ["c"] = null }),
            H.Json(output));
    }
}
