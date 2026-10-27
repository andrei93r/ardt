// Port of tests/core/recording.test.ts.
using System.Text.Json.Nodes;
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class RecordingTests
{
    private static void AssertJsonEqual(object? expected, object? actual) =>
        Assert.True(
            JsonNode.DeepEquals(JsonNode.Parse(H.Json(expected)), JsonNode.Parse(H.Json(actual))),
            $"expected {H.Json(expected)} but got {H.Json(actual)}");

    private static DateTime Local(int year, int month, int day, int hour = 0, int minute = 0, int second = 0) =>
        new(year, month, day, hour, minute, second, DateTimeKind.Local);

    [Fact]
    public void RecordingFileNameStampsOneLocalTimeFilePerSession()
    {
        Assert.Equal("rec-20261002-030405.jsonl", Recording.RecordingFileName(Local(2026, 10, 2, 3, 4, 5)));
        Assert.Equal("rec-20260131-235959.jsonl", Recording.RecordingFileName(Local(2026, 1, 31, 23, 59, 59)));
    }

    [Fact]
    public void RecordingFileNameZeroPadsEveryComponent()
    {
        Assert.Equal("rec-20260101-000000.jsonl", Recording.RecordingFileName(Local(2026, 1, 1)));
    }

    [Fact]
    public void RecordingFileNameDisambiguatesASecondSessionInTheSameSecond()
    {
        var date = Local(2026, 10, 2, 3, 4, 5);
        Assert.Equal("rec-20261002-030405.jsonl", Recording.RecordingFileName(date, 1));
        Assert.Equal("rec-20261002-030405-2.jsonl", Recording.RecordingFileName(date, 2));
        Assert.Equal("rec-20261002-030405-11.jsonl", Recording.RecordingFileName(date, 11));
    }

    [Fact]
    public void ClampMaxSecondsFallsBackToTheDefaultForAnAbsentOrNonPositiveRequest()
    {
        Assert.Equal(Recording.DefaultMaxMs, Recording.ClampMaxSeconds(null));
        Assert.Equal(Recording.DefaultMaxMs, Recording.ClampMaxSeconds(0));
        Assert.Equal(Recording.DefaultMaxMs, Recording.ClampMaxSeconds(-5));
        Assert.Equal(Recording.DefaultMaxMs, Recording.ClampMaxSeconds(double.NaN));
    }

    [Fact]
    public void ClampMaxSecondsClampsARealRequestToTheAllowedWindow()
    {
        Assert.Equal(30_000, Recording.ClampMaxSeconds(30));
        Assert.Equal(Recording.MinCapSeconds * 1000, Recording.ClampMaxSeconds(0.9));
        Assert.Equal(Recording.MaxCapSeconds * 1000, Recording.ClampMaxSeconds(60 * 60 * 5));
    }

    [Fact]
    public void CapReasonStopsAtTheFirstBoundReached()
    {
        Assert.Null(Recording.CapReason(0, 0, 1000, 1000));
        Assert.Equal(CapReasonKind.Time, Recording.CapReason(1000, 0, 1000, 1000));
        Assert.Equal(CapReasonKind.Bytes, Recording.CapReason(0, 1000, 1000, 1000));
    }

    [Fact]
    public void CapReasonPrefersTheByteCapWhenBothAreExceeded()
    {
        Assert.Equal(CapReasonKind.Bytes, Recording.CapReason(5000, 5000, 1000, 1000));
    }

    [Fact]
    public void CapReasonIgnoresANonPositiveCap()
    {
        Assert.Null(Recording.CapReason(1e9, 1e12, 0, 0));
    }

    [Fact]
    public void CapReasonHonoursTheBuiltInDefaults()
    {
        Assert.Equal(
            CapReasonKind.Bytes,
            Recording.CapReason(0, Recording.DefaultMaxBytes, Recording.DefaultMaxMs, Recording.DefaultMaxBytes));
        Assert.Equal(
            CapReasonKind.Time,
            Recording.CapReason(Recording.DefaultMaxMs, 0, Recording.DefaultMaxMs, Recording.DefaultMaxBytes));
    }

    private static readonly string[] Names =
    {
        "rec-20260101-000000.jsonl",
        "rec-20260102-000000.jsonl",
        "rec-20260103-000000.jsonl",
    };

    [Fact]
    public void RecordingsToDeleteDeletesTheOldestExcessChronologically()
    {
        Assert.Equal(new[] { Names[0] }, Recording.RecordingsToDelete(Names, 2));
        Assert.Empty(Recording.RecordingsToDelete(Names, 3));
        Assert.Empty(Recording.RecordingsToDelete(Names, 10));
    }

    [Fact]
    public void RecordingsToDeleteNeverDeletesBelowOneFile()
    {
        Assert.Equal(new[] { Names[0], Names[1] }, Recording.RecordingsToDelete(Names, 0));
        Assert.Equal(new[] { Names[0], Names[1] }, Recording.RecordingsToDelete(Names, -1));
    }

    [Fact]
    public void RecordingsToDeleteDoesNotDependOnTheInputOrder()
    {
        Assert.Equal(new[] { Names[0] }, Recording.RecordingsToDelete(new[] { Names[2], Names[0], Names[1] }, 2));
    }

    [Fact]
    public void RecordingsToDeleteKeepsTheNewestTenByDefault()
    {
        var many = Enumerable.Range(1, 13)
            .Select(index => $"rec-202601{index.ToString("00", System.Globalization.CultureInfo.InvariantCulture)}-000000.jsonl")
            .ToList();
        Assert.Equal(13 - Recording.MaxRecordingFiles, Recording.RecordingsToDelete(many).Count);
    }

    [Fact]
    public void RecordingExpiryReadsTheLocalTimestampBackFromARecordingName()
    {
        var date = Local(2026, 10, 2, 21, 31, 2);
        var expected = (double)new DateTimeOffset(date).ToUnixTimeMilliseconds();
        Assert.Equal(expected, Recording.RecordingTimestamp("rec-20261002-213102.jsonl"));
        Assert.Equal(expected, Recording.RecordingTimestamp("rec-20261002-213102-3.jsonl"));
        Assert.Null(Recording.RecordingTimestamp("other.jsonl"));
        Assert.Null(Recording.RecordingTimestamp("rec-20261301-000000.jsonl"));
    }

    [Fact]
    public void RecordingExpiryExpiresRecordingsOlderThan31Days()
    {
        var now = new DateTimeOffset(Local(2026, 10, 18, 12, 0, 0));
        var names = new[]
        {
            "rec-20260917-120000.jsonl", // exactly 31 days: keep
            "rec-20260916-115959.jsonl", // one second beyond: delete
            "rec-20261018-120000.jsonl", // today: keep
            "foreign.jsonl",
        };
        Assert.Equal(31, Recording.RecordingRetentionDays);
        Assert.Equal(new[] { "rec-20260916-115959.jsonl" }, Recording.RecordingsExpired(names, now));
    }

    [Fact]
    public void SampleDueSamplesImmediatelyThenAtMostOncePerInterval()
    {
        Assert.True(Recording.SampleDue(0, 1_000));
        Assert.False(Recording.SampleDue(1_000, 1_000 + Recording.SnapshotIntervalMs - 1));
        Assert.True(Recording.SampleDue(1_000, 1_000 + Recording.SnapshotIntervalMs));
    }

    [Fact]
    public void SnapshotKeyIsStableForEqualSnapshotsAndDistinctForAChangedField()
    {
        static Dictionary<string, object?> Snapshot(double x) => new()
        {
            ["focused"] = 7,
            ["windows"] = new List<object?>
            {
                new Dictionary<string, object?>
                {
                    ["id"] = 7,
                    ["rect"] = new Dictionary<string, object?>
                    {
                        ["x"] = x,
                        ["y"] = 0,
                        ["width"] = 10,
                        ["height"] = 10,
                    },
                },
            },
        };

        Assert.Equal(Recording.SnapshotKey(Snapshot(0)), Recording.SnapshotKey(Snapshot(0)));
        Assert.NotEqual(Recording.SnapshotKey(Snapshot(0)), Recording.SnapshotKey(Snapshot(1)));
    }

    [Fact]
    public void LineFormatsTagEachKindAndKeepTheRecordBodyVerbatim()
    {
        var header = Recording.HeaderRecord(5, new Dictionary<string, object?> { ["platform"] = "gnome" });
        Assert.Equal("header", header["kind"]);
        Assert.Equal("adrt.recording", header["format"]);
        Assert.Equal(1, header["version"]);
        Assert.Equal(5.0, header["at"]);
        Assert.Equal("gnome", header["platform"]);

        AssertJsonEqual(
            new Dictionary<string, object?>
            {
                ["kind"] = "event",
                ["t"] = 9,
                ["seq"] = 3,
                ["event"] = "window-opened",
                ["at"] = 8,
            },
            Recording.EventRecord(9, new Dictionary<string, object?>
            {
                ["seq"] = 3,
                ["event"] = "window-opened",
                ["at"] = 8,
            }));
        Assert.Equal(
            "event",
            Recording.EventRecord(2, new Dictionary<string, object?> { ["kind"] = "work-area", ["t"] = 1 })["kind"]);
        AssertJsonEqual(
            new Dictionary<string, object?> { ["kind"] = "state", ["t"] = 11, ["focused"] = 4 },
            Recording.StateRecord(11, new Dictionary<string, object?> { ["focused"] = 4 }));
        AssertJsonEqual(
            new Dictionary<string, object?>
            {
                ["kind"] = "footer",
                ["at"] = 12,
                ["reason"] = "user",
                ["events"] = 2,
            },
            Recording.FooterRecord(12, new Dictionary<string, object?>
            {
                ["reason"] = "user",
                ["events"] = 2,
            }));

        var note = Recording.NoteRecord(11, "drag did not land");
        var footer = Recording.FooterRecord(12, new Dictionary<string, object?>
        {
            ["reason"] = "user",
            ["note"] = "drag did not land",
        });
        AssertJsonEqual(
            new Dictionary<string, object?> { ["kind"] = "note", ["t"] = 11, ["text"] = "drag did not land" },
            note);
        Assert.Equal(note["text"], footer["note"]);
    }

    [Fact]
    public void FormatBytesUsesBinaryUnits()
    {
        Assert.Equal("0 B", Recording.FormatBytes(0));
        Assert.Equal("512 B", Recording.FormatBytes(512));
        Assert.Equal("1.0 KiB", Recording.FormatBytes(1024));
        Assert.Equal("1.5 KiB", Recording.FormatBytes(1536));
        Assert.Equal("1.0 MiB", Recording.FormatBytes(1024 * 1024));
        Assert.Equal("3.0 MiB", Recording.FormatBytes(3 * 1024 * 1024));
        Assert.Equal("20 MiB", Recording.FormatBytes(20 * 1024 * 1024));
    }

    [Fact]
    public void FormatBytesTreatsANonFiniteOrNegativeSizeAsEmpty()
    {
        Assert.Equal("0 B", Recording.FormatBytes(-1));
        Assert.Equal("0 B", Recording.FormatBytes(double.NaN));
        Assert.Equal("0 B", Recording.FormatBytes(double.PositiveInfinity));
    }

    private static readonly string[] SummaryLines =
    {
        H.Json(Recording.HeaderRecord(1, new Dictionary<string, object?> { ["platform"] = "gnome" })),
        H.Json(Recording.EventRecord(2, new Dictionary<string, object?>
        {
            ["source"] = "host",
            ["event"] = "focus-changed",
        })),
        H.Json(Recording.NoteRecord(3, "the split snapped back")),
        H.Json(Recording.FooterRecord(4, new Dictionary<string, object?>
        {
            ["reason"] = "user",
            ["durationMs"] = 4573,
            ["note"] = "the split snapped back",
        })),
    };

    [Fact]
    public void SummarizeRecordingReadsTheTimestampNoteStopReasonAndDuration()
    {
        var summary = Recording.SummarizeRecording(
            "rec-20261021-080540.jsonl", 165901, string.Join('\n', SummaryLines) + "\n");
        Assert.Equal("rec-20261021-080540.jsonl", summary.Name);
        Assert.Equal(Recording.RecordingTimestamp("rec-20261021-080540.jsonl"), summary.Timestamp);
        Assert.Equal(165901, summary.Bytes);
        Assert.Equal("the split snapped back", summary.Note);
        Assert.Equal("user", summary.StopReason);
        Assert.Equal(4573, summary.DurationMs);
        Assert.False(summary.Open);
    }

    [Fact]
    public void SummarizeRecordingMarksAFileWithoutAFooterAsOpen()
    {
        var summary = Recording.SummarizeRecording(
            "rec-20261021-080540.jsonl", 10, string.Join('\n', SummaryLines.Take(2)));
        Assert.True(summary.Open);
        Assert.Null(summary.StopReason);
        var partial = Recording.SummarizeRecording(
            "rec-20261021-080540.jsonl", 10, string.Join('\n', SummaryLines.Take(3)));
        Assert.True(partial.Open);
        Assert.Equal("the split snapped back", partial.Note);
    }

    [Fact]
    public void SummarizeRecordingToleratesATruncatedOrForeignLineInsteadOfThrowing()
    {
        var text = SummaryLines[0] + "\n{\"kind\":\"foote";
        var summary = Recording.SummarizeRecording("rec-20261021-080540.jsonl", 10, text);
        Assert.True(summary.Open);
        Assert.True(summary.Timestamp > 0);
    }

    [Fact]
    public void SummarizeRecordingReportsAForeignNameWithAZeroTimestamp()
    {
        var summary = Recording.SummarizeRecording("not-a-recording.jsonl", 4, "");
        Assert.Equal(0, summary.Timestamp);
        Assert.True(summary.Open);
    }

    [Fact]
    public void SortRecordingsNewestOrdersByTheNameTimestampNewestFirst()
    {
        var rows = new[]
        {
            Recording.SummarizeRecording("rec-20260101-000000.jsonl", 1, ""),
            Recording.SummarizeRecording("rec-20260301-000000.jsonl", 1, ""),
            Recording.SummarizeRecording("rec-20260201-000000.jsonl", 1, ""),
        };
        Assert.Equal(
            new[]
            {
                "rec-20260301-000000.jsonl",
                "rec-20260201-000000.jsonl",
                "rec-20260101-000000.jsonl",
            },
            Recording.SortRecordingsNewest(rows).Select(row => row.Name));
    }

    [Fact]
    public void SortRecordingsNewestFallsBackToTheNameForAForeignFileAndDoesNotMutateTheInput()
    {
        var rows = new[]
        {
            Recording.SummarizeRecording("rec-20260101-000000.jsonl", 1, ""),
            Recording.SummarizeRecording("zzz.jsonl", 1, ""),
        };
        var sorted = Recording.SortRecordingsNewest(rows);
        Assert.Equal("rec-20260101-000000.jsonl", sorted[0].Name);
        Assert.Equal(new[] { "rec-20260101-000000.jsonl", "zzz.jsonl" }, rows.Select(row => row.Name));
    }

    [Fact]
    public void RecordingsToRemoveReturnsOnlyAPresentWellFormedRecordingName()
    {
        var present = new[] { "rec-20260101-000000.jsonl", "rec-20260102-000000.jsonl", "notes.txt" };
        Assert.Equal(
            new[] { "rec-20260101-000000.jsonl" },
            Recording.RecordingsToRemove(new[] { "rec-20260101-000000.jsonl" }, present));
        Assert.Equal(
            new[] { "rec-20260101-000000.jsonl" },
            Recording.RecordingsToRemove(
                new[] { "rec-20260101-000000.jsonl", "gone.jsonl", "notes.txt" }, present));
        Assert.Empty(Recording.RecordingsToRemove(Array.Empty<string>(), present));
    }

    [Fact]
    public void CenterRectCentresTheContentInTheContainer()
    {
        Assert.Equal(
            H.Rect(440, 300, 400, 200),
            Recording.CenterRect(H.Size(1280, 800), H.Size(400, 200)));
    }

    [Fact]
    public void CenterRectRoundsFractionalSizesAndOffsets()
    {
        Assert.Equal(
            H.Rect(25, 35, 51, 31),
            Recording.CenterRect(H.Size(100, 100), H.Size(51, 31)));
    }

    [Fact]
    public void CenterRectClampsToTheTopLeftWhenTheContentIsLargerThanTheContainer()
    {
        Assert.Equal(
            H.Rect(0, 0, 300, 200),
            Recording.CenterRect(H.Size(100, 80), H.Size(300, 200)));
    }

    [Fact]
    public void CenterRectTreatsANonFiniteContentSizeAsEmpty()
    {
        Assert.Equal(
            H.Rect(50, 20, 0, 40),
            Recording.CenterRect(H.Size(100, 80), H.Size(double.NaN, 40)));
    }

    [Fact]
    public void NormalizeNoteTrimsAndNormalisesLineEndings()
    {
        Assert.Equal("a\nb", Recording.NormalizeNote("  a\r\nb  "));
        Assert.Equal("", Recording.NormalizeNote("\r"));
        Assert.Equal("one line", Recording.NormalizeNote("one line"));
    }

    [Fact]
    public void NormalizeNoteKeepsTabsAndNewlinesButReplacesOtherControlCharacters()
    {
        Assert.Equal("a\tb", Recording.NormalizeNote("a\tb"));
        Assert.Equal("a b c", Recording.NormalizeNote("a\u0007b\u007fc"));
    }

    [Fact]
    public void NormalizeNoteCapsTheNoteLength()
    {
        var longNote = new string('x', Recording.NoteMaxLength + 500);
        Assert.Equal(Recording.NoteMaxLength, Recording.NormalizeNote(longNote).Length);
    }

    [Fact]
    public void NormalizeNoteEscapesSafelyWhenSerialisedIntoAJsonlLine()
    {
        const string text = "quote \" and \\ and\nnewline";
        var line = H.Json(Recording.NoteRecord(7, Recording.NormalizeNote(text)));
        AssertJsonEqual(
            new Dictionary<string, object?>
            {
                ["kind"] = "note",
                ["t"] = 7,
                ["text"] = "quote \" and \\ and\nnewline",
            },
            JsonNode.Parse(line));
        Assert.DoesNotContain("\n", line);
    }
}
