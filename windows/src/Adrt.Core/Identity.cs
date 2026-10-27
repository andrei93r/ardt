// Port of src/core/identity.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Globalization;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Adrt.Core;

/*
 * §12 app identity resolution.
 *
 * Identity is resolved at the window's first frame by the documented chain and
 * records the winning key, its source and every raw value it saw. This module
 * is pure: the platform layer hands in the tracker desktop id, the sandboxed /
 * GTK ids, the raw `wm_class` and a snapshot of the process table; everything
 * here only walks and normalises.
 *
 * Normalisation strips a trailing `.desktop` and a trailing `AppImage` suffix.
 * It never casefolds a path, never collapses the filesystem (`realpath`) and
 * never merges packaging namespaces: a deb, a Flatpak and a Snap install of one
 * app stay three identities. The conservative family normaliser exists for
 * grouping only (profiles, display) and is never persisted as an identity.
 */

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum IdentitySource
{
    [JsonStringEnumMemberName("desktop-id")] DesktopId,
    [JsonStringEnumMemberName("sandboxed-app-id")] SandboxedAppId,
    [JsonStringEnumMemberName("gtk-application-id")] GtkApplicationId,
    [JsonStringEnumMemberName("appimage")] AppImage,
    [JsonStringEnumMemberName("wm-class")] WmClass,
    [JsonStringEnumMemberName("window")] Window,
}

/// <summary>A snapshot of one process, as the platform reads it from the process table.</summary>
public sealed record ProcessEnv
{
    [JsonPropertyName("pid")] public required int Pid { get; init; }
    [JsonPropertyName("ppid")] public required int Ppid { get; init; }

    /// <summary>Raw NUL-separated environment. A zeroed or empty string means unreadable.</summary>
    [JsonPropertyName("environ")] public required string Environ { get; init; }
}

