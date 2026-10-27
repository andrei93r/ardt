using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows.Overlay;

/// <summary>
/// Owns the border state machine and the overlay window. One place decides
/// "should the border be visible, and where" (<see cref="BorderState"/>); the
/// overlay only renders the answer.
/// </summary>
/// <remarks>
/// Visibility gates are the core's <see cref="SuppressionReason"/> set (pause,
/// sharing) plus the session's own <see cref="IndicatorSuppression"/>. The user's
/// config switch is a separate hard gate (<see cref="Enabled"/>), so toggling the
/// border off and on never loses the current focus.
/// </remarks>
[SupportedOSPlatform("windows")]
internal sealed class BorderController : IDisposable
{
    private readonly BorderWindow _window;
    private readonly BorderState _state = new();
    private readonly Func<IReadOnlyList<MonitorInfo>> _monitors;
    private readonly Action<string> _log;
    private IndicatorSuppression? _sessionSuppression;
    private bool _sessionVisible = true;
    private bool _paused;
    private bool _dragging;
    private int _disposed;

    public BorderController(
        bool enabled,
        Func<IReadOnlyList<MonitorInfo>> monitors,
        Action<string> log)
    {
        ArgumentNullException.ThrowIfNull(monitors);
        ArgumentNullException.ThrowIfNull(log);

        Enabled = enabled;
        _monitors = monitors;
        _log = log;
        _window = new BorderWindow(log);
    }

    /// <summary>The config switch. When false the overlay is hidden but focus is remembered.</summary>
    public bool Enabled { get; private set; }

    /// <summary>True when <paramref name="handle"/> is one of our overlay windows.</summary>
    public bool IsOwnWindow(nint handle) => _window.IsOwnWindow(handle);

    /// <summary>Show or hide the border for this session.</summary>
    public void SetEnabled(bool enabled)
    {
        if (Enabled == enabled) return;

        Enabled = enabled;
        _log(enabled ? "adrt: focus border on" : "adrt: focus border off");
        Redraw();
    }

    /// <summary>Toggle the border and return the new state.</summary>
    public bool Toggle()
    {
        SetEnabled(!Enabled);
        return Enabled;
    }

    /// <summary>
    /// Re-affirm the focused window from live state. This is an authoritative
    /// state pass, not a focus signal, so the core settles it immediately (no
    /// stale pre-placement frame is ever drawn).
    /// </summary>
    public void SetFocus(int id, Rect rect)
    {
        _state.SetFocusFromState(id, rect);
        Redraw();
    }

    /// <summary>Follow the focused window's frame as it moves.</summary>
    public void UpdateRect(Rect rect)
    {
        _state.UpdateRect(rect);
        Redraw();
    }

    /// <summary>No tileable window has focus (desktop, dialog, empty workspace).</summary>
    public void Clear()
    {
        _state.ClearFocus();
        Redraw();
    }

    /// <summary>Manual tiling pause; the border hides while paused and returns on resume.</summary>
    public void SetPaused(bool paused)
    {
        if (_paused == paused) return;

        _paused = paused;
        ApplySuppressions();
    }

    /// <summary>Hide while the user is dragging a window (§23.1 `drag`).</summary>
    public void SetDragging(bool dragging)
    {
        if (_dragging == dragging) return;

        _dragging = dragging;
        if (dragging)
        {
            _state.Suppress(SuppressionReason.Drag);
        }
        else
        {
            _state.Unsuppress(SuppressionReason.Drag);
        }

        Redraw();
    }

    /// <summary>
    /// Apply the session-mode effects: the lock/unlock dialog hides the border,
    /// sharing maps to the core's sharing suppression.
    /// </summary>
    public void SetSession(bool visible, IndicatorSuppression? suppression)
    {
        _sessionVisible = visible;
        _sessionSuppression = suppression;
        ApplySuppressions();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;

        _window.Dispose();
        GC.SuppressFinalize(this);
    }

    private void ApplySuppressions()
    {
        if (_paused || _sessionSuppression == IndicatorSuppression.Pause)
        {
            _state.Suppress(SuppressionReason.Pause);
        }
        else
        {
            _state.Unsuppress(SuppressionReason.Pause);
        }

        if (_sessionSuppression == IndicatorSuppression.Sharing)
        {
            _state.Suppress(SuppressionReason.Sharing);
        }
        else
        {
            _state.Unsuppress(SuppressionReason.Sharing);
        }

        Redraw();
    }

    private void Redraw()
    {
        if (!Enabled || !_sessionVisible)
        {
            _window.Hide();
            return;
        }

        BorderSnapshot snapshot = _state.Snapshot();
        if (snapshot.Visible && snapshot.Rect is { } rect)
        {
            _window.Show(_monitors(), rect);
        }
        else
        {
            _window.Hide();
        }
    }
}
