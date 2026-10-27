using System.ComponentModel;
using System.Runtime.Versioning;
using Adrt.Windows.Input;

namespace Adrt.Windows;

/// <summary>
/// Tray-less W5 host: starts the WinEvent pump, tiles two windows per monitor
/// through <see cref="TilingHost"/>, and owns the W5 input + chrome layer.
/// </summary>
/// <remarks>
/// <para>
/// The main thread is STA and runs a plain Win32 message loop, so
/// <c>RegisterHotKey</c> deliveries, the layered border windows and the WTS
/// session watcher all share one thread and one queue. There is no window,
/// tray or settings UI yet; every applied plan and every action is logged to
/// the console.
/// </para>
/// <para>
/// Hotkeys are <see cref="HotkeyTable.Default"/>, registered by
/// <see cref="HotkeyRegistrar"/>: conflicts are logged and skipped. The border
/// is on unless <c>--no-border</c> / <c>ADRT_BORDER=0</c> is given;
/// <c>Ctrl+Alt+B</c> toggles it at runtime.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
internal static class Program
{
    private const string MutexName = @"Local\Adrt.Windows.SingleInstance";
    private const uint TickIntervalMs = 40;

    private static readonly ManualResetEvent QuitEvent = new(false);

    [STAThread]
    private static int Main(string[] args)
    {
        InputOptions options = InputOptions.Parse(args);

        using var mutex = new Mutex(initiallyOwned: true, MutexName, out bool createdNew);
        if (!createdNew)
        {
            Console.Error.WriteLine("adrt: another instance is already running.");
            return 1;
        }

        try
        {
            Run(options);
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

    private static void Run(InputOptions options)
    {
        using var pump = new WindowEventPump();
        pump.Start();
        Console.WriteLine("adrt: win-event pump started.");

        var host = new TilingHost(pump, Console.WriteLine);
        host.Start();

        using var hotkeys = new HotkeyManager();
        using var input = new InputLayer(host, options, RequestQuit, Console.WriteLine);
        Console.WriteLine($"adrt: {options.Describe()}");
        IReadOnlyList<HotkeyRegistrationResult> registrations = input.RegisterHotkeys(hotkeys);
        int accepted = registrations.Count(result => result.Registration.Registered);
        Console.WriteLine(FormattableString.Invariant(
            $"adrt: {accepted}/{registrations.Count} default hotkeys active."));

        ConsoleCancelEventHandler onCancel = (_, cancelArgs) =>
        {
            cancelArgs.Cancel = true;
            RequestQuit();
        };

        Console.CancelKeyPress += onCancel;
        Console.WriteLine("adrt: tiling two windows per monitor; Ctrl+C also quits.");

        try
        {
            MessageLoop(host, pump, input);
        }
        finally
        {
            Console.CancelKeyPress -= onCancel;
            hotkeys.UnregisterAll();
            pump.Stop();
            Console.WriteLine("adrt: stopped.");
        }
    }

    private static void MessageLoop(TilingHost host, WindowEventPump pump, InputLayer input)
    {
        // Wait on the pump's own coalescing signal (it is poked on every window
        // event and every 50 ms) plus the quit handle, with a 40 ms safety
        // timeout. Do not use SetTimer/WM_TIMER: a thread timer is not reliably
        // delivered to a console message loop, which silently disabled tiling.
        nint[] handles =
        [
            pump.Signaled.SafeWaitHandle.DangerousGetHandle(),
            QuitEvent.SafeWaitHandle.DangerousGetHandle(),
        ];

        while (true)
        {
            uint result = NativeMethods.MsgWaitForMultipleObjectsEx(
                (uint)handles.Length, handles, TickIntervalMs, NativeMethods.QS_ALLINPUT, 0);

            if (result == 1) return; // quit handle
            if (result == 0 || result == NativeMethods.WAIT_TIMEOUT) host.Tick();

            // Session lock, drag state and the border are polled on every wake,
            // including a hotkey wake; none of them plans, so this stays off the
            // drain's critical path.
            input.Tick();

            while (NativeMethods.PeekMessage(out NativeMethods.MSG message, 0, 0, 0, NativeMethods.PM_REMOVE))
            {
                if (message.message == NativeMethods.WM_QUIT) return;

                if (message.message == NativeMethods.WM_HOTKEY)
                {
                    _ = input.HandleHotkey(message.wParam.ToInt32());
                    continue;
                }

                NativeMethods.TranslateMessage(ref message);
                NativeMethods.DispatchMessage(ref message);
            }
        }
    }

    private static void RequestQuit() => QuitEvent.Set();
}