/// <summary>Everything the platform observed about the window at its first frame.</summary>
public sealed record IdentityProbe
{
    /// <summary>Desktop id from the shell's window tracker (often `*.desktop`).</summary>
    [JsonPropertyName("desktopId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DesktopId { get; init; }

    /// <summary>Sandboxed app id (Flatpak / Snap).</summary>
    [JsonPropertyName("sandboxedAppId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SandboxedAppId { get; init; }

    /// <summary>GTK application id.</summary>
    [JsonPropertyName("gtkApplicationId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? GtkApplicationId { get; init; }

    /// <summary>The window's process id, when the platform could read it.</summary>
    [JsonPropertyName("pid")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Pid { get; init; }

    /// <summary>The process table used to walk for an AppImage `APPIMAGE`.</summary>
    [JsonPropertyName("processes")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<ProcessEnv>? Processes { get; init; }

    /// <summary>Raw `wm_class`.</summary>
    [JsonPropertyName("wmClass")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? WmClass { get; init; }

    /// <summary>Session sequence for the provisional fallback.</summary>
    [JsonPropertyName("windowSeq")] public required int WindowSeq { get; init; }
}

/// <summary>The outcome of the chain: the key, where it came from and what was seen.</summary>
public sealed record IdentityResolution
{
    [JsonPropertyName("key")] public required string Key { get; init; }
    [JsonPropertyName("source")] public required IdentitySource Source { get; init; }

    /// <summary>The winning raw value, before normalisation; `null` for the provisional key.</summary>
    [JsonPropertyName("raw")] public required string? Raw { get; init; }

    [JsonPropertyName("provisional")] public required bool Provisional { get; init; }

    /// <summary>Every raw candidate, for the journal, keyed by source.</summary>
    [JsonPropertyName("rawValues")] public required IReadOnlyDictionary<IdentitySource, string?> RawValues { get; init; }
}

public static class Identity
{
    /// <summary>Prefix of the session-only provisional key (`window:<seq>`).</summary>
    private const string ProvisionalPrefix = "window:";

    private const string DesktopSuffix = ".desktop";

    private static readonly Regex AppImageSuffix = new(@"\.?AppImage\z", RegexOptions.CultureInvariant);
    private static readonly Regex Provisional = new(@"\Awindow:[0-9]+\z", RegexOptions.CultureInvariant);

    /// <summary>Strip the `.desktop` / `AppImage` suffixes and surrounding space. Never casefolds, never realpaths.</summary>
    public static string NormalizeIdentity(string raw)
    {
        var value = TrimJs(raw);
        if (value.EndsWith(DesktopSuffix, StringComparison.Ordinal)) value = value[..^DesktopSuffix.Length];
        value = AppImageSuffix.Replace(value, "");
        return TrimJs(value);
    }

    /// <summary>A provisional key is session-only and is re-keyed when a real identity appears.</summary>
    public static bool IsProvisional(string key) => Provisional.IsMatch(key);

    /// <summary>
    /// Conservative family key for grouping only. It casefolds (grouping is not an
    /// identity) and drops surrounding space, but it deliberately does **not** strip
    /// reverse-DNS or packaging qualifiers, so `com.spotify.Client` (Flatpak),
    /// `spotify` (deb) and Snap installs remain different families.
    /// </summary>
#pragma warning disable CA1308 // The model's family key is deliberately lower case.
    public static string AppFamily(string key) => RemoveWhitespace(NormalizeIdentity(key).ToLowerInvariant());
#pragma warning restore CA1308

    /// <summary>Read one variable out of a raw NUL-separated environment block.</summary>
    public static string? ReadEnvValue(string environ, string key)
    {
        foreach (var entry in environ.Split('\0'))
        {
            var eq = entry.IndexOf('=');
            if (eq <= 0) continue;
            if (entry[..eq] == key) return entry[(eq + 1)..];
        }
        return null;
    }

    /// <summary>
    /// Walk the process ancestors of `pid` (own process first) for `APPIMAGE`.
    ///
    /// An AppImage sets `APPIMAGE` to the real `.AppImage` path in the launcher
    /// environment; the mount path it uses at runtime is random per run. Chromium
    /// zeroes its own environment, so its own process shows nothing and the walk
    /// must continue to the parent that launched it. Mount paths are therefore never
    /// an identity.
    /// </summary>
    public static string? FindAppImage(int pid, IReadOnlyList<ProcessEnv> processes)
    {
        var table = new Dictionary<int, ProcessEnv>();
        foreach (var process in processes) table[process.Pid] = process;

        var visited = new HashSet<int>();
        int? current = pid;
        while (current is not null && !visited.Contains(current.Value))
        {
            visited.Add(current.Value);
            if (!table.TryGetValue(current.Value, out var process)) return null;
            var value = ReadEnvValue(process.Environ, "APPIMAGE");
            if (value is not null && value.Length > 0) return value;
            current = process.Ppid > 0 ? process.Ppid : null;
        }
        return null;
    }

    /// <summary>
    /// Resolve the chain in the model's order:
    /// desktop id → sandboxed app id → GTK application id → AppImage ancestor →
    /// `wm_class` → `window:<seq>`.
    /// </summary>
    public static IdentityResolution ResolveIdentity(IdentityProbe probe)
    {
        var desktopRaw = NonEmpty(probe.DesktopId);
        var sandboxedRaw = NonEmpty(probe.SandboxedAppId);
        var gtkRaw = NonEmpty(probe.GtkApplicationId);
        var wmClassRaw = NonEmpty(probe.WmClass);

        string? appImageRaw = null;
        if (probe.Pid is not null && probe.Processes is not null)
        {
            appImageRaw = NonEmpty(FindAppImage(probe.Pid.Value, probe.Processes));
        }

        var rawValues = new Dictionary<IdentitySource, string?>
        {
            [IdentitySource.DesktopId] = desktopRaw,
            [IdentitySource.SandboxedAppId] = sandboxedRaw,
            [IdentitySource.GtkApplicationId] = gtkRaw,
            [IdentitySource.AppImage] = appImageRaw,
            [IdentitySource.WmClass] = wmClassRaw,
            [IdentitySource.Window] = null,
        };

        var steps = new (IdentitySource Source, string? Raw)[]
        {
            // A desktop id that is itself the provisional key is ignored (§12).
            (IdentitySource.DesktopId, desktopRaw is not null && !IsProvisional(desktopRaw) ? desktopRaw : null),
            (IdentitySource.SandboxedAppId, sandboxedRaw),
            (IdentitySource.GtkApplicationId, gtkRaw),
            (IdentitySource.AppImage, appImageRaw),
            (IdentitySource.WmClass, wmClassRaw),
        };

        foreach (var step in steps)
        {
            if (step.Raw is null) continue;
            var key = NormalizeIdentity(step.Raw);
            if (key.Length == 0) continue;
            return new IdentityResolution
            {
                Key = key,
                Source = step.Source,
                Raw = step.Raw,
                Provisional = false,
                RawValues = rawValues,
            };
        }

        var provisionalKey = ProvisionalPrefix + probe.WindowSeq.ToString(CultureInfo.InvariantCulture);
        return new IdentityResolution
        {
            Key = provisionalKey,
            Source = IdentitySource.Window,
            Raw = null,
            Provisional = true,
            RawValues = rawValues,
        };
    }

    private static string? NonEmpty(string? raw)
    {
        if (raw is null) return null;
        var trimmed = TrimJs(raw);
        return trimmed.Length > 0 ? trimmed : null;
    }

    /// <summary>JavaScript's `String.prototype.trim()` (ECMAScript WhiteSpace + LineTerminator).</summary>
    private static string TrimJs(string value)
    {
        var start = 0;
        var end = value.Length;
        while (start < end && IsJsWhitespace(value[start])) start += 1;
        while (end > start && IsJsWhitespace(value[end - 1])) end -= 1;
        return value[start..end];
    }

    /// <summary>JavaScript's `/\s+/g` (ECMAScript WhiteSpace + LineTerminator).</summary>
    private static string RemoveWhitespace(string value)
    {
        var output = new System.Text.StringBuilder(value.Length);
        foreach (var ch in value)
        {
            if (!IsJsWhitespace(ch)) output.Append(ch);
        }
        return output.ToString();
    }

    private static bool IsJsWhitespace(char ch) =>
        ch is '\t' or '\n' or '\v' or '\f' or '\r' or ' ' or
            '\u00a0' or '\u1680' or '\u2000' or '\u2001' or '\u2002' or '\u2003' or '\u2004' or '\u2005' or
            '\u2006' or '\u2007' or '\u2008' or '\u2009' or '\u200a' or '\u2028' or '\u2029' or '\u202f' or
            '\u205f' or '\u3000' or '\ufeff';
}
