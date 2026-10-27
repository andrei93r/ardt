// Port of src/core/registry-file.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>
/// Registry-file policy, separate from the platform IO that applies it.
///
/// A 201 MB <c>registry.json</c> once made startup parse it in one piece and the
/// Shell died of OOM before any policy could run. The file is therefore gated by
/// size <b>before</b> it is read: an oversized or unparseable file is moved aside
/// (gzipped into <c>backups/</c>) and startup continues with an empty registry.
/// </summary>
public static class RegistryFile
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    /// <summary>What startup may do with a file of <paramref name="size"/> bytes (null = stat failed).</summary>
    public static RegistryFileActionKind RegistryFileAction(
        double? size,
        double maxBytes = AppRegistry.MaxRegistryBytes)
    {
        if (size is null || !double.IsFinite(size.Value) || size.Value < 0) return RegistryFileActionKind.Missing;
        return size.Value > maxBytes ? RegistryFileActionKind.Quarantine : RegistryFileActionKind.Load;
    }

    /// <summary>Serialized size of a registry payload, in UTF-8 bytes.</summary>
    public static double RegistryBytes(object? data) => Text.Utf8ByteLength(JsonSerializer.Serialize(data, JsonOptions));

    /// <summary>
    /// Backup name for a quarantined registry, e.g.
    /// <c>registry.oversize-20261018-123830.json.gz</c>. The suffix says why, so a
    /// later diagnosis never mistakes it for a live file.
    /// </summary>
    public static string QuarantineFileName(RegistryQuarantineReason reason, TimeProvider time) =>
        QuarantineFileName(reason, time.GetLocalNow());

    public static string QuarantineFileName(RegistryQuarantineReason reason, DateTimeOffset now)
    {
        var stamp = $"{now.Year.ToString(CultureInfo.InvariantCulture)}" +
            $"{Pad2(now.Month)}{Pad2(now.Day)}" +
            $"-{Pad2(now.Hour)}{Pad2(now.Minute)}{Pad2(now.Second)}";
        var suffix = reason == RegistryQuarantineReason.Oversize ? "oversize" : "corrupt";
        return $"registry.{suffix}-{stamp}.json.gz";
    }

    private static string Pad2(int value) => value.ToString("00", CultureInfo.InvariantCulture);
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum RegistryFileActionKind
{
    [JsonStringEnumMemberName("missing")] Missing,
    [JsonStringEnumMemberName("load")] Load,
    [JsonStringEnumMemberName("quarantine")] Quarantine,
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum RegistryQuarantineReason
{
    [JsonStringEnumMemberName("oversize")] Oversize,
    [JsonStringEnumMemberName("corrupt")] Corrupt,
}
