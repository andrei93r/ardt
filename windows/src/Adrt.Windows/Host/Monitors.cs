using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// One monitor as seen by the platform layer. All rectangles are physical pixels;
/// <see cref="Bounds"/> is the full display rectangle and <see cref="WorkArea"/>
/// excludes the taskbar and other appbars.
/// </summary>
public sealed record MonitorInfo
{
    /// <summary>HMONITOR identity (not stable across display topology changes).</summary>
    public required nint Handle { get; init; }

    /// <summary>Stable index after ordering monitors left-to-right, top-to-bottom.</summary>
    public required int Index { get; init; }

    /// <summary>Monitor device name (e.g. <c>\\.\DISPLAY1</c>).</summary>
    public required string DeviceName { get; init; }

    /// <summary>Full display rectangle in physical pixels.</summary>
    public required Rect Bounds { get; init; }

    /// <summary>Usable rectangle (taskbar/appbars removed) in physical pixels.</summary>
    public required Rect WorkArea { get; init; }

    /// <summary>Effective DPI (96 = 100%).</summary>
    public required int Dpi { get; init; }

    /// <summary>True for the primary monitor.</summary>
    public required bool IsPrimary { get; init; }

    /// <summary>Effective scale factor (1.0 at 96 DPI).</summary>
    public double Scale => Dpi / 96.0;
}

/// <summary>
/// Enumerates monitors, work areas and per-monitor DPI.
/// </summary>
/// <remarks>
/// Reads are live; there is no cached topology. Callers that need change
/// detection should compare successive <see cref="Enumerate"/> results (the host
/// does this on a slow tick because <c>WM_DISPLAYCHANGE</c> requires a message
/// window).
/// </remarks>
[SupportedOSPlatform("windows")]
public static class Monitors
{
    private static readonly NativeMethods.MonitorEnumProc MonitorProc = OnMonitor;
    private static readonly nint MonitorProcPointer = Marshal.GetFunctionPointerForDelegate(MonitorProc);

    /// <summary>Enumerate all monitors, ordered and indexed by position.</summary>
    public static IReadOnlyList<MonitorInfo> Enumerate()
    {
        var found = new List<MonitorInfo>(4);
        GCHandle context = GCHandle.Alloc(found);
        try
        {
            if (!NativeMethods.EnumDisplayMonitors(0, 0, MonitorProcPointer, GCHandle.ToIntPtr(context)))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "EnumDisplayMonitors failed");
            }
        }
        finally
        {
            context.Free();
        }

        var ordered = found
            .OrderBy(monitor => monitor.Bounds.X)
            .ThenBy(monitor => monitor.Bounds.Y)
            .ToList();

        for (int index = 0; index < ordered.Count; index++)
        {
            MonitorInfo monitor = ordered[index];
            ordered[index] = monitor with
            {
                Index = index,
                DeviceName = monitor.DeviceName.Length > 0
                    ? monitor.DeviceName
                    : $@"\\.\DISPLAY{index + 1}",
            };
        }

        return ordered;
    }

    private static bool OnMonitor(nint hMonitor, nint hdcMonitor, nint lprcMonitor, nint dwData)
    {
        if (GCHandle.FromIntPtr(dwData).Target is not List<MonitorInfo> monitors) return false;

        var info = new NativeMethods.MONITORINFOEX
        {
            cbSize = (uint)Marshal.SizeOf<NativeMethods.MONITORINFOEX>(),
            szDevice = new char[32],
        };

        if (!NativeMethods.GetMonitorInfo(hMonitor, ref info)) return true;

        monitors.Add(new MonitorInfo
        {
            Handle = hMonitor,
            Index = 0,
            DeviceName = new string(info.szDevice).TrimEnd('\0'),
            Bounds = NativeMethods.ToRect(info.rcMonitor),
            WorkArea = NativeMethods.ToRect(info.rcWork),
            Dpi = ReadDpi(hMonitor),
            IsPrimary = (info.dwFlags & NativeMethods.MONITORINFOF_PRIMARY) != 0,
        });

        return true;
    }

    private static int ReadDpi(nint hMonitor)
    {
        int hr = NativeMethods.GetDpiForMonitor(hMonitor, NativeMethods.MDT_EFFECTIVE_DPI, out uint dpiX, out _);
        return hr >= 0 && dpiX > 0 ? (int)dpiX : 96;
    }
}
