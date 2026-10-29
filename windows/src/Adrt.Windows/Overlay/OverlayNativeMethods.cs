using System.Runtime.InteropServices;
using System.Runtime.Versioning;

// The project does not enable AllowUnsafeBlocks; runtime-marshalled DllImport is
// the correct choice (same rationale as Host/NativeMethods.cs).
#pragma warning disable SYSLIB1054 // Use LibraryImport instead of DllImport.

namespace Adrt.Windows.Overlay;

/// <summary>
/// Win32/GDI declarations for the layered border overlay and the session-lock
/// watcher. Self-contained so the chrome lane owns its whole native surface.
/// </summary>
[SupportedOSPlatform("windows")]
internal static class OverlayNativeMethods
{
    internal const string User32 = "user32.dll";
    internal const string Gdi32 = "gdi32.dll";
    internal const string WtsApi32 = "wtsapi32.dll";

    internal const int WS_POPUP = unchecked((int)0x80000000);

    internal const int WS_EX_TOPMOST = 0x00000008;
    internal const int WS_EX_TRANSPARENT = 0x00000020;
    internal const int WS_EX_TOOLWINDOW = 0x00000080;
    internal const int WS_EX_LAYERED = 0x00080000;
    internal const int WS_EX_NOACTIVATE = 0x08000000;

    internal const uint SWP_NOSIZE = 0x0001;
    internal const uint SWP_NOMOVE = 0x0002;
    internal const uint SWP_NOZORDER = 0x0004;
    internal const uint SWP_NOACTIVATE = 0x0010;
    internal const uint SWP_SHOWWINDOW = 0x0040;
    internal const uint SWP_HIDEWINDOW = 0x0080;

    internal const int SW_HIDE = 0;
    internal const int SW_SHOWNOACTIVATE = 4;

    internal const uint WM_NCHITTEST = 0x0084;
    internal const uint WM_MOUSEACTIVATE = 0x0021;
    internal const uint WM_ERASEBKGND = 0x0014;
    internal const uint WM_PAINT = 0x000F;
    internal const uint WM_WTSSESSION_CHANGE = 0x02B1;

    internal const int HTTRANSPARENT = -1;
    internal const int MA_NOACTIVATE = 3;

    internal const int GWLP_USERDATA = -21;

    internal const int WTS_SESSION_LOCK = 0x7;
    internal const int WTS_SESSION_UNLOCK = 0x8;
    internal const uint NOTIFY_FOR_THIS_SESSION = 0;

    internal const uint ULW_ALPHA = 0x00000002;
    internal const byte AC_SRC_OVER = 0x00;
    internal const byte AC_SRC_ALPHA = 0x01;
    internal const uint BI_RGB = 0;
    internal const uint DIB_RGB_COLORS = 0;

    internal const int ERROR_CLASS_ALREADY_EXISTS = 1410;

    internal static readonly nint HwndTopMost = -1;

    [StructLayout(LayoutKind.Sequential)]
    internal struct POINT
    {
        public int X;
        public int Y;

        public POINT(int x, int y)
        {
            X = x;
            Y = y;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct SIZE
    {
        public int CX;
        public int CY;

        public SIZE(int cx, int cy)
        {
            CX = cx;
            CY = cy;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct BLENDFUNCTION
    {
        public byte BlendOp;
        public byte BlendFlags;
        public byte SourceConstantAlpha;
        public byte AlphaFormat;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct BITMAPINFOHEADER
    {
        public uint biSize;
        public int biWidth;
        public int biHeight;
        public ushort biPlanes;
        public ushort biBitCount;
        public uint biCompression;
        public uint biSizeImage;
        public int biXPelsPerMeter;
        public int biYPelsPerMeter;
        public uint biClrUsed;
        public uint biClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct BITMAPINFO
    {
        public BITMAPINFOHEADER bmiHeader;
        public uint bmiColors;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct WNDCLASSEX
    {
        public uint cbSize;
        public uint style;
        public nint lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public nint hInstance;
        public nint hIcon;
        public nint hCursor;
        public nint hbrBackground;
        public string? lpszMenuName;
        public string lpszClassName;
        public nint hIconSm;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    internal delegate nint WndProcDelegate(nint hWnd, uint msg, nint wParam, nint lParam);

    [DllImport(User32, EntryPoint = "RegisterClassExW", SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern ushort RegisterClassEx(ref WNDCLASSEX windowClass);

    [DllImport(User32, EntryPoint = "UnregisterClassW", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UnregisterClass(string className, nint instance);

    [DllImport(User32, EntryPoint = "CreateWindowExW", SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern nint CreateWindowEx(
        int exStyle,
        string className,
        string windowName,
        int style,
        int x,
        int y,
        int width,
        int height,
        nint parent,
        nint menu,
        nint instance,
        nint param);

    [DllImport(User32, EntryPoint = "DestroyWindow", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DestroyWindow(nint hWnd);

    [DllImport(User32, EntryPoint = "DefWindowProcW", SetLastError = true)]
    internal static extern nint DefWindowProc(nint hWnd, uint msg, nint wParam, nint lParam);

    [DllImport(User32, EntryPoint = "ShowWindow", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ShowWindow(nint hWnd, int command);

    [DllImport(User32, EntryPoint = "SetWindowPos", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowPos(
        nint hWnd,
        nint insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);

    [DllImport(User32, EntryPoint = "UpdateLayeredWindow", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UpdateLayeredWindow(
        nint hWnd,
        nint dstDc,
        ref POINT dstPoint,
        ref SIZE size,
        nint srcDc,
        ref POINT srcPoint,
        uint colorKey,
        ref BLENDFUNCTION blend,
        uint flags);

    [DllImport(User32, EntryPoint = "GetDC", SetLastError = true)]
    internal static extern nint GetDC(nint hWnd);

    [DllImport(User32, EntryPoint = "ReleaseDC", SetLastError = true)]
    internal static extern int ReleaseDC(nint hWnd, nint hDc);

    [DllImport(User32, EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    internal static extern nint GetWindowLongPtr(nint hWnd, int index);

    [DllImport(User32, EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    internal static extern nint SetWindowLongPtr(nint hWnd, int index, nint newValue);

    [DllImport(User32, EntryPoint = "ValidateRect", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ValidateRect(nint hWnd, nint rect);

    [DllImport("kernel32.dll", EntryPoint = "GetModuleHandleW", SetLastError = true, CharSet = CharSet.Unicode)]
    internal static extern nint GetModuleHandle(string? moduleName);

    [DllImport(Gdi32, EntryPoint = "CreateCompatibleDC", SetLastError = true)]
    internal static extern nint CreateCompatibleDC(nint hDc);

    [DllImport(Gdi32, EntryPoint = "DeleteDC", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DeleteDC(nint hDc);

    [DllImport(Gdi32, EntryPoint = "CreateDIBSection", SetLastError = true)]
    internal static extern nint CreateDIBSection(
        nint hDc,
        ref BITMAPINFO bitmapInfo,
        uint usage,
        out nint bits,
        nint section,
        uint offset);

    [DllImport(Gdi32, EntryPoint = "SelectObject", SetLastError = true)]
    internal static extern nint SelectObject(nint hDc, nint gdiObject);

    [DllImport(Gdi32, EntryPoint = "DeleteObject", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DeleteObject(nint gdiObject);

    [DllImport(WtsApi32, EntryPoint = "WTSRegisterSessionNotification", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool WTSRegisterSessionNotification(nint hWnd, uint flags);

    [DllImport(WtsApi32, EntryPoint = "WTSUnRegisterSessionNotification", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool WTSUnRegisterSessionNotification(nint hWnd);
}
