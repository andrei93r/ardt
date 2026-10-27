using Adrt.Core;

namespace Adrt.Windows;

/// <summary>Maximize/unmaximize work for one planning pass, by surface id.</summary>
/// <param name="Restore">Windows to <c>SW_RESTORE</c> before the plan is built.</param>
/// <param name="Minimize">Windows to minimize because a maximized window keeps the screen.</param>
internal sealed record MaximizeActions(IReadOnlyList<int> Restore, IReadOnlyList<int> Minimize)
{
    public bool IsEmpty => Restore.Count == 0 && Minimize.Count == 0;
}

/// <summary>
/// The Windows single-desktop version of the model's maximize ladder (§4).
/// </summary>
/// <remarks>
/// <para>
/// A lone window is not turned into an OS-maximized window here: the tiler's
/// "lone fill" already gives it the whole work area and keeps it a normal
/// window, which is the Windows representation of the model's maximize while
/// virtual desktops are unavailable.
/// </para>
/// <para>
/// When the user maximizes one member of a pair, that window keeps the screen
/// (it is already maximized) and the other managed windows are minimized — the
/// single-desktop form of "maximize moves to its own workspace". Unmaximizing
/// it restores those windows and the next plan forms the pair again.
/// </para>
/// <para>
/// A maximized window that is no longer alone (a fresh arrival, or a window the
/// user restored beside it) is restored so the pair can exist: a maximized
/// window cannot be half-tiled. This is the "unmaximize restores the pair"
/// rule in the direction the newcomer forces.
/// </para>
/// </remarks>
internal sealed class MaximizeLadder
{
    private readonly Dictionary<int, bool> _wasMaximized = [];

    /// <summary>Observe the live set and return the actions the pass must apply first.</summary>
    public MaximizeActions Observe(IReadOnlyList<Surface> surfaces)
    {
        var restore = new HashSet<int>();
        var minimize = new HashSet<int>();
        var justMaximized = new HashSet<int>();
        var unmaximized = new HashSet<int>();
        var byScreen = new Dictionary<int, List<Surface>>();

        foreach (Surface surface in surfaces)
        {
            bool known = _wasMaximized.TryGetValue(surface.Id, out bool wasMaximized);
            if (known)
            {
                if (!wasMaximized && surface.Flags.Maximized) justMaximized.Add(surface.Id);
                else if (wasMaximized && !surface.Flags.Maximized) unmaximized.Add(surface.Id);
            }

            _wasMaximized[surface.Id] = surface.Flags.Maximized;

            if (!byScreen.TryGetValue(surface.ScreenId, out List<Surface>? onScreen))
            {
                onScreen = [];
                byScreen.Add(surface.ScreenId, onScreen);
            }

            onScreen.Add(surface);
        }

        foreach (List<Surface> onScreen in byScreen.Values)
        {
            bool screenUnmaximized = false;
            bool screenJustMaximized = false;
            foreach (Surface surface in onScreen)
            {
                if (unmaximized.Contains(surface.Id)) screenUnmaximized = true;
                if (justMaximized.Contains(surface.Id)) screenJustMaximized = true;
            }

            // A user unmaximize restores the windows this ladder minimized for
            // the maximizer, so the pair is back in one pass.
            if (screenUnmaximized)
            {
                foreach (Surface surface in onScreen)
                {
                    if (surface.Flags.Minimized) restore.Add(surface.Id);
                }
            }

            var active = new List<Surface>(onScreen.Count);
            foreach (Surface surface in onScreen)
            {
                if (!surface.Flags.Minimized) active.Add(surface);
            }

            var maximized = new List<Surface>();
            var normal = new List<Surface>();
            foreach (Surface surface in active)
            {
                if (surface.Flags.Maximized) maximized.Add(surface);
                else normal.Add(surface);
            }

            if (maximized.Count == 0) continue;

            if (screenJustMaximized)
            {
                // The user's maximize wins this pass: single-desktop mode keeps
                // it in place and minimizes the windows that would share it.
                foreach (Surface surface in normal) minimize.Add(surface.Id);
            }
            else if (active.Count >= 2)
            {
                // Something now shares the screen with the maximized window (a
                // newcomer, or a window the user restored): restore the
                // maximizer so the planner can form the pair.
                foreach (Surface surface in maximized) restore.Add(surface.Id);
            }
        }

        restore.ExceptWith(minimize);
        return new MaximizeActions([.. restore], [.. minimize]);
    }

    /// <summary>Tell the ladder an OS restore was ours, not the user's unmaximize.</summary>
    public void NoteRestored(int surfaceId) => _wasMaximized[surfaceId] = false;

    /// <summary>Tell the ladder an OS maximize was ours (undo), not the user's click.</summary>
    public void NoteMaximized(int surfaceId) => _wasMaximized[surfaceId] = true;

    /// <summary>Forget windows that are gone so the map cannot grow without bound.</summary>
    public void Prune(IReadOnlySet<int> liveIds)
    {
        foreach (int id in _wasMaximized.Keys.ToArray())
        {
            if (!liveIds.Contains(id)) _wasMaximized.Remove(id);
        }
    }
}
