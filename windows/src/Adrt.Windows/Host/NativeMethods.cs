using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Adrt.Core;

// This project does not enable AllowUnsafeBlocks, and source-generated
// LibraryImport interop always requires it (SYSLIB1062). Runtime-marshalled
// DllImport is therefore the correct choice here; the analyzer suggestion is
// suppressed rather than failing the build.
#pragma warning disable SYSLIB1054 // Use LibraryImport instead of DllImport.

namespace Adrt.Windows;

/// <summary>
/// Raw Win32/DWM declarations and constants used by the Windows platform layer.
/// </summary>
/// <remarks>
/// Declarations are <see langword="internal"/> on purpose: the public surface is the
/// typed host API (<see cref="Win32Window"/>, <see cref="Monitors"/>,
/// <see cref="GeometryApplier"/>, ...), never raw P/Invoke.
/// All coordinates crossing this boundary are physical pixels (PerMonitorV2).
/// </remarks>
[SupportedOSPlatform("windows")]
internal static class NativeMethods
{
    internal const string User32 = "user32.dll";
    internal const string Kernel32 = "kernel32.dll";
    internal const string DwmApi = "dwmapi.dll";
    internal const string ShCore = "shcore.dll";

    // GetWindowLongPtr / GetWindow / GetAncestor.
    internal const int GWL_STYLE = -16;
    internal const int GWL_EXSTYLE = -20;
    internal const uint GW_OWNER = 4;
    internal const uint GA_ROOT = 2;

    // Window styles.
    internal const int WS_POPUP = unchecked((int)0x80000000);
    internal const int WS_MAXIMIZE = 0x01000000;
    internal const int WS_EX_TOPMOST = 0x00000008;
    internal const int WS_EX_TOOLWINDOW = 0x00000080;
    internal const int WS_EX_APPWINDOW = 0x00040000;
    internal const int WS_EX_NOACTIVATE = 0x08000000;

    // SetWindowPos.
    internal const uint SWP_NOSIZE = 0x0001;
    internal const uint SWP_NOMOVE = 0x0002;
    internal const uint SWP_NOZORDER = 0x0004;
    internal const uint SWP_NOACTIVATE = 0x0010;
    internal const uint SWP_FRAMECHANGED = 0x0020;
    internal const uint SWP_SHOWWINDOW = 0x0040;
    internal const uint SWP_NOSENDCHANGING = 0x0400;

    // ShowWindow.
    internal const int SW_MAXIMIZE = 3;
    internal const int SW_MINIMIZE = 6;
    internal const int SW_RESTORE = 9;
    internal const int SW_SHOWNOACTIVATE = 4;

    // DWM window attributes.
    internal const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    internal const int DWMWA_CLOAKED = 14;

    // SetWinEventHook.
    internal const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    internal const uint EVENT_SYSTEM_MOVESIZESTART = 0x000A;
    internal const uint EVENT_SYSTEM_MOVESIZEEND = 0x000B;
    internal const uint EVENT_SYSTEM_MINIMIZESTART = 0x0016;
    internal const uint EVENT_SYSTEM_MINIMIZEEND = 0x0017;
    internal const uint EVENT_OBJECT_CREATE = 0x8000;
    internal const uint EVENT_OBJECT_DESTROY = 0x8001;
    internal const uint EVENT_OBJECT_SHOW = 0x8002;
    internal const uint EVENT_OBJECT_HIDE = 0x8003;
    internal const uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B;
    internal const uint EVENT_OBJECT_CLOAKED = 0x8017;
    internal const uint EVENT_OBJECT_UNCLOAKED = 0x8018;
    internal const uint EVENT_MIN = 0x00000001;
    internal const uint EVENT_MAX = 0x7FFFFFFF;
    internal const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    internal const uint WINEVENT_SKIPOWNPROCESS = 0x0002;
    internal const int OBJID_WINDOW = 0;

    // Window messages.
    internal const uint WM_QUIT = 0x0012;
    internal const uint WM_DISPLAYCHANGE = 0x007E;
    internal const uint WM_TIMER = 0x0113;
    internal const uint WM_HOTKEY = 0x0312;

    // RegisterHotKey.
    internal const uint MOD_ALT = 0x0001;
    internal const uint MOD_CONTROL = 0x0002;
    internal const uint MOD_SHIFT = 0x0004;
    internal const uint MOD_WIN = 0x0008;
    internal const uint MOD_NOREPEAT = 0x4000;

    // Win32 error codes we report by name.
    internal const int ERROR_ACCESS_DENIED = 5;
    internal const int ERROR_INVALID_PARAMETER = 87;
    internal const int ERROR_HOTKEY_ALREADY_REGISTERED = 1409;

    // Monitor enumeration and DPI.
    internal const uint MONITORINFOF_PRIMARY = 0x0001;
    internal const uint MONITOR_DEFAULTTONEAREST = 0x0002;
    internal const int MDT_EFFECTIVE_DPI = 0;
    internal const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    // ---------------------------------------------------------------------
    // Structs. Field names mirror the Win32 headers; they are internal and
    // only touched by the wrappers in this directory.
    // ---------------------------------------------------------------------

