// Port of src/core/session.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SessionMode
{
    [JsonStringEnumMemberName("user")] User,
    [JsonStringEnumMemberName("unlock-dialog")] UnlockDialog,
    [JsonStringEnumMemberName("screen-sharing")] ScreenSharing,
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum IndicatorSuppression
{
    [JsonStringEnumMemberName("pause")] Pause,
    [JsonStringEnumMemberName("sharing")] Sharing,
}

public sealed record SessionEffects
{
    /// <summary>
    /// True when tiling, retiles and the drain must stop: a locked session or a
    /// manual pause (`isPaused`). The scan tick is governed separately by
    /// `scanTickRunning`, so the two fields can disagree during a manual pause.
    /// </summary>
    [JsonPropertyName("paused")] public required bool Paused { get; init; }

    /// <summary>Whether the border may be shown (before other suppressions).</summary>
    [JsonPropertyName("indicatorVisible")] public required bool IndicatorVisible { get; init; }

    /// <summary>Suppression to add to the border while in this mode, if any.</summary>
    [JsonPropertyName("indicatorSuppression")] public IndicatorSuppression? IndicatorSuppression { get; init; }

    [JsonPropertyName("scanTickRunning")] public required bool ScanTickRunning { get; init; }

    /// <summary>True exactly once when leaving the paused mode for `user`.</summary>
    [JsonPropertyName("retileOnResume")] public required bool RetileOnResume { get; init; }
}

public sealed record SessionState
{
    [JsonPropertyName("mode")] public required SessionMode Mode { get; init; }
    [JsonPropertyName("paused")] public required bool Paused { get; init; }
}

/// <summary>
/// Session-mode state machine (§18). The adapter's single
/// `_onSessionModeChanged()` handler drives this and applies the emitted
/// effects; nothing else inspects the session mode.
/// </summary>
public sealed class SessionMachine
{
    private SessionMode _mode;
    private bool _retilePending;

    /// <summary>
    /// A user-requested pause (the panel's Pause/Resume). It is not a session
    /// *mode*: locking or sharing still pause on their own, and clearing this flag
    /// never overrides them. Folded into the one `isPaused` predicate so every
    /// existing pause consumer (tiling, the drain, the indicator) sees it.
    /// </summary>
    private bool _manualPaused;

    /// <summary>
    /// A stable, frozen snapshot of the two public fields. The getter returns this
    /// object by reference, so a poll does not allocate per read; every transition
    /// that can change it (`setMode`, `setManualPause`) rebuilds it once.
    /// </summary>
    private SessionState _stateView;

    public SessionMachine(SessionMode mode = SessionMode.User)
    {
        _mode = mode;
        _stateView = new SessionState { Mode = mode, Paused = IsPaused };
    }

    public SessionState State => _stateView;

    /// <summary>The one pause predicate: a locked session or a manual user pause.</summary>
    public bool IsPaused => _mode == SessionMode.UnlockDialog || _manualPaused;

    /// <summary>Whether the user paused tiling manually (as opposed to a session mode).</summary>
    public bool ManualPause => _manualPaused;

    /// <summary>Set the user-requested pause. Idempotent; never touches the session mode.</summary>
    public void SetManualPause(bool paused)
    {
        if (_manualPaused == paused) return;
        _manualPaused = paused;
        RefreshStateView();
    }

    public bool IndicatorVisible => _mode == SessionMode.User;

    /// <summary>
    /// Move to a new mode and return the effects to apply. `retileOnResume` is
    /// true on the transition out of `unlock-dialog` back to `user`, and is
    /// cleared by the next call so the active workspace retiles exactly once.
    /// </summary>
    public SessionEffects SetMode(SessionMode mode)
    {
        var previous = _mode;
        _mode = mode;
        var retileOnResume = previous == SessionMode.UnlockDialog && mode == SessionMode.User && !_retilePending;
        _retilePending = retileOnResume;
        RefreshStateView();
        IndicatorSuppression? suppression = mode == SessionMode.UnlockDialog
            ? IndicatorSuppression.Pause
            : mode == SessionMode.ScreenSharing ? IndicatorSuppression.Sharing : null;
        return new SessionEffects
        {
            // The same combined predicate `state.paused` exposes, so the two answers
            // cannot diverge: a manual pause keeps tiling stopped across a transition.
            Paused = IsPaused,
            IndicatorVisible = mode == SessionMode.User,
            IndicatorSuppression = suppression,
            ScanTickRunning = mode != SessionMode.UnlockDialog,
            RetileOnResume = retileOnResume,
        };
    }

    /// <summary>Consume a pending resume retile.</summary>
    public bool ConsumeRetile()
    {
        var pending = _retilePending;
        _retilePending = false;
        return pending;
    }

    /// <summary>Rebuild the frozen `state` snapshot after a field it exposes changed.</summary>
    private void RefreshStateView() => _stateView = new SessionState { Mode = _mode, Paused = IsPaused };
}
