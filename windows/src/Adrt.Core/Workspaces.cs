// Port of src/core/workspaces.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>A window to move before a reap, and the workspace it moves to.</summary>
public sealed record RelocateMove
{
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("to")] public required int To { get; init; }
}

public sealed record ReapPlan
{
    /// <summary>Workspace indexes to remove.</summary>
    [JsonPropertyName("reap")] public required IReadOnlyList<int> Reap { get; init; }

    /// <summary>Windows to move before the reap, in order.</summary>
    [JsonPropertyName("relocate")] public required IReadOnlyList<RelocateMove> Relocate { get; init; }
}

/// <summary>
/// Emptiness and packing (§5). Reaping is a **property, not an event**: at every
/// drain, any empty workspace other than GNOME's trailing spare is removed,
/// wherever it sits. A workspace whose only windows are minimized relocates its
/// occupant first (left, else right, else it is left alone), so that it can be
/// reaped — except when no neighbour holds windows, which is the one legal
/// look-empty workspace.
/// </summary>
public static class Workspaces
{
    /// <summary>Whether a workspace holds anything at all (visible, minimized or floating).</summary>
    public static bool HoldsWindows(Ws ws) => PlacementPolicy.WindowCount(ws) > 0;

    /// <summary>GNOME's trailing empty workspace: the last one, never removed by adrt.</summary>
    public static int SpareIndex(State state) => Math.Max(0, state.Workspaces.Count - 1);

    /// <summary>
    /// What the drain should reap and relocate. Workspaces holding only minimized
    /// windows relocate their occupant and are then reaped; empty workspaces other
    /// than the spare are reaped; a workspace pinned by a float stays.
    /// </summary>
    public static ReapPlan ReapPlan(State state)
    {
        var spare = SpareIndex(state);
        var reap = new List<int>();
        var relocate = new List<RelocateMove>();
        for (var index = 0; index < state.Workspaces.Count; index++)
        {
            if (index == spare) continue;
            var ws = state.Workspaces[index];
            var visible = (ws.Slots[0] is null ? 0 : 1) + (ws.Slots[1] is null ? 0 : 1);
            var floats = ws.Floats?.Count ?? 0;
            if (floats > 0) continue; // a float pins its workspace (§6)
            if (visible > 0) continue;
            if (ws.Minimized.Count > 0)
            {
                var move = PlacementPolicy.MinimizeRelocation(state, index);
                if (move is not { } relocation) continue; // allowed to stay: no neighbour holds windows
                foreach (var hidden in ws.Minimized) relocate.Add(new RelocateMove { Id = hidden.Id, To = relocation.To });
                reap.Add(index);
                continue;
            }
            reap.Add(index);
        }
        return new ReapPlan { Reap = reap, Relocate = relocate };
    }
}
