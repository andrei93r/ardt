// Port of src/core/appregistry.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>
/// §12 app registry: one auto-populated entry per app.
///
/// The registry merges the three legacy stores — <c>adaptation.json</c>,
/// <c>behavior.json</c> and the <c>exception-apps</c> list — into one entry that
/// logs every app seen, holds the durable <c>neverTile</c> decision, timing-only
/// adaptation hints, a behaviour profile and the per-app placements. It is pure:
/// the platform layer parses the legacy files and the settings list, and this
/// module only folds them in.
///
/// <c>adapt</c> is performance and smoothness only. It carries delays, settle,
/// animation skip and retry counts; it can never carry geometry, and no learned
/// minimum ever reaches the tiler. The migration drops every geometric field of
/// the legacy adaptation record on purpose.
///
/// Placements are keyed by instance id and each one carries a durable per-app
/// ordinal (<c>#1</c>, <c>#2</c>, …). The ordinal counter only ever rolls forward,
/// so windows recreated after a restart match the previous session in order.
/// </summary>
public sealed class AppRegistry
{
    public const double DefaultTtlMs = 30d * 24 * 60 * 60 * 1000;
    public const int RegistryVersion = 1;

    /// <summary>Most placements kept per app; window recreation only needs a handful.</summary>
    public const int MaxPlacementsPerApp = 64;

    /// <summary>Hard cap on the serialized registry file (bytes).</summary>
    public const double MaxRegistryBytes = 4 * 1024 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    private readonly OrderedDictionary<string, AppEntry> _table = new(StringComparer.Ordinal);
    private readonly double _ttlMs;
    private readonly TimeProvider _time;

    public AppRegistry(AppRegistryOptions? options = null, TimeProvider? time = null)
    {
        _ttlMs = options?.TtlMs ?? DefaultTtlMs;
        _time = time ?? TimeProvider.System;
    }

    public int Size => _table.Count;

    public bool Has(string appId) => _table.ContainsKey(appId);

    public AppEntry? Get(string appId) => _table.TryGetValue(appId, out var entry) ? entry : null;

    public IReadOnlyList<AppEntry> Entries() => [.. _table.Values];

    /// <summary>Log a window opening: auto-populate the entry and count it.</summary>
    public AppEntry Observe(AppObservation observation)
    {
        var now = observation.Now ?? Now();
        var entry = Ensure(observation.AppId, now);
        entry.LastSeen = now;
        entry.WindowsSeen += 1;
        // A title is client text. Clipping here (not only at serialization) keeps a
        // pathological title out of memory, the journal and DumpState too.
        if (observation.Title is not null) entry.LastTitle = Text.ClipText(observation.Title);
        return entry;
    }

    /// <summary>Set the durable per-app float decision.</summary>
    public AppEntry SetNeverTile(string appId, bool value, double? now = null)
    {
        var resolvedNow = now ?? Now();
        var entry = Ensure(appId, resolvedNow);
        entry.NeverTile = value;
        entry.LastSeen = resolvedNow;
        return entry;
    }

    /// <summary>Flip the durable float decision and report the new value.</summary>
    public bool ToggleNeverTile(string appId, double? now = null)
    {
        var resolvedNow = now ?? Now();
        var entry = Ensure(appId, resolvedNow);
        entry.NeverTile = !entry.NeverTile;
        entry.LastSeen = resolvedNow;
        return entry.NeverTile;
    }

    public bool IsNeverTile(string appId) => _table.TryGetValue(appId, out var entry) && entry.NeverTile;

    public AppEntry SetProfile(string appId, AppProfile hints, double? now = null)
    {
        var entry = Ensure(appId, now ?? Now());
        entry.Profile = MergeProfile(entry.Profile, hints);
        return entry;
    }

    /// <summary>
    /// Merge timing-only adaptation hints. Unknown keys are ignored, so a legacy
    /// record cannot smuggle geometry in through this path.
    /// </summary>
    public AppEntry SetAdapt(string appId, IReadOnlyDictionary<string, object?> patch, double? now = null)
    {
        var entry = Ensure(appId, now ?? Now());
        entry.Adapt = MergeAdapt(entry.Adapt, SanitizeAdapt(patch));
        return entry;
    }

