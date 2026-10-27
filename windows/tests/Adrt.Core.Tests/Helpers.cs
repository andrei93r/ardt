// Port of tests/core/helpers.ts.
using Adrt.Core;

namespace Adrt.Core.Tests;

internal static class H
{
    public static Rect Rect(double x, double y, double width, double height) => new(x, y, width, height);

    public static Size Size(double width, double height) => new(width, height);

    public static Screen Screen(
        int index = 0,
        string connector = "eDP-1",
        Rect? geometry = null,
        Rect? workArea = null,
        double scale = 1,
        double refreshRate = 60,
        bool isPrimary = true) => new()
        {
            Index = index,
            Connector = connector,
            Geometry = geometry ?? Rect(0, 0, 1920, 1080),
            WorkArea = workArea,
            Scale = scale,
            RefreshRate = refreshRate,
            IsPrimary = isPrimary,
        };

    public static Surface Surface(
        int id = 1,
        SurfaceKind kind = SurfaceKind.Normal,
        string appId = "app",
        string appVersion = "*",
        string title = "window",
        Size? min = null,
        Size? max = null,
        Rect? frame = null,
        int screenId = 0,
        int workspaceId = 0,
        int? parentId = null,
        Layer layer = Layer.Tiled,
        int zPosition = 0,
        SurfaceFlags? flags = null) => new()
        {
            Id = id,
            Kind = kind,
            AppId = appId,
            AppVersion = appVersion,
            Title = title,
            Min = min ?? Size(100, 100),
            Max = max ?? Size(10000, 10000),
            Frame = frame ?? Rect(0, 0, 800, 600),
            ScreenId = screenId,
            WorkspaceId = workspaceId,
            ParentId = parentId,
            Layer = layer,
            ZPosition = zPosition,
            Flags = flags ?? new SurfaceFlags(),
        };

    public static TilerWindow Window(
        int id = 1,
        string appId = "app",
        string title = "window",
        SurfaceKind kind = SurfaceKind.Normal,
        Rect? rect = null,
        Size? min = null,
        Size? max = null,
        int screenId = 0,
        int workspaceId = 0) => new()
        {
            Id = id,
            AppId = appId,
            Title = title,
            Kind = kind,
            Rect = rect ?? Rect(0, 0, 800, 600),
            Min = min ?? Size(100, 100),
            Max = max ?? Size(10000, 10000),
            ScreenId = screenId,
            WorkspaceId = workspaceId,
        };

    /// <summary>Round-trips a value through JSON so dictionary/list records compare structurally.</summary>
    public static string Json<T>(T value) =>
        System.Text.Json.JsonSerializer.Serialize(value, JsonOptions);

    public static readonly System.Text.Json.JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
    };
}
