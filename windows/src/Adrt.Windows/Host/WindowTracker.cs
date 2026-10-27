using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// Turns raw <see cref="WindowEvent"/>s into pure-core <see cref="Surface"/>s.
/// </summary>
/// <remarks>
/// <para>
/// The tracker owns the identity map: an HWND gets the next monotonic id the
/// first time it is seen and keeps it until the window is destroyed, so the
/// planner can talk about windows by id while the host still knows the handle.
/// </para>
/// <para>
/// Events only mark the tracked set dirty. <see cref="Snapshot"/> rebuilds every
/// surface from live Win32/DWM reads when the host decides the stream has
/// settled (<see cref="TryBeginDrain"/>), which keeps the coalesced drain from
/// planning against half-applied state. Classification is the core's job: the
/// tracker supplies styles/owner/state facts and lets
/// <see cref="Classify.ClassifySurface"/> decide what is tileable.
/// </para>
/// <para>
/// All members run on the host thread; the WinEvent hook thread never touches
/// this object.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class WindowTracker
{
    /// <summary>Stage W3 puts every screen in one workspace.</summary>
    public const int SingleWorkspaceId = 0;

    private static readonly NativeMethods.EnumWindowsProc EnumWindowsCallback = OnEnumWindows;

    /// <summary>No exception apps and no user rules yet; only built-in rules apply.</summary>
    private static readonly ClassifyConfig Classification = new()
    {
        ExceptionApps = Array.Empty<string>(),
        Rules = Array.Empty<Rule>(),
        HeuristicModalDetect = false,
    };

    /// <summary>
    /// Shell surfaces that are top-level and unowned but are not part of the
    /// tiling: the desktop (Progman/WorkerW) and the taskbar. Windows has no
    /// "skip-taskbar" bit for them, so they are matched by class before the core
    /// classification runs; everything app-like is left to
    /// <see cref="Classify.ClassifySurface"/>.
    /// </summary>
    private static readonly HashSet<string> ShellClasses = new(StringComparer.Ordinal)
    {
        "Progman",
        "WorkerW",
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd",
    };

    private readonly Dictionary<nint, int> _idByHandle = [];
    private readonly Dictionary<int, nint> _handleById = [];
    private readonly HashSet<nint> _known = [];
    private int _nextId = 1;
    private long _lastEventAt = Stopwatch.GetTimestamp();
    private int _dirty;

    /// <summary>Number of HWNDs currently remembered (live, hidden and stale alike).</summary>
    public int TrackedCount => _known.Count;

    /// <summary>True when an event has arrived since the last drain started.</summary>
    public bool HasPending => Volatile.Read(ref _dirty) != 0;

    /// <summary>
    /// Remember the windows that already exist when the host starts, so tiling
    /// works without waiting for every window to be re-shown.
    /// </summary>
    public void Seed()
    {
        var handles = new List<nint>(64);
        GCHandle context = GCHandle.Alloc(handles);
        try
        {
            if (!NativeMethods.EnumWindows(
                    Marshal.GetFunctionPointerForDelegate(EnumWindowsCallback),
                    GCHandle.ToIntPtr(context)))
            {
                return;
            }
        }
        finally
        {
            context.Free();
        }

        foreach (nint handle in handles)
        {
            if (NativeMethods.IsWindowVisible(handle)) Track(handle);
        }

        MarkDirty();
    }

    /// <summary>Take in raw events from the pump; only identity/dirty state changes here.</summary>
    public void Observe(IReadOnlyList<WindowEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);

        foreach (WindowEvent rawEvent in events)
        {
            if (rawEvent.Kind == WindowEventKind.Destroy)
            {
                Untrack(rawEvent.Window);
                MarkDirty();
                continue;
            }

            if (rawEvent.Window == 0) continue;
            Track(rawEvent.Window);
            MarkDirty();
        }
    }

    /// <summary>
    /// True when there is pending work and no event has arrived for
    /// <paramref name="quiet"/>; consumes the dirty flag so the caller drains once.
    /// </summary>
    public bool TryBeginDrain(TimeSpan quiet)
    {
        if (Volatile.Read(ref _dirty) == 0) return false;
        if (Stopwatch.GetElapsedTime(Interlocked.Read(ref _lastEventAt)) < quiet) return false;

        Interlocked.Exchange(ref _dirty, 0);
        return true;
    }

    /// <summary>Force a drain on the next tick (used after resume and topology changes).</summary>
    public void RequestRetile() => MarkDirty();

    /// <summary>Build the current tileable surfaces, ordered by id.</summary>
    /// <param name="screenByMonitor">HMONITOR → <see cref="Screen.Index"/> for the live topology.</param>
    public IReadOnlyList<Surface> Snapshot(IReadOnlyDictionary<nint, int> screenByMonitor)
    {
        ArgumentNullException.ThrowIfNull(screenByMonitor);

        var surfaces = new List<Surface>(_known.Count);
        foreach (nint handle in _known.ToArray())
        {
            var window = new Win32Window(handle);
            if (!window.IsValid)
            {
                Untrack(handle);
                continue;
            }

            if (!window.IsTopLevel) continue;

            Surface? surface = BuildSurface(window, screenByMonitor);
            if (surface is not null) surfaces.Add(surface);
        }

        // ids are monotonic, so this also keeps the planner's id order stable.
        surfaces.Sort(static (left, right) => left.Id.CompareTo(right.Id));
        return surfaces;
    }

    /// <summary>Resolve the HWND currently carrying <paramref name="surfaceId"/>.</summary>
    public bool TryGetHandle(int surfaceId, out nint handle) =>
        _handleById.TryGetValue(surfaceId, out handle);

    /// <summary>Resolve the stable id of <paramref name="handle"/>, if it is known.</summary>
    public bool TryGetId(nint handle, out int surfaceId) =>
        _idByHandle.TryGetValue(handle, out surfaceId);

    private Surface? BuildSurface(Win32Window window, IReadOnlyDictionary<nint, int> screenByMonitor)
    {
        // Not on this desktop: hidden, or cloaked because it lives on another
        // virtual desktop / is a suspended UWP app. The core has no cloaked flag,
        // so these never become surfaces at all.
        if (!window.IsVisible || window.IsCloaked) return null;

        // The desktop and taskbar are top-level, unowned and visible; they are
        // shell chrome rather than user windows.
        if (ShellClasses.Contains(window.ClassName)) return null;

        Rect frame = window.FrameBounds;
        if (frame.Width <= 0 || frame.Height <= 0) return null;

        Win32Window owner = window.Owner;
        bool owned = owner.Handle != 0;
        bool chromeLess = window.IsToolWindow || window.IsNoActivate;

        SurfaceKind kind = owned
            ? SurfaceKind.Dialog
            : chromeLess ? SurfaceKind.Utility : SurfaceKind.Normal;

        var flags = new SurfaceFlags
        {
            // An owned top-level window is a transient/dialog: the core ignores it.
            Transient = owned,
            Above = window.IsTopmost,
            Minimized = window.IsMinimized,
            Maximized = window.IsMaximized,
            // Tool/no-activate windows are not part of the taskbar/tiling surface.
            SkipTaskbar = chromeLess,
        };

        int? parentId = owned && TryGetId(owner.Handle, out int ownerId) ? ownerId : null;

        var surface = new Surface
        {
            Id = _idByHandle[window.Handle],
            Kind = kind,
            AppId = window.ExecutableName,
            AppVersion = "",
            Title = window.Title,
            // Win32 exposes neither hint; 0/0 matches the core's "unknown" case
            // (it only fails `min-equals-max` for non-zero sizes).
            Min = new Size(0, 0),
            Max = new Size(0, 0),
            Frame = frame,
            ScreenId = ScreenFor(window, screenByMonitor),
            WorkspaceId = SingleWorkspaceId,
            Flags = flags,
            ParentId = parentId,
            // Replaced below with the classification's layer.
            Layer = Layer.Tiled,
            ZPosition = 0,
        };

        Classification classification = Classify.ClassifySurface(surface, Classification);
        if (!classification.Tileable) return null;

        return surface with { Layer = classification.Layer };
    }

    private static int ScreenFor(Win32Window window, IReadOnlyDictionary<nint, int> screenByMonitor)
    {
        if (screenByMonitor.Count == 0) return 0;
        return screenByMonitor.TryGetValue(window.MonitorHandle, out int index)
            ? index
            : screenByMonitor.Values.Min();
    }

    private int Track(nint handle)
    {
        if (_idByHandle.TryGetValue(handle, out int existing)) return existing;

        int id = _nextId++;
        _idByHandle.Add(handle, id);
        _handleById.Add(id, handle);
        _known.Add(handle);
        return id;
    }

    private void Untrack(nint handle)
    {
        if (_idByHandle.Remove(handle, out int id)) _handleById.Remove(id);
        _known.Remove(handle);
    }

    private void MarkDirty()
    {
        Interlocked.Exchange(ref _lastEventAt, Stopwatch.GetTimestamp());
        Volatile.Write(ref _dirty, 1);
    }

    private static bool OnEnumWindows(nint handle, nint data)
    {
        if (GCHandle.FromIntPtr(data).Target is List<nint> handles) handles.Add(handle);
        return true;
    }
}
