// Port of src/core/notify.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

public sealed record Notice
{
    [JsonPropertyName("key")] public required string Key { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }

    /// <summary>Always shown, never gated by a setting.</summary>
    [JsonPropertyName("always")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Always { get; init; }
}

/// <summary>
/// The debug notification catalogue (§21). Each entry is one decision the user can
/// opt into; when it is on, that decision raises a live notification phrased as the
/// decision itself, so the logic can be followed as it happens.
///
/// Two rules keep it usable rather than noisy:
///   * a notice is deduplicated per (key, subject) inside a short window, and
///   * at most a few notices are shown inside a longer window.
///
/// The "nothing happened" notices are the exception: they are always on, never
/// behind a checkbox (a request that changes nothing must say why).
/// </summary>
public static class Notify
{
    public static readonly IReadOnlyList<Notice> NoticeCatalogue =
    [
        new Notice { Key = "workspace-created", Title = "Workspace full → created one to the right" },
        new Notice { Key = "did-not-fit", Title = "Window did not fit → maximizing on the next workspace" },
        new Notice { Key = "trigger-wins", Title = "No room to share → keeping this window, the other gives way" },
        new Notice { Key = "sibling-adapted", Title = "A client refused the split → the sibling adapted" },
        new Notice { Key = "sibling-could-not", Title = "The sibling could not adapt → own workspace" },
        new Notice { Key = "no-room-floats", Title = "No room on this screen → floating" },
        new Notice { Key = "maximize-moved", Title = "Maximizing → moving it to its own workspace" },
        new Notice { Key = "minimized-others", Title = "Minimizing the other windows on this screen" },
        new Notice { Key = "minimized-moved", Title = "Only a minimized window left → moved to the neighbouring workspace" },
        new Notice { Key = "workspace-reaped", Title = "Empty workspace reaped" },
        new Notice { Key = "screen-changed", Title = "Screen changed → windows kept" },
        new Notice { Key = "normalised", Title = "Enabled → normalising the workspaces" },
    ];

    /// <summary>Requests that changed nothing: always shown, never a checkbox (§21).</summary>
    public static readonly IReadOnlyList<Notice> NoticeAlways =
    [
        new Notice { Key = "nothing-to-undo", Title = "Nothing to undo", Always = true },
        new Notice { Key = "cannot-move-workspace", Title = "Cannot move: this screen has only one workspace", Always = true },
        new Notice { Key = "un-float-full", Title = "Cannot un-float: both slots are taken", Always = true },
        new Notice { Key = "nothing-to-nudge", Title = "Nothing to nudge", Always = true },
        new Notice { Key = "resize-limit", Title = "Already at the limit", Always = true },
        new Notice { Key = "undo-impossible", Title = "Cannot undo: the window is gone", Always = true },
    ];

    private static readonly IReadOnlyList<Notice> All = [.. NoticeCatalogue, .. NoticeAlways];

    /// <summary>The phrase for a key, or null when the key is unknown (a typo is a bug).</summary>
    public static string? NoticeTitle(string key)
    {
        var entry = All.FirstOrDefault(notice => notice.Key == key);
        return entry?.Title;
    }

    /// <summary>Whether a key is always shown rather than gated by a setting.</summary>
    public static bool IsAlwaysNotice(string key) => NoticeAlways.Any(notice => notice.Key == key);
}

internal readonly record struct ShownNotice(string Key, string Subject, double At);

public sealed class NoticeGate
{
    private readonly List<ShownNotice> _shown = [];

    /// <param name="dedupeMs">The same key for the same subject is silent for this long.</param>
    /// <param name="cap">At most this many notices in the window below.</param>
    /// <param name="windowMs">The window the cap applies to.</param>
    public NoticeGate(double dedupeMs = 2000, int cap = 3, double windowMs = 10000)
    {
        DedupeMs = dedupeMs;
        Cap = cap;
        WindowMs = windowMs;
    }

    private double DedupeMs { get; }

    private int Cap { get; }

    private double WindowMs { get; }

    public int Size => _shown.Count;

    /// <summary>Whether this notice may be shown now. Records it when it may.</summary>
    public bool Allow(string key, string subject, double now)
    {
        Prune(now);
        if (_shown.Any(shown => shown.Key == key && shown.Subject == subject && now - shown.At < DedupeMs))
        {
            return false;
        }
        var inWindow = _shown.Count(shown => now - shown.At < WindowMs);
        if (inWindow >= Cap) return false;
        _shown.Add(new ShownNotice(key, subject, now));
        return true;
    }

    private void Prune(double now)
    {
        var keep = Math.Max(DedupeMs, WindowMs);
        while (_shown.Count > 0 && now - _shown[0].At >= keep) _shown.RemoveAt(0);
    }
}
