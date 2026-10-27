// Port of src/core/profiles.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>Hardcoded app families (§10). Shared by every adapter; pure data + lookup.</summary>
public sealed record Profile
{
    [JsonPropertyName("name")] public required string Name { get; init; }
    [JsonPropertyName("unmaximizeDelayMs")] public required double UnmaximizeDelayMs { get; init; }
    [JsonPropertyName("retriesMs")] public required IReadOnlyList<double> RetriesMs { get; init; }
    [JsonPropertyName("animate")] public required bool Animate { get; init; }
}

public static class Profiles
{
    private static readonly IReadOnlyList<string> ChromeFamily = new[]
    {
        "google-chrome",
        "chrome",
        "chromium",
        "chromium-browser",
        "brave-browser",
        "brave",
        "vivaldi-stable",
        "vivaldi",
        "microsoft-edge",
        "edge",
        "opera",
    };

    private static readonly IReadOnlyList<string> Electron = new[]
    {
        "code",
        "code-insiders",
        "vscode",
        "slack",
        "discord",
        "signal",
        "element",
        "obsidian",
        "notion",
        "figma",
        "postman",
        "insomnia",
        "spotify",
        "1password",
        "bitwarden",
        "joplin",
        "logseq",
        "todoist",
        "zulip",
        "mattermost",
        "teams",
        "whatsapp",
        "standard-notes",
        "thunderbird-beta",
    };

    private static readonly IReadOnlyList<string> GtkTerminal = new[]
    {
        "org.gnome.terminal",
        "gnome-terminal",
        "kgx",
        "kitty",
        "alacritty",
        "foot",
        "footclient",
        "wezterm",
        "konsole",
    };

    private static readonly IReadOnlyList<string> JavaSwing = new[]
    {
        "jetbrains-idea",
        "jetbrains-idea-ce",
        "jetbrains-pycharm",
        "jetbrains-pycharm-ce",
        "jetbrains-webstorm",
        "jetbrains-goland",
        "jetbrains-clion",
        "jetbrains-rider",
        "jetbrains-datagrip",
        "idea",
    };

    private static readonly Profile ChromeFamilyProfile = new()
    {
        Name = "chrome-family",
        UnmaximizeDelayMs = 48,
        RetriesMs = new double[] { 80, 200, 500 },
        Animate = true,
    };

    private static readonly Profile ElectronProfile = new()
    {
        Name = "electron",
        UnmaximizeDelayMs = 48,
        RetriesMs = new double[] { 80, 200, 500 },
        Animate = true,
    };

    private static readonly Profile GtkTerminalProfile = new()
    {
        Name = "gtk-terminal",
        UnmaximizeDelayMs = 0,
        RetriesMs = new double[] { 50 },
        Animate = true,
    };

    private static readonly Profile JavaSwingProfile = new()
    {
        Name = "java-swing",
        UnmaximizeDelayMs = 48,
        RetriesMs = new double[] { 80, 200, 500 },
        Animate = false,
    };

    private static readonly Profile DefaultProfile = new()
    {
        Name = "default",
        UnmaximizeDelayMs = 16,
        RetriesMs = new double[] { 50, 150 },
        Animate = true,
    };

    /// <summary>
    /// TS `PROFILES`. Named `All` because a static member cannot share its
    /// enclosing type's name in C#.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, Profile> All = new Dictionary<string, Profile>(StringComparer.Ordinal)
    {
        ["chrome-family"] = ChromeFamilyProfile,
        ["electron"] = ElectronProfile,
        ["gtk-terminal"] = GtkTerminalProfile,
        ["java-swing"] = JavaSwingProfile,
        ["default"] = DefaultProfile,
    };

    /// <summary>Resolve the profile for an app class. Unknown apps get `default`.</summary>
    public static Profile ProfileFor(string appId)
    {
        if (Belongs(appId, ChromeFamily)) return All["chrome-family"];
        if (Belongs(appId, Electron)) return All["electron"];
        if (Belongs(appId, GtkTerminal)) return All["gtk-terminal"];
        if (Belongs(appId, JavaSwing)) return All["java-swing"];
        return All["default"];
    }

#pragma warning disable CA1308 // The model normalises app ids to lower case for grouping.
    private static string Normalize(string appId) => RemoveWhitespace(appId.ToLowerInvariant());
#pragma warning restore CA1308

    private static bool Belongs(string appId, IReadOnlyList<string> family)
    {
        var id = Normalize(appId);
        foreach (var entry in family)
        {
            var candidate = Normalize(entry);
            if (id == candidate) return true;
            if (id.EndsWith("." + candidate, StringComparison.Ordinal)) return true;
        }
        return false;
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
