// Port of src/core/recording.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Adrt.Core;

/// <summary>
/// Start/stop bug recorder (§22 extension). The user reports a live graphical bug
/// but cannot say <b>when</b> it happened; one recording captures a bounded window
/// so they can hand over a timestamp and the matching log.
///
/// Everything here is pure so it can be unit tested without a Shell: the file
/// name, the cap/rotation decisions, the sample cadence and the line formats. The
/// recorder adapter owns the file, the listeners and the timer; this module never
/// touches IO, the compositor or the clock beyond a <c>Date</c> it is handed.
/// </summary>
public static class Recording
{
    /// <summary>Identifies a recording stream in its header, so a reader can tell it apart.</summary>
    private const string RecordingFormat = "adrt.recording";

    private const int RecordingVersion = 1;

    /// <summary>Bounds: ten minutes or fifty megabytes, whichever comes first.</summary>
    public const double DefaultMaxMs = 10 * 60 * 1000;

    public const double DefaultMaxBytes = 50 * 1024 * 1024;

    /// <summary>Only the newest ten recording files are kept (the oldest rotate away).</summary>
    public const int MaxRecordingFiles = 10;

    /// <summary>The minimum gap between two <c>state</c> snapshots: about 20 Hz.</summary>
    public const double SnapshotIntervalMs = 50;

    /// <summary>Bounds on the start trigger's optional <c>maxSeconds</c> cap.</summary>
    public const double MinCapSeconds = 1;

    public const double MaxCapSeconds = 60 * 60;

    /// <summary>The note a user types when a recording stops is bounded too (§22 extension).</summary>
    public const int NoteMaxLength = 2000;

    /// <summary>Recordings are pruned after the same 31-day window as the logs.</summary>
    public const double RecordingRetentionDays = 31;

    private const double MsPerDay = 24 * 60 * 60 * 1000;

