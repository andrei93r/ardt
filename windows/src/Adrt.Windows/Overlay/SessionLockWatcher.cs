using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Adrt.Windows.Overlay;

/// <summary>
/// Watches the interactive session's lock state through
/// <c>WTSRegisterSessionNotification</c>.
/// </summary>
/// <remarks>
/// <para>
/// The border must disappear the moment the workstation locks and come back on
/// unlock. The WTS notification is delivered to a window owned by this process,
/// so a small hidden top-level window is created on the host's STA thread and
/// its message loop dispatches <c>WM_WTSSESSION_CHANGE</c>.
/// </para>
/// <para>
/// The window procedure only stores the state (lock/unlock); deciding what to
/// hide, suppress or retile is <see cref="BorderController"/>'s job on the host
/// tick. No policy runs in the callback.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
internal sealed class SessionLockWatcher : IDisposable
{
    private const string ClassName = "Adrt.SessionWatcher";

    private static readonly OverlayNativeMethods.WndProcDelegate WindowProcedure = OnMessage;
    private static readonly nint WindowProcedurePointer =
        Marshal.GetFunctionPointerForDelegate(WindowProcedure);

    private readonly GCHandle _self;
    private readonly Action<string>? _log;
    private nint _window;
    private int _locked;
    private int _disposed;

    public SessionLockWatcher(Action<string>? log = null)
    {
        _log = log;
        _self = GCHandle.Alloc(this);

        bool initialized = false;
        try
        {
            WindowClassRegistration.Ensure(ClassName, WindowProcedurePointer);
            _window = OverlayNativeMethods.CreateWindowEx(
                OverlayNativeMethods.WS_EX_TOOLWINDOW | OverlayNativeMethods.WS_EX_NOACTIVATE,
                ClassName,
                "adrt session watcher",
                OverlayNativeMethods.WS_POPUP,
                0,
                0,
                0,
                0,
                0,
                0,
                WindowClassRegistration.ModuleHandle,
                0);

            if (_window == 0)
            {
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "could not create the session watcher window");
            }

            _ = OverlayNativeMethods.SetWindowLongPtr(
                _window,
                OverlayNativeMethods.GWLP_USERDATA,
                GCHandle.ToIntPtr(_self));

            if (!OverlayNativeMethods.WTSRegisterSessionNotification(
                    _window,
                    OverlayNativeMethods.NOTIFY_FOR_THIS_SESSION))
            {
                // Non-fatal: the host still works, but the border relies on the
                // pause key / foreground disappearing while locked.
                _log?.Invoke(FormattableString.Invariant(
                    $"adrt: WTSRegisterSessionNotification failed ({Marshal.GetLastWin32Error()}); the border may stay visible over the lock screen"));
            }

            initialized = true;
        }
        finally
        {
            if (!initialized)
            {
                if (_window != 0)
                {
                    _ = OverlayNativeMethods.DestroyWindow(_window);
                    _window = 0;
                }

                _self.Free();
            }
        }
    }

    /// <summary>True after <c>WTS_SESSION_LOCK</c> until <c>WTS_SESSION_UNLOCK</c>.</summary>
    public bool IsLocked => Volatile.Read(ref _locked) != 0;

    /// <inheritdoc />
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;

        if (_window != 0)
        {
            _ = OverlayNativeMethods.WTSUnRegisterSessionNotification(_window);
            _ = OverlayNativeMethods.DestroyWindow(_window);
            _window = 0;
        }

        if (_self.IsAllocated) _self.Free();
        GC.SuppressFinalize(this);
    }

    private static nint OnMessage(nint hWnd, uint msg, nint wParam, nint lParam)
    {
        if (msg == OverlayNativeMethods.WM_WTSSESSION_CHANGE)
        {
            nint data = OverlayNativeMethods.GetWindowLongPtr(hWnd, OverlayNativeMethods.GWLP_USERDATA);
            if (data != 0 && GCHandle.FromIntPtr(data).Target is SessionLockWatcher watcher)
            {
                if (wParam == OverlayNativeMethods.WTS_SESSION_LOCK)
                {
                    Volatile.Write(ref watcher._locked, 1);
                }
                else if (wParam == OverlayNativeMethods.WTS_SESSION_UNLOCK)
                {
                    Volatile.Write(ref watcher._locked, 0);
                }
            }
        }

        return OverlayNativeMethods.DefWindowProc(hWnd, msg, wParam, lParam);
    }
}
