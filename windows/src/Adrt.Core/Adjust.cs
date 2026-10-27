// Port of src/core/adjust.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum AdjustMode
{
    [JsonStringEnumMemberName("move")] Move,
    [JsonStringEnumMemberName("resize")] Resize,
}

/// <summary>
/// Drag intent: did the user resize a shared inner edge, or move the window?
/// Pure, so the awkward cases can be unit-tested (§12, §13).
///
/// The caller's only signals are the rect before the gesture and the rect after
/// it. An inner-edge resize touches exactly one edge, leaving the other three
/// where they were. Anything else — a move, a compositor clamp, or an overview
/// drop that scales the window to its target — changes more than one edge and
/// must be treated as a move: reading a scaled drop as a resize saves a bogus
/// split ratio that then persists for that pair of apps.
/// </summary>
public static class Adjust
{
    /// <summary>How much an edge may drift and still count as "did not move" (px).</summary>
    private const double AdjustTolerance = 8;

    public static AdjustMode ClassifyAdjust(Rect start, Rect now, double tolerance = AdjustTolerance)
    {
        var dx = Math.Abs(now.X - start.X);
        var dy = Math.Abs(now.Y - start.Y);
        var dw = Math.Abs(now.Width - start.Width);
        var dh = Math.Abs(now.Height - start.Height);

        // Horizontal inner edge: the width changed, the vertical axis did not.
        if (dw > tolerance && dy <= tolerance && dh <= tolerance) return AdjustMode.Resize;
        // Vertical inner edge: the height changed, the horizontal axis did not.
        if (dh > tolerance && dx <= tolerance && dw <= tolerance) return AdjustMode.Resize;
        return AdjustMode.Move;
    }
}
