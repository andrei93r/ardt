// Port of tests/core/settings-descriptor.test.ts.
//
// The TS test re-parses the GSettings schema XML (and prefs.ts) and fails when the
// generated descriptor drifts. The two source files are embedded read-only into
// this test assembly, so the check needs no repository-relative file access.
using System.Globalization;
using System.Text.RegularExpressions;
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class SettingsDescriptorTests
{
    private sealed record SchemaKey(
        string Key,
        string GType,
        string DefaultText,
        IReadOnlyList<string> Choices,
        double? Min,
        double? Max);

    private static readonly Regex AttrPattern = new("([A-Za-z_][A-Za-z0-9_-]*)=\"([^\"]*)\"", RegexOptions.CultureInvariant);
    private static readonly Regex KeyPattern = new("<key\\b([^>]*)>([\\s\\S]*?)</key>", RegexOptions.CultureInvariant);
    private static readonly Regex DefaultPattern = new("<default>([\\s\\S]*?)</default>", RegexOptions.CultureInvariant);
    private static readonly Regex RangePattern = new("<range\\b([^>]*)\\/?>", RegexOptions.CultureInvariant);
    private static readonly Regex ChoicesPattern = new("<choices>([\\s\\S]*?)</choices>", RegexOptions.CultureInvariant);
    private static readonly Regex ChoicePattern = new("<choice\\b([^>]*)\\/?>", RegexOptions.CultureInvariant);
    private static readonly Regex ArrayValuePattern = new("'((?:[^'\\\\]|\\\\.)*)'", RegexOptions.CultureInvariant);

    private static string ReadEmbedded(string name)
    {
        var assembly = typeof(SettingsDescriptorTests).Assembly;
        using var stream = assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"missing embedded resource {name}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static readonly string SchemaXml = ReadEmbedded("adrt-schema.xml");
    private static readonly string PrefsSource = ReadEmbedded("adrt-prefs.ts");

    private static Dictionary<string, string> Attrs(string text)
    {
        var output = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (Match match in AttrPattern.Matches(text)) output[match.Groups[1].Value] = match.Groups[2].Value;
        return output;
    }

    private static string DecodeEntities(string text) => text
        .Replace("&lt;", "<", StringComparison.Ordinal)
        .Replace("&gt;", ">", StringComparison.Ordinal)
        .Replace("&quot;", "\"", StringComparison.Ordinal)
        .Replace("&apos;", "'", StringComparison.Ordinal)
        .Replace("&#39;", "'", StringComparison.Ordinal)
        .Replace("&amp;", "&", StringComparison.Ordinal);

    private static IReadOnlyList<SchemaKey> ParseSchema(string xml)
    {
        var keys = new List<SchemaKey>();
        foreach (Match match in KeyPattern.Matches(xml))
        {
            var attribute = Attrs(match.Groups[1].Value);
            var body = match.Groups[2].Value;
            var defaultMatch = DefaultPattern.Match(body);
            var rangeMatch = RangePattern.Match(body);
            var choicesMatch = ChoicesPattern.Match(body);
            var choices = choicesMatch.Success
                ? ChoicePattern.Matches(choicesMatch.Groups[1].Value)
                    .Select(choice => DecodeEntities(Attrs(choice.Groups[1].Value).GetValueOrDefault("value", "")))
                    .ToList()
                : new List<string>();
            var range = rangeMatch.Success ? Attrs(rangeMatch.Groups[1].Value) : new Dictionary<string, string>();
            keys.Add(new SchemaKey(
                attribute.GetValueOrDefault("name", ""),
                attribute.GetValueOrDefault("type", ""),
                defaultMatch.Success ? defaultMatch.Groups[1].Value : "",
                choices,
                range.TryGetValue("min", out var min) && range.TryGetValue("max", out _)
                    ? double.Parse(min, CultureInfo.InvariantCulture)
                    : null,
                range.TryGetValue("min", out _) && range.TryGetValue("max", out var max)
                    ? double.Parse(max, CultureInfo.InvariantCulture)
                    : null));
        }
        return keys;
    }

    private static string UnescapeGvariant(string text) =>
        text.Replace("\\'", "'", StringComparison.Ordinal).Replace("\\\\", "\\", StringComparison.Ordinal);

    private static IReadOnlyList<string> ArrayValues(string text)
    {
        var body = text.StartsWith('[') && text.EndsWith(']') ? text[1..^1] : text;
        return ArrayValuePattern.Matches(body)
            .Select(item => UnescapeGvariant(item.Groups[1].Value))
            .ToList();
    }

    private static string StringValue(string text)
    {
        var trimmed = text.Trim();
        var unwrapped = trimmed.StartsWith('\'') && trimmed.EndsWith('\'') ? trimmed[1..^1] : trimmed;
        return UnescapeGvariant(unwrapped);
    }

    private static object ExpectedDefault(string gtype, string raw)
    {
        var text = DecodeEntities(raw).Trim();
        return gtype switch
        {
            "b" => text == "true",
            "i" or "u" => double.Parse(text, CultureInfo.InvariantCulture),
            "as" => ArrayValues(text),
            _ => StringValue(text),
        };
    }

    private static SettingType ExpectedType(string gtype, IReadOnlyList<string> choices)
    {
        if (gtype == "s" && choices.Count > 0) return SettingType.Enum;
        return gtype switch
        {
            "b" => SettingType.Bool,
            "i" => SettingType.Int,
            "u" => SettingType.Uint,
            "s" => SettingType.String,
            "as" => SettingType.Strv,
            _ => throw new InvalidOperationException($"unknown gtype {gtype}"),
        };
    }

    private static readonly IReadOnlyList<SchemaKey> Schema = ParseSchema(SchemaXml);
    private static readonly IReadOnlyList<SettingDescriptor> Descriptors = SettingsDescriptor.Settings;
    private static readonly Dictionary<string, SchemaKey> SchemaByKey =
        Schema.ToDictionary(entry => entry.Key, StringComparer.Ordinal);

    [Fact]
    public void ListsEverySchemaKeyOnceInDeclarationOrder()
    {
        var keys = Descriptors.Select(setting => setting.Key).ToList();
        Assert.Equal(keys.Count, keys.Distinct().Count());
        Assert.Equal(Schema.Select(entry => entry.Key), keys);
    }

    [Fact]
    public void ClaimsNoKeyTheSchemaDoesNotDeclare()
    {
        var unknown = Descriptors.Where(setting => !SchemaByKey.ContainsKey(setting.Key)).Select(setting => setting.Key);
        Assert.Empty(unknown);
    }

    [Fact]
    public void MapsEverySchemaTypeToTheDescriptorType()
    {
        foreach (var setting in Descriptors)
        {
            Assert.True(SchemaByKey.TryGetValue(setting.Key, out var schemaKey), $"no schema key for {setting.Key}");
            Assert.Equal(ExpectedType(schemaKey!.GType, schemaKey.Choices), setting.Type);
        }
    }

    [Fact]
    public void ReproducesEverySchemaDefault()
    {
        foreach (var setting in Descriptors)
        {
            if (!SchemaByKey.TryGetValue(setting.Key, out var schemaKey)) continue;
            Assert.Equal(H.Json(ExpectedDefault(schemaKey.GType, schemaKey.DefaultText)), H.Json(setting.Default));
        }
    }

    [Fact]
    public void MirrorsSchemaRangeBoundsAndChoicesWhenDeclared()
    {
        foreach (var setting in Descriptors)
        {
            if (!SchemaByKey.TryGetValue(setting.Key, out var schemaKey)) continue;
            Assert.Equal(schemaKey.Min, setting.Min);
            Assert.Equal(schemaKey.Max, setting.Max);
            if (schemaKey.Choices.Count > 0)
            {
                Assert.Equal(schemaKey.Choices, setting.Choices);
            }
            else
            {
                Assert.Null(setting.Choices);
            }
        }
    }

    // ---- preferences layout ----

    private static readonly Regex PrefsKeyPattern =
        new("key:\\s*'([^']+)',\\s*kind:\\s*'([^']+)'", RegexOptions.CultureInvariant);

    private static readonly List<string> PrefsKeys =
        PrefsKeyPattern.Matches(PrefsSource).Select(match => match.Groups[1].Value).ToList();

    [Fact]
    public void PreferencesDeclareUserFacingRows()
    {
        Assert.True(PrefsKeys.Count > 50);
    }

    [Fact]
    public void PreferencesReferenceOnlyKeysTheDescriptorDeclares()
    {
        var known = new HashSet<string>(Descriptors.Select(setting => setting.Key), StringComparer.Ordinal);
        Assert.DoesNotContain(PrefsKeys, key => !known.Contains(key));
    }
}