    public AdaptRecord AdaptFor(string appId) =>
        _table.TryGetValue(appId, out var entry) ? entry.Adapt : new AdaptRecord();

    /// <summary>
    /// Record a placement. The instance id keeps its ordinal once assigned; the
    /// ordinal counter rolls forward and is never reused.
    /// </summary>
    public AppPlacement Place(string appId, string instanceId, PlacementInput input, double? now = null)
    {
        var resolvedNow = now ?? Now();
        var entry = Ensure(appId, resolvedNow);
        var key = PlacementKey(instanceId);
        double ordinal;
        if (entry.Placements.TryGetValue(key, out var existing))
        {
            ordinal = existing.Ordinal;
        }
        else
        {
            ordinal = entry.NextOrdinal;
            entry.NextOrdinal += 1;
        }
        var placement = new AppPlacement
        {
            Ordinal = ordinal,
            Connector = Text.ClipText(input.Connector),
            Slot = input.Slot,
            Maximized = input.Maximized is true,
            Fullscreen = input.Fullscreen is true,
            Rect = input.Rect,
        };
        entry.Placements[key] = placement;
        entry.LastSeen = resolvedNow;
        var count = entry.Placements.Count;
        if (count > MaxPlacementsPerApp)
        {
            var oldest = entry.Placements
                .OrderBy(pair => pair.Value.Ordinal)
                .Take(count - MaxPlacementsPerApp)
                .Select(pair => pair.Key)
                .ToList();
            foreach (var oldKey in oldest) entry.Placements.Remove(oldKey);
        }
        return placement;
    }

    public AppPlacement? Placement(string appId, string instanceId) =>
        _table.TryGetValue(appId, out var entry) &&
        entry.Placements.TryGetValue(PlacementKey(instanceId), out var placement)
            ? placement
            : null;

    /// <summary>Placements in ordinal order, the order recreated windows match in.</summary>
    public IReadOnlyList<AppPlacement> Placements(string appId) =>
        _table.TryGetValue(appId, out var entry)
            ? entry.Placements.Values.OrderBy(placement => placement.Ordinal).ToList()
            : new List<AppPlacement>();

    public double? OrdinalFor(string appId, string instanceId) =>
        _table.TryGetValue(appId, out var entry) &&
        entry.Placements.TryGetValue(PlacementKey(instanceId), out var placement)
            ? placement.Ordinal
            : null;

    public InstancePlacement? PlacementByOrdinal(string appId, double ordinal)
    {
        if (!_table.TryGetValue(appId, out var entry)) return null;
        foreach (var pair in entry.Placements)
        {
            if (pair.Value.Ordinal == ordinal) return new InstancePlacement(pair.Key, pair.Value);
        }
        return null;
    }

    /// <summary>Drop one placement; the ordinal is retired, never handed out again.</summary>
    public bool ForgetPlacement(string appId, string instanceId)
    {
        if (!_table.TryGetValue(appId, out var entry)) return false;
        return entry.Placements.Remove(PlacementKey(instanceId));
    }

