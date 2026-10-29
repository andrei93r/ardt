using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// Turns tracker surfaces into the core's focus inputs (§6/§17).
/// </summary>
/// <remarks>
/// The cycle is scoped to the focused window's screen, matching the model; a
/// directional move may reach another monitor (the core's candidate pass is
/// what decides), but never another workspace — only the active desktop has
/// visible surfaces. Floats are represented as <see cref="CycleEntryKind.Float"/>
/// so they cycle after the managed halves, left to right.
/// </remarks>
[SupportedOSPlatform("windows")]
internal static class FocusNavigator
{
    /// <summary>The cycle entries for the current window's screen, including floats.</summary>
    public static IReadOnlyList<CycleEntry> Entries(
        Surface current,
        IReadOnlyList<Surface> surfaces,
        IReadOnlyDictionary<int, int> slots,
        IReadOnlySet<int> floats)
    {
        var entries = new List<CycleEntry>(surfaces.Count);
        foreach (Surface surface in surfaces)
        {
            if (surface.ScreenId != current.ScreenId) continue;

            bool floating = floats.Contains(surface.Id);
            entries.Add(new CycleEntry
            {
                Id = surface.Id,
                Kind = floating ? CycleEntryKind.Float : CycleEntryKind.Managed,
                Slot = floating ? null : slots.TryGetValue(surface.Id, out int slot) ? slot : 0,
                Rect = surface.Frame,
                Z = surface.ZPosition,
                Minimized = surface.Flags.Minimized,
            });
        }

        return entries;
    }

    /// <summary>
    /// Next id in the cycle, using an optional lap snapshot from the core's
    /// <see cref="Focus.CycleSequence"/> so raising a float cannot reorder the lap.
    /// </summary>
    public static int? Next(
        Surface current,
        IReadOnlyList<Surface> surfaces,
        IReadOnlyDictionary<int, int> slots,
        IReadOnlySet<int> floats,
        IReadOnlyList<int>? order = null)
    {
        IReadOnlyList<CycleEntry> entries = Entries(current, surfaces, slots, floats);
        return Focus.CycleOrder(current.Id, entries, order);
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