    private static readonly Regex RecordingName = new(
        @"^rec-([0-9]{4})([0-9]{2})([0-9]{2})-([0-9]{2})([0-9]{2})([0-9]{2})(?:-[0-9]+)?\.jsonl$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    /// <summary>
    /// Clean a user note: normalise line endings, drop other control characters
    /// (keeping tab and newline), trim the edges and cap the length. The note is
    /// untrusted text headed for a JSONL file and the shell, so this is the one
    /// place it is made safe; JSON escaping itself is the serializer's job.
    /// </summary>
    public static string NormalizeNote(string text)
    {
        var normalized = text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
        var cleaned = new StringBuilder(normalized.Length);
        for (var index = 0; index < normalized.Length; index += 1)
        {
            var character = normalized[index];
            if (char.IsHighSurrogate(character) &&
                index + 1 < normalized.Length &&
                char.IsLowSurrogate(normalized[index + 1]))
            {
                cleaned.Append(character).Append(normalized[index + 1]);
                index += 1;
                continue;
            }
            var control = character == 0x7f || (character < 0x20 && character != '\n' && character != '\t');
            cleaned.Append(control ? ' ' : character);
        }
        var trimmed = cleaned.ToString().Trim();
        return trimmed.Length > NoteMaxLength ? trimmed[..NoteMaxLength] : trimmed;
    }

    /// <summary>
    /// Centre <paramref name="content"/> inside <paramref name="container"/>, as the
    /// on-screen rect the prompt's content box should occupy. Both sizes are rounded
    /// and the result is clamped to the container's top-left so a content larger
    /// than the screen still starts on-screen instead of at a negative offset. Pure,
    /// so the prompt's layout can be asserted without a Shell.
    /// </summary>
    public static Rect CenterRect(Size container, Size content)
    {
        var width = Math.Max(0, JsRound(double.IsFinite(content.Width) ? content.Width : 0));
        var height = Math.Max(0, JsRound(double.IsFinite(content.Height) ? content.Height : 0));
        var x = Math.Max(0, JsRound((container.Width - width) / 2));
        var y = Math.Max(0, JsRound((container.Height - height) / 2));
        return new Rect(x, y, width, height);
    }

    /// <summary>
    /// <c>rec-YYYYMMDD-HHMMSS.jsonl</c> from a local-time timestamp. One file per
    /// recording session, so the newest is always the one a user just produced.
    ///
    /// <paramref name="occurrence"/> disambiguates a second recording that starts in
    /// the <b>same</b> second: 1 is the plain name, 2 is <c>rec-…-2.jsonl</c>, and so
    /// on. The adapter picks the first name whose file does not exist, so two
    /// sessions in one second never interleave into one file.
    /// </summary>
    public static string RecordingFileName(DateTime date, double occurrence = 1)
    {
        var stamp =
            $"{date.Year.ToString(CultureInfo.InvariantCulture)}" +
            $"{Pad2(date.Month)}{Pad2(date.Day)}" +
            $"-{Pad2(date.Hour)}{Pad2(date.Minute)}{Pad2(date.Second)}";
        var suffix = occurrence > 1 ? $"-{Math.Floor(occurrence).ToString(CultureInfo.InvariantCulture)}" : string.Empty;
        return $"rec-{stamp}{suffix}.jsonl";
    }

    /// <summary>
    /// The duration cap to use for a start request, in milliseconds. An absent,
    /// non-finite or non-positive request falls back to the default; a real one is
    /// clamped to <c>[MIN_CAP_SECONDS, MAX_CAP_SECONDS]</c> so no trigger can ask for
    /// a recording that never ends or writes for a day.
    /// </summary>
    public static double ClampMaxSeconds(double? seconds, double fallbackMs = DefaultMaxMs)
    {
        if (seconds is null || !double.IsFinite(seconds.Value) || seconds.Value <= 0) return fallbackMs;
        var bounded = Math.Min(Math.Max(Math.Truncate(seconds.Value), MinCapSeconds), MaxCapSeconds);
        return bounded * 1000;
    }

    /// <summary>
    /// Why the recording must stop on its own, or null while it may continue. The
    /// byte cap is checked first: it is the one that keeps a pathological event
    /// flood from filling the disk before the next time check.
    /// </summary>
    public static CapReasonKind? CapReason(double elapsedMs, double bytes, double maxMs, double maxBytes)
    {
        if (maxBytes > 0 && bytes >= maxBytes) return CapReasonKind.Bytes;
        if (maxMs > 0 && elapsedMs >= maxMs) return CapReasonKind.Time;
        return null;
    }

    /// <summary>
    /// Names to delete so that at most <paramref name="keep"/> of
    /// <paramref name="names"/> remain. <paramref name="names"/> is sorted
    /// lexicographically — the <c>rec-YYYYMMDD-HHMMSS</c> prefix makes that
    /// chronological — and the oldest excess is returned. At least one name is
    /// always kept.
    /// </summary>
    public static IReadOnlyList<string> RecordingsToDelete(IReadOnlyList<string> names, double keep = MaxRecordingFiles)
    {
        var sorted = names.OrderBy(name => name, StringComparer.Ordinal).ToList();
        var bounded = double.IsFinite(keep) && keep >= 1 ? Math.Floor(keep) : 1;
        var excess = sorted.Count - bounded;
        return excess > 0 ? sorted.GetRange(0, (int)excess) : new List<string>();
    }

    /// <summary>Local timestamp encoded in a recording name, or null for a foreign name.</summary>
    public static double? RecordingTimestamp(string name)
    {
        var match = RecordingName.Match(name);
        if (!match.Success) return null;
        var year = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        var month = int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
        var day = int.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture);
        var hour = int.Parse(match.Groups[4].Value, CultureInfo.InvariantCulture);
        var minute = int.Parse(match.Groups[5].Value, CultureInfo.InvariantCulture);
        var second = int.Parse(match.Groups[6].Value, CultureInfo.InvariantCulture);
        // Reject an impossible date (`20261301` would otherwise roll into 2027).
        // The JS Date constructor maps years 0..99 into 1900..1999, so those can
        // never round-trip and are rejected up front.
        if (year < 100) return null;
        DateTime date;
        try
        {
            date = new DateTime(year, month, day, hour, minute, second, DateTimeKind.Unspecified);
        }
        catch (ArgumentOutOfRangeException)
        {
            return null;
        }
        var offset = TimeZoneInfo.Local.GetUtcOffset(date);
        return (double)new DateTimeOffset(date, offset).ToUnixTimeMilliseconds();
    }

    /// <summary>
    /// Recording names older than the retention window. Recordings are a bounded
    /// diagnostic aid, not a permanent log, so the same 31-day prune applies.
    /// </summary>
    public static IReadOnlyList<string> RecordingsExpired(
        IReadOnlyList<string> names,
        TimeProvider time,
        double retentionDays = RecordingRetentionDays) =>
        RecordingsExpired(names, time.GetLocalNow(), retentionDays);

    public static IReadOnlyList<string> RecordingsExpired(
        IReadOnlyList<string> names,
        DateTimeOffset now,
        double retentionDays = RecordingRetentionDays)
    {
        var days = double.IsFinite(retentionDays) && retentionDays > 0
            ? Math.Floor(retentionDays)
            : RecordingRetentionDays;
        var cutoff = now.ToUnixTimeMilliseconds() - days * MsPerDay;
        var output = new List<string>();
        foreach (var name in names)
        {
            var timestamp = RecordingTimestamp(name);
            if (timestamp is not null && timestamp.Value < cutoff) output.Add(name);
        }
        return output;
    }

