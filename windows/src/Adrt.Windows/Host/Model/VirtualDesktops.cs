using System.Runtime.InteropServices;
using System.Runtime.Versioning;

// DllImport is deliberate here: this file is the self-contained virtual-desktop
// bridge, so its two small user32 declarations stay local rather than growing
// NativeMethods. Source-generated LibraryImport would need AllowUnsafeBlocks.
#pragma warning disable SYSLIB1054 // Use LibraryImport instead of DllImport.

namespace Adrt.Windows;

/// <summary>
/// The documented Windows virtual-desktop surface, wrapped for the tiling host.
/// </summary>
/// <remarks>
/// <para>
/// Only the documented <c>IVirtualDesktopManager</c> interface is used. Creating
/// and switching desktops live on the undocumented
/// <c>IVirtualDesktopManagerInternal</c>, whose GUIDs move between Windows
/// builds, so this service deliberately stops at the three documented calls:
/// <c>IsWindowOnCurrentVirtualDesktop</c>, <c>GetWindowDesktopId</c> and
/// <c>MoveWindowToDesktop</c>. When the COM class cannot be activated, the
/// service reports <see cref="IsSupported"/> = <see langword="false"/> and the
/// host keeps its legal single-desktop mode.
/// </para>
/// <para>
/// Integration point: <c>TilingHost</c> calls <see cref="Refresh"/> on a 1 s
/// tick and <see cref="TryMoveToDesktop"/> when a workspace changes. All members
/// are meant to run on the host's STA message-loop thread.
/// </para>
/// <para>
/// No method throws into the host loop: activation and COM failures are caught,
/// reported once, and turned into <see langword="false"/>/<see langword="null"/>.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
internal sealed class VirtualDesktops
{
    private const string ClsidVirtualDesktopManager = "AA509086-5CA9-4C25-8F95-589D3C07B48A";
    private const string IidVirtualDesktopManager = "A5CD92FF-29BE-454C-8D04-D82879FB3F1B";

    private static readonly Guid Clsid = new(ClsidVirtualDesktopManager);
    private static readonly Guid Iid = new(IidVirtualDesktopManager);

    private readonly Action<string>? _log;
    private IVirtualDesktopManager? _manager;
    private Guid? _currentDesktopId;
    private bool _creationAttempted;
    private bool _unavailableLogged;
    private bool _callFailureLogged;

    /// <summary>Create the bridge and probe the documented COM class once.</summary>
    /// <param name="log">Receives one line on availability and the first failure.</param>
    public VirtualDesktops(Action<string>? log = null)
    {
        _log = log;
        _ = EnsureManager();
    }

    /// <summary>
    /// True when the documented COM class was activated. False means this host
    /// cannot use virtual desktops (no COM class, or not on Windows) and must
    /// keep the single-desktop degradation.
    /// </summary>
    public bool IsSupported => _manager is not null;

    /// <summary>
    /// The desktop id inferred at the last <see cref="Refresh"/>, or
    /// <see langword="null"/> when no window could identify the current desktop.
    /// </summary>
    /// <remarks>
    /// The documented interface has no <c>GetCurrentDesktopId</c>. The id is
    /// therefore read from a window known to be on the current desktop — the
    /// foreground window first, then the first visible top-level window. The
    /// last successful value is retained when no such window exists.
    /// </remarks>
    public Guid? CurrentDesktopId => _currentDesktopId;

    /// <summary>
    /// Re-read the current desktop id. Safe to call on every host tick: it logs
    /// nothing on success and never throws.
    /// </summary>
    public void Refresh()
    {
        if (!EnsureManager()) return;

        Guid? current = QueryCurrentDesktopId();
        if (current is { } desktopId) _currentDesktopId = desktopId;
    }

    /// <summary>Move one top-level window to <paramref name="desktopId"/>.</summary>
    /// <returns>True when COM accepted the move; false for a stale handle or a refusal.</returns>
    public bool TryMoveToDesktop(nint hwnd, Guid desktopId)
    {
        if (hwnd == 0 || desktopId == Guid.Empty) return false;
        if (!EnsureManager()) return false;

        IVirtualDesktopManager? manager = _manager;
        if (manager is null || !IsWindow(hwnd)) return false;

        try
        {
            Guid id = desktopId;
            int hr = manager.MoveWindowToDesktop(hwnd, ref id);
            if (hr >= 0) return true;

            NoteCallFailure(nameof(IVirtualDesktopManager.MoveWindowToDesktop), hr);
            return false;
        }
        catch (Exception error)
        {
            MarkUnavailable(error.Message, error.HResult);
            return false;
        }
    }