    /// <summary>
    /// Re-key a provisional entry onto its real identity, carrying the entry. When
    /// the real key already exists it wins its own fields; only <c>neverTile</c> is
    /// ORed, and the provisional placements are carried over.
    /// </summary>
    public bool Rekey(string oldKey, string newKey)
    {
        if (oldKey == newKey) return false;
        if (!_table.TryGetValue(oldKey, out var oldEntry)) return false;

        if (!_table.TryGetValue(newKey, out var existing))
        {
            _table.Remove(oldKey);
            oldEntry.AppId = newKey;
            _table[newKey] = oldEntry;
            return true;
        }

        // The real key wins: its profile, adapt and placements take precedence, its
        // identity fields dominate, and only neverTile is a union.
        existing.NeverTile = existing.NeverTile || oldEntry.NeverTile;
        existing.FirstSeen = Math.Min(existing.FirstSeen, oldEntry.FirstSeen);
        existing.LastSeen = Math.Max(existing.LastSeen, oldEntry.LastSeen);
        existing.WindowsSeen += oldEntry.WindowsSeen;
        if (existing.LastTitle.Length == 0) existing.LastTitle = oldEntry.LastTitle;
        existing.Profile = MergeProfile(oldEntry.Profile, existing.Profile);
        existing.Adapt = MergeAdapt(oldEntry.Adapt, existing.Adapt);

        // Placements from the provisional entry are carried over; the real key's own
        // placements win on an instance-id collision. A carried ordinal that clashes
        // with a real one is renumbered forward so ordinals stay unique. One pass
        // with a used-ordinal set: the previous per-placement scan made this O(n²).
        var merged = new Dictionary<string, AppPlacement>(existing.Placements, StringComparer.Ordinal);
        var used = new HashSet<double>();
        var highest = 0.0;
        foreach (var placement in merged.Values)
        {
            used.Add(placement.Ordinal);
            if (placement.Ordinal > highest) highest = placement.Ordinal;
        }
        var next = Math.Max(existing.NextOrdinal, highest + 1);
        foreach (var pair in oldEntry.Placements)
        {
            if (merged.ContainsKey(pair.Key)) continue;
            var placement = pair.Value;
            if (used.Contains(placement.Ordinal))
            {
                while (used.Contains(next)) next += 1;
                merged[pair.Key] = placement with { Ordinal = next };
                used.Add(next);
                next += 1;
            }
            else
            {
                merged[pair.Key] = placement;
                used.Add(placement.Ordinal);
                if (placement.Ordinal > highest) highest = placement.Ordinal;
            }
        }
        existing.Placements = merged;
        existing.NextOrdinal = Math.Max(Math.Max(existing.NextOrdinal, next), highest + 1);
        _table.Remove(oldKey);
        return true;
    }

    /// <summary>
    /// Fold the three legacy stores into entries. Adaptation records contribute
    /// their timing only; behavior floats and exception globs contribute
    /// <c>neverTile</c>. Idempotent: running it twice leaves the same state.
    /// </summary>
    public MigrationReport Migrate(LegacyStores stores, double? now = null)
    {
        var resolvedNow = now ?? Now();
        var adapted = new List<string>();
        var floated = new List<string>();
        var skipped = new List<string>();

        var records = stores.Adaptation?.Records;
        if (records is not null)
        {
            foreach (var pair in records)
            {
                var appId = pair.Key;
                var record = pair.Value;
                if (appId.Length == 0 || record is null)
                {
                    skipped.Add(appId);
                    continue;
                }
                _table.TryGetValue(appId, out var existing);
                var entry = Ensure(appId, resolvedNow);
                var firstSeen = NumberValue(record.FirstSeen) ?? resolvedNow;
                var lastSeen = NumberValue(record.LastSeen) ?? resolvedNow;
                if (existing is null)
                {
                    entry.FirstSeen = firstSeen;
                    entry.LastSeen = lastSeen;
                }
                else
                {
                    entry.FirstSeen = Math.Min(existing.FirstSeen, firstSeen);
                    entry.LastSeen = Math.Max(existing.LastSeen, lastSeen);
                }
                if (NumberValue(record.Observations) is double observations)
                {
                    entry.WindowsSeen = Math.Max(entry.WindowsSeen, observations);
                }
                entry.Adapt = MergeAdapt(entry.Adapt, SanitizeAdapt(LegacyTiming(record)));
                adapted.Add(appId);
            }
        }

        var floats = stores.Behavior?.Floats;
        if (floats is not null)
        {
            foreach (var appId in floats)
            {
                if (appId is null || appId.Length == 0)
                {
                    skipped.Add(appId ?? "null");
                    continue;
                }
                var entry = Ensure(appId, resolvedNow);
                entry.NeverTile = true;
                floated.Add(appId);
            }
        }

        var exceptions = stores.ExceptionApps;
        if (exceptions is not null)
        {
            foreach (var pattern in exceptions)
            {
                if (pattern is null || pattern.Trim().Length == 0)
                {
                    skipped.Add(pattern ?? "null");
                    continue;
                }
                var key = Identity.NormalizeIdentity(pattern);
                var entry = Ensure(key, resolvedNow);
                entry.NeverTile = true;
                floated.Add(key);
            }
        }

        return new MigrationReport(adapted, floated, skipped);
    }