    /// <summary>Whether a new state sample is due at the ~20 Hz cadence.</summary>
    public static bool SampleDue(double lastSampleMs, double nowMs, double intervalMs = SnapshotIntervalMs)
    {
        if (lastSampleMs <= 0) return true;
        return nowMs - lastSampleMs >= intervalMs;
    }

    /// <summary>
    /// A stable identity for a snapshot, so identical consecutive ones can be
    /// dropped and a still screen does not bloat the file. Snapshots are plain JSON
    /// data; an unserialisable one (never produced here) is a distinct key.
    /// </summary>
    public static string SnapshotKey(object? snapshot)
    {
        try
        {
            return JsonSerializer.Serialize(snapshot, JsonOptions);
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }

    /// <summary>
    /// One <c>header</c> line: the build, the environment and the full settings
    /// snapshot. The body is spread first so a field can never shadow the
    /// <c>kind</c> tag.
    /// </summary>
    public static Dictionary<string, object?> HeaderRecord(double at, IReadOnlyDictionary<string, object?> fields)
    {
        var record = CloneFields(fields);
        record["kind"] = "header";
        record["format"] = RecordingFormat;
        record["version"] = RecordingVersion;
        record["at"] = at;
        return record;
    }

    /// <summary>
    /// One <c>event</c> line: a journal/history record, reused verbatim but with the
    /// <c>kind</c>/<c>t</c> tag on top, so a record that itself carries a <c>kind</c>
    /// (a model event does) cannot masquerade as a header/footer. <c>t</c> is the
    /// record's own <c>at</c>; the body keeps every original field.
    /// </summary>
    public static Dictionary<string, object?> EventRecord(double t, IReadOnlyDictionary<string, object?> entry)
    {
        var record = CloneFields(entry);
        record["kind"] = "event";
        record["t"] = t;
        return record;
    }

    /// <summary>One <c>state</c> line: the periodic snapshot, inlined under the line timestamp.</summary>
    public static Dictionary<string, object?> StateRecord(double t, IReadOnlyDictionary<string, object?> snapshot)
    {
        var record = CloneFields(snapshot);
        record["kind"] = "state";
        record["t"] = t;
        return record;
    }

    /// <summary>
    /// One <c>note</c> line: what the user observed, written <b>before</b> the footer
    /// after a user-initiated stop. Add-only, so a reader that does not know it can
    /// ignore it; the footer also carries the same text so the file is
    /// self-contained from its last line alone.
    /// </summary>
    public static Dictionary<string, object?> NoteRecord(double t, string text) => new(StringComparer.Ordinal)
    {
        ["kind"] = "note",
        ["t"] = t,
        ["text"] = text,
    };

    /// <summary>One <c>footer</c> line: why and when the recording ended, and its totals.</summary>
    public static Dictionary<string, object?> FooterRecord(double at, IReadOnlyDictionary<string, object?> fields)
    {
        var record = CloneFields(fields);
        record["kind"] = "footer";
        record["at"] = at;
        return record;
    }

    /// <summary>
    /// A recording's size, as a short human string. Binary units, because that is
    /// what the file's byte count actually measures: 1536 bytes is "1.5 KiB".
    /// </summary>
    public static string FormatBytes(double bytes)
    {
        var n = double.IsFinite(bytes) && bytes > 0 ? Math.Floor(bytes) : 0;
        if (n < 1024) return $"{Number(n)} B";
        string[] units = ["KiB", "MiB", "GiB"];
        var value = n / 1024;
        var unit = 0;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit += 1;
        }
        var amount = value < 10
            ? value.ToString("0.0", CultureInfo.InvariantCulture)
            : Number(JsRound(value));
        return $"{amount} {units[unit]}";
    }

