using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// Turns tracker surfaces into the core's focus inputs (§6/§17).
/// </summary>
/// <remarks>
/// The cycle is scoped to the focused window's screen, matching the model; a
/// directional move may reach another monitor (the core's candidate pass is
/// what decides), but never another workspace — there is one in this stage.
/// </remarks>
[SupportedOSPlatform("windows")]
internal static class FocusNavigator
{
    /// <summary>Next id in the cycle, or null when there is nowhere to go.</summary>
    public static int? Next(
        Surface current,
        IReadOnlyList<Surface> surfaces,
        IReadOnlyDictionary<int, int> slots)
    {
        var entries = new List<CycleEntry>(surfaces.Count);
        foreach (Surface surface in surfaces)
        {
            if (surface.ScreenId != current.ScreenId) continue;

            entries.Add(new CycleEntry
            {
                Id = surface.Id,
                Kind = CycleEntryKind.Managed,
                Slot = slots.TryGetValue(surface.Id, out int slot) ? slot : 0,
                Rect = surface.Frame,
                Minimized = surface.Flags.Minimized,
            });
        }

        return Focus.CycleOrder(current.Id, entries);
    }

    /// <summary>Nearest non-minimized surface in <paramref name="direction"/>.</summary>
    public static int? Direction(
        Surface current,
        Rect currentRect,
        IReadOnlyList<Surface> surfaces,
        FocusDirection direction)
    {
        var candidates = new List<FocusCandidate>(surfaces.Count);
        foreach (Surface surface in surfaces)
        {
            if (surface.Id == current.Id || surface.Flags.Minimized) continue;
            candidates.Add(new FocusCandidate { Id = surface.Id, Rect = surface.Frame });
        }

        return Focus.PickDirectional(currentRect, candidates, direction);
    }
}
