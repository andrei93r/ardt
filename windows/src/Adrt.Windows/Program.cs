using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// Minimal console host: proves the platform skeleton end to end before the tray
/// shell exists. It starts the event pump and logs monitor/top-level-window
/// changes; it makes no tiling decisions.
/// </summary>
[SupportedOSPlatform("windows")]
internal static class Program
{
    private const string MutexName = @"Local\Adrt.Windows.SingleInstance";
    private const int TopologyPollMilliseconds = 1000;

    private static int Main()
    {
        using var mutex = new Mutex(initiallyOwned: true, MutexName, out bool createdNew);
        if (!createdNew)
        {
            Console.Error.WriteLine("adrt: another instance is already running.");
            return 1;
        }

        try
        {
            Run();
            return 0;
        }
        catch (Win32Exception error)
        {
            Console.Error.WriteLine($"adrt: {error.Message}");
            return 1;
        }
        catch (InvalidOperationException error)
        {
            Console.Error.WriteLine($"adrt: {error.Message}");
            return 1;
        }
        finally
        {
            mutex.ReleaseMutex();
        }
    }

    private static void Run()
    {
        using var pump = new WindowEventPump();
        pump.Start();

        Console.WriteLine("adrt: win-event pump started.");
        IReadOnlyList<MonitorInfo> monitors = Monitors.Enumerate();
        foreach (MonitorInfo monitor in monitors)
        {
            Console.WriteLine(FormatMonitor(monitor));
        }

        Console.WriteLine("adrt: logging top-level window changes; Ctrl+C to exit.");

        using var stop = new ManualResetEventSlim(false);
        ConsoleCancelEventHandler onCancel = (_, args) =>
        {
            args.Cancel = true;
            stop.Set();
        };

        Console.CancelKeyPress += onCancel;
        try
        {
            DrainLoop(pump, stop, monitors);
        }
        finally
        {
            Console.CancelKeyPress -= onCancel;
            pump.Stop();
        }
    }

    private static void DrainLoop(
        WindowEventPump pump,
        ManualResetEventSlim stop,
        IReadOnlyList<MonitorInfo> monitors)
    {
        var waitHandles = new[] { pump.Signaled, stop.WaitHandle };
        var topologyClock = Stopwatch.StartNew();
        int reportedDrops = 0;

        while (WaitHandle.WaitAny(waitHandles, TopologyPollMilliseconds) != 1)
        {
            LogWindowEvents(pump);
            LogDroppedEvents(pump, ref reportedDrops);

            if (topologyClock.ElapsedMilliseconds < TopologyPollMilliseconds) continue;
            topologyClock.Restart();
            monitors = LogTopologyChanges(monitors);
        }

        LogWindowEvents(pump);
    }

    private static void LogWindowEvents(WindowEventPump pump)
    {
        foreach (WindowEvent rawEvent in pump.Drain())
        {
            var window = new Win32Window(rawEvent.Window);
            if (!window.IsValid)
            {
                // Destroy events arrive after the HWND is gone; log identity only.
                Console.WriteLine(Inv($"{Stamp()} {FormatKind(rawEvent.Kind),-14} {Hex(rawEvent.Window)} (gone)"));
                continue;
            }

            if (!window.IsTopLevel) continue;

            string title = window.Title;
            if (title.Length == 0) title = "(untitled)";

            string flags = window.IsMinimized ? "minimized" : window.IsVisible ? "visible" : "hidden";
            if (window.IsCloaked) flags += ",cloaked";
            if (window.Owner.Handle != 0) flags += ",owned";
            if (window.IsTopmost) flags += ",topmost";

            Rect frame = window.FrameBounds;
            Console.WriteLine(Inv(
                $"{Stamp()} {FormatKind(rawEvent.Kind),-14} {Hex(rawEvent.Window)} ",
                $"pid={window.ProcessId} {window.ExecutableName} \"{title}\" ",
                $"{frame.X:0},{frame.Y:0} {frame.Width:0}x{frame.Height:0} [{flags}]"));
        }
    }

    private static void LogDroppedEvents(WindowEventPump pump, ref int reportedDrops)
    {
        int dropped = pump.DroppedCount;
        if (dropped == reportedDrops) return;

        reportedDrops = dropped;
        Console.WriteLine(Inv($"{Stamp()} queue          dropped {dropped} event(s) (queue full)"));
    }

    private static IReadOnlyList<MonitorInfo> LogTopologyChanges(IReadOnlyList<MonitorInfo> previous)
    {
        IReadOnlyList<MonitorInfo> current = Monitors.Enumerate();
        if (SameTopology(previous, current)) return previous;

        Console.WriteLine(Inv($"{Stamp()} display        topology changed ({current.Count} monitor(s))"));
        foreach (MonitorInfo monitor in current)
        {
            Console.WriteLine(FormatMonitor(monitor));
        }

        return current;
    }

    private static bool SameTopology(IReadOnlyList<MonitorInfo> left, IReadOnlyList<MonitorInfo> right)
    {
        if (left.Count != right.Count) return false;

        for (int index = 0; index < left.Count; index++)
        {
            MonitorInfo a = left[index];
            MonitorInfo b = right[index];
            if (a.Handle != b.Handle ||
                a.DeviceName != b.DeviceName ||
                a.Dpi != b.Dpi ||
                a.IsPrimary != b.IsPrimary ||
                a.Bounds != b.Bounds ||
                a.WorkArea != b.WorkArea)
            {
                return false;
            }
        }

        return true;
    }

    private static string FormatMonitor(MonitorInfo monitor) => Inv(
        $"monitor {monitor.Index}: {monitor.DeviceName} ",
        $"{monitor.Bounds.Width:0}x{monitor.Bounds.Height:0} at {monitor.Bounds.X:0},{monitor.Bounds.Y:0} ",
        $"work {monitor.WorkArea.X:0},{monitor.WorkArea.Y:0} ",
        $"{monitor.WorkArea.Width:0}x{monitor.WorkArea.Height:0} ",
        $"scale {monitor.Scale:0.##}{(monitor.IsPrimary ? " primary" : "")}");

    private static string FormatKind(WindowEventKind kind) => kind.ToString().ToLowerInvariant();

    private static string Hex(nint handle) => Inv($"0x{handle.ToInt64():X}");

    private static string Stamp() => DateTime.Now.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture);

    private static string Inv(params FormattableString[] parts) =>
        string.Concat(parts.Select(part => FormattableString.Invariant(part)));
}
