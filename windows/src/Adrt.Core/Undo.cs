// Port of src/core/undo.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>The configuration one window instance had when a change was captured.</summary>
public sealed record InstanceConfig
{
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("workspace")] public required int Workspace { get; init; }

    /// <summary>The tiling slot it held, or null when it was not a tiled half.</summary>
    [JsonPropertyName("slot")] public int? Slot { get; init; }

    [JsonPropertyName("rect")] public required Rect Rect { get; init; }
    [JsonPropertyName("maximized")] public required bool Maximized { get; init; }
    [JsonPropertyName("floating")] public required bool Floating { get; init; }
}

/// <summary>§13: one change — the instances it touched and the ratios behind them.</summary>
public sealed record Change
{
    [JsonPropertyName("instances")] public required IReadOnlyList<InstanceConfig> Instances { get; init; }
    [JsonPropertyName("ratios")] public Dictionary<string, double>? Ratios { get; init; }
}

/// <summary>The single in-memory undo slot. `set` overwrites: there is never a stack.</summary>
public sealed class ChangeLog
{
    private Change? _entry;

    /// <summary>Record a change. An empty change is ignored, so it cannot mask the real one.</summary>
    public bool Set(Change change)
    {
        if (change.Instances.Count == 0) return false;
        var ratios = change.Ratios;
        _entry = new Change
        {
            Instances = change.Instances
                .Select(instance => instance with
                {
                    Rect = new Rect(instance.Rect.X, instance.Rect.Y, instance.Rect.Width, instance.Rect.Height),
                })
                .ToList(),
            Ratios = ratios is null ? null : new Dictionary<string, double>(ratios),
        };
        return true;
    }

    /// <summary>Take the change (undo consumes it: it can be undone once).</summary>
    public Change? Take()
    {
        var entry = _entry;
        _entry = null;
        return entry;
    }

    public Change? Peek() => _entry;

    public void Clear() => _entry = null;

    public int Size => _entry is null ? 0 : 1;
}

/// <summary>The live state of an instance, as the validator needs to see it.</summary>
public sealed record LiveInstance
{
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("workspace")] public required int Workspace { get; init; }

    /// <summary>The slot the window currently holds, or null when not a tiled half.</summary>
    [JsonPropertyName("slot")] public int? Slot { get; init; }
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum UndoProblem
{
    [JsonStringEnumMemberName("instance-gone")] InstanceGone,
    [JsonStringEnumMemberName("slot-taken")] SlotTaken,
}

public sealed record UndoValidation
{
    [JsonPropertyName("ok")] public required bool Ok { get; init; }

    /// <summary>Null means "no problem" (the TypeScript's `null` union member).</summary>
    [JsonPropertyName("problem")] public UndoProblem? Problem { get; init; }
}

/// <summary>
/// Undo (§13). Exactly one change is held, in memory only, per instance and
/// configuration: workspace, slot, rect, maximized, floating — plus the ratios
/// that produced them. A restart clears it; it is never persisted.
///
/// The change is only ever *described* here, never applied: the adapter reads
/// the live state, asks `validateChange` whether the whole change can still be
/// restored, and applies all of it or none of it.
/// </summary>
public static class Undo
{
    /// <summary>
    /// §13: validate the *whole* change before applying any of it. It is impossible
    /// when an instance is gone, or when a slot the change needs is now held by a
    /// window that is not part of the change (the change's own swap is fine).
    /// Partial restores never happen.
    /// </summary>
    public static UndoValidation ValidateChange(Change change, IReadOnlyList<LiveInstance> live)
    {
        var byId = new Dictionary<int, LiveInstance>();
        foreach (var instance in live) byId[instance.Id] = instance;
        foreach (var instance in change.Instances)
        {
            if (!byId.ContainsKey(instance.Id)) return new UndoValidation { Ok = false, Problem = UndoProblem.InstanceGone };
        }
        var own = new HashSet<int>(change.Instances.Select(instance => instance.Id));
        foreach (var instance in change.Instances)
        {
            if (instance.Slot is null) continue;
            var occupant = live.FirstOrDefault(
                candidate => candidate.Workspace == instance.Workspace && candidate.Slot == instance.Slot && candidate.Id != instance.Id);
            if (occupant is not null && !own.Contains(occupant.Id)) return new UndoValidation { Ok = false, Problem = UndoProblem.SlotTaken };
        }
        return new UndoValidation { Ok = true, Problem = null };
    }
}
