using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Adrt.Windows;

/// <summary>
/// Tray-less W3 host: starts the WinEvent pump, tiles two windows per monitor
/// through <see cref="TilingHost"/>, and exposes pause/quit hotkeys.
/// </summary>
/// <remarks>
/// The main thread owns a plain Win32 message loop so <c>RegisterHotKey</c> and
/// the drain timer both post to its queue. There is no window, tray or UI yet;
/// every applied plan is logged to the console.
/// </remarks>
[SupportedOSPlatform("windows")]
internal static class Program
{
    private const string MutexName = @"Local\Adrt.Windows.SingleInstance";
    private const uint TickIntervalMs = 40;
    private const int HotkeyPause = 1;
    private const int HotkeyQuit = 2;

    private static readonly nint TickTimerId = 2;

    private static uint _mainThreadId;

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

        var host = new TilingHost(pump, Console.WriteLine);
        host.Start();

        using var hotkeys = new HotkeyManager();
        RegisterHotkey(hotkeys, HotkeyPause, HotkeyModifiers.Control | HotkeyModifiers.Alt, (uint)'P', "Ctrl+Alt+P (pause/resume)");
        RegisterHotkey(hotkeys, HotkeyQuit, HotkeyModifiers.Control | HotkeyModifiers.Alt, (uint)'Q', "Ctrl+Alt+Q (quit)");

        _mainThreadId = NativeMethods.GetCurrentThreadId();
        ConsoleCancelEventHandler onCancel = (_, args) =>
        {
            args.Cancel = true;
            RequestQuit();
        };

        Console.CancelKeyPress += onCancel;
        Console.WriteLine("adrt: tiling two windows per monitor; Ctrl+C also quits.");

        if (NativeMethods.SetTimer(0, TickTimerId, TickIntervalMs, 0) == 0)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SetTimer failed");
        }

        try
        {
            MessageLoop(host);
        }
        finally
        {
            NativeMethods.KillTimer(0, TickTimerId);
            Console.CancelKeyPress -= onCancel;
            hotkeys.UnregisterAll();
            pump.Stop();
            Console.WriteLine("adrt: stopped.");
        }
    }

    private static void MessageLoop(TilingHost host)
    {
        while (true)
        {
            int result = NativeMethods.GetMessage(out NativeMethods.MSG message, 0, 0, 0);
            if (result <= 0) return; // 0 = WM_QUIT, -1 = error.

            if (message.message == NativeMethods.WM_HOTKEY)
            {
                HandleHotkey(host, message.wParam.ToInt32());
                continue;
            }

            if (message.message == NativeMethods.WM_TIMER &&
                message.hwnd == 0 &&
                message.wParam == TickTimerId)
            {
                host.Tick();
                continue;
            }

            NativeMethods.TranslateMessage(ref message);
            NativeMethods.DispatchMessage(ref message);
        }
    }

    private static void HandleHotkey(TilingHost host, int id)
    {
        switch (id)
        {
            case HotkeyPause:
                host.TogglePause();
                break;
            case HotkeyQuit:
                RequestQuit();
                break;
            default:
                break;
        }
    }

    private static void RegisterHotkey(
        HotkeyManager hotkeys,
        int id,
        HotkeyModifiers modifiers,
        uint virtualKey,
        string label)
    {
        HotkeyRegistration registration = hotkeys.Register(
            id,
            modifiers | HotkeyModifiers.NoRepeat,
            virtualKey);

        Console.WriteLine(registration.Registered
            ? $"adrt: {label} registered."
            : $"adrt: {label} unavailable ({registration.Error}); continuing without it.");
    }

    private static void RequestQuit()
    {
        uint threadId = Volatile.Read(ref _mainThreadId);
        if (threadId != 0) NativeMethods.PostThreadMessage(threadId, NativeMethods.WM_QUIT, 0, 0);
    }
}
