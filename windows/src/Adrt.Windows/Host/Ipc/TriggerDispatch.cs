using System.Text.Json.Nodes;
using Adrt.Core;

namespace Adrt.Windows;

/// <summary>
/// Maps the ported trigger table onto the host's public surface. Triggers the
/// host cannot yet honour return a structured <c>notImplemented</c> object
/// instead of failing the pipe (the transport stays policy-free).
/// </summary>
public sealed class TriggerDispatch
{
    private readonly TilingHost _host;
    private readonly Action _quit;
    private readonly Action<string> _log;

    /// <summary>Create a dispatcher over a started host.</summary>
    /// <param name="host">The tiling host.</param>
    /// <param name="quit">Called for the <c>Quit</c> trigger.</param>
    /// <param name="log">Optional diagnostics sink.</param>
    public TriggerDispatch(TilingHost host, Action quit, Action<string>? log = null)
    {
        _host = host ?? throw new ArgumentNullException(nameof(host));
        _quit = quit ?? throw new ArgumentNullException(nameof(quit));
        _log = log ?? Console.WriteLine;
    }

    /// <summary>Dispatch one trigger name and return its JSON result.</summary>
    public JsonNode? Invoke(string trigger, JsonNode? args)
    {
        _log($"adrt: ipc {trigger}");

        switch (trigger)
        {
            case "TogglePause":
                _host.TogglePause();
                return new JsonObject { ["paused"] = _host.IsPaused };
            case "Retile":
            case "RequestRetile":
                _host.RequestRetile();
                return null;
            case "FocusNext":
            case "FocusCycle":
                return new JsonObject { ["focused"] = _host.FocusNext() };
            case "FocusDirection":
                return new JsonObject { ["focused"] = _host.FocusDirection(ReadDirection(args)) };
            case "Undo":
                return new JsonObject { ["undone"] = _host.UndoLast(), ["canUndo"] = _host.CanUndo };
            case "DumpState":
                return DumpState();
            case "DumpDecisions":
            case "DumpEvents":
            case "DumpTrace":
                return new JsonArray();
            case "Quit":
                _quit();
                return null;
            default:
                return new JsonObject { ["notImplemented"] = trigger };
        }
    }

    private static Adrt.Core.FocusDirection ReadDirection(JsonNode? args)
    {
        string? name = args switch
        {
            JsonArray array when array.Count > 0 => array[0]?.GetValue<string>(),
            JsonObject obj when obj["direction"] is JsonValue value => value.GetValue<string>(),
            JsonValue value => value.GetValue<string>(),
            _ => null,
        };

        return name?.ToLowerInvariant() switch
        {
            "left" => Adrt.Core.FocusDirection.Left,
            "up" => Adrt.Core.FocusDirection.Up,
            "down" => Adrt.Core.FocusDirection.Down,
            _ => Adrt.Core.FocusDirection.Right,
        };
    }

    private JsonNode DumpState()
    {
        var screens = new JsonArray();
        foreach (MonitorInfo monitor in _host.Monitors)
        {
            screens.Add(new JsonObject
            {
                ["index"] = monitor.Index,
                ["connector"] = monitor.DeviceName,
                ["isPrimary"] = monitor.IsPrimary,
                ["geometry"] = RectJson(monitor.Bounds),
                ["workArea"] = RectJson(monitor.WorkArea),
            });
        }

        return new JsonObject
        {
            ["platform"] = "windows",
            ["paused"] = _host.IsPaused,
            ["canUndo"] = _host.CanUndo,
            ["monitors"] = screens,
        };
    }

    private static JsonObject RectJson(Rect rect) => new()
    {
        ["x"] = rect.X,
        ["y"] = rect.Y,
        ["width"] = rect.Width,
        ["height"] = rect.Height,
    };
}
