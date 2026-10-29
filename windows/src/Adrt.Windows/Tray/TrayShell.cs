// WinForms tray shell for the WPF host. Kept out of Program.cs on purpose: the
// integrator creates one, wires the events and calls Start/Stop from the thread
// that owns the Win32 message loop.
using System.Drawing;
using System.IO;
using System.Runtime.Versioning;
using System.Windows.Forms;
using Adrt.Settings;

namespace Adrt.Windows;

/// <summary>The requested state after the tray's pause/resume item is clicked.</summary>
public sealed class TrayPauseEventArgs(bool paused) : EventArgs
{
    /// <summary>True when the user asked to pause tiling.</summary>
    public bool Paused { get; } = paused;
}

/// <summary>
/// The notification-area icon and its menu: pause/resume, settings and quit.
/// </summary>
/// <remarks>
/// <para>
/// A <see cref="NotifyIcon"/> needs the thread's Win32 message loop to dispatch
/// its messages. Create and start the shell on the UI thread (the one that runs
/// <c>MsgWaitForMultipleObjectsEx</c>/<c>DispatchMessage</c> in
/// <c>Program.MessageLoop</c>) and stop it from the same thread before the loop
/// exits. Mark the host's <c>Main</c> with <c>[STAThread]</c>: WPF and WinForms
/// dialogs both require it.
/// </para>
/// <para>
/// <see cref="PauseResumeRequested"/> only reports the desired state. The host
/// owns the actual pause flag, so the integrator should keep
/// <see cref="IsPaused"/> in sync when a hotkey toggles the same state.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class TrayShell : IDisposable
{
    private const string DefaultTooltip = "Adrt — window tiling";

    private readonly string _tooltip;
    private readonly Action<string> _log;
    private NotifyIcon? _notifyIcon;
    private ContextMenuStrip? _menu;
    private ToolStripMenuItem? _pauseItem;
    private Icon? _icon;
    private bool _paused;
    private bool _disposed;

    /// <summary>Create a tray shell; call <see cref="Start"/> once a message loop exists.</summary>
    /// <param name="tooltip">Tooltip text; the default describes the app.</param>
    /// <param name="log">Optional one-line diagnostics sink.</param>
    public TrayShell(string? tooltip = null, Action<string>? log = null)
    {
        _tooltip = string.IsNullOrWhiteSpace(tooltip) ? DefaultTooltip : tooltip;
        _log = log ?? (_ => { });
    }

    /// <summary>Raised after the pause/resume item is clicked; the handler applies the state.</summary>
    public event EventHandler<TrayPauseEventArgs>? PauseResumeRequested;

    /// <summary>Raised when Settings is chosen. With no handler the built-in window opens.</summary>
    public event EventHandler? SettingsRequested;

    /// <summary>Raised when Apps is chosen. With no handler the built-in window opens on Apps.</summary>
    public event EventHandler? AppsRequested;

    /// <summary>Raised when Quit is chosen; the host decides how to end its message loop.</summary>
    public event EventHandler? QuitRequested;

    /// <summary>
    /// The state shown by the menu. Set it from the host when tiling is paused or
    /// resumed elsewhere (a hotkey, a session event); setting it does not raise
    /// <see cref="PauseResumeRequested"/>.
    /// </summary>
    public bool IsPaused
    {
        get => _paused;
        set
        {
            if (_paused == value) return;
            _paused = value;
            UpdatePauseItem();
        }
    }

    /// <summary>True while the icon is in the notification area.</summary>
    public bool IsStarted => _notifyIcon is not null;

    /// <summary>Create the icon and menu. Idempotent; must run on the message-loop thread.</summary>
    public void Start()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_notifyIcon is not null) return;

        ContextMenuStrip? menu = null;
        Icon? icon = null;
        NotifyIcon? notify = null;
        try
        {
            menu = new ContextMenuStrip();
            var pause = new ToolStripMenuItem("Pause tiling");
            pause.Click += OnPauseResumeClicked;
            var settings = new ToolStripMenuItem("Settings…");
            settings.Click += OnSettingsClicked;
            var apps = new ToolStripMenuItem("Apps…");
            apps.Click += OnAppsClicked;
            var quit = new ToolStripMenuItem("Quit adrt");
            quit.Click += OnQuitClicked;

            menu.Items.Add(pause);
            menu.Items.Add(settings);
            menu.Items.Add(apps);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(quit);

            icon = LoadIcon();
            notify = new NotifyIcon
            {
                Icon = icon,
                Text = TooltipText(),
                ContextMenuStrip = menu,
            };
            notify.DoubleClick += OnSettingsClicked;
            notify.Visible = true;

            _menu = menu;
            _pauseItem = pause;
            _notifyIcon = notify;
            _icon = icon;
            UpdatePauseItem();
        }
        catch
        {
            notify?.Dispose();
            icon?.Dispose();
            menu?.Dispose();
            throw;
        }
    }

    /// <summary>Remove the icon and release the menu. Idempotent; safe before <see cref="Start"/>.</summary>
    public void Stop()
    {
        if (_notifyIcon is not null)
        {
            _notifyIcon.Visible = false;
            _notifyIcon.DoubleClick -= OnSettingsClicked;
            _notifyIcon.Dispose();
            _notifyIcon = null;
        }

        _menu?.Dispose();
        _menu = null;
        _pauseItem = null;

        _icon?.Dispose();
        _icon = null;
    }

    /// <summary>Show a balloon/toast notice; a no-op before <see cref="Start"/>.</summary>
    public void ShowNotification(string title, string message, ToolTipIcon icon = ToolTipIcon.Info)
    {
        if (_notifyIcon is null) return;
        _notifyIcon.BalloonTipTitle = title;
        _notifyIcon.BalloonTipText = message;
        _notifyIcon.BalloonTipIcon = icon;
        _notifyIcon.ShowBalloonTip(5000);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed) return;
        Stop();
        _disposed = true;
        GC.SuppressFinalize(this);
    }

    private void OnPauseResumeClicked(object? sender, EventArgs e)
    {
        IsPaused = !IsPaused;

        EventHandler<TrayPauseEventArgs>? handler = PauseResumeRequested;
        if (handler is null)
        {
            _log(IsPaused ? "adrt: paused from the tray" : "adrt: resumed from the tray");
            return;
        }
        handler(this, new TrayPauseEventArgs(IsPaused));
    }

    private void OnSettingsClicked(object? sender, EventArgs e)
    {
        EventHandler? handler = SettingsRequested;
        if (handler is not null)
        {
            handler(this, EventArgs.Empty);
            return;
        }

        // The tray is useful on its own: with no subscriber, open the bundled
        // preferences window (it owns its own STA thread).
        SettingsWindowHost.Show(page: SettingsPage.Settings, log: _log);
    }

    private void OnAppsClicked(object? sender, EventArgs e)
    {
        EventHandler? handler = AppsRequested;
        if (handler is not null)
        {
            handler(this, EventArgs.Empty);
            return;
        }

        SettingsWindowHost.Show(page: SettingsPage.Apps, log: _log);
    }

    private void OnQuitClicked(object? sender, EventArgs e)
    {
        EventHandler? handler = QuitRequested;
        if (handler is not null)
        {
            handler(this, EventArgs.Empty);
            return;
        }
        _log("adrt: quit requested from the tray, but no handler is attached");
    }

    private void UpdatePauseItem()
    {
        if (_pauseItem is not null) _pauseItem.Text = _paused ? "Resume tiling" : "Pause tiling";
        if (_notifyIcon is not null) _notifyIcon.Text = TooltipText();
    }

    private string TooltipText()
    {
        string text = _paused ? $"{_tooltip} (paused)" : _tooltip;
        // NotifyIcon.Text is limited to 63 characters on older shells.
        return text.Length <= 63 ? text : text[..60] + "...";
    }

    private static Icon LoadIcon()
    {
        try
        {
            string? executable = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(executable))
            {
                Icon? extracted = Icon.ExtractAssociatedIcon(executable);
                if (extracted is not null) return extracted;
            }
        }
        catch (ArgumentException)
        {
            // No icon resource in the executable; fall through to the stock icon.
        }
        catch (FileNotFoundException)
        {
            // The executable path vanished; the stock icon is still fine.
        }

        // Clone: the caller disposes the icon, and the shared one must survive.
        return (Icon)SystemIcons.Application.Clone();
    }
}