    /// <summary>
    /// Parse a recording file into the summary the prefs window shows. Only the
    /// header, the note and the footer are read line-by-line, and every line is
    /// tolerated on its own: a truncated or half-written file still yields a usable
    /// summary rather than throwing in the preferences process. Nothing here touches
    /// IO — the caller passes the file's text and byte size.
    /// </summary>
    public static RecordingSummary SummarizeRecording(string name, double bytes, string text)
    {
        var stopReason = (string?)null;
        var note = string.Empty;
        var durationMs = 0.0;
        var open = true;
        foreach (var line in text.Split('\n'))
        {
            if (line.Length == 0) continue;
            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(line);
            }
            catch (JsonException)
            {
                continue;
            }
            using (document)
            {
                var row = document.RootElement;
                if (row.ValueKind != JsonValueKind.Object) continue;
                var kind = StringValue(row, "kind");
                if (kind == "note")
                {
                    note = StringValue(row, "text") ?? note;
                }
                else if (kind == "footer")
                {
                    open = false;
                    note = StringValue(row, "note") ?? note;
                    stopReason = StringValue(row, "reason") ?? stopReason;
                    if (row.TryGetProperty("durationMs", out var duration) &&
                        duration.ValueKind == JsonValueKind.Number &&
                        duration.TryGetDouble(out var parsed) &&
                        double.IsFinite(parsed))
                    {
                        durationMs = Math.Max(0, parsed);
                    }
                }
            }
        }
        return new RecordingSummary
        {
            Name = name,
            Timestamp = RecordingTimestamp(name) ?? 0,
            Bytes = double.IsFinite(bytes) && bytes > 0 ? Math.Floor(bytes) : 0,
            StopReason = stopReason,
            Note = note,
            DurationMs = durationMs,
            Open = open,
        };
    }

    /// <summary>
    /// Summaries newest first. The name's timestamp is the sort key, so a file whose
    /// name does not parse falls to the end; equal timestamps break on the name, so
    /// the order is stable and the same list is shown every open.
    /// </summary>
    public static IReadOnlyList<RecordingSummary> SortRecordingsNewest(IReadOnlyList<RecordingSummary> rows) =>
        rows.OrderByDescending(row => row.Timestamp)
            .ThenByDescending(row => row.Name, StringComparer.Ordinal)
            .ToList();

    /// <summary>
    /// Which of <paramref name="names"/> the user asked to remove, validated against
    /// what is on disk. Only names that are present are returned, and only ones that
    /// look like a recording, so a stale selection can never delete an unrelated
    /// file.
    /// </summary>
    public static IReadOnlyList<string> RecordingsToRemove(
        IReadOnlyList<string> names,
        IReadOnlyList<string> present)
    {
        var available = new HashSet<string>(present, StringComparer.Ordinal);
        return names.Where(name => available.Contains(name) && RecordingName.IsMatch(name)).ToList();
    }

    private static Dictionary<string, object?> CloneFields(IReadOnlyDictionary<string, object?> fields)
    {
        var record = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var pair in fields) record[pair.Key] = pair.Value;
        return record;
    }

    private static string? StringValue(JsonElement row, string property) =>
        row.TryGetProperty(property, out var element) && element.ValueKind == JsonValueKind.String
            ? element.GetString()
            : null;

    private static string Pad2(int value) => value.ToString("00", CultureInfo.InvariantCulture);

    /// <summary>JS <c>Math.round</c>: nearest integer, halves away from zero for positives.</summary>
    private static double JsRound(double value) => Math.Floor(value + 0.5);

    /// <summary>JS <c>Number#toString</c> for byte counts (integral doubles stay bare).</summary>
    private static string Number(double value) =>
        value == 0 ? "0" : value.ToString("R", CultureInfo.InvariantCulture);
}

/// <summary>Why a recording stopped. <c>user</c> and <c>disable</c> are explicit; <c>cap</c> is a bound.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum StopReason
{
    [JsonStringEnumMemberName("user")] User,
    [JsonStringEnumMemberName("cap")] Cap,
    [JsonStringEnumMemberName("disable")] Disable,
}

/// <summary>The <c>capReason</c> answer: which bound stopped the recording.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum CapReasonKind
{
    [JsonStringEnumMemberName("time")] Time,
    [JsonStringEnumMemberName("bytes")] Bytes,
}

/// <summary>A recording file's identity plus what the prefs window shows about it.</summary>
public sealed record RecordingSummary
{
    /// <summary>File name, e.g. <c>rec-20261021-080540.jsonl</c>.</summary>
    [JsonPropertyName("name")] public required string Name { get; init; }

    /// <summary>Local timestamp encoded in the name, or 0 when the name is foreign.</summary>
    [JsonPropertyName("timestamp")] public required double Timestamp { get; init; }

    /// <summary>File size in bytes, as reported by the caller.</summary>
    [JsonPropertyName("bytes")] public required double Bytes { get; init; }

    /// <summary>The reason the recording stopped (<c>user</c>, <c>cap</c>, <c>disable</c>), or null.</summary>
    [JsonPropertyName("stopReason")] public string? StopReason { get; init; }

    /// <summary>The user's observation note, or ''.</summary>
    [JsonPropertyName("note")] public required string Note { get; init; }

    /// <summary>How long the recording ran, in milliseconds, or 0 when unknown.</summary>
    [JsonPropertyName("durationMs")] public required double DurationMs { get; init; }

    /// <summary>True when the file has no footer (still recording, or truncated).</summary>
    [JsonPropertyName("open")] public required bool Open { get; init; }
}
