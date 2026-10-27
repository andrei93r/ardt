using Adrt.Core;
using Adrt.Windows.Input.Actions;
using Adrt.Windows.Input.Drag;
using Adrt.Windows.Overlay;

namespace Adrt.Windows.Input;

/// <summary>
/// The W5 input + chrome facade: hotkey table registration, action dispatch,
/// drag interpretation and the focus border, all on the host's STA thread.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="HandleHotkey"/> and <see cref="Tick"/> are called from the host's
/// message loop, never from a WinEvent hook or a window procedure. The hotkey
/// path only dispatches; no planning happens in a callback.
/// </para>
/// <para>
/// The border is refreshed from the foreground window on each tick. A focus
/// change re-reads the tileable set (classification included); while the same
/// window stays focused only its DWM frame is read and the overlay moves if the
/// frame moved. Per-monitor overlays are created lazily by the renderer.
/// </para>
/// </remarks>
internal sealed class InputLayer : IDisposable
{
    /// <summary>Ticks between monitor-only topology reads (~1 s at the 40 ms tick).</summary>
    private const int MonitorRefreshTicks = 25;

    private readonly TilingHost _host;
    private readonly Action<string> _log;
    private readonly Action _requestQuit;
    private readonly WindowCatalog _catalog = new();
    private readonly WindowActions _actions;
    private readonly BorderController _border;
    private readonly SessionLockWatcher _sessionWatcher;
    private readonly SessionMachine _session = new();
    private readonly DragInterpreter _drag;
    private readonly Dictionary<int, HotkeyBinding> _bindings = [];
    private bool _lastLocked;
    private bool _lastPaused;
    private nint _lastForeground;
    private bool _borderTracked;
    private int _monitorTicks;
    private int _disposed;

    public InputLayer(
        TilingHost host,
        InputOptions options,
        Action requestQuit,
        Action<string>? log = null)
    {
        ArgumentNullException.ThrowIfNull(host);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(requestQuit);

        _host = host;
        _requestQuit = requestQuit;
        _log = log ?? Console.WriteLine;

        _actions = new WindowActions(host, _catalog, options.NudgeStep, _log);
        _border = new BorderController(options.BorderEnabled, () => _catalog.Screens, _log);
        _sessionWatcher = new SessionLockWatcher(_log);
        _drag = new DragInterpreter(_catalog, _log);

        _lastPaused = host.IsPaused;
        _session.SetManualPause(_lastPaused);
        _border.SetPaused(_lastPaused);
        _border.SetSession(visible: true, suppression: null);
    }

    /// <summary>Register the default table and remember the accepted bindings by id.</summary>
    public IReadOnlyList<HotkeyRegistrationResult> RegisterHotkeys(HotkeyManager hotkeys)
    {
        ArgumentNullException.ThrowIfNull(hotkeys);

        IReadOnlyList<HotkeyRegistrationResult> results =
            HotkeyRegistrar.RegisterDefaults(hotkeys, _log);
        foreach (HotkeyRegistrationResult result in results)
        {
            if (result.Registration.Registered) _bindings[result.Binding.Id] = result.Binding;
        }

        return results;
    }

    /// <summary>Dispatch one <c>WM_HOTKEY</c>. Returns true when the id was ours.</summary>
    public bool HandleHotkey(int id)
    {
        if (!_bindings.TryGetValue(id, out HotkeyBinding? binding))
        {
            _log(FormattableString.Invariant($"[input] WM_HOTKEY with unknown id {id}; ignoring"));
            return false;
        }

        switch (binding.Action)
        {
            case HotkeyAction.TogglePause:
                _host.TogglePause();
                _lastPaused = _host.IsPaused;
                _session.SetManualPause(_lastPaused);
                _border.SetPaused(_lastPaused);
                _log(_host.IsPaused ? "[pause] tiling paused" : "[pause] tiling resumed");
                break;

            case HotkeyAction.Quit:
                _log("[quit] requested from the hotkey table");
                _requestQuit();
                break;

            case HotkeyAction.ToggleBorder:
                _ = _border.Toggle();
                // Re-read the focused window so enabling draws it immediately.
                _lastForeground = 0;
                _borderTracked = false;
                break;

            default:
                _ = _actions.Run(binding);
                // A move/swap/focus action invalidates the cached foreground and
                // the classification; the next tick rebuilds them.
                _lastForeground = 0;
                _borderTracked = false;
                break;
        }

        return true;
    }

    /// <summary>Poll session lock, pause, drag state and the focused frame.</summary>
    public void Tick()
    {
        PollSession();
        SyncPause();
        _drag.Poll();
        _border.SetDragging(_drag.IsDragging);
        UpdateBorder();

        _monitorTicks++;
        if (_monitorTicks < MonitorRefreshTicks) return;
        _monitorTicks = 0;
        _ = _catalog.RefreshMonitors();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;

        _border.Dispose();
        _sessionWatcher.Dispose();
        GC.SuppressFinalize(this);
    }

    private void PollSession()
    {
        bool locked = _sessionWatcher.IsLocked;
        if (locked == _lastLocked) return;
        _lastLocked = locked;

        SessionEffects effects = _session.SetMode(
            locked ? SessionMode.UnlockDialog : SessionMode.User);
        _border.SetSession(effects.IndicatorVisible, effects.IndicatorSuppression);
        _log(locked ? "[session] locked; border hidden" : "[session] unlocked");
        if (effects.RetileOnResume) _host.RequestRetile();
    }

    private void SyncPause()
    {
        bool paused = _host.IsPaused;
        if (paused == _lastPaused) return;

        _lastPaused = paused;
        _session.SetManualPause(paused);
        _border.SetPaused(paused);
        _log(paused ? "[pause] tiling paused" : "[pause] tiling resumed");
    }

    private void UpdateBorder()
    {
        if (!_border.Enabled) return;

        nint foreground = Win32Window.Foreground.Handle;
        if (foreground == 0 || _border.IsOwnWindow(foreground))
        {
            _borderTracked = false;
            _lastForeground = foreground;
            _border.Clear();
            return;
        }

        if (foreground != _lastForeground)
        {
            _lastForeground = foreground;
            _catalog.Refresh();
            MonitoredWindow? tracked = _catalog.Find(foreground);
            _borderTracked = tracked is not null && IsBorderEligible(tracked);
            if (!_borderTracked)
            {
                _border.Clear();
                return;
            }

            _border.SetFocus(tracked!.Surface.Id, tracked.Frame);
            return;
        }

        if (!_borderTracked) return;

        var window = new Win32Window(foreground);
        if (!window.IsValid || !window.IsVisible || window.IsMinimized || window.IsMaximized)
        {
            _borderTracked = false;
            _border.Clear();
            return;
        }

        Rect frame = window.FrameBounds;
        if (frame.Width <= 0 || frame.Height <= 0)
        {
            _borderTracked = false;
            _border.Clear();
            return;
        }

        _border.UpdateRect(frame);
    }

    private static bool IsBorderEligible(MonitoredWindow window)
    {
        SurfaceFlags flags = window.Surface.Flags;
        return window.Surface.Layer == Layer.Tiled &&
               !flags.Minimized &&
               !flags.Maximized &&
               !flags.Floating;
    }
}
