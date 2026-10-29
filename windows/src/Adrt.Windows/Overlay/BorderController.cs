using System.Runtime.Versioning;
using Adrt.Core;

namespace Adrt.Windows.Overlay;

/// <summary>
/// Owns the border state machine and paints the focus border with the Windows 11
/// DWM border colour. One place decides "should the border be visible"
/// (<see cref="BorderState"/>); DWM only renders the answer.
/// </summary>
/// <remarks>
/// <para>
/// The border is a single <c>DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ...)</c>
/// call on the focused top-level window, so it needs no overlay window and no
/// layered-window composition. The accent is #3B82F6 as a COLORREF
/// (<c>0x00F6823B</c>); the previously decorated window is always reset to
/// <c>DWMWA_COLOR_DEFAULT</c> when focus moves or the border hides.
/// </para>
/// <para>
/// Visibility gates are the core's <see cref="SuppressionReason"/> set (pause,
/// sharing) plus the session's own <see cref="IndicatorSuppression"/>. The user's
/// config switch is a separate hard gate (<see cref="Enabled"/>), so toggling the
/// border off and on never loses the current focus.
/// </para>
/// <para>
/// <see cref="BorderWindow"/> remains compiled but dormant: its layered-window
/// path never presented on the target build. DWM is only available on Windows 11;
/// on older builds the attribute call fails, which is logged once and the border
/// is a no-op.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
internal sealed class BorderController : IDisposable
{
    private readonly BorderState _state = new();
    private readonly Action<string> _log;
    private IndicatorSuppression? _sessionSuppression;
    private bool _sessionVisible = true;
    private bool _paused;
    private bool _dragging;
    private nint _decorated;
    private bool _dwmFailureLogged;
    private int _disposed;

    public BorderController(
        bool enabled,
        Func<IReadOnlyList<MonitorInfo>> monitors,
        Action<string> log)
    {
        // The monitor list only fed the retired overlay; the parameter stays so
        // the public API (Program/Input) is unchanged.
        ArgumentNullException.ThrowIfNull(monitors);
        ArgumentNullException.ThrowIfNull(log);

        Enabled = enabled;
        _log = log;
    }

    /// <summary>The config switch. When false the border is hidden but focus is remembered.</summary>
    public bool Enabled { get; private set; }

    /// <summary>
    /// True when <paramref name="handle"/> is one of our overlay windows. DWM
    /// decorates the focused app window itself, so we never create one.
    /// </summary>
    public bool IsOwnWindow(nint handle) => false;

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

        ResetDecoration();
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
            ResetDecoration();
            return;
        }

        BorderSnapshot snapshot = _state.Snapshot();
        if (snapshot.Visible && snapshot.Rect is not null)
        {
            // The state machine only becomes visible for the foreground window
            // (InputLayer feeds this controller from GetForegroundWindow), so the
            // live foreground handle is the one HWND to decorate.
            Decorate(OverlayNativeMethods.GetForegroundWindow());
        }
        else
        {
            ResetDecoration();
        }
    }

    private void Decorate(nint hwnd)
    {
        if (hwnd == 0)
        {
            ResetDecoration();
            return;
        }

        if (hwnd == _decorated) return;

        ResetDecoration();

        uint color = OverlayNativeMethods.ACCENT_BORDER_COLOR;
        int hr = OverlayNativeMethods.DwmSetWindowAttribute(
            hwnd,
            OverlayNativeMethods.DWMWA_BORDER_COLOR,
            ref color,
            sizeof(uint));

        // Remember the HWND even on failure so a pre-Windows-11 host does not
        // retry (and log) on every frame; resetting it later is harmless.
        _decorated = hwnd;

        if (hr < 0 && !_dwmFailureLogged)
        {
            _dwmFailureLogged = true;
            _log($"adrt: DWM border colour unavailable (hr=0x{hr:X8}); focus border disabled");
        }
    }

    private void ResetDecoration()
    {
        nint previous = _decorated;
        if (previous == 0) return;

        _decorated = 0;
        uint color = OverlayNativeMethods.DWMWA_COLOR_DEFAULT;
        _ = OverlayNativeMethods.DwmSetWindowAttribute(
            previous,
            OverlayNativeMethods.DWMWA_BORDER_COLOR,
            ref color,
            sizeof(uint));
    }
}
