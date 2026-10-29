using System.Text.Json.Nodes;

namespace Adrt.Windows;

/// <summary>
/// Positional argument readers for the named-pipe trigger surface.
/// </summary>
/// <remarks>
/// The CLI sends the trigger table's <c>in</c> arguments as a JSON array, but the
/// transport hands the node through unmodified and older callers used a bare
/// scalar or an object for <c>FocusDirection</c>. Every reader therefore accepts
/// an array, a scalar, or a property of an object and returns <see langword="null"/>
/// for a missing or wrongly typed value instead of throwing; the dispatcher turns
/// that into <c>false</c>/<c>notImplemented</c>, never into a dead pipe.
/// </remarks>
internal static class TriggerArgs
{
    /// <summary>Read a string at <paramref name="index"/>.</summary>
    public static string? Text(JsonNode? args, int index) =>
        Item(args, index) is JsonValue value && value.TryGetValue(out string? text) ? text : null;

    /// <summary>Read an integer at <paramref name="index"/>, rounding a JSON fractional value.</summary>
    public static int? Integer(JsonNode? args, int index)
    {
        if (Number(args, index) is not double number || !double.IsFinite(number)) return null;
        return (int)Math.Round(number, MidpointRounding.AwayFromZero);
    }

    /// <summary>Read a finite floating-point value at <paramref name="index"/>.</summary>
    public static double? Number(JsonNode? args, int index)
    {
        if (Item(args, index) is not JsonValue value) return null;
        if (value.TryGetValue(out double number)) return double.IsFinite(number) ? number : null;
        if (value.TryGetValue(out int integer)) return integer;
        return null;
    }

    /// <summary>Read a boolean at <paramref name="index"/>.</summary>
    public static bool? Flag(JsonNode? args, int index) =>
        Item(args, index) is JsonValue value && value.TryGetValue(out bool flag) ? flag : null;

    /// <summary>Read a named string property of an object argument.</summary>
    public static string? Property(JsonNode? args, string name) =>
        args is JsonObject obj &&
        obj[name] is JsonValue value &&
        value.TryGetValue(out string? text)
            ? text
            : null;

    private static JsonNode? Item(JsonNode? args, int index)
    {
        if (args is JsonArray array) return index >= 0 && index < array.Count ? array[index] : null;
        return index == 0 ? args : null;
    }
}
