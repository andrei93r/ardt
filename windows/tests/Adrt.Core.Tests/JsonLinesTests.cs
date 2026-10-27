// Port of tests/core/jsonl.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class JsonLinesTests
{
    [Fact]
    public void DayStringFormatsALocalDateWithZeroPadding()
    {
        Assert.Equal("2026-01-05", JsonLines.DayString(new DateTime(2026, 0 + 1, 5)));
        Assert.Equal("2026-09-30", JsonLines.DayString(new DateTime(2026, 9, 30)));
        Assert.Equal("2026-12-31", JsonLines.DayString(new DateTime(2026, 12, 31)));
    }

    [Fact]
    public void DayStringSortsChronologicallyAsText()
    {
        var days = new[]
        {
            JsonLines.DayString(new DateTime(2026, 12, 1)),
            JsonLines.DayString(new DateTime(2026, 1, 15)),
            JsonLines.DayString(new DateTime(2026, 11, 9)),
        }.OrderBy(day => day, StringComparer.Ordinal).ToList();
        Assert.Equal(new[] { "2026-01-15", "2026-11-09", "2026-12-01" }, days);
    }

    [Fact]
    public void EncodeTextEncodesAsciiAsOneByteEach()
    {
        Assert.Equal(new byte[] { 0x61, 0x62, 0x0a }, JsonLines.EncodeText("ab\n"));
    }

    [Fact]
    public void EncodeTextEncodesMultiByteUtf8()
    {
        Assert.Equal(new byte[] { 0xc3, 0xa9 }, JsonLines.EncodeText("é"));
        Assert.Equal(new byte[] { 0xf0, 0x9f, 0x98, 0x80 }, JsonLines.EncodeText("😀"));
    }

    [Fact]
    public void EncodeTextKeepsTheByteLengthDistinctFromTheStringLength()
    {
        Assert.Equal(2, JsonLines.EncodeText("é").Length);
        Assert.Empty(JsonLines.EncodeText(""));
    }

    [Fact]
    public void JsonLineSerializesOneObjectAndTerminatesTheLine()
    {
        Assert.Equal(
            "{\"a\":1,\"b\":\"x\"}\n",
            JsonLines.JsonLine(new Dictionary<string, object?> { ["a"] = 1, ["b"] = "x" }));
    }

    [Fact]
    public void JsonLineRoundTripsTheRecord()
    {
        var record = new Dictionary<string, object?>
        {
            ["seq"] = 3,
            ["source"] = "display",
            ["event"] = "shown",
            ["nested"] = new Dictionary<string, object?> { ["ok"] = true },
        };
        Assert.Equal(H.Json(record), H.Json(System.Text.Json.Nodes.JsonNode.Parse(JsonLines.JsonLine(record))));
    }

    [Fact]
    public void JsonLineNeverEmitsARawNewlineInsideTheLine()
    {
        var line = JsonLines.JsonLine(new Dictionary<string, object?> { ["text"] = "a\nb" });
        Assert.EndsWith("\n", line);
        Assert.DoesNotContain("\n", line[..^1]);
    }

    [Fact]
    public void DecodeTextDecodesUtf8ExactlyIncludingCharactersALatin1LoopMangled()
    {
        const string text = "café — 日本語 🚀 “quoted”";
        Assert.Equal(text, JsonLines.DecodeText(JsonLines.EncodeText(text)));
        Assert.Equal("é", JsonLines.DecodeText(new byte[] { 0xc3, 0xa9 }));
    }

    [Fact]
    public void DecodeTextRoundTripsATitleAcrossAReadWriteCycleWithoutDoubling()
    {
        const string original = "Büro – naïve façade";
        var once = JsonLines.DecodeText(JsonLines.EncodeText(original));
        var twice = JsonLines.DecodeText(JsonLines.EncodeText(once));
        Assert.Equal(original, once);
        Assert.Equal(original, twice);
    }

    [Fact]
    public void LineFramerEmitsOnlyCompleteNewlineTerminatedLines()
    {
        var framer = new JsonLines.LineFramer();
        var framed = framer.Push(JsonLines.EncodeText("{\"a\":1}\n{\"b\":2}\n"));
        Assert.Equal(new[] { "{\"a\":1}", "{\"b\":2}" }, framed.Lines);
        Assert.Equal(16, framed.Consumed);
        Assert.Equal(0, framer.BufferedBytes);
    }

    [Fact]
    public void LineFramerCarriesAPartialLineToTheNextChunk()
    {
        var framer = new JsonLines.LineFramer();
        var first = framer.Push(JsonLines.EncodeText("{\"a\":"));
        Assert.Empty(first.Lines);
        Assert.Equal(0, first.Consumed);
        Assert.Equal(5, framer.BufferedBytes);

        var second = framer.Push(JsonLines.EncodeText("1}\nnext"));
        Assert.Equal(new[] { "{\"a\":1}" }, second.Lines);
        Assert.Equal(8, second.Consumed);
        Assert.Equal(4, framer.BufferedBytes);
    }

    [Fact]
    public void LineFramerDecodesAMultiByteSequenceSplitAcrossChunks()
    {
        var bytes = JsonLines.EncodeText("é\n");
        var framer = new JsonLines.LineFramer();
        Assert.Empty(framer.Push(bytes[..1]).Lines);
        Assert.Equal(new[] { "é" }, framer.Push(bytes[1..]).Lines);
    }

    [Fact]
    public void LineFramerDoesNotAdvanceTheOffsetPastAPartialLine()
    {
        var framer = new JsonLines.LineFramer();
        var result = framer.Push(JsonLines.EncodeText("one\ntwo"));
        Assert.Equal(new[] { "one" }, result.Lines);
        Assert.Equal(4, result.Consumed);
    }

    [Fact]
    public void LineFramerDropsALineLongerThanTheCapWithoutBufferingIt()
    {
        var framer = new JsonLines.LineFramer(8);
        framer.Push(JsonLines.EncodeText("123456789"));
        Assert.Equal(0, framer.BufferedBytes);
        var result = framer.Push(JsonLines.EncodeText("still long\nok\n"));
        Assert.Equal(new[] { "ok" }, result.Lines);
        Assert.Equal(14, result.Consumed);
    }

    [Fact]
    public void LineFramerAcceptsCrlfLineEndings()
    {
        Assert.Equal(new[] { "a", "b" }, new JsonLines.LineFramer().Push(JsonLines.EncodeText("a\r\nb\r\n")).Lines);
    }

    [Fact]
    public void JsonlBufferDrainsNothingWhenEmpty()
    {
        Assert.Null(new JsonLines.JsonlBuffer().Drain());
    }

    [Fact]
    public void JsonlBufferJoinsTheBufferedLinesForOneDayIntoASingleBatch()
    {
        var buffer = new JsonLines.JsonlBuffer();
        buffer.Push("2026-10-01", "{\"n\":1}\n");
        buffer.Push("2026-10-01", "{\"n\":2}\n");
        Assert.Equal(2, buffer.Length);
        var batch = buffer.Drain();
        Assert.Equal("2026-10-01", batch?.Day);
        Assert.Equal("{\"n\":1}\n{\"n\":2}\n", batch?.Text);
        Assert.Equal(2, batch?.Count);
        Assert.Null(buffer.Drain());
        Assert.Equal(0, buffer.Length);
    }

    [Fact]
    public void JsonlBufferReportsADayRolloverOnlyWhileLinesArePending()
    {
        var buffer = new JsonLines.JsonlBuffer();
        Assert.False(buffer.RollsOver("2026-10-01"));
        buffer.Push("2026-10-01", "a\n");
        Assert.False(buffer.RollsOver("2026-10-01"));
        Assert.True(buffer.RollsOver("2026-10-02"));
        buffer.Drain();
        Assert.False(buffer.RollsOver("2026-10-02"));
    }

    [Fact]
    public void JsonlBufferTakesTheDayFromTheFirstLineOfABatch()
    {
        var buffer = new JsonLines.JsonlBuffer();
        buffer.Push("2026-10-02", "a\n");
        Assert.Equal("2026-10-02", buffer.Drain()?.Day);
    }
}