    [StructLayout(LayoutKind.Sequential)]
    internal struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;

        public readonly int Width => Right - Left;
        public readonly int Height => Bottom - Top;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct MSG
    {
        public nint hwnd;
        public uint message;
        public nint wParam;
        public nint lParam;
        public uint time;
        public POINT pt;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct MONITORINFOEX
    {
        public uint cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;

        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
        public char[] szDevice;
    }

    // ---------------------------------------------------------------------
    // Callbacks. The function pointer is obtained with
    // Marshal.GetFunctionPointerForDelegate and the delegate is kept alive by
    // the caller.
    // ---------------------------------------------------------------------

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    internal delegate void WinEventProc(
        nint hWinEventHook,
        uint eventCode,
        nint hwnd,
        int idObject,
        int idChild,
        uint idEventThread,
        uint dwmsEventTime);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal delegate bool MonitorEnumProc(
        nint hMonitor,
        nint hdcMonitor,
        nint lprcMonitor,
        nint dwData);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal delegate bool EnumWindowsProc(nint hWnd, nint lParam);

    // ---------------------------------------------------------------------
    // user32.dll — messages, hooks, windows.
    // ---------------------------------------------------------------------

    [DllImport(User32, EntryPoint = "SetWinEventHook", SetLastError = true)]
    internal static extern nint SetWinEventHook(
        uint eventMin,
        uint eventMax,
        nint hmodWinEventProc,
        nint pfnWinEventProc,
        uint idProcess,
        uint idThread,
        uint dwFlags);

    [DllImport(User32, EntryPoint = "UnhookWinEvent", SetLastError = true)]
    internal static extern bool UnhookWinEvent(nint hWinEventHook);

    [DllImport(User32, EntryPoint = "GetWindowThreadProcessId", SetLastError = true)]
    internal static extern uint GetWindowThreadProcessId(nint hWnd, out uint lpdwProcessId);

    [DllImport(User32, EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    internal static extern nint GetWindowLongPtr(nint hWnd, int nIndex);

    [DllImport(User32, EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    internal static extern nint SetWindowLongPtr(nint hWnd, int nIndex, nint dwNewLong);

    [DllImport(User32, EntryPoint = "IsWindow", SetLastError = true)]
    internal static extern bool IsWindow(nint hWnd);

    [DllImport(User32, EntryPoint = "IsWindowVisible", SetLastError = true)]
    internal static extern bool IsWindowVisible(nint hWnd);

    [DllImport(User32, EntryPoint = "IsIconic", SetLastError = true)]
    internal static extern bool IsIconic(nint hWnd);

    [DllImport(User32, EntryPoint = "GetWindow", SetLastError = true)]
    internal static extern nint GetWindow(nint hWnd, uint uCmd);

    [DllImport(User32, EntryPoint = "GetAncestor", SetLastError = true)]
    internal static extern nint GetAncestor(nint hWnd, uint gaFlags);

    [DllImport(User32, EntryPoint = "GetForegroundWindow", SetLastError = true)]
    internal static extern nint GetForegroundWindow();

    [DllImport(User32, EntryPoint = "SetForegroundWindow", SetLastError = true)]
    internal static extern bool SetForegroundWindow(nint hWnd);

    [DllImport(User32, EntryPoint = "SetWindowPos", SetLastError = true)]
    internal static extern bool SetWindowPos(
        nint hWnd,
        nint hWndInsertAfter,
        int x,
        int y,
        int cx,
        int cy,
        uint uFlags);

    [DllImport(User32, EntryPoint = "BeginDeferWindowPos", SetLastError = true)]
    internal static extern nint BeginDeferWindowPos(int nNumWindows);

    [DllImport(User32, EntryPoint = "DeferWindowPos", SetLastError = true)]
    internal static extern nint DeferWindowPos(
        nint hWinPosInfo,
        nint hWnd,
        nint hWndInsertAfter,
        int x,
        int y,
        int cx,
        int cy,
        uint uFlags);

    [DllImport(User32, EntryPoint = "EndDeferWindowPos", SetLastError = true)]
    internal static extern bool EndDeferWindowPos(nint hWinPosInfo);

    [DllImport(User32, EntryPoint = "ShowWindow", SetLastError = true)]
    internal static extern bool ShowWindow(nint hWnd, int nCmdShow);

    [DllImport(User32, EntryPoint = "GetWindowRect", SetLastError = true)]
    internal static extern bool GetWindowRect(nint hWnd, out RECT lpRect);

    [DllImport(User32, EntryPoint = "EnumWindows", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool EnumWindows(nint lpEnumFunc, nint lParam);

    [DllImport(User32, EntryPoint = "EnumDisplayMonitors", SetLastError = true)]
    internal static extern bool EnumDisplayMonitors(
        nint hdc,
        nint lprcClip,
        nint lpfnEnum,
        nint dwData);

    [DllImport(User32, EntryPoint = "MonitorFromWindow", SetLastError = true)]
    internal static extern nint MonitorFromWindow(nint hwnd, uint dwFlags);

    [DllImport(User32, EntryPoint = "GetDpiForWindow", SetLastError = true)]
    internal static extern uint GetDpiForWindow(nint hwnd);

    [DllImport(User32, EntryPoint = "RegisterHotKey", SetLastError = true)]
    internal static extern bool RegisterHotKey(nint hWnd, int id, uint fsModifiers, uint vk);

    [DllImport(User32, EntryPoint = "UnregisterHotKey", SetLastError = true)]
    internal static extern bool UnregisterHotKey(nint hWnd, int id);

    internal const uint QS_ALLINPUT = 0x04FF;
    internal const uint PM_REMOVE = 0x0001;
    internal const uint WAIT_TIMEOUT = 0x00000102;

    [DllImport(User32, EntryPoint = "MsgWaitForMultipleObjectsEx", SetLastError = true)]
    internal static extern uint MsgWaitForMultipleObjectsEx(
        uint nCount, nint[] pHandles, uint dwMilliseconds, uint dwWakeMask, uint dwFlags);

    [DllImport(User32, EntryPoint = "PeekMessageW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool PeekMessage(
        out MSG lpMsg, nint hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

    [DllImport(User32, EntryPoint = "GetMessageW", SetLastError = true)]
    internal static extern int GetMessage(out MSG lpMsg, nint hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport(User32, EntryPoint = "TranslateMessage", SetLastError = true)]
    internal static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport(User32, EntryPoint = "DispatchMessageW", SetLastError = true)]
    internal static extern nint DispatchMessage(ref MSG lpMsg);

    [DllImport(User32, EntryPoint = "PostQuitMessage", SetLastError = true)]
    internal static extern void PostQuitMessage(int nExitCode);

    [DllImport(User32, EntryPoint = "PostThreadMessageW", SetLastError = true)]
    internal static extern bool PostThreadMessage(uint idThread, uint msg, nint wParam, nint lParam);

    [DllImport(User32, EntryPoint = "SetTimer", SetLastError = true)]
    internal static extern nint SetTimer(nint hWnd, nint nIDEvent, uint uElapse, nint lpTimerFunc);

    [DllImport(User32, EntryPoint = "KillTimer", SetLastError = true)]
    internal static extern bool KillTimer(nint hWnd, nint uIDEvent);

    [DllImport(User32, EntryPoint = "GetClassNameW", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern int GetClassName(nint hWnd, [Out] char[] lpClassName, int nMaxCount);

    [DllImport(User32, EntryPoint = "GetWindowTextW", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern int GetWindowText(nint hWnd, [Out] char[] lpString, int nMaxCount);

    [DllImport(User32, EntryPoint = "GetMonitorInfoW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetMonitorInfo(nint hMonitor, ref MONITORINFOEX lpmi);

    internal const nint DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;

    [DllImport(User32, EntryPoint = "SetProcessDpiAwarenessContext", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetProcessDpiAwarenessContext(nint dpiContext);

    // ---------------------------------------------------------------------
    // dwmapi.dll.
    // ---------------------------------------------------------------------

    [DllImport(DwmApi, EntryPoint = "DwmGetWindowAttribute", SetLastError = true)]
    internal static extern int DwmGetWindowAttributeRect(
        nint hwnd,
        int dwAttribute,
        out RECT pvAttribute,
        int cbAttribute);

    [DllImport(DwmApi, EntryPoint = "DwmGetWindowAttribute", SetLastError = true)]
    internal static extern int DwmGetWindowAttributeInt(
        nint hwnd,
        int dwAttribute,
        out int pvAttribute,
        int cbAttribute);

    // ---------------------------------------------------------------------
    // shcore.dll — per-monitor DPI (Windows 8.1+).
    // ---------------------------------------------------------------------

    [DllImport(ShCore, EntryPoint = "GetDpiForMonitor", SetLastError = true)]
    internal static extern int GetDpiForMonitor(
        nint hmonitor,
        int dpiType,
        out uint dpiX,
        out uint dpiY);

    // ---------------------------------------------------------------------
    // kernel32.dll.
    // ---------------------------------------------------------------------

    [DllImport(Kernel32, EntryPoint = "GetLastError", SetLastError = false)]
    internal static extern uint GetLastError();

    [DllImport(Kernel32, EntryPoint = "GetCurrentThreadId", SetLastError = false)]
    internal static extern uint GetCurrentThreadId();

    [DllImport(Kernel32, EntryPoint = "OpenProcess", SetLastError = true)]
    internal static extern nint OpenProcess(
        uint dwDesiredAccess,
        [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle,
        uint dwProcessId);

    [DllImport(Kernel32, EntryPoint = "CloseHandle", SetLastError = true)]
    internal static extern bool CloseHandle(nint hObject);

    [DllImport(Kernel32, EntryPoint = "QueryFullProcessImageNameW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool QueryFullProcessImageName(
        nint hProcess,
        uint dwFlags,
        [Out] char[] lpExeName,
        ref uint lpdwSize);

    /// <summary>Convert a Win32 rectangle to the core rectangle (physical pixels).</summary>
    internal static Rect ToRect(in RECT rect) =>
        new(rect.Left, rect.Top, rect.Width, rect.Height);
}
