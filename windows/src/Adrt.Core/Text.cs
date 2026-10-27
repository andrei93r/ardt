// Port of src/core/text.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Adrt.Core;

/*
 * Text taken from a client (window titles, app ids) is unbounded: a client can
 * report a title of millions of characters, and a corrupted one can grow on
 * every read. Clipping it at the edges keeps it out of our memory, our logs and
 * our DumpState payloads.
 */

public static class Text
{
    /// <summary>Longest client text we keep (a window title).</summary>
    public const int MaxText = 256;

    /// <summary>Longest string we allow in one history payload field.</summary>
    public const int MaxLogText = 512;

    private static readonly Regex ControlCharacters =
        new("[\u0000-\u001f\u007f]", RegexOptions.CultureInvariant);

    /// <summary>Strip control characters and bound the length of client-provided text.</summary>
    public static string ClipText(object? value, int max = MaxText)
    {
        if (value is not string text) return "";
        var clean = ControlCharacters.Replace(text, " ");
        if (clean.Length <= max) return clean;
        var limit = Math.Max(0, Math.Min(max, clean.Length));
        return clean[..limit] + "…";
    }

    /// <summary>
    /// UTF-8 byte length of a string, counted without allocating an encoded copy.
    /// Used to gate a serialized file against a byte cap before writing it; JS
    /// `string.length` counts UTF-16 code units, which understates non-ASCII text.
    /// </summary>
    public static int Utf8ByteLength(string text)
    {
        var bytes = 0;
        for (var index = 0; index < text.Length; index += 1)
        {
            var code = text[index];
            if (code < 0x80)
            {
                bytes += 1;
            }
            else if (code < 0x800)
            {
                bytes += 2;
            }
            else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.Length)
            {
                var low = text[index + 1];
                if (low >= 0xdc00 && low <= 0xdfff)
                {
                    bytes += 4;
                    index += 1;
                }
                else
                {
                    bytes += 3;
                }
            }
            else
            {
                bytes += 3;
            }
        }
        return bytes;
    }

    /// <summary>
    /// Deep-clip the string values of a history payload, so one pathological client
    /// string (or a corrupted one that grows) can never produce a giant log line.
    /// </summary>
    public static object? ClipPayload(object? value, int depth = 0)
    {
        if (value is string text) return ClipText(text, MaxLogText);
        if (value is null) return null;
        if (value is JsonNode node)
        {
            if (value is JsonValue jsonValue)
            {
                if (jsonValue.GetValueKind() == JsonValueKind.String)
                {
                    return ClipText(jsonValue.GetValue<string>(), MaxLogText);
                }
                return jsonValue.DeepClone();
            }
            if (depth >= 3) return "…";
            if (node is JsonObject obj)
            {
                var output = new Dictionary<string, object?>(obj.Count);
                foreach (var (key, item) in obj) output[key] = ClipPayload(item, depth + 1);
                return output;
            }
            var array = (JsonArray)node;
            var list = new List<object?>(array.Count);
            foreach (var item in array) list.Add(ClipPayload(item, depth + 1));
            return list;
        }
        if (value.GetType().IsPrimitive || value is decimal) return value;
        if (depth >= 3) return "…";
        if (value is IDictionary<string, object?> map)
        {
            var output = new Dictionary<string, object?>(map.Count);
            foreach (var (key, item) in map) output[key] = ClipPayload(item, depth + 1);
            return output;
        }
        if (value is IReadOnlyDictionary<string, object?> readOnlyMap)
        {
            var output = new Dictionary<string, object?>(readOnlyMap.Count);
            foreach (var (key, item) in readOnlyMap) output[key] = ClipPayload(item, depth + 1);
            return output;
        }
        if (value is IDictionary dictionary)
        {
            var output = new Dictionary<string, object?>();
            foreach (DictionaryEntry entry in dictionary)
            {
                output[Convert.ToString(entry.Key, CultureInfo.InvariantCulture) ?? ""] =
                    ClipPayload(entry.Value, depth + 1);
            }
            return output;
        }
        if (value is IEnumerable items)
        {
            var list = new List<object?>();
            foreach (var item in items) list.Add(ClipPayload(item, depth + 1));
            return list;
        }
        // Plain C# objects: own enumerable properties, like Object.entries.
        var properties = value.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance);
        if (properties.Length == 0) return value;
        var bag = new Dictionary<string, object?>();
        foreach (var property in properties)
        {
            if (!property.CanRead || property.GetIndexParameters().Length > 0) continue;
            bag[property.Name] = ClipPayload(property.GetValue(value), depth + 1);
        }
        return bag;
    }
}
