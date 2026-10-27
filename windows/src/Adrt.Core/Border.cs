// Port of src/core/border.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>Reasons the border is suppressed (§23.1).</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SuppressionReason
{
    [JsonStringEnumMemberName("workspace-switch")] WorkspaceSwitch,
    [JsonStringEnumMemberName("drag")] Drag,
    [JsonStringEnumMemberName("fullscreen")] Fullscreen,
    [JsonStringEnumMemberName("pause")] Pause,
    [JsonStringEnumMemberName("sharing")] Sharing,
    [JsonStringEnumMemberName("overview")] Overview,
    [JsonStringEnumMemberName("occluded")] Occluded,
    [JsonStringEnumMemberName("popup")] Popup,
}

public sealed record BorderSnapshot
{
    [JsonPropertyName("visible")] public required bool Visible { get; init; }
    [JsonPropertyName("rect")] public required Rect? Rect { get; init; }
}

/// <summary>
/// The single owner of "should the border be visible and where" (§23.1).
/// Every path that shows the border goes through here.
/// </summary>
public sealed class BorderState
{
    private readonly HashSet<SuppressionReason> _suppressions = [];

    private int? _focusId;
    private Rect? _focusRect;
    private bool _visible;

    /// <summary>
    /// Whether the focused window's rect is its settled placement. A focus change
    /// arrives <b>before</b> the model has placed the window, so the rect handed to
    /// <c>SetFocus</c> is the window's pre-placement frame; drawing the highlight
    /// then paints it at the old position for a frame, which is the "focus is drawn
    /// before the window is in position and stabilized" bug. The border stays
    /// hidden until <c>Settle()</c> says the model has placed it.
    /// </summary>
    private bool _settled;

    /// <summary>
    /// Whether a focus signal's placement is still owed. A focus signal hands over
    /// a <b>guessed</b> rect, so any model state pass that arrives before the focus
    /// layout is unknown to be "the placement" and must not open the gate. Without
    /// this the gate would either draw early (A173) or, once a window is already in
    /// place with nothing left to move it, never open at all — the enable/disable
    /// stress in A161 showed the highlight failing to come back for exactly that
    /// reason. A state pass with no placement owed is authoritative and settles.
    /// </summary>
    private bool _placementPending;

    /// <summary>Id of the currently focused tracked window, or null.</summary>
    public int? FocusedId => _focusId;

    /// <summary>True once the focused window's rect is its model placement, not a guess.</summary>
    public bool IsSettled => _settled;

    public IReadOnlyList<SuppressionReason> ActiveSuppressions => [.. _suppressions];

    public void Suppress(SuppressionReason reason)
    {
        _suppressions.Add(reason);
        Recompute();
    }

    public void Unsuppress(SuppressionReason reason)
    {
        _suppressions.Remove(reason);
        Recompute();
    }

    public bool IsSuppressed(SuppressionReason reason) => _suppressions.Contains(reason);

    /// <summary>
    /// A focus <b>signal</b>: the compositor focused <paramref name="id"/>, and the
    /// rect is the window's frame <b>at that moment</b> — a pre-placement guess,
    /// because the model has not run its focus-driven layout yet. The gate is closed
    /// until that layout (or a real move) settles it.
    /// </summary>
    public void SetFocus(int id, Rect rect)
    {
        // A repeat of the same focus is still a fresh signal: the display re-emitted
        // focus and a focus-driven pass follows, so the gate is re-armed. Only a
        // state pass (see SetFocusFromState) may settle without one.
        _placementPending = true;
        _settled = false;
        _focusId = id;
        _focusRect = rect;
        Recompute();
    }

    /// <summary>
    /// A model <b>state pass</b> re-affirms the focused window. Its rect is the
    /// model's current geometry, so it is authoritative — <b>unless</b> a focus
    /// signal's placement is still owed, in which case this pass is unrelated (a
    /// route, a self-heal, a drag) and may be carrying an intermediate frame; it is
    /// then left for the focus layout to settle. A frame that merely <b>differs</b>
    /// is not the placement: the compositor can move a window part-way there, and
    /// drawing that intermediate rect is the same early draw. Real geometry is
    /// observed by the animated-frame and motion-tick paths (<c>SettleIfMoved</c>),
    /// not here.
    /// </summary>
    public void SetFocusFromState(int id, Rect rect)
    {
        _focusId = id;
        _focusRect = rect;
        if (!_placementPending) _settled = true;
        Recompute();
    }

    /// <summary>
    /// The model has placed the focused window, so its rect is now trustworthy and
    /// the border may be drawn. Called on the model's focus-driven layout pass
    /// (<c>model.layout reason=focus</c>) and by a state pass that owes no placement.
    /// </summary>
    public void Settle()
    {
        _placementPending = false;
        _settled = true;
        Recompute();
    }

    /// <summary>
    /// Settle only if <paramref name="rect"/> is no longer the pre-placement frame
    /// captured by <c>SetFocus</c>. An unrelated model pass (a route, a self-heal, a
    /// drag) can run between the focus signal and the focus-driven pass; settling on
    /// it would draw the highlight at the frame the window is about to leave — the
    /// very bug this gate exists to prevent. Once the window has actually moved, its
    /// frame is real geometry and drawing it is correct even if the focus layout is
    /// still in flight.
    /// </summary>
    public void SettleIfMoved(Rect rect)
    {
        if (_focusRect is null || Types.RectEquals(_focusRect.Value, rect)) return;
        _focusRect = rect;
        _placementPending = false;
        _settled = true;
        Recompute();
    }

    public void ClearFocus()
    {
        _focusId = null;
        _focusRect = null;
        _settled = false;
        _placementPending = false;
        Recompute();
    }

    /// <summary>Follow the focused window's frame; no-op without focus (§23).</summary>
    public void UpdateRect(Rect rect)
    {
        if (_focusId is null) return;
        _focusRect = rect;
        Recompute();
    }

    public void Clear()
    {
        _suppressions.Clear();
        _focusId = null;
        _focusRect = null;
        _settled = false;
        _placementPending = false;
        Recompute();
    }

    public BorderSnapshot Snapshot() =>
        _visible && _focusRect is not null
            ? new BorderSnapshot { Visible = true, Rect = _focusRect }
            : new BorderSnapshot { Visible = false, Rect = null };

    public bool ShouldShow => _visible;

    public Rect? Rect => _visible ? _focusRect : null;

    private void Recompute()
    {
        _visible = _suppressions.Count == 0 && _focusId is not null && _focusRect is not null && _settled;
    }
}
