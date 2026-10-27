// Port of src/core/cursor.ts. Keep names and semantics 1:1 with the TypeScript.
namespace Adrt.Core;

public readonly record struct Point(double X, double Y);

/// <summary>
/// Pointer-target geometry (pure). The centre of a window's rect, clamped so it
/// stays inside the work area. Nothing here imports the compositor: the adapter
/// reads the live rect and performs the actual warp (§17 cursor-centre, §11 lane 1).
/// </summary>
public static class Cursor
{
    /// <summary>The integer centre of a rectangle.</summary>
    public static Point RectCentre(Rect rect) =>
        new(JsRound(rect.X + rect.Width / 2), JsRound(rect.Y + rect.Height / 2));

    /// <summary>
    /// Clamp a point so it lies inside `area`. Coordinates are pixel indices, so the
    /// last addressable column/row is `x + width - 1`: a point on the inclusive
    /// right/bottom edge would be outside the work area. A non-positive area is
    /// returned unchanged (there is nothing to clamp to); the caller validates the
    /// work area before it gets here anyway (§10).
    /// </summary>
    private static Point ClampPointToArea(Point point, Rect area)
    {
        if (area.Width <= 0 || area.Height <= 0) return new Point(point.X, point.Y);
        return new Point(
            JsRound(Types.Clamp(point.X, area.X, area.X + area.Width - 1)),
            JsRound(Types.Clamp(point.Y, area.Y, area.Y + area.Height - 1)));
    }

    /// <summary>
    /// The cursor target for a window: the centre of `rect`, clamped inside
    /// `workArea`. This is the whole of the cursor-follow policy that is pure — the
    /// drain owns reading the focused window's live rect and the setting.
    /// </summary>
    public static Point CentreInWorkArea(Rect rect, Rect workArea) =>
        ClampPointToArea(RectCentre(rect), workArea);

    /// <summary>JS `Math.round` is floor(x + 0.5); C# `Math.Round` is half to even.</summary>
    private static double JsRound(double value) => Math.Floor(value + 0.5);
}