    /// <summary>
    /// TTL pruning. Stale entries are dropped, but a durable <c>neverTile</c>
    /// decision is kept — it is the user's own decision, not a cache.
    /// </summary>
    public IReadOnlyList<string> Prune(double? now = null)
    {
        var resolvedNow = now ?? Now();
        var removed = new List<string>();
        foreach (var appId in _table.Keys.ToList())
        {
            var entry = _table[appId];
            if (entry.NeverTile) continue;
            if (resolvedNow - entry.LastSeen > _ttlMs)
            {
                _table.Remove(appId);
                removed.Add(appId);
            }
        }
        return removed;
    }

    public bool Remove(string appId) => _table.Remove(appId);

    /// <summary>
    /// Serialize a bounded copy of the registry. Every entry is already clipped and
    /// placement-capped, so an ordinary registry is far below the cap. If the whole
    /// file would still exceed <paramref name="maxBytes"/>, keep durable
    /// <c>neverTile</c> entries first and then the newest entries; the discarded ones
    /// stay in memory for this session but are never written to a file that startup
    /// would have to parse in one piece.
    /// </summary>
    public AppRegistryData ToJSON(double? maxBytes = null)
    {
        var cap = maxBytes ?? MaxRegistryBytes;
        var entries = Entries().Select(CloneEntry).ToList();
        AppRegistryData Wrap(IReadOnlyList<AppEntry> list) => new() { Version = RegistryVersion, Entries = list };
        if (!double.IsFinite(cap) || cap <= 0) return Wrap(entries);

        var text = Serialize(Wrap(entries));
        if (Text.Utf8ByteLength(text) <= cap) return Wrap(entries);

        var ranked = entries
            .OrderByDescending(entry => entry.NeverTile)
            .ThenByDescending(entry => entry.LastSeen)
            .ToList();
        var kept = new HashSet<AppEntry>();
        double used = Text.Utf8ByteLength(Serialize(Wrap(new List<AppEntry>())));
        foreach (var entry in ranked)
        {
            double size = Text.Utf8ByteLength(Serialize(entry)) + 1; // + the comma
            if (used + size > cap) continue;
            kept.Add(entry);
            used += size;
        }
        var bounded = entries.Where(entry => kept.Contains(entry)).ToList();
        return Wrap(bounded);
    }

    public static AppRegistry FromJSON(AppRegistryData? data, AppRegistryOptions? options = null, TimeProvider? time = null)
    {
        var registry = new AppRegistry(options, time);
        // A newer persisted schema is refused rather than silently downgraded, the
        // same convention as `config.normalizeBundle`: the caller gets an empty
        // registry and may choose to overwrite the file.
        if (data is not null && double.IsFinite(data.Version) && data.Version > RegistryVersion) return registry;
        var entries = data?.Entries;
        if (entries is null) return registry;
        foreach (var entry in entries)
        {
            if (entry is null || entry.AppId is null) continue;
            // The table is keyed by appId, so a duplicate is corruption. Keep the
            // first occurrence deterministically; a later one must not silently
            // overwrite the data that was already accepted.
            if (registry._table.ContainsKey(entry.AppId)) continue;
            registry._table[entry.AppId] = CloneEntry(entry);
        }
        return registry;
    }

    /// <summary>
    /// Keep only the timing fields of <paramref name="source"/>. Anything else — in
    /// particular the legacy <c>refusedMinW</c>/<c>refusedMinH</c>/<c>acceptedW</c>/
    /// <c>acceptedH</c> — is dropped, so no learned geometry can ever reach the
    /// tiler (§12).
    /// </summary>
    public static AdaptRecord SanitizeAdapt(IReadOnlyDictionary<string, object?>? source)
    {
        var output = new AdaptRecord();
        if (source is null) return output;
        if (NumberValue(source.GetValueOrDefault("unmaximizeDelayMs")) is double delay)
        {
            output = output with { UnmaximizeDelayMs = delay };
        }
        if (NumberValue(source.GetValueOrDefault("settleMs")) is double settle)
        {
            output = output with { SettleMs = settle };
        }
        if (BoolValue(source.GetValueOrDefault("skipAnimation")) is bool skip)
        {
            output = output with { SkipAnimation = skip };
        }
        if (NumberValue(source.GetValueOrDefault("retries")) is double retries)
        {
            output = output with { Retries = retries };
        }
        return output;
    }

