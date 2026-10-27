using Adrt.Core;

namespace Adrt.Windows;

/// <summary>A window a placement batch moved, with the rectangle it had before.</summary>
/// <param name="SurfaceId">Stable tracker id.</param>
/// <param name="Slot">Screen-scoped slot the window held before the batch, or null.</param>
/// <param name="Rect">Visible frame before the batch, physical pixels.</param>
/// <param name="Maximized">Whether the window was maximized before the batch.</param>
internal readonly record struct PlacedWindow(int SurfaceId, int? Slot, Rect Rect, bool Maximized);

/// <summary>
/// The single undo slot for placement batches (§13), backed by the core
/// <see cref="ChangeLog"/>.
/// </summary>
/// <remarks>
/// Every applied batch overwrites the previous entry, matching the model's
/// "there is never a stack" rule. Only the previous geometry and maximize state
/// are stored; the host validates the whole change with
/// <see cref="Undo.ValidateChange"/> before restoring any of it.
/// </remarks>
internal sealed class PlacementHistory
{
    private readonly ChangeLog _changes = new();

    /// <summary>Number of undoable batches (0 or 1).</summary>
    public int Size => _changes.Size;

    /// <summary>Record the pre-batch state so <c>UndoLast</c> can revert it.</summary>
    public void Record(IReadOnlyList<PlacedWindow> windows)
    {
        ArgumentNullException.ThrowIfNull(windows);
        if (windows.Count == 0) return;

        var instances = new List<InstanceConfig>(windows.Count);
        foreach (PlacedWindow window in windows)
        {
            instances.Add(new InstanceConfig
            {
                Id = window.SurfaceId,
                Workspace = WindowTracker.SingleWorkspaceId,
                Slot = window.Slot,
                Rect = window.Rect,
                Maximized = window.Maximized,
                Floating = false,
            });
        }

        _changes.Set(new Change { Instances = instances, Ratios = null });
    }

    /// <summary>Take the last change; undo consumes it, so it can be reverted once.</summary>
    public Change? Take() => _changes.Take();
}
