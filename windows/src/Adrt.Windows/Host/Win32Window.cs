using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// Invisible frame margins around a window's visible (DWM extended frame) bounds,
/// in physical pixels. <see cref="Left"/> is positive when the frame starts
/// <em>inside</em> the window rectangle, as it does on Windows 10/11.
/// </summary>
/// <param name="Left">Left margin: <c>frame.Left - window.Left</c>.</param>
/// <param name="Top">Top margin: <c>frame.Top - window.Top</c>.</param>
/// <param name="Right">Right margin: <c>window.Right - frame.Right</c>.</param>
/// <param name="Bottom">Bottom margin: <c>window.Bottom - frame.Bottom</c>.</param>
public readonly record struct FrameMargins(int Left, int Top, int Right, int Bottom);

/// <summary>
/// Typed handle to one Win32 top-level window. Every read is a live Win32/DWM
/// query; the struct itself is a thin, allocation-free identity wrapper.
/// </summary>
/// <remarks>
/// Rectangles are physical pixels and use <see cref="Adrt.Core.Rect"/> so they can
/// flow directly into the pure core. A window can disappear between two reads
/// (destroy/reap races), so callers must treat failed reads as "window gone"
/// rather than as an error.
/// </remarks>
[SupportedOSPlatform("windows")]
public readonly record struct Win32Window(nint Handle)
{
    /// <summary>The window that currently has keyboard focus, or a zero handle.</summary>
    public static Win32Window Foreground => new(NativeMethods.GetForegroundWindow());

    /// <summary>True when the handle still refers to a live window.</summary>
    public bool IsValid => Handle != 0 && NativeMethods.IsWindow(Handle);

    /// <summary>Owning process id, or 0 when the window is gone or access is denied.</summary>
    public uint ProcessId
    {
        get
        {
            if (Handle == 0) return 0;
            uint threadId = NativeMethods.GetWindowThreadProcessId(Handle, out uint processId);
            return threadId == 0 ? 0 : processId;
        }
    }

    /// <summary>Full image path of the owning process, or an empty string when it cannot be queried.</summary>
    public string ProcessImagePath
    {
        get
        {
            uint processId = ProcessId;
            if (processId == 0) return "";

            nint process = NativeMethods.OpenProcess(NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
            if (process == 0) return "";
            try
            {
                var buffer = new char[1024];
                uint length = (uint)buffer.Length;
                return NativeMethods.QueryFullProcessImageName(process, 0, buffer, ref length)
                    ? new string(buffer, 0, (int)length)
                    : "";
            }
            finally
            {
                NativeMethods.CloseHandle(process);
            }
        }
    }

    /// <summary>File name of the owning process image (e.g. <c>notepad.exe</c>).</summary>
    public string ExecutableName
    {
        get
        {
            string path = ProcessImagePath;
            if (path.Length == 0) return "";
            int separator = path.LastIndexOf('\\');
            return separator >= 0 ? path[(separator + 1)..] : path;
        }
    }

    /// <summary>Win32 window class name, or an empty string when it cannot be read.</summary>
    public string ClassName
    {
        get
        {
            if (Handle == 0) return "";
            var buffer = new char[256];
            int length = NativeMethods.GetClassName(Handle, buffer, buffer.Length);
            return length > 0 ? new string(buffer, 0, length) : "";
        }
    }

    /// <summary>Window caption, or an empty string when it cannot be read.</summary>
    public string Title
    {
        get
        {
            if (Handle == 0) return "";
            var buffer = new char[1024];
            int length = NativeMethods.GetWindowText(Handle, buffer, buffer.Length);
            return length > 0 ? new string(buffer, 0, length) : "";
        }
    }

    /// <summary>Window style bits (<c>WS_*</c>).</summary>
    public long Style => Handle == 0 ? 0 : (long)NativeMethods.GetWindowLongPtr(Handle, NativeMethods.GWL_STYLE);

    /// <summary>Extended window style bits (<c>WS_EX_*</c>).</summary>
    public long ExtendedStyle => Handle == 0 ? 0 : (long)NativeMethods.GetWindowLongPtr(Handle, NativeMethods.GWL_EXSTYLE);

    /// <summary>True when the window is mapped.</summary>
    public bool IsVisible => Handle != 0 && NativeMethods.IsWindowVisible(Handle);

    /// <summary>True when the window is minimized.</summary>
    public bool IsMinimized => Handle != 0 && NativeMethods.IsIconic(Handle);

    /// <summary>True when the extended styles carry <c>WS_EX_TOPMOST</c>.</summary>
    public bool IsTopmost => (ExtendedStyle & NativeMethods.WS_EX_TOPMOST) != 0;

    /// <summary>True when the extended styles carry <c>WS_EX_TOOLWINDOW</c>.</summary>
    public bool IsToolWindow => (ExtendedStyle & NativeMethods.WS_EX_TOOLWINDOW) != 0;

    /// <summary>True when the extended styles carry <c>WS_EX_NOACTIVATE</c>.</summary>
    public bool IsNoActivate => (ExtendedStyle & NativeMethods.WS_EX_NOACTIVATE) != 0;

    /// <summary>True when the style carries <c>WS_POPUP</c>.</summary>
    public bool IsPopup => (Style & NativeMethods.WS_POPUP) != 0;

    /// <summary>Owner window (dialogs/tool windows), or a zero handle.</summary>
    public Win32Window Owner => new(NativeMethods.GetWindow(Handle, NativeMethods.GW_OWNER));

    /// <summary>True when the window is a top-level window rather than a child control.</summary>
    public bool IsTopLevel =>
        Handle != 0 && NativeMethods.GetAncestor(Handle, NativeMethods.GA_ROOT) == Handle;

    /// <summary>Root window of this handle (itself for top-level windows).</summary>
    public Win32Window Root => new(NativeMethods.GetAncestor(Handle, NativeMethods.GA_ROOT));

    /// <summary>HMONITOR hosting the window (nearest monitor), or 0 for an invalid handle.</summary>
    public nint MonitorHandle =>
        Handle == 0 ? 0 : NativeMethods.MonitorFromWindow(Handle, NativeMethods.MONITOR_DEFAULTTONEAREST);

    /// <summary>
    /// The window rectangle as reported by <c>GetWindowRect</c> (includes the
    /// invisible resize border), in physical pixels.
    /// </summary>
    public Rect WindowRect =>
        Handle != 0 && NativeMethods.GetWindowRect(Handle, out NativeMethods.RECT rect)
            ? NativeMethods.ToRect(rect)
            : default;

    /// <summary>
    /// Visible bounds from <c>DWMWA_EXTENDED_FRAME_BOUNDS</c>, falling back to
    /// <see cref="WindowRect"/> for windows DWM cannot describe. This is the
    /// rectangle the tiler places, in physical pixels.
    /// </summary>
    public Rect FrameBounds
    {
        get
        {
            if (Handle == 0) return default;
            int hr = NativeMethods.DwmGetWindowAttributeRect(
                Handle,
                NativeMethods.DWMWA_EXTENDED_FRAME_BOUNDS,
                out NativeMethods.RECT frame,
                Marshal.SizeOf<NativeMethods.RECT>());
            return hr >= 0 ? NativeMethods.ToRect(frame) : WindowRect;
        }
    }

    /// <summary>Invisible DWM frame margins between <see cref="WindowRect"/> and <see cref="FrameBounds"/>.</summary>
    public FrameMargins FrameMargins
    {
        get
        {
            Rect window = WindowRect;
            Rect frame = FrameBounds;
            return new FrameMargins(
                (int)Math.Round(frame.X - window.X),
                (int)Math.Round(frame.Y - window.Y),
                (int)Math.Round(window.Right - frame.Right),
                (int)Math.Round(window.Bottom - frame.Bottom));
        }
    }

    /// <summary>True when DWM reports the window as cloaked (other virtual desktop, UWP suspension).</summary>
    public bool IsCloaked
    {
        get
        {
            if (Handle == 0) return false;
            int hr = NativeMethods.DwmGetWindowAttributeInt(
                Handle,
                NativeMethods.DWMWA_CLOAKED,
                out int cloaked,
                sizeof(int));
            return hr >= 0 && cloaked != 0;
        }
    }

    /// <summary>Effective DPI of the monitor hosting the window; 96 when unavailable.</summary>
    public int Dpi
    {
        get
        {
            if (Handle == 0) return 96;
            uint dpi = NativeMethods.GetDpiForWindow(Handle);
            return dpi == 0 ? 96 : (int)dpi;
        }
    }

    /// <summary>Window DPI as a scale factor (1.0 at 96 DPI).</summary>
    public double Scale => Dpi / 96.0;

    /// <summary>Move/resize the window with <c>SetWindowPos</c> and no activation or z-order change.</summary>
    public bool MoveTo(Rect windowRect) =>
        Handle != 0 && NativeMethods.SetWindowPos(
            Handle,
            0,
            (int)Math.Round(windowRect.X),
            (int)Math.Round(windowRect.Y),
            (int)Math.Round(windowRect.Width),
            (int)Math.Round(windowRect.Height),
            NativeMethods.SWP_NOACTIVATE | NativeMethods.SWP_NOZORDER | NativeMethods.SWP_NOSENDCHANGING);

    /// <summary>Restore/minimize/maximize the window without moving focus (see <c>SW_*</c>).</summary>
    public bool Show(int command) => Handle != 0 && NativeMethods.ShowWindow(Handle, command);

    /// <inheritdoc />
    public override string ToString() =>
        Handle == 0 ? "Win32Window(none)" : $"Win32Window(0x{Handle:X})";
}
