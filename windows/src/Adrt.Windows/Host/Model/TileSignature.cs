using System.Text;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// A stable description of the tileable set, used by the periodic self-heal
/// sweep to notice a change that arrived without an event (a missed destroy, a
/// cloaked window, a classification flag flip).
/// </summary>
/// <remarks>
/// Only membership and the state flags that change what the tiler may move are
/// part of the signature. Geometry is deliberately absent: a user move is
/// already an event, and including it here would make the sweep re-plan on every
/// animation frame.
/// </remarks>
internal static class TileSignature
{
    public static string For(IReadOnlyList<Surface> surfaces)
    {
        var builder = new StringBuilder(surfaces.Count * 24);
        foreach (Surface surface in surfaces)
        {
            builder.Append(FormattableString.Invariant(
                $"{surface.Id}:{surface.ScreenId}:{surface.WorkspaceId}:{(surface.Flags.Minimized ? 'm' : '-')}"));
            builder.Append(surface.Flags.Maximized ? 'M' : '-');
            builder.Append(surface.Flags.Floating ? 'f' : '-');
            builder.Append('|');
        }

        return builder.ToString();
    }
}
