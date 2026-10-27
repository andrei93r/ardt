// Port of src/core/rotation.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Globalization;

namespace Adrt.Core;

/// <summary>
/// History log rotation (§21). One JSONL file per day, split into numbered parts
/// so no single file can grow without limit (a 268 MB file once exhausted memory
/// and crashed the Shell).
/// </summary>
public static class Rotation
{
    /// <summary>Exactly this many days of extension logs are kept.</summary>
    public const double LogRetentionDays = 31;

    private const double MsPerDay = 24 * 60 * 60 * 1000;

    /// <summary>
    /// The <c>YYYY-MM-DD</c> day before which files are expired, given a retention
    /// window.
    /// </summary>
    public static string RetentionCutoffDay(TimeProvider time, double retentionDays = LogRetentionDays) =>
        RetentionCutoffDay(time.GetLocalNow(), retentionDays);

    public static string RetentionCutoffDay(DateTimeOffset now, double retentionDays = LogRetentionDays)
    {
        var days = double.IsFinite(retentionDays) && retentionDays > 0 ? Math.Floor(retentionDays) : LogRetentionDays;
        var cutoff = now.AddMilliseconds(-days * MsPerDay).ToLocalTime();
        var year = cutoff.Year.ToString(CultureInfo.InvariantCulture);
        var month = cutoff.Month.ToString("00", CultureInfo.InvariantCulture);
        var day = cutoff.Day.ToString("00", CultureInfo.InvariantCulture);
        return $"{year}-{month}-{day}";
    }

    /// <summary>
    /// Whether a day file is older than the retention window. The cutoff day itself
    /// is kept; a file dated before it is expired. Day strings sort chronologically.
    /// </summary>
    public static bool IsDayExpired(string day, TimeProvider time, double retentionDays = LogRetentionDays) =>
        IsDayExpired(day, time.GetLocalNow(), retentionDays);

    public static bool IsDayExpired(string day, DateTimeOffset now, double retentionDays = LogRetentionDays) =>
        string.CompareOrdinal(day, RetentionCutoffDay(now, retentionDays)) < 0;

    /// <summary>Whether the current part has grown to the rotation threshold.</summary>
    public static bool ShouldRotate(double currentBytes, double maxBytes)
    {
        if (!double.IsFinite(maxBytes) || maxBytes <= 0) return false;
        return currentBytes >= maxBytes;
    }

    /// <summary>
    /// Path of a rotated part. Part 1 is the live file itself; parts 2..N are the
    /// older ones, highest number oldest.
    ///   "/x/2026-09-30.jsonl", 2 -> "/x/2026-09-30.2.jsonl"
    /// </summary>
    public static string PartPath(string basePath, double part)
    {
        if (part <= 1) return basePath;
        var suffix = $".{Number(part)}.jsonl";
        return basePath.EndsWith(".jsonl", StringComparison.Ordinal)
            ? basePath[..^6] + suffix
            : basePath;
    }

    /// <summary>
    /// Part numbers to delete so that at most <paramref name="maxParts"/> remain
    /// (highest first). At least one part (the live file) is always kept, so a cap
    /// below 1 is treated as 1.
    /// </summary>
    public static IReadOnlyList<int> PartsToPrune(int highestPart, double maxParts)
    {
        var keep = double.IsFinite(maxParts) && maxParts >= 1 ? Math.Floor(maxParts) : 1;
        var output = new List<int>();
        for (var part = highestPart; part > keep; part--) output.Add(part);
        return output;
    }

    /// <summary>JS <c>Number#toString</c> for part numbers (integral doubles stay bare).</summary>
    private static string Number(double value) =>
        value == 0 ? "0" : value.ToString("R", CultureInfo.InvariantCulture);
}