    private double Now() => _time.GetUtcNow().ToUnixTimeMilliseconds();

    private AppEntry Ensure(string appId, double now)
    {
        if (_table.TryGetValue(appId, out var entry)) return entry;
        entry = CreateEntry(appId, now);
        _table[appId] = entry;
        return entry;
    }

    private static AppEntry CreateEntry(string appId, double now) => new()
    {
        AppId = appId,
        FirstSeen = now,
        LastSeen = now,
        WindowsSeen = 0,
        LastTitle = string.Empty,
        NeverTile = false,
        Profile = new AppProfile(),
        Adapt = new AdaptRecord(),
        Placements = new Dictionary<string, AppPlacement>(StringComparer.Ordinal),
        NextOrdinal = 1,
    };

    /// <summary>One placement's in-memory key. Bounded so a client id cannot bloat the file.</summary>
    private static string PlacementKey(string instanceId) => Text.ClipText(instanceId);

    private static AppPlacement ClonePlacement(AppPlacement placement) => new()
    {
        Ordinal = double.IsFinite(placement.Ordinal) ? placement.Ordinal : 0,
        Connector = Text.ClipText(placement.Connector),
        Slot = double.IsFinite(placement.Slot) ? placement.Slot : 0,
        Maximized = placement.Maximized,
        Fullscreen = placement.Fullscreen,
        Rect = new Rect(
            double.IsFinite(placement.Rect.X) ? placement.Rect.X : 0,
            double.IsFinite(placement.Rect.Y) ? placement.Rect.Y : 0,
            double.IsFinite(placement.Rect.Width) ? placement.Rect.Width : 0,
            double.IsFinite(placement.Rect.Height) ? placement.Rect.Height : 0),
    };

    /// <summary>
    /// Keep only the newest <c>MAX_PLACEMENTS_PER_APP</c> placements, by ordinal.
    /// Applied on load as well as on <c>Place()</c>, so a hand-edited or corrupted
    /// file cannot force an unbounded dictionary into memory on the next save.
    /// </summary>
    private static Dictionary<string, AppPlacement> BoundPlacements(
        IReadOnlyDictionary<string, AppPlacement>? placements)
    {
        var sorted = (placements ?? new Dictionary<string, AppPlacement>(StringComparer.Ordinal))
            .Where(pair => pair.Value is not null)
            .OrderBy(pair => pair.Value.Ordinal)
            .ToList();
        var kept = sorted.Skip(Math.Max(0, sorted.Count - MaxPlacementsPerApp));
        var output = new Dictionary<string, AppPlacement>(StringComparer.Ordinal);
        foreach (var pair in kept)
        {
            // The instance id is persisted as a JSON key, so it is client text too.
            output[Text.ClipText(pair.Key)] = ClonePlacement(pair.Value);
        }
        return output;
    }

    private static AppEntry CloneEntry(AppEntry entry)
    {
        var profile = entry.Profile ?? new AppProfile();
        return new AppEntry
        {
            AppId = Text.ClipText(entry.AppId),
            FirstSeen = double.IsFinite(entry.FirstSeen) ? entry.FirstSeen : 0,
            LastSeen = double.IsFinite(entry.LastSeen) ? entry.LastSeen : 0,
            WindowsSeen = double.IsFinite(entry.WindowsSeen) ? entry.WindowsSeen : 0,
            LastTitle = Text.ClipText(entry.LastTitle ?? string.Empty),
            NeverTile = entry.NeverTile,
            Profile = new AppProfile
            {
                Family = profile.Family is null ? null : Text.ClipText(profile.Family),
                UnmaximizeDelayMs = profile.UnmaximizeDelayMs,
                RetriesMs = profile.RetriesMs,
                Animate = profile.Animate,
            },
            Adapt = entry.Adapt ?? new AdaptRecord(),
            Placements = BoundPlacements(entry.Placements),
            // The counter is re-derived: a persisted value below the highest placement
            // ordinal would hand out a duplicate, so the derived floor always wins.
            NextOrdinal = Math.Max(
                double.IsFinite(entry.NextOrdinal) ? entry.NextOrdinal : 0,
                HighestOrdinal(entry.Placements) + 1),
        };
    }

