using System.Runtime.Versioning;
using System.Text;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// A focus lap: the core's <see cref="Focus.CycleSequence"/> is snapshotted once
/// when the lap starts and reused until the plane changes. Focusing a float
/// raises it, but the raised stacking order must not reorder the rest of the lap.
/// </summary>
/// <remarks>All state is host-thread only.</remarks>
[SupportedOSPlatform("windows")]
internal sealed class FocusLap
{
    private IReadOnlyList<int>? _order;
    private string? _key;

    /// <summary>Start a new lap on the next <see cref="Next"/> (retile, desktop switch, undo).</summary>
    public void Reset()
    {
        _order = null;
        _key = null;
    }

    /// <summary>Next id in the current lap, starting one when the plane changed.</summary>
    public int? Next(
        Surface current,
        IReadOnlyList<Surface> surfaces,
        IReadOnlyDictionary<int, int> slots,
        IReadOnlySet<int> floats)
    {
        IReadOnlyList<CycleEntry> entries = FocusNavigator.Entries(current, surfaces, slots, floats);
        string key = KeyFor(entries);
        if (_order is null || !string.Equals(key, _key, StringComparison.Ordinal))
        {
            _order = Focus.CycleSequence(entries);
            _key = key;
        }

        return Focus.CycleOrder(current.Id, entries, _order);
    }

    /// <summary>
    /// The lap's membership key. Rect and stacking are deliberately absent: a
    /// float raised by focusing it, or moved, must not restart the lap.
    /// </summary>
    private static string KeyFor(IReadOnlyList<CycleEntry> entries)
    {
        var builder = new StringBuilder(entries.Count * 12);
        foreach (CycleEntry entry in entries)
        {
            builder.Append(FormattableString.Invariant(
                $"{entry.Id}:{(entry.Kind == CycleEntryKind.Float ? 'f' : 'm')}:{entry.Slot}:{entry.Minimized}"));
            builder.Append('|');
        }

        return builder.ToString();
    }
}
