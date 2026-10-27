// Port of src/core/rules.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Adrt.Core;

/// <summary>Minimal surface view a rule is matched against.</summary>
public sealed record RuleContext
{
    [JsonPropertyName("appId")] public required string AppId { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }
    [JsonPropertyName("kind")] public required SurfaceKind Kind { get; init; }
    [JsonPropertyName("transient")] public required bool Transient { get; init; }
}

/// <summary>A single user-authored rule's match fields (§19.1 `rules-json`, §6).</summary>
public sealed record RuleMatch
{
    [JsonPropertyName("appId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? AppId { get; init; }

    [JsonPropertyName("title")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Title { get; init; }

    [JsonPropertyName("kind")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<SurfaceKind>? Kind { get; init; }

    [JsonPropertyName("transient")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Transient { get; init; }
}

/// <summary>
/// What a rule does to a matching window: force a placement (`full`,
/// `left-half`, `right-half`) or float it (`float`). A `float` rule keeps the
/// window out of the tiling exactly like an exception app, but it is *not*
/// copied into the durable Never-tile list (§16): the list records a persistent
/// user decision, while a rule is a live condition the user can edit or remove.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum TileMode
{
    [JsonStringEnumMemberName("full")] Full,
    [JsonStringEnumMemberName("left-half")] LeftHalf,
    [JsonStringEnumMemberName("right-half")] RightHalf,
    [JsonStringEnumMemberName("float")] Float,
}

/// <summary>
/// One rule. A rule may force a placement *or* float the window; the durable
/// "never tile" decision still lives in the Never-tile list / registry
/// `neverTile` (§16), and a `float` rule is deliberately not written to it.
/// First match in array order wins; `enabled: false` skips it without removing
/// it.
/// </summary>
public sealed record Rule
{
    [JsonPropertyName("match")] public required RuleMatch Match { get; init; }
    [JsonPropertyName("tile")] public required TileMode Tile { get; init; }

    /// <summary>Per-rule switch. Absent means enabled (storage-compatible).</summary>
    [JsonPropertyName("enabled")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Enabled { get; init; }
}

public sealed record RulesParse
{
    [JsonPropertyName("rules")] public required IReadOnlyList<Rule> Rules { get; init; }
    [JsonPropertyName("errors")] public required IReadOnlyList<string> Errors { get; init; }
}

/// <summary>The result of migrating a legacy rule list to the new shape.</summary>
public sealed record RuleMigration
{
    [JsonPropertyName("rules")] public required IReadOnlyList<Rule> Rules { get; init; }
    [JsonPropertyName("errors")] public required IReadOnlyList<string> Errors { get; init; }

    /// <summary>App patterns extracted from legacy float rules: append to `exception-apps`.</summary>
    [JsonPropertyName("neverTile")] public required IReadOnlyList<string> NeverTile { get; init; }

    /// <summary>True when `rules-json` should be rewritten.</summary>
    [JsonPropertyName("changed")] public required bool Changed { get; init; }
}

public static class Rules
{
    public static readonly IReadOnlyList<TileMode> TileModes = new[]
    {
        TileMode.Full,
        TileMode.LeftHalf,
        TileMode.RightHalf,
        TileMode.Float,
    };

    /// <summary>
    /// Compiled globs, keyed by the pattern string. `globMatch` runs per exception
    /// app and per rule field on every classification/retile, so a `new RegExp` per
    /// call was pure churn (PERFORMANCE_PLAN stage 1.3). The cache is bounded because
    /// patterns come from user settings; FIFO eviction keeps a rules-editor keystroke
    /// burst from growing it without limit.
    /// </summary>
    private const int GlobCacheLimit = 256;

    private static readonly Dictionary<string, Regex> CompiledGlobs = new(StringComparer.Ordinal);
    private static readonly Queue<string> CompiledGlobOrder = new();
    private static readonly object GlobCacheLock = new();

    public static RuleContext ContextFor(Surface surface) => new()
    {
        AppId = surface.AppId,
        Title = surface.Title,
        Kind = surface.Kind,
        Transient = surface.Flags.Transient,
    };

    /// <summary>Translate a glob (`*`, `?`) into an anchored, case-insensitive RegExp.</summary>
    public static Regex GlobToRegExp(string glob)
    {
        // JavaScript's `.` (used for both wildcards) never matches a line
        // terminator, and `^`/`$` anchor the whole input. Keep both so the
        // compiled glob behaves exactly like the TS `RegExp`.
        const string jsDot = @"[^\n\r\u2028\u2029]";
        var source = @"\A";
        foreach (var ch in glob)
        {
            if (ch == '*') source += jsDot + "*";
            else if (ch == '?') source += jsDot;
            else if (IsRegexMeta(ch)) source += "\\" + ch;
            else source += ch;
        }
        source += @"\z";
        return new Regex(source, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    /// <summary>The shared RegExp for a glob — compiled once per distinct pattern.</summary>
    public static Regex CompileGlob(string glob)
    {
        lock (GlobCacheLock)
        {
            if (CompiledGlobs.TryGetValue(glob, out var cached)) return cached;
            var compiled = GlobToRegExp(glob);
            if (CompiledGlobs.Count >= GlobCacheLimit)
            {
                var oldest = CompiledGlobOrder.Dequeue();
                CompiledGlobs.Remove(oldest);
            }
            CompiledGlobs[glob] = compiled;
            CompiledGlobOrder.Enqueue(glob);
            return compiled;
        }
    }

    public static bool GlobMatch(string glob, string value) => CompileGlob(glob).IsMatch(value);

    /// <summary>Does a rule match a surface? All present fields must match (AND).</summary>
    public static bool RuleMatches(Rule rule, RuleContext context)
    {
        var m = rule.Match;
        if (m.AppId is not null && !GlobMatch(m.AppId, context.AppId)) return false;
        if (m.Title is not null && !GlobMatch(m.Title, context.Title)) return false;
        if (m.Transient is not null && m.Transient != context.Transient) return false;
        if (!KindAllowed(m.Kind, context.Kind)) return false;
        return true;
    }

    /// <summary>First enabled rule (in list order) that matches, or null.</summary>
    public static Rule? FirstMatch(IReadOnlyList<Rule> rules, RuleContext context)
    {
        foreach (var rule in rules)
        {
            if (rule.Enabled == false) continue;
            if (RuleMatches(rule, context)) return rule;
        }
        return null;
    }

    /// <summary>
    /// Validate one raw rule entry. Returns the rule when it is usable, `null`
    /// otherwise; every problem is appended to `errors` (never silently dropped).
    /// </summary>
    public static Rule? ValidateRule(JsonNode? entry, string where, List<string> errors)
    {
        if (entry is not JsonObject obj)
        {
            errors.Add($"{where}: must be an object");
            return null;
        }
        if (obj.ContainsKey("float"))
        {
            errors.Add($"{where}: \"float\" is no longer supported; use the Never-tile list");
            return null;
        }
        obj.TryGetPropertyValue("match", out var matchNode);
        var match = ParseMatch(matchNode, where, errors);
        if (!Constrains(match))
        {
            errors.Add($"{where}: match must name at least one of appId, title, kind, transient");
        }
        TileMode? tile = null;
        if (!obj.TryGetPropertyValue("tile", out var tileNode))
        {
            errors.Add($"{where}: \"tile\" is required ({TileModesText})");
        }
        else if (tileNode is not JsonValue tileValue ||
                 tileValue.GetValueKind() != JsonValueKind.String ||
                 !TryParseTileMode(tileValue.GetValue<string>(), out var parsedTile))
        {
            errors.Add($"{where}: tile must be one of {TileModesText}");
        }
        else
        {
            tile = parsedTile;
        }
        bool? enabled = null;
        if (obj.TryGetPropertyValue("enabled", out var enabledNode))
        {
            if (enabledNode is JsonValue enabledValue && enabledValue.GetValueKind() is JsonValueKind.True or JsonValueKind.False)
            {
                enabled = enabledValue.GetValue<bool>();
            }
            else
            {
                errors.Add($"{where}: enabled must be a boolean");
            }
        }
        if (tile is null || !Constrains(match)) return null;
        return new Rule { Match = match, Tile = tile.Value, Enabled = enabled };
    }

    /// <summary>
    /// Validate a parsed `rules-json` value. Invalid entries are reported in
    /// `errors` and omitted from `rules` (the UI surfaces them inline; the runtime
    /// never applies them).
    /// </summary>
    public static RulesParse ValidateRules(JsonNode? input)
    {
        var errors = new List<string>();
        if (input is null) return new RulesParse { Rules = Array.Empty<Rule>(), Errors = errors };
        if (input is not JsonArray entries)
        {
            errors.Add("rules-json must be a JSON array");
            return new RulesParse { Rules = Array.Empty<Rule>(), Errors = errors };
        }
        var rules = new List<Rule>();
        for (var i = 0; i < entries.Count; i += 1)
        {
            var rule = ValidateRule(entries[i], FormattableString.Invariant($"rule[{i}]"), errors);
            if (rule is not null) rules.Add(rule);
        }
        return new RulesParse { Rules = rules, Errors = errors };
    }

    /// <summary>Parse a JSON string into validated rules (§22 `ReloadRules`).</summary>
    public static RulesParse ParseRulesJson(string json)
    {
        JsonNode? parsed;
        try
        {
            parsed = JsonNode.Parse(json);
        }
        catch (JsonException e)
        {
            return new RulesParse
            {
                Rules = Array.Empty<Rule>(),
                Errors = new List<string> { $"rules-json is not valid JSON: {e.Message}" },
            };
        }
        return ValidateRules(parsed);
    }

    /// <summary>
    /// Migrate a parsed legacy rule list (§23 decisions 91-93):
    ///   - a `{"match":{"appId":…},"float":true}` rule moves its app glob to the
    ///     Never-tile list and leaves the rule set;
    ///   - a legacy global `rules-enabled:false` becomes `enabled:false` on every
    ///     rule, so the per-rule switch carries the old off state;
    ///   - a `float` flag on a rule that *also* has a `tile` action is stripped, and
    ///     the tile action survives.
    /// </summary>
    public static RuleMigration MigrateRules(JsonNode? input, bool rulesEnabled)
    {
        var errors = new List<string>();
        var rules = new List<Rule>();
        var neverTile = new List<string>();
        var changed = false;
        if (input is null)
        {
            return new RuleMigration
            {
                Rules = rules,
                Errors = errors,
                NeverTile = neverTile,
                Changed = changed,
            };
        }
        if (input is not JsonArray entries)
        {
            return new RuleMigration
            {
                Rules = rules,
                Errors = new List<string> { "rules-json must be a JSON array" },
                NeverTile = neverTile,
                Changed = false,
            };
        }
        for (var i = 0; i < entries.Count; i += 1)
        {
            var where = FormattableString.Invariant($"rule[{i}]");
            var entry = entries[i];
            if (entry is not JsonObject obj)
            {
                errors.Add($"{where}: must be an object");
                continue;
            }
            var legacyFloat = obj["float"] is JsonValue floatValue && floatValue.GetValueKind() == JsonValueKind.True;
            if (obj.ContainsKey("float")) changed = true;
            if (legacyFloat && rulesEnabled)
            {
                var appId = AppIdOf(entry);
                if (appId.Length > 0) neverTile.Add(appId);
            }
            // Rebuild the entry without the legacy flag, then validate it as today.
            var clean = new JsonObject();
            if (obj.TryGetPropertyValue("match", out var matchNode)) clean["match"] = matchNode?.DeepClone();
            if (obj.TryGetPropertyValue("tile", out var tileNode)) clean["tile"] = tileNode?.DeepClone();
            if (obj.TryGetPropertyValue("enabled", out var enabledNode)) clean["enabled"] = enabledNode?.DeepClone();
            // A float-only rule has nothing left to keep once its app moved.
            if (legacyFloat && !obj.ContainsKey("tile")) continue;
            var rule = ValidateRule(clean, where, errors);
            if (rule is null) continue;
            if (!rulesEnabled && rule.Enabled != false)
            {
                rule = rule with { Enabled = false };
                changed = true;
            }
            rules.Add(rule);
        }
        return new RuleMigration
        {
            Rules = rules,
            Errors = errors,
            NeverTile = neverTile,
            Changed = changed,
        };
    }

    /// <summary>Migrate a raw `rules-json` string. Invalid JSON is reported, never rewritten.</summary>
    public static RuleMigration MigrateRulesJson(string json, bool rulesEnabled)
    {
        JsonNode? parsed;
        try
        {
            parsed = JsonNode.Parse(json);
        }
        catch (JsonException e)
        {
            return new RuleMigration
            {
                Rules = Array.Empty<Rule>(),
                Errors = new List<string> { $"rules-json is not valid JSON: {e.Message}" },
                NeverTile = Array.Empty<string>(),
                Changed = false,
            };
        }
        return MigrateRules(parsed, rulesEnabled);
    }

    private static string TileModesText => string.Join(", ", TileModes.Select(TileModeWire));

    private static string TileModeWire(TileMode mode) => mode switch
    {
        TileMode.Full => "full",
        TileMode.LeftHalf => "left-half",
        TileMode.RightHalf => "right-half",
        TileMode.Float => "float",
        _ => throw new ArgumentOutOfRangeException(nameof(mode)),
    };

    private static bool TryParseTileMode(string value, out TileMode mode)
    {
        switch (value)
        {
            case "full": mode = TileMode.Full; return true;
            case "left-half": mode = TileMode.LeftHalf; return true;
            case "right-half": mode = TileMode.RightHalf; return true;
            case "float": mode = TileMode.Float; return true;
            default: mode = default; return false;
        }
    }

    private static bool TryParseSurfaceKind(string value, out SurfaceKind kind)
    {
        switch (value)
        {
            case "normal": kind = SurfaceKind.Normal; return true;
            case "dialog": kind = SurfaceKind.Dialog; return true;
            case "modal": kind = SurfaceKind.Modal; return true;
            case "utility": kind = SurfaceKind.Utility; return true;
            case "toolbar": kind = SurfaceKind.Toolbar; return true;
            case "skip": kind = SurfaceKind.Skip; return true;
            default: kind = default; return false;
        }
    }

    private static bool IsRegexMeta(char ch) =>
        ch is '.' or '*' or '+' or '?' or '$' or '^' or '{' or '}' or '(' or ')' or '|' or '[' or ']' or '\\';

    private static bool KindAllowed(IReadOnlyList<SurfaceKind>? kinds, SurfaceKind kind)
    {
        if (kinds is null) return true;
        return kinds.Contains(kind);
    }

    private static bool IsStringArray(JsonNode? value) =>
        value is JsonArray array && array.All(item => item is JsonValue v && v.GetValueKind() == JsonValueKind.String);

    private static RuleMatch ParseMatch(JsonNode? raw, string where, List<string> errors)
    {
        if (raw is not JsonObject obj)
        {
            errors.Add($"{where}: \"match\" must be an object");
            return new RuleMatch();
        }
        string? appId = null;
        if (obj.TryGetPropertyValue("appId", out var appIdNode))
        {
            if (appIdNode is JsonValue value && value.GetValueKind() == JsonValueKind.String) appId = value.GetValue<string>();
            else errors.Add($"{where}: match.appId must be a string");
        }
        string? title = null;
        if (obj.TryGetPropertyValue("title", out var titleNode))
        {
            if (titleNode is JsonValue value && value.GetValueKind() == JsonValueKind.String) title = value.GetValue<string>();
            else errors.Add($"{where}: match.title must be a string");
        }
        bool? transient = null;
        if (obj.TryGetPropertyValue("transient", out var transientNode))
        {
            if (transientNode is JsonValue value && value.GetValueKind() is JsonValueKind.True or JsonValueKind.False)
            {
                transient = value.GetValue<bool>();
            }
            else
            {
                errors.Add($"{where}: match.transient must be a boolean");
            }
        }
        IReadOnlyList<SurfaceKind>? kinds = null;
        if (obj.TryGetPropertyValue("kind", out var kindNode))
        {
            if (!IsStringArray(kindNode))
            {
                errors.Add($"{where}: match.kind must be a string array");
            }
            else
            {
                var parsed = new List<SurfaceKind>();
                foreach (var item in (JsonArray)kindNode!)
                {
                    var text = item!.GetValue<string>();
                    if (TryParseSurfaceKind(text, out var kind)) parsed.Add(kind);
                    else errors.Add($"{where}: unknown kind \"{text}\"");
                }
                kinds = parsed;
            }
        }
        return new RuleMatch { AppId = appId, Title = title, Kind = kinds, Transient = transient };
    }

    /// <summary>Whether a match constrains anything at all.</summary>
    private static bool Constrains(RuleMatch match) =>
        match.AppId is not null ||
        match.Title is not null ||
        match.Transient is not null ||
        (match.Kind is not null && match.Kind.Count > 0);

    private static string AppIdOf(JsonNode? raw)
    {
        if (raw is not JsonObject obj || !obj.TryGetPropertyValue("match", out var matchNode) || matchNode is not JsonObject match) return "";
        if (match.TryGetPropertyValue("appId", out var appId) &&
            appId is JsonValue value &&
            value.GetValueKind() == JsonValueKind.String)
        {
            return value.GetValue<string>();
        }
        return "";
    }
}