    private static double HighestOrdinal(IReadOnlyDictionary<string, AppPlacement>? placements)
    {
        var highest = 0.0;
        if (placements is null) return highest;
        foreach (var placement in placements.Values)
        {
            if (placement.Ordinal > highest) highest = placement.Ordinal;
        }
        return highest;
    }

    /// <summary>
    /// Project a legacy adaptation record onto timing-only hints. The EMA fields map
    /// to the registry's delays; the geometric fields are deliberately never read.
    /// </summary>
    private static Dictionary<string, object?> LegacyTiming(AdaptationRecord record)
    {
        var timing = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (NumberValue(record.UnmaximizeDelayEma) is double delay)
        {
            timing["unmaximizeDelayMs"] = JsRound(delay);
        }
        if (NumberValue(record.SettleTimeEma) is double settle)
        {
            timing["settleMs"] = JsRound(settle);
        }
        if (BoolValue(record.SkipAnimation) is bool skip) timing["skipAnimation"] = skip;
        return timing;
    }

    private static AppProfile MergeProfile(AppProfile first, AppProfile second) => new()
    {
        Family = second.Family ?? first.Family,
        UnmaximizeDelayMs = second.UnmaximizeDelayMs ?? first.UnmaximizeDelayMs,
        RetriesMs = second.RetriesMs ?? first.RetriesMs,
        Animate = second.Animate ?? first.Animate,
    };

    private static AdaptRecord MergeAdapt(AdaptRecord first, AdaptRecord second) => new()
    {
        UnmaximizeDelayMs = second.UnmaximizeDelayMs ?? first.UnmaximizeDelayMs,
        SettleMs = second.SettleMs ?? first.SettleMs,
        SkipAnimation = second.SkipAnimation ?? first.SkipAnimation,
        Retries = second.Retries ?? first.Retries,
    };

    private static double? NumberValue(object? value)
    {
        switch (value)
        {
            case double number:
                return double.IsFinite(number) ? number : null;
            case float number:
                return double.IsFinite(number) ? number : null;
            case int number:
                return number;
            case long number:
                return number;
            case decimal number:
                return (double)number;
            case JsonElement element when element.ValueKind == JsonValueKind.Number:
                return element.TryGetDouble(out var parsed) && double.IsFinite(parsed) ? parsed : null;
            default:
                return null;
        }
    }

    private static bool? BoolValue(object? value) => value switch
    {
        bool flag => flag,
        JsonElement { ValueKind: JsonValueKind.True } => true,
        JsonElement { ValueKind: JsonValueKind.False } => false,
        _ => null,
    };

    /// <summary>JS <c>Math.round</c>: nearest integer, halves away from zero for positives.</summary>
    private static double JsRound(double value) => Math.Floor(value + 0.5);

    private static string Serialize(object value) => JsonSerializer.Serialize(value, JsonOptions);
}

