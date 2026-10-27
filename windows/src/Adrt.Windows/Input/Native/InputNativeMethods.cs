using System.Runtime.InteropServices;
using System.Runtime.Versioning;

// The project does not enable AllowUnsafeBlocks; runtime-marshalled DllImport is
// the correct choice (same rationale as Host/NativeMethods.cs).
#pragma warning disable SYSLIB1054 // Use LibraryImport instead of DllImport.

namespace Adrt.Windows.Input;

/// <summary>
/// Raw Win32 calls the input layer needs: foreground activation, pointer warp,
/// close, and the foreground thread's move/size state (drag detection).
/// </summary>
/// <remarks>
/// Kept separate from the host's <c>NativeMethods</c> so the input layer can be
/// reasoned about (and later extracted) on its own. All coordinates are physical
/// pixels (the process is PerMonitorV2).
/// </remarks>
[SupportedOSPlatform("windows")]
internal static class InputNativeMethods
{
    internal const string User32 = "user32.dll";

    internal const int SW_RESTORE = 9;
    internal const int SW_MAXIMIZE = 3;

    internal const uint WM_CLOSE = 0x0010;

    internal const uint GUI_INMOVESIZE = 0x0002;

    [StructLayout(LayoutKind.Sequential)]
    internal struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct GUITHREADINFO
    {
        public uint cbSize;
        public uint flags;
        public nint hwndActive;
        public nint hwndFocus;
        public nint hwndCapture;
        public nint hwndMenuOwner;
        public nint hwndMoveSize;
        public nint hwndCaret;
        public RECT rcCaret;
    }

    [DllImport(User32, EntryPoint = "SetForegroundWindow", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetForegroundWindow(nint hWnd);

    [DllImport(User32, EntryPoint = "SetCursorPos", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetCursorPos(int x, int y);

    [DllImport(User32, EntryPoint = "PostMessageW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool PostMessage(nint hWnd, uint msg, nint wParam, nint lParam);

    [DllImport(User32, EntryPoint = "GetGUIThreadInfo", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);
}