    /// <summary>Whether <paramref name="hwnd"/> is on the desktop the user is looking at.</summary>
    public bool IsOnCurrentDesktop(nint hwnd)
    {
        if (hwnd == 0) return false;
        if (!EnsureManager()) return false;

        IVirtualDesktopManager? manager = _manager;
        if (manager is null || !IsWindow(hwnd)) return false;

        try
        {
            int hr = manager.IsWindowOnCurrentVirtualDesktop(hwnd, out int onCurrentDesktop);
            if (hr >= 0) return onCurrentDesktop != 0;

            NoteCallFailure(nameof(IVirtualDesktopManager.IsWindowOnCurrentVirtualDesktop), hr);
            return false;
        }
        catch (Exception error)
        {
            MarkUnavailable(error.Message, error.HResult);
            return false;
        }
    }

    /// <summary>Activate the COM object once; a failure degrades for the session.</summary>
    private bool EnsureManager()
    {
        if (_manager is not null) return true;
        if (_creationAttempted) return false;
        _creationAttempted = true;

        try
        {
            Type? type = Type.GetTypeFromCLSID(Clsid, throwOnError: false);
            if (type is null)
            {
                MarkUnavailable("CLSID_VirtualDesktopManager is not registered", 0);
                return false;
            }

            object? instance = Activator.CreateInstance(type);
            _manager = instance as IVirtualDesktopManager;
            if (_manager is null)
            {
                MarkUnavailable("the COM object does not implement IVirtualDesktopManager", 0);
                return false;
            }

            Log("[desktops] IVirtualDesktopManager available.");
            return true;
        }
        catch (Exception error)
        {
            // Activation can fail with COMException, PlatformNotSupportedException,
            // NotSupportedException or a type-load error depending on the host.
            // Any of them means "no virtual desktops"; tiling must continue.
            MarkUnavailable(error.Message, error.HResult);
            return false;
        }
    }

    /// <summary>Read the current desktop id from the foreground or first visible window.</summary>
    private Guid? QueryCurrentDesktopId()
    {
        if (TryDesktopOfCurrentWindow(GetForegroundWindow(), out Guid foreground))
        {
            return foreground;
        }

        Guid? found = null;
        _ = EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            if (!TryDesktopOfCurrentWindow(hwnd, out Guid candidate)) return true;

            found = candidate;
            return false;
        }, 0);

        return found;
    }

    /// <summary>The desktop id of a window, but only when that window is on the current desktop.</summary>
    private bool TryDesktopOfCurrentWindow(nint hwnd, out Guid desktopId)
    {
        desktopId = Guid.Empty;

        IVirtualDesktopManager? manager = _manager;
        if (manager is null || hwnd == 0 || !IsWindow(hwnd)) return false;

        try
        {
            int hr = manager.IsWindowOnCurrentVirtualDesktop(hwnd, out int onCurrentDesktop);
            if (hr < 0)
            {
                NoteCallFailure(nameof(IVirtualDesktopManager.IsWindowOnCurrentVirtualDesktop), hr);
                return false;
            }
            if (onCurrentDesktop == 0) return false;

            hr = manager.GetWindowDesktopId(hwnd, out desktopId);
            if (hr < 0)
            {
                NoteCallFailure(nameof(IVirtualDesktopManager.GetWindowDesktopId), hr);
                desktopId = Guid.Empty;
                return false;
            }

            return desktopId != Guid.Empty;
        }
        catch (Exception error)
        {
            desktopId = Guid.Empty;
            MarkUnavailable(error.Message, error.HResult);
            return false;
        }
    }

    private void MarkUnavailable(string reason, int hresult)
    {
        _manager = null;
        if (_unavailableLogged) return;
        _unavailableLogged = true;

        string code = hresult == 0 ? "" : FormattableString.Invariant($" (0x{hresult:X8})");
        Log($"[desktops] virtual desktops unavailable: {reason}{code}; using single-desktop mode.");
    }

    private void NoteCallFailure(string operation, int hresult)
    {
        if (_callFailureLogged) return;
        _callFailureLogged = true;
        Log(FormattableString.Invariant($"[desktops] {operation} failed (hr=0x{hresult:X8}); ignored."));
    }

    private void Log(string message) => _log?.Invoke(message);

    // ---------------------------------------------------------------------
    // The documented interface. Method order defines the vtable order, so it
    // must stay exactly as declared in shobjidl_core.h.
    // ---------------------------------------------------------------------

    [ComImport]
    [Guid(IidVirtualDesktopManager)]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IVirtualDesktopManager
    {
        [PreserveSig]
        int IsWindowOnCurrentVirtualDesktop(nint topLevelWindow, out int onCurrentDesktop);

        [PreserveSig]
        int GetWindowDesktopId(nint topLevelWindow, out Guid desktopId);

        [PreserveSig]
        int MoveWindowToDesktop(nint topLevelWindow, ref Guid desktopId);
    }

    // ---------------------------------------------------------------------
    // Local user32 declarations: only what the current-desktop probe needs.
    // ---------------------------------------------------------------------

    [DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc callback, nint lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(nint hwnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(nint hwnd);

    [return: MarshalAs(UnmanagedType.Bool)]
    private delegate bool EnumWindowsProc(nint hwnd, nint lParam);
}
