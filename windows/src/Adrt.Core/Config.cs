// Port of src/core/config.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Adrt.Core;

/*
 * Config bundle format, normalization and merge logic (§19.2).
 *
 * `core/` may not import from `platform/`, so the scalar value union is
 * redeclared here. `platform/settings.ts` exposes the identical shape.
 */

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum ImportMode
{
    [JsonStringEnumMemberName("merge")] Merge,
    [JsonStringEnumMemberName("replace")] Replace,
}

/// <summary>§9.4</summary>
public sealed record AdaptationRecord
{
    [JsonPropertyName("appId")] public required string AppId { get; init; }
    [JsonPropertyName("firstSeen")] public required double FirstSeen { get; init; }
    [JsonPropertyName("lastSeen")] public required double LastSeen { get; init; }
    [JsonPropertyName("observations")] public required double Observations { get; init; }

    [JsonPropertyName("unmaximizeDelayEma")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? UnmaximizeDelayEma { get; init; }

    [JsonPropertyName("settleTimeEma")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? SettleTimeEma { get; init; }

    [JsonPropertyName("refusedMinW")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? RefusedMinW { get; init; }

    [JsonPropertyName("refusedMinH")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? RefusedMinH { get; init; }

    [JsonPropertyName("acceptedW")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? AcceptedW { get; init; }

    [JsonPropertyName("acceptedH")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? AcceptedH { get; init; }

    [JsonPropertyName("skipAnimation")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? SkipAnimation { get; init; }
}

/// <summary>The serialised app registry, as carried by a v4 bundle.</summary>
public sealed record BundleRegistry
{
    [JsonPropertyName("version")] public required double Version { get; init; }
    [JsonPropertyName("entries")] public required IReadOnlyList<object?> Entries { get; init; }
}

public sealed record BundleTracked
{
    [JsonPropertyName("adaptations")] public required Dictionary<string, AdaptationRecord> Adaptations { get; init; }
    [JsonPropertyName("behavior")] public required Dictionary<string, object?> Behavior { get; init; }

    /// <summary>§12: the app registry state (v4). Absent when reading a v3 bundle.</summary>
    [JsonPropertyName("registry")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public BundleRegistry? Registry { get; init; }
}

public sealed record Bundle
{
    [JsonPropertyName("format")] public required string Format { get; init; }
    [JsonPropertyName("version")] public required double Version { get; init; }
    [JsonPropertyName("exportedAt")] public required string ExportedAt { get; init; }
    [JsonPropertyName("settings")] public required Dictionary<string, object?> Settings { get; init; }
    [JsonPropertyName("tracked")] public required BundleTracked Tracked { get; init; }
}

public sealed record MergeReport
{
    [JsonPropertyName("applied")] public required IReadOnlyList<string> Applied { get; init; }
    [JsonPropertyName("skipped")] public required IReadOnlyList<string> Skipped { get; init; }
}

public sealed record MergeResult<T>
{
    [JsonPropertyName("record")] public required T Record { get; init; }
    [JsonPropertyName("report")] public required MergeReport Report { get; init; }
}

public sealed record BundleMergeResult
{
    [JsonPropertyName("bundle")] public required Bundle Bundle { get; init; }
    [JsonPropertyName("settings")] public required MergeReport Settings { get; init; }
    [JsonPropertyName("adaptations")] public required MergeReport Adaptations { get; init; }
    [JsonPropertyName("behavior")] public required MergeReport Behavior { get; init; }
}

public static class Config
{
    public const string BundleFormat = "adrt.config";

    /// <summary>
    /// §12/Stage 4: v4 folds `adaptation.json`, `behavior.json` and `exception-apps`
    /// into the app registry. A v3 bundle is read by the same normaliser and its
    /// registry field is synthesised from the legacy stores; a bundle newer than
    /// this constant is refused rather than downgraded.
    /// </summary>
    public const double BundleVersion = 4;

    private const string EpochIso = "1970-01-01T00:00:00.000Z";

    private static readonly IReadOnlySet<string> DeepMergeKeys = new HashSet<string> { "classes", "floats" };

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>
    /// Normalize a parsed bundle. Version 2 placed `adaptations` and `behavior` at
    /// the top level; both shapes map onto the v3 `tracked` object.
    /// </summary>
    public static Bundle? NormalizeBundle(JsonNode? raw, List<string>? errors = null)
    {
        errors ??= new List<string>();
        if (raw is not JsonObject root)
        {
            errors.Add("bundle must be a JSON object");
            return null;
        }
        if (!IsString(root["format"], BundleFormat))
        {
            errors.Add($"bundle format must be \"{BundleFormat}\"");
            return null;
        }
        var version = IsNumber(root["version"]) ? root["version"]!.GetValue<double>() : 0;
        if (version > BundleVersion)
        {
            errors.Add(FormattableString.Invariant($"bundle version {version} is newer than {BundleVersion}"));
            return null;
        }

        var settings = new Dictionary<string, object?>();
        if (root.TryGetPropertyValue("settings", out var settingsNode))
        {
            if (settingsNode is JsonObject settingsObject)
            {
                foreach (var (key, value) in settingsObject)
                {
                    if (TryConfigValue(value, out var configValue)) settings[key] = configValue;
                    else errors.Add($"settings.{key} has an unsupported value");
                }
            }
            else
            {
                errors.Add("settings must be an object");
            }
        }

        var adaptations = new Dictionary<string, AdaptationRecord>();
        var tracked = root["tracked"] as JsonObject;
        var adaptationSource = CoalesceProperty(tracked, root, "adaptations", out var adaptationPresent);
        if (adaptationSource is JsonObject adaptationObject)
        {
            foreach (var (appId, record) in adaptationObject)
            {
                if (record is JsonObject recordObject) adaptations[appId] = ReadAdaptation(appId, recordObject);
                else errors.Add($"adaptations.{appId} must be an object");
            }
        }
        else if (adaptationPresent)
        {
            errors.Add("adaptations must be an object");
        }

        var behaviorSource = CoalesceProperty(tracked, root, "behavior", out _);
        var behavior = behaviorSource is JsonObject behaviorObject
            ? FromJson(behaviorObject) as Dictionary<string, object?> ?? new Dictionary<string, object?>()
            : new Dictionary<string, object?>();

        BundleRegistry? registry = null;
        if (tracked?["registry"] is JsonObject registryObject && registryObject["entries"] is JsonArray registryEntries)
        {
            var registryVersion = IsNumber(registryObject["version"]) ? registryObject["version"]!.GetValue<double>() : 1;
            var entries = new List<object?>(registryEntries.Count);
            foreach (var entry in registryEntries) entries.Add(FromJson(entry));
            registry = new BundleRegistry { Version = registryVersion, Entries = entries };
        }

        var exportedAt = root["exportedAt"] is JsonValue exportedValue &&
                         exportedValue.GetValueKind() == JsonValueKind.String
            ? exportedValue.GetValue<string>()
            : EpochIso;

        return new Bundle
        {
            Format = BundleFormat,
            Version = version,
            ExportedAt = exportedAt,
            Settings = settings,
            Tracked = new BundleTracked
            {
                Adaptations = adaptations,
                Behavior = behavior,
                Registry = registry,
            },
        };
    }

    public static (Bundle? Bundle, IReadOnlyList<string> Errors) ParseBundle(string json)
    {
        var errors = new List<string>();
        JsonNode? raw;
        try
        {
            raw = JsonNode.Parse(json);
        }
        catch (JsonException e)
        {
            return (null, new List<string> { $"bundle is not valid JSON: {e.Message}" });
        }
        var bundle = NormalizeBundle(raw, errors);
        return (bundle, errors);
    }

    public static string SerializeBundle(Bundle bundle) => JsonSerializer.Serialize(bundle, SerializerOptions);

    /// <summary>
    /// Merge behavior-style records. `merge` deepens only `classes` and `floats`
    /// by one level; every other key is replaced by the incoming value (§19.2).
    /// </summary>
    public static MergeResult<Dictionary<string, object?>> MergeRecords(
        IReadOnlyDictionary<string, object?> @base,
        IReadOnlyDictionary<string, object?> incoming,
        ImportMode mode)
    {
        if (mode == ImportMode.Replace)
        {
            return new MergeResult<Dictionary<string, object?>>
            {
                Record = new Dictionary<string, object?>(incoming),
                Report = new MergeReport { Applied = incoming.Keys.ToList(), Skipped = @base.Keys.ToList() },
            };
        }
        var record = new Dictionary<string, object?>(@base);
        var applied = new List<string>();
        foreach (var (key, value) in incoming)
        {
            var existingRecord = @base.TryGetValue(key, out var existing) ? AsRecord(existing) : null;
            var incomingRecord = AsRecord(value);
            if (DeepMergeKeys.Contains(key) && existingRecord is not null && incomingRecord is not null)
            {
                var merged = new Dictionary<string, object?>(existingRecord);
                foreach (var (innerKey, innerValue) in incomingRecord) merged[innerKey] = innerValue;
                record[key] = merged;
            }
            else
            {
                record[key] = value;
            }
            applied.Add(key);
        }
        var skipped = @base.Keys.Where(key => !incoming.ContainsKey(key)).ToList();
        return new MergeResult<Dictionary<string, object?>>
        {
            Record = record,
            Report = new MergeReport { Applied = applied, Skipped = skipped },
        };
    }

    /// <summary>
    /// Merge adaptation records one level deep per app (§19.2). `replace` discards
    /// the base map entirely.
    /// </summary>
    public static MergeResult<Dictionary<string, AdaptationRecord>> MergeAdaptations(
        IReadOnlyDictionary<string, AdaptationRecord> @base,
        IReadOnlyDictionary<string, AdaptationRecord> incoming,
        ImportMode mode)
    {
        if (mode == ImportMode.Replace)
        {
            return new MergeResult<Dictionary<string, AdaptationRecord>>
            {
                Record = new Dictionary<string, AdaptationRecord>(incoming),
                Report = new MergeReport { Applied = incoming.Keys.ToList(), Skipped = @base.Keys.ToList() },
            };
        }
        var record = new Dictionary<string, AdaptationRecord>(@base);
        var applied = new List<string>();
        foreach (var (appId, adaptation) in incoming)
        {
            record[appId] = @base.TryGetValue(appId, out var previous)
                ? MergeAdaptation(previous, adaptation)
                : adaptation;
            applied.Add(appId);
        }
        var skipped = @base.Keys.Where(appId => !incoming.ContainsKey(appId)).ToList();
        return new MergeResult<Dictionary<string, AdaptationRecord>>
        {
            Record = record,
            Report = new MergeReport { Applied = applied, Skipped = skipped },
        };
    }

    /// <summary>
    /// Merge two bundles. The merged bundle's `exportedAt` is an *input* (P6d): the
    /// pure core never reads the wall clock. It defaults to the epoch sentinel,
    /// which is deterministic; callers that care about the timestamp pass one.
    /// </summary>
    public static BundleMergeResult MergeBundles(
        Bundle @base,
        Bundle incoming,
        ImportMode mode,
        string exportedAt = EpochIso)
    {
        Dictionary<string, object?> settings;
        MergeReport settingsReport;
        if (mode == ImportMode.Replace)
        {
            settings = new Dictionary<string, object?>(incoming.Settings);
            settingsReport = new MergeReport
            {
                Applied = incoming.Settings.Keys.ToList(),
                Skipped = @base.Settings.Keys.ToList(),
            };
        }
        else
        {
            settings = new Dictionary<string, object?>(@base.Settings);
            foreach (var (key, value) in incoming.Settings) settings[key] = value;
            settingsReport = new MergeReport
            {
                Applied = incoming.Settings.Keys.ToList(),
                Skipped = @base.Settings.Keys.Where(key => !incoming.Settings.ContainsKey(key)).ToList(),
            };
        }

        var adaptations = MergeAdaptations(@base.Tracked.Adaptations, incoming.Tracked.Adaptations, mode);
        var behavior = MergeRecords(@base.Tracked.Behavior, incoming.Tracked.Behavior, mode);
        // The serialised registry is opaque to this module (`AppRegistry` owns entry
        // merging), so it is carried through by reference: in merge mode the incoming
        // one wins and falls back to the base; replace mode takes the incoming one
        // wholesale. Rebuilding `tracked` without it silently dropped every placement.
        var registry = mode == ImportMode.Replace
            ? incoming.Tracked.Registry
            : incoming.Tracked.Registry ?? @base.Tracked.Registry;

        return new BundleMergeResult
        {
            Bundle = new Bundle
            {
                Format = BundleFormat,
                Version = BundleVersion,
                ExportedAt = exportedAt,
                Settings = settings,
                Tracked = new BundleTracked
                {
                    Adaptations = adaptations.Record,
                    Behavior = behavior.Record,
                    Registry = registry,
                },
            },
            Settings = settingsReport,
            Adaptations = adaptations.Report,
            Behavior = behavior.Report,
        };
    }

    private static JsonNode? CoalesceProperty(JsonObject? tracked, JsonObject root, string name, out bool present)
    {
        JsonNode? candidate = null;
        if (tracked is not null) tracked.TryGetPropertyValue(name, out candidate);
        if (candidate is not null)
        {
            present = true;
            return candidate;
        }
        if (root.TryGetPropertyValue(name, out var fallback))
        {
            present = true;
            return fallback;
        }
        present = false;
        return null;
    }

    private static AdaptationRecord ReadAdaptation(string appId, JsonObject record)
    {
        var result = new AdaptationRecord
        {
            AppId = appId,
            FirstSeen = 0,
            LastSeen = 0,
            Observations = 0,
        };
        if (record["appId"] is JsonValue appIdValue && appIdValue.GetValueKind() == JsonValueKind.String)
        {
            result = result with { AppId = appIdValue.GetValue<string>() };
        }
        if (TryNumber(record, "firstSeen", out var firstSeen)) result = result with { FirstSeen = firstSeen };
        if (TryNumber(record, "lastSeen", out var lastSeen)) result = result with { LastSeen = lastSeen };
        if (TryNumber(record, "observations", out var observations)) result = result with { Observations = observations };
        if (TryNumber(record, "unmaximizeDelayEma", out var unmaximizeDelayEma))
        {
            result = result with { UnmaximizeDelayEma = unmaximizeDelayEma };
        }
        if (TryNumber(record, "settleTimeEma", out var settleTimeEma)) result = result with { SettleTimeEma = settleTimeEma };
        if (TryNumber(record, "refusedMinW", out var refusedMinW)) result = result with { RefusedMinW = refusedMinW };
        if (TryNumber(record, "refusedMinH", out var refusedMinH)) result = result with { RefusedMinH = refusedMinH };
        if (TryNumber(record, "acceptedW", out var acceptedW)) result = result with { AcceptedW = acceptedW };
        if (TryNumber(record, "acceptedH", out var acceptedH)) result = result with { AcceptedH = acceptedH };
        if (record["skipAnimation"] is JsonValue skipValue &&
            skipValue.GetValueKind() is JsonValueKind.True or JsonValueKind.False)
        {
            result = result with { SkipAnimation = skipValue.GetValue<bool>() };
        }
        return result;
    }

    private static AdaptationRecord MergeAdaptation(AdaptationRecord previous, AdaptationRecord incoming) => incoming with
    {
        UnmaximizeDelayEma = incoming.UnmaximizeDelayEma ?? previous.UnmaximizeDelayEma,
        SettleTimeEma = incoming.SettleTimeEma ?? previous.SettleTimeEma,
        RefusedMinW = incoming.RefusedMinW ?? previous.RefusedMinW,
        RefusedMinH = incoming.RefusedMinH ?? previous.RefusedMinH,
        AcceptedW = incoming.AcceptedW ?? previous.AcceptedW,
        AcceptedH = incoming.AcceptedH ?? previous.AcceptedH,
        SkipAnimation = incoming.SkipAnimation ?? previous.SkipAnimation,
    };

    private static bool IsString(JsonNode? node, string expected) =>
        node is JsonValue value &&
        value.GetValueKind() == JsonValueKind.String &&
        value.GetValue<string>() == expected;

    private static bool IsNumber(JsonNode? node) =>
        node is JsonValue value && value.GetValueKind() == JsonValueKind.Number;

    private static bool TryNumber(JsonObject record, string name, out double number)
    {
        if (record[name] is JsonValue value && value.GetValueKind() == JsonValueKind.Number)
        {
            number = value.GetValue<double>();
            return true;
        }
        number = 0;
        return false;
    }

    private static bool TryConfigValue(JsonNode? value, out object? result)
    {
        result = null;
        if (value is JsonArray array)
        {
            if (!array.All(item => item is JsonValue v && v.GetValueKind() == JsonValueKind.String)) return false;
            var strings = new List<string>(array.Count);
            foreach (var item in array) strings.Add(item!.GetValue<string>());
            result = strings;
            return true;
        }
        if (value is not JsonValue jsonValue) return false;
        switch (jsonValue.GetValueKind())
        {
            case JsonValueKind.Number:
                result = jsonValue.GetValue<double>();
                return true;
            case JsonValueKind.String:
                result = jsonValue.GetValue<string>();
                return true;
            case JsonValueKind.True:
                result = true;
                return true;
            case JsonValueKind.False:
                result = false;
                return true;
            default:
                return false;
        }
    }

    private static object? FromJson(JsonNode? node)
    {
        switch (node)
        {
            case null:
                return null;
            case JsonObject obj:
                var map = new Dictionary<string, object?>(obj.Count);
                foreach (var (key, item) in obj) map[key] = FromJson(item);
                return map;
            case JsonArray array:
                var list = new List<object?>(array.Count);
                foreach (var item in array) list.Add(FromJson(item));
                return list;
            case JsonValue value:
                switch (value.GetValueKind())
                {
                    case JsonValueKind.Number:
                        return value.GetValue<double>();
                    case JsonValueKind.String:
                        return value.GetValue<string>();
                    case JsonValueKind.True:
                        return true;
                    case JsonValueKind.False:
                        return false;
                    default:
                        return value.DeepClone();
                }
            default:
                return null;
        }
    }

    private static Dictionary<string, object?>? AsRecord(object? value) => value switch
    {
        Dictionary<string, object?> map => map,
        JsonObject obj => obj.ToDictionary(pair => pair.Key, pair => FromJson(pair.Value)),
        IReadOnlyDictionary<string, object?> readOnly =>
            readOnly.ToDictionary(pair => pair.Key, pair => pair.Value),
        _ => null,
    };
}
