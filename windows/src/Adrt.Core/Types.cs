// Port of src/core/types.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

public readonly record struct Rect(double X, double Y, double Width, double Height)
{
    public double Right => X + Width;
    public double Bottom => Y + Height;
}

public readonly record struct Size(double Width, double Height);

public sealed record Screen
{
    [JsonPropertyName("index")] public required int Index { get; init; }
    [JsonPropertyName("connector")] public required string Connector { get; init; }
    [JsonPropertyName("geometry")] public required Rect Geometry { get; init; }
    [JsonPropertyName("workArea")] public Rect? WorkArea { get; init; }
    [JsonPropertyName("scale")] public required double Scale { get; init; }
    [JsonPropertyName("refreshRate")] public required double RefreshRate { get; init; }
    [JsonPropertyName("isPrimary")] public required bool IsPrimary { get; init; }
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SurfaceKind
{
    [JsonStringEnumMemberName("normal")] Normal,
    [JsonStringEnumMemberName("dialog")] Dialog,
    [JsonStringEnumMemberName("modal")] Modal,
    [JsonStringEnumMemberName("utility")] Utility,
    [JsonStringEnumMemberName("toolbar")] Toolbar,
    [JsonStringEnumMemberName("skip")] Skip,
}

public sealed record SurfaceFlags
{
    [JsonPropertyName("transient")] public bool Transient { get; init; }
    [JsonPropertyName("modal")] public bool Modal { get; init; }
    [JsonPropertyName("attachedDialog")] public bool AttachedDialog { get; init; }
    [JsonPropertyName("fullscreen")] public bool Fullscreen { get; init; }
    [JsonPropertyName("above")] public bool Above { get; init; }
    [JsonPropertyName("minimized")] public bool Minimized { get; init; }
    [JsonPropertyName("maximized")] public bool Maximized { get; init; }
    [JsonPropertyName("floating")] public bool Floating { get; init; }
    [JsonPropertyName("skipTaskbar")] public bool SkipTaskbar { get; init; }
    [JsonPropertyName("overrideRedirect")] public bool OverrideRedirect { get; init; }
    [JsonPropertyName("onAllWorkspaces")] public bool OnAllWorkspaces { get; init; }
    [JsonPropertyName("sticky")] public bool Sticky { get; init; }
}

public enum Layer
{
    Background = 0,
    Tiled = 1,
    Floating = 2,
    Modal = 3,
    Indicator = 4,
}

public sealed record Placement
{
    [JsonPropertyName("surfaceId")] public required int SurfaceId { get; init; }
    [JsonPropertyName("rect")] public required Rect Rect { get; init; }
    [JsonPropertyName("layer")] public required Layer Layer { get; init; }
    [JsonPropertyName("order")] public required int Order { get; init; }
}

public sealed record TilePlan
{
    [JsonPropertyName("placements")] public required IReadOnlyList<Placement> Placements { get; init; }
}

/// <summary>Window kinds that can never be tiled (§5).</summary>
public static class Types
{
    public static readonly IReadOnlySet<SurfaceKind> NonTileableKinds =
        new HashSet<SurfaceKind> { SurfaceKind.Dialog, SurfaceKind.Modal, SurfaceKind.Skip };

    public static SurfaceFlags EmptyFlags() => new();

    public static bool RectEquals(Rect a, Rect b) => a == b;

    public static double Clamp(double value, double min, double max)
    {
        if (max < min) return min;
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    /// <summary>
    /// Keep a rectangle inside an area. See src/core/types.ts clampRectToArea for
    /// the full rationale (tolerance, integer coordinates, non-negative size).
    /// </summary>
    public static Rect ClampRectToArea(Rect rect, Rect area, double tolerance = 0)
    {
        var slack = double.IsFinite(tolerance) && tolerance > 0 ? tolerance : 0;
        var inside =
            rect.Width >= 0 &&
            rect.Height >= 0 &&
            rect.X >= area.X - slack &&
            rect.Y >= area.Y - slack &&
            rect.X + rect.Width <= area.X + area.Width + slack &&
            rect.Y + rect.Height <= area.Y + area.Height + slack;
        if (inside) return rect;

        var width = Math.Max(0, Math.Min(rect.Width, area.Width));
        var height = Math.Max(0, Math.Min(rect.Height, area.Height));
        return new Rect(
            Math.Round(Clamp(rect.X, area.X, area.X + area.Width - width)),
            Math.Round(Clamp(rect.Y, area.Y, area.Y + area.Height - height)),
            Math.Round(width),
            Math.Round(height));
    }

    /// <summary>Snap a logical-pixel value to the monitor scale grid (§25).</summary>
    /// <remarks>
    /// JS <c>Math.round</c> is half-up, .NET <c>Math.Round</c> is half-to-even;
    /// use the JS rule so the port matches the TypeScript core bit for bit.
    /// </remarks>
    public static double Snap(double value, double scale) =>
        scale <= 1 ? value : Math.Floor(value * scale + 0.5) / scale;

    public static Rect SnapRect(Rect rect, double scale) => new(
        Snap(rect.X, scale),
        Snap(rect.Y, scale),
        Snap(rect.Width, scale),
        Snap(rect.Height, scale));

    /// <summary>Shrink to the scale grid from the inside (§10/§25).</summary>
    public static Rect SnapRectInward(Rect rect, double scale)
    {
        if (!double.IsFinite(scale) || scale <= 1 || scale == Math.Floor(scale)) return rect;
        var left = Math.Ceiling(rect.X * scale) / scale;
        var top = Math.Ceiling(rect.Y * scale) / scale;
        var right = Math.Floor((rect.X + rect.Width) * scale) / scale;
        var bottom = Math.Floor((rect.Y + rect.Height) * scale) / scale;
        return new Rect(left, top, Math.Max(0, right - left), Math.Max(0, bottom - top));
    }
}

/// <summary>Compositor-facing view of one surface (src/core/types.ts Surface).</summary>
public sealed record Surface
{
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("kind")] public required SurfaceKind Kind { get; init; }
    [JsonPropertyName("appId")] public required string AppId { get; init; }
    [JsonPropertyName("appVersion")] public required string AppVersion { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }
    [JsonPropertyName("min")] public required Size Min { get; init; }
    [JsonPropertyName("max")] public required Size Max { get; init; }
    [JsonPropertyName("frame")] public required Rect Frame { get; init; }
    [JsonPropertyName("screenId")] public required int ScreenId { get; init; }
    [JsonPropertyName("workspaceId")] public required int WorkspaceId { get; init; }
    [JsonPropertyName("flags")] public required SurfaceFlags Flags { get; init; }
    [JsonPropertyName("parentId")] public int? ParentId { get; init; }
    [JsonPropertyName("layer")] public required Layer Layer { get; init; }
    [JsonPropertyName("zPosition")] public required int ZPosition { get; init; }
}
