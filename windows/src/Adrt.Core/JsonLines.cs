// Port of src/core/jsonl.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>
/// Shared JSONL primitives for the on-disk stores (history §21, journal §22,
/// recorder §22 extension). Each store still owns its directory, file layout,
/// rotation caps, retention window, stream and flush timer; these are only the pure
/// pieces they repeat: the local day key, UTF-8 line serialization, and the buffered
/// lines waiting for the next flush. No IO and no compositor API, so <c>core/</c>
/// stays pure and deterministic.
/// </summary>
public static class JsonLines
{
    /// <summary>One complete line is never allowed to buffer more than this while streaming.</summary>
    private const int MaxLineBytes = 1024 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        // JSON.stringify leaves non-ASCII text unescaped.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    /// <summary><c>YYYY-MM-DD</c> in local time, the day-file key the stores share.</summary>
    public static string DayString(DateTime date) =>
        $"{date.Year}-{date.Month.ToString("00", System.Globalization.CultureInfo.InvariantCulture)}" +
        $"-{date.Day.ToString("00", System.Globalization.CultureInfo.InvariantCulture)}";

    /// <summary>UTF-8 encode one line for a stream.</summary>
    public static byte[] EncodeText(string text) => Encoding.UTF8.GetBytes(text);

    /// <summary>
    /// Decode raw file bytes as UTF-8. The old Latin-1 loop
    /// (<c>String.fromCharCode(byte)</c>) turned every non-ASCII byte into a code
    /// point of its own; writing that string back as UTF-8 then doubled the mojibake
    /// on every read/write round-trip and grew the registry exponentially.
    /// </summary>
    public static string DecodeText(byte[] bytes) => Encoding.UTF8.GetString(bytes);

    /// <summary>One framing pass: the complete lines and how many raw bytes they used.</summary>
    public sealed record FramedLines
    {
        [JsonPropertyName("lines")] public required IReadOnlyList<string> Lines { get; init; }

        /// <summary>Bytes up to and including the last newline; safe to add to a read offset.</summary>
        [JsonPropertyName("consumed")] public required int Consumed { get; init; }
    }

    /// <summary>
    /// Incremental UTF-8 JSONL framing for streamed reads. Chunks may split a line
    /// anywhere (including inside a multi-byte UTF-8 sequence); only complete,
    /// newline-terminated lines are decoded and emitted. A partial trailing line
    /// stays buffered for the next chunk, and a line longer than
    /// <c>maxLineBytes</c> is dropped instead of buffering an unbounded string.
    ///
    /// Pure: the adapter owns the stream, this owns the boundaries. <c>Consumed</c>
    /// is byte-accurate, so a tail can resume where the previous pass stopped and a
    /// partial write is re-read once its newline arrives.
    /// </summary>
    public sealed class LineFramer
    {
        private readonly int _maxLineBytes;
        private byte[] _carry = [];
        private bool _skipping;

        public LineFramer(int maxLineBytes = MaxLineBytes)
        {
            _maxLineBytes = maxLineBytes;
        }

        /// <summary>Bytes held for a line whose newline has not arrived yet.</summary>
        public int BufferedBytes => _carry.Length;

        public FramedLines Push(byte[] chunk)
        {
            if (chunk.Length == 0) return new FramedLines { Lines = [], Consumed = 0 };
            var data = new byte[_carry.Length + chunk.Length];
            _carry.CopyTo(data, 0);
            chunk.CopyTo(data, _carry.Length);

            var lines = new List<string>();
            var start = 0;
            for (var index = 0; index < data.Length; index += 1)
            {
                if (data[index] != 0x0a) continue;
                var end = index;
                if (end > start && data[end - 1] == 0x0d) end -= 1;
                if (_skipping)
                {
                    _skipping = false;
                }
                else if (end - start <= _maxLineBytes)
                {
                    lines.Add(Encoding.UTF8.GetString(data, start, end - start));
                }
                start = index + 1;
            }

            _carry = data[start..];
            if (_carry.Length > _maxLineBytes)
            {
                // No newline in sight: discard the oversized line and keep scanning.
                _carry = [];
                _skipping = true;
            }
            return new FramedLines { Lines = lines, Consumed = start };
        }
    }

    /// <summary>One JSON line: <c>JSON.stringify</c> plus the newline the JSONL format needs.</summary>
    public static string JsonLine(object? value) => JsonSerializer.Serialize(value, JsonOptions) + "\n";

    /// <summary>One drained batch: the day it belongs to and its serialized lines.</summary>
    public sealed record JsonlBatch
    {
        [JsonPropertyName("day")] public required string Day { get; init; }
        [JsonPropertyName("text")] public required string Text { get; init; }
        [JsonPropertyName("count")] public required int Count { get; init; }
    }

    /// <summary>
    /// The lines a store accumulates between flushes. Pure: the store owns the
    /// timer, the stream and the rotation decision; this only remembers which day
    /// the pending lines belong to and hands them back as one batch. A batch never
    /// spans two days, because the store flushes before pushing a new day's line.
    /// </summary>
    public sealed class JsonlBuffer
    {
        private List<string> _lines = [];
        private string _day = string.Empty;

        public int Length => _lines.Count;

        /// <summary>True when lines are pending for a day other than <paramref name="day"/> (flush first).</summary>
        public bool RollsOver(string day) => _lines.Count > 0 && _day != day;

        /// <summary>Buffer one serialized line for <paramref name="day"/>.</summary>
        public void Push(string day, string line)
        {
            if (_lines.Count == 0) _day = day;
            _lines.Add(line);
        }

        /// <summary>Take every buffered line as one batch, or null when nothing is pending.</summary>
        public JsonlBatch? Drain()
        {
            if (_lines.Count == 0) return null;
            var batch = new JsonlBatch
            {
                Day = _day,
                Text = string.Concat(_lines),
                Count = _lines.Count,
            };
            _lines = [];
            _day = string.Empty;
            return batch;
        }
    }
}
