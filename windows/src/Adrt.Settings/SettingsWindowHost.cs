// Opens the WPF settings window on its own STA thread. The tray runs inside the
// host's Win32 message loop, so it must not create WPF windows on that thread.
using System.Runtime.Versioning;
using System.Windows;
using System.Windows.Threading;

namespace Adrt.Settings;

/// <summary>
/// Owns the single settings window and the STA thread it lives on.
/// </summary>
/// <remarks>
/// <para>
/// The host's main thread is a raw Win32 message loop with a WinForms
/// <c>NotifyIcon</c>; WPF needs an STA thread with a dispatcher. This class
/// starts that thread lazily on the first <see cref="Show"/> and reuses the same
/// window afterwards. Closing the window hides it instead of ending the UI
/// thread, so reopening is instant and the store instance is preserved.
/// </para>
/// <para>
/// Call <see cref="Show"/> from any thread. It is safe to call from a tray menu
/// handler, a hotkey or a command line switch.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public static class SettingsWindowHost
{
    private static readonly object Gate = new();
    private static readonly ManualResetEventSlim Ready = new(false);
    private static Thread? _thread;
    private static volatile Dispatcher? _dispatcher;
    private static SettingsWindow? _window;
    private static string _startupError = string.Empty;
    private static volatile bool _shuttingDown;

    /// <summary>
    /// Show (or bring to front) the settings window, starting its UI thread on
    /// the first call. <paramref name="store"/> is used only on that first call;
    /// later calls reuse the window and its store.
    /// </summary>
    /// <param name="store">The store to edit; null creates the per-user store.</param>
    /// <param name="log">Optional one-line diagnostics sink.</param>
    /// <param name="page">
    /// The tab to select; null selects the main Settings tab, so a plain
    /// <c>Show()</c> from a tray handler never strands the user on a sub-page.
    /// </param>
    public static void Show(
        SettingsStore? store = null,
        Action<string>? log = null,
        SettingsPage? page = null)
    {
        EnsureStarted(store, log);

        Dispatcher? dispatcher = _dispatcher;
        if (dispatcher is null)
        {
            log?.Invoke($"adrt: the settings window is unavailable: {_startupError}");
            return;
        }

        void Open()
        {
            if (_window is null) return;
            _window.ShowPage(page ?? SettingsPage.Settings);
            if (!_window.IsVisible) _window.Show();
            if (_window.WindowState == WindowState.Minimized) _window.WindowState = WindowState.Normal;
            _window.Activate();
            _window.Focus();
        }

        if (dispatcher.CheckAccess()) Open();
        else dispatcher.BeginInvoke((Action)Open);
    }

    /// <summary>Hide the window without ending the UI thread.</summary>
    public static void Hide()
    {
        Dispatcher? dispatcher = _dispatcher;
        if (dispatcher is null) return;
        dispatcher.BeginInvoke((Action)(() => _window?.Hide()));
    }

    /// <summary>Close the window and end the settings UI thread.</summary>
    public static void Shutdown()
    {
        Dispatcher? dispatcher = _dispatcher;
        if (dispatcher is null) return;
        dispatcher.BeginInvoke((Action)(() =>
        {
            _shuttingDown = true;
            _window?.Close();
            Dispatcher.CurrentDispatcher.InvokeShutdown();
        }));
    }

    private static void EnsureStarted(SettingsStore? store, Action<string>? log)
    {
        lock (Gate)
        {
            if (_thread is { IsAlive: true }) return;

            Ready.Reset();
            _startupError = string.Empty;
            _dispatcher = null;
            _window = null;
            _shuttingDown = false;

            SettingsStore resolved = store ?? new SettingsStore();
            var thread = new Thread(() => RunUiThread(resolved, log))
            {
                IsBackground = true,
                Name = "Adrt settings UI",
            };
            thread.SetApartmentState(ApartmentState.STA);
            _thread = thread;
            thread.Start();

            // The UI thread never takes Gate, so waiting here cannot deadlock.
            if (!Ready.Wait(TimeSpan.FromSeconds(10)))
            {
                _startupError = "the UI thread did not become ready within 10 seconds";
                log?.Invoke($"adrt: {_startupError}");
            }
        }
    }

    private static void RunUiThread(SettingsStore store, Action<string>? log)
    {
        try
        {
            // No Application object: a Dispatcher.Run loop is enough for one window,
            // and it lets the host own an Application on its own thread if it ever
            // becomes a WPF app (WPF permits only one Application per AppDomain).
            var window = new SettingsWindow(store);
            window.Closing += (_, args) =>
            {
                if (_shuttingDown) return;
                args.Cancel = true;
                window.Hide();
            };

            _window = window;
            _dispatcher = Dispatcher.CurrentDispatcher;
            Ready.Set();
            Dispatcher.Run();
        }
#pragma warning disable CA1031 // A failed UI thread must be reported, never tear down the tiling host.
        catch (Exception error)
#pragma warning restore CA1031
        {
            _startupError = error.Message;
            log?.Invoke($"adrt: the settings window failed to start: {error.Message}");
            Ready.Set();
        }
        finally
        {
            _dispatcher = null;
            _window = null;
        }
    }
}