/// <summary>Timing/behaviour hints. Never geometry (§12).</summary>
public sealed record AppProfile
{
    [JsonPropertyName("family")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Family { get; init; }

    [JsonPropertyName("unmaximizeDelayMs")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? UnmaximizeDelayMs { get; init; }

    [JsonPropertyName("retriesMs")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<double>? RetriesMs { get; init; }

    [JsonPropertyName("animate")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Animate { get; init; }
}

/// <summary>Performance and smoothness only: delays, settle, animation skip, retries.</summary>
public sealed record AdaptRecord
{
    [JsonPropertyName("unmaximizeDelayMs")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? UnmaximizeDelayMs { get; init; }

    [JsonPropertyName("settleMs")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? SettleMs { get; init; }

    [JsonPropertyName("skipAnimation")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? SkipAnimation { get; init; }

    [JsonPropertyName("retries")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? Retries { get; init; }
}

/// <summary>One remembered placement, keyed by the window's instance id in the entry.</summary>
public sealed record AppPlacement
{
    /// <summary>Durable per-app ordinal, 1-based; assigned once per instance id.</summary>
    [JsonPropertyName("ordinal")] public required double Ordinal { get; init; }

    [JsonPropertyName("connector")] public required string Connector { get; init; }
    [JsonPropertyName("slot")] public required double Slot { get; init; }
    [JsonPropertyName("maximized")] public required bool Maximized { get; init; }
    [JsonPropertyName("fullscreen")] public required bool Fullscreen { get; init; }
    [JsonPropertyName("rect")] public required Rect Rect { get; init; }
}

public sealed record PlacementInput
{
    [JsonPropertyName("connector")] public required string Connector { get; init; }
    [JsonPropertyName("slot")] public required double Slot { get; init; }

    [JsonPropertyName("maximized")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Maximized { get; init; }

    [JsonPropertyName("fullscreen")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Fullscreen { get; init; }

    [JsonPropertyName("rect")] public required Rect Rect { get; init; }
}

public sealed class AppEntry
{
    [JsonPropertyName("appId")] public required string AppId { get; set; }
    [JsonPropertyName("firstSeen")] public double FirstSeen { get; set; }
    [JsonPropertyName("lastSeen")] public double LastSeen { get; set; }
    [JsonPropertyName("windowsSeen")] public double WindowsSeen { get; set; }
    [JsonPropertyName("lastTitle")] public string LastTitle { get; set; } = string.Empty;
    [JsonPropertyName("neverTile")] public bool NeverTile { get; set; }
    [JsonPropertyName("profile")] public AppProfile Profile { get; set; } = new();

    [JsonPropertyName("adapt")] public AdaptRecord Adapt { get; set; } = new();

    /// <summary>Keyed by instance id.</summary>
    [JsonPropertyName("placements")]
    public Dictionary<string, AppPlacement> Placements { get; set; } = new(StringComparer.Ordinal);

    /// <summary>Monotonic ordinal counter; never rolls back, even after pruning.</summary>
    [JsonPropertyName("nextOrdinal")] public double NextOrdinal { get; set; } = 1;
}

public sealed record AppObservation
{
    [JsonPropertyName("appId")] public required string AppId { get; init; }

    [JsonPropertyName("title")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Title { get; init; }

    [JsonPropertyName("now")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? Now { get; init; }
}

public sealed record AppRegistryOptions
{
    [JsonPropertyName("ttlMs")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? TtlMs { get; init; }
}

/// <summary>Parsed legacy stores, handed in by the platform layer.</summary>
public sealed record LegacyStores
{
    /// <summary>Parsed <c>adaptation.json</c>: <c>{ version, records }</c>.</summary>
    [JsonPropertyName("adaptation")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public LegacyAdaptation? Adaptation { get; init; }

    /// <summary>Parsed <c>behavior.json</c>: <c>{ version, floats }</c>.</summary>
    [JsonPropertyName("behavior")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public LegacyBehavior? Behavior { get; init; }

    /// <summary>The <c>exception-apps</c> setting: glob patterns.</summary>
    [JsonPropertyName("exceptionApps")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? ExceptionApps { get; init; }
}

public sealed record LegacyAdaptation
{
    [JsonPropertyName("records")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Dictionary<string, AdaptationRecord?>? Records { get; init; }
}

public sealed record LegacyBehavior
{
    [JsonPropertyName("floats")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? Floats { get; init; }
}

public sealed record MigrationReport(
    [property: JsonPropertyName("adapted")] IReadOnlyList<string> Adapted,
    [property: JsonPropertyName("floated")] IReadOnlyList<string> Floated,
    [property: JsonPropertyName("skipped")] IReadOnlyList<string> Skipped);

public sealed record AppRegistryData
{
    [JsonPropertyName("version")] public double Version { get; init; }

    [JsonPropertyName("entries")] public IReadOnlyList<AppEntry> Entries { get; init; } = [];
}

/// <summary>The <c>placementByOrdinal</c> answer: the instance id and its placement.</summary>
public sealed record InstancePlacement(string InstanceId, AppPlacement Placement);
