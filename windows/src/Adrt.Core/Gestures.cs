// Port of src/core/gestures.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Adrt.Core;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum GestureKind
{
    [JsonStringEnumMemberName("swipe-3-horizontal")] Swipe3Horizontal,
    [JsonStringEnumMemberName("swipe-3-vertical")] Swipe3Vertical,
    [JsonStringEnumMemberName("swipe-4-horizontal")] Swipe4Horizontal,
    [JsonStringEnumMemberName("swipe-4-vertical")] Swipe4Vertical,
    [JsonStringEnumMemberName("pinch-in")] PinchIn,
    [JsonStringEnumMemberName("pinch-out")] PinchOut,
    [JsonStringEnumMemberName("hold-3-swipe")] Hold3Swipe,
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum GesturePhase
{
    [JsonStringEnumMemberName("begin")] Begin,
    [JsonStringEnumMemberName("update")] Update,
    [JsonStringEnumMemberName("end")] End,
    [JsonStringEnumMemberName("cancel")] Cancel,
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum GestureDirection
{
    [JsonStringEnumMemberName("left")] Left,
    [JsonStringEnumMemberName("right")] Right,
    [JsonStringEnumMemberName("up")] Up,
    [JsonStringEnumMemberName("down")] Down,
}

public sealed record GestureEvent
{
    [JsonPropertyName("kind")] public required GestureKind Kind { get; init; }
    [JsonPropertyName("phase")] public required GesturePhase Phase { get; init; }
    [JsonPropertyName("progress")] public required double Progress { get; init; }
    [JsonPropertyName("deltaX")] public required double DeltaX { get; init; }
    [JsonPropertyName("deltaY")] public required double DeltaY { get; init; }
    [JsonPropertyName("direction")] public GestureDirection? Direction { get; init; }
    [JsonPropertyName("touchPoints")] public required double TouchPoints { get; init; }
    [JsonPropertyName("timestampUs")] public required double TimestampUs { get; init; }
}

/// <summary>The mutable state machine state (§41.2).</summary>
public sealed class GestureState
{
    [JsonPropertyName("activeKind")] public GestureKind? ActiveKind { get; set; }
    [JsonPropertyName("startX")] public double StartX { get; set; }
    [JsonPropertyName("startY")] public double StartY { get; set; }
    [JsonPropertyName("accumulatedX")] public double AccumulatedX { get; set; }
    [JsonPropertyName("accumulatedY")] public double AccumulatedY { get; set; }
    [JsonPropertyName("touchPoints")] public double TouchPoints { get; set; }
    [JsonPropertyName("phase")] public GesturePhase Phase { get; set; } = GesturePhase.Cancel;
    [JsonPropertyName("startedAtUs")] public double StartedAtUs { get; set; }
}

public sealed record GestureConfig
{
    [JsonPropertyName("enabled")] public required bool Enabled { get; init; }
    [JsonPropertyName("swipe3Horizontal")] public required GestureActionType Swipe3Horizontal { get; init; }
    [JsonPropertyName("swipe3Vertical")] public required GestureActionType Swipe3Vertical { get; init; }
    [JsonPropertyName("swipe4Horizontal")] public required GestureActionType Swipe4Horizontal { get; init; }
    [JsonPropertyName("swipe4Vertical")] public required GestureActionType Swipe4Vertical { get; init; }
    [JsonPropertyName("pinchAction")] public required GestureActionType PinchAction { get; init; }

    /// <summary>0–100; higher means a smaller travel threshold.</summary>
    [JsonPropertyName("sensitivity")] public required double Sensitivity { get; init; }
}

/// <summary>
/// A gesture action setting. The TypeScript is
/// <c>'switch-workspace' | … | `custom:${string}`</c>; the open-ended
/// <c>custom:</c> arm cannot be an enum, so the named values are static
/// instances of this value type and a custom action keeps its wire string.
/// </summary>
[JsonConverter(typeof(GestureActionTypeJsonConverter))]
public readonly record struct GestureActionType
{
    private readonly string? _wire;

    private GestureActionType(string wire) => _wire = wire;

    /// <summary>The exact settings/JSON value, e.g. <c>custom:do-a-thing</c>.</summary>
    public string Wire => _wire ?? string.Empty;

    public static readonly GestureActionType SwitchWorkspace = new("switch-workspace");
    public static readonly GestureActionType ToggleOverview = new("toggle-overview");
    public static readonly GestureActionType ShowDesktop = new("show-desktop");
    public static readonly GestureActionType SwapPair = new("swap-pair");
    public static readonly GestureActionType None = new("none");

    public bool IsCustom => Wire.StartsWith("custom:", StringComparison.Ordinal);

    public static GestureActionType Custom(string action) => new($"custom:{action}");

    public static GestureActionType FromWire(string wire) => new(wire);

    public override string ToString() => Wire;
}

public sealed class GestureActionTypeJsonConverter : JsonConverter<GestureActionType>
{
    public override GestureActionType Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        GestureActionType.FromWire(reader.GetString() ?? string.Empty);

    public override void Write(Utf8JsonWriter writer, GestureActionType value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.Wire);
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum GestureActionKind
{
    [JsonStringEnumMemberName("switch-workspace")] SwitchWorkspace,
    [JsonStringEnumMemberName("toggle-overview")] ToggleOverview,
    [JsonStringEnumMemberName("show-desktop")] ShowDesktop,
    [JsonStringEnumMemberName("swap-pair")] SwapPair,
    [JsonStringEnumMemberName("custom")] Custom,
    [JsonStringEnumMemberName("none")] None,
}

public sealed record GestureAction
{
    [JsonPropertyName("type")] public required GestureActionKind Type { get; init; }

    [JsonPropertyName("direction")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public GestureDirection? Direction { get; init; }

    [JsonPropertyName("action")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Action { get; init; }

    /// <summary>
    /// The shared below-threshold/cancel answer. The TypeScript freezes the
    /// singleton so one caller mutating the object cannot corrupt what every later
    /// completion returns; the record is immutable, so the same guarantee holds.
    /// </summary>
    public static readonly GestureAction NoneAction = new() { Type = GestureActionKind.None };
}

/// <summary>
/// Pure gesture state machine (§41.2). All decisions live here; the adapter
/// only feeds events. <c>SimulateGesture</c> drives this exact code path (§41.1).
/// </summary>
public static class Gestures
{
    private const string CustomPrefix = "custom:";

    public static GestureState InitialGestureState() => new();

    /// <summary>Travel in logical pixels required to trigger. Higher sensitivity, lower threshold.</summary>
    public static double GestureThreshold(double sensitivity)
    {
        var clamped = Math.Min(100, Math.Max(0, sensitivity));
        return Math.Max(40, 200 - 2 * clamped);
    }

    private static bool IsHorizontal(GestureKind kind) =>
        kind is GestureKind.Swipe3Horizontal or GestureKind.Swipe4Horizontal;

    private static bool IsPinch(GestureKind kind) => kind is GestureKind.PinchIn or GestureKind.PinchOut;

    /// <summary>Travel distance that decides whether a completed gesture triggered.</summary>
    private static double Travelled(GestureKind kind, GestureState state)
    {
        if (IsHorizontal(kind)) return Math.Abs(state.AccumulatedX);
        if (IsPinch(kind)) return Math.Max(Math.Abs(state.AccumulatedX), Math.Abs(state.AccumulatedY));
        return Math.Abs(state.AccumulatedY);
    }

    private static void Reset(GestureState state)
    {
        state.ActiveKind = null;
        state.StartX = 0;
        state.StartY = 0;
        state.AccumulatedX = 0;
        state.AccumulatedY = 0;
        state.TouchPoints = 0;
        state.Phase = GesturePhase.Cancel;
        state.StartedAtUs = 0;
    }

    /// <summary>
    /// The action GNOME Shell performs for a gesture on its own (§41.5). GNOME's
    /// swipe tracker accepts three <b>or more</b> fingers for the horizontal
    /// workspace switch and the vertical overview toggle; it has no system pinch
    /// action. (Kept verbatim for the Windows port: the gesture module is the
    /// reference state machine, not platform policy.)
    /// </summary>
    public static GestureActionType NativeAction(GestureKind kind) => kind switch
    {
        GestureKind.Swipe3Horizontal or GestureKind.Swipe4Horizontal => GestureActionType.SwitchWorkspace,
        GestureKind.Swipe3Vertical or GestureKind.Swipe4Vertical => GestureActionType.ToggleOverview,
        _ => GestureActionType.None,
    };

    /// <summary>
    /// Whether adrt must intercept <paramref name="kind"/>. A matching action is
    /// left to GNOME so its swipe tracker can follow the fingers. <c>none</c> also
    /// defers: it means "no adrt action", and consuming a gesture only to do
    /// nothing would silently disable GNOME's built-in behaviour; the master
    /// <c>gesture-enabled</c> toggle is the way to turn gestures off.
    /// </summary>
    public static bool OwnsGesture(GestureKind kind, GestureConfig config)
    {
        var action = ActionFor(kind, config);
        return action != GestureActionType.None && action != NativeAction(kind);
    }

    private static GestureActionType ActionFor(GestureKind kind, GestureConfig config) => kind switch
    {
        GestureKind.Swipe3Horizontal => config.Swipe3Horizontal,
        GestureKind.Swipe3Vertical => config.Swipe3Vertical,
        GestureKind.Swipe4Horizontal => config.Swipe4Horizontal,
        GestureKind.Swipe4Vertical => config.Swipe4Vertical,
        GestureKind.PinchIn or GestureKind.PinchOut => config.PinchAction,
        _ => GestureActionType.None,
    };

    private static GestureDirection DirectionFor(GestureKind kind, GestureState state)
    {
        if (IsHorizontal(kind)) return state.AccumulatedX < 0 ? GestureDirection.Left : GestureDirection.Right;
        return state.AccumulatedY < 0 ? GestureDirection.Up : GestureDirection.Down;
    }

    private static GestureAction Resolve(GestureActionType actionType, GestureKind kind, GestureState state)
    {
        if (actionType == GestureActionType.SwitchWorkspace)
        {
            return new GestureAction
            {
                Type = GestureActionKind.SwitchWorkspace,
                Direction = DirectionFor(kind, state),
            };
        }
        if (actionType == GestureActionType.ToggleOverview)
        {
            return new GestureAction { Type = GestureActionKind.ToggleOverview };
        }
        if (actionType == GestureActionType.ShowDesktop)
        {
            return new GestureAction { Type = GestureActionKind.ShowDesktop };
        }
        if (actionType == GestureActionType.SwapPair)
        {
            return new GestureAction
            {
                Type = GestureActionKind.SwapPair,
                Direction = state.AccumulatedX < 0 ? GestureDirection.Left : GestureDirection.Right,
            };
        }
        if (actionType == GestureActionType.None) return GestureAction.NoneAction;

        var action = actionType.IsCustom ? actionType.Wire[CustomPrefix.Length..] : actionType.Wire;
        return new GestureAction { Type = GestureActionKind.Custom, Action = action };
    }

    /// <summary>
    /// Feed one event into the state machine. Returns the resolved action when a
    /// gesture completes, <c>{ type: 'none' }</c> when it completes below threshold
    /// or is cancelled, and null while a gesture is in flight or ignored.
    /// </summary>
    public static GestureAction? FeedGesture(GestureState state, GestureEvent @event, GestureConfig config)
    {
        if (!config.Enabled) return null;

        if (@event.Phase == GesturePhase.Begin)
        {
            // A second gesture while one is active is ignored (§41.6).
            if (state.ActiveKind is not null) return null;
            state.ActiveKind = @event.Kind;
            state.Phase = GesturePhase.Begin;
            state.StartX = @event.DeltaX;
            state.StartY = @event.DeltaY;
            state.AccumulatedX = @event.DeltaX;
            state.AccumulatedY = @event.DeltaY;
            state.TouchPoints = @event.TouchPoints;
            state.StartedAtUs = @event.TimestampUs;
            return null;
        }

        if (@event.Phase == GesturePhase.Cancel)
        {
            Reset(state);
            return GestureAction.NoneAction;
        }

        var active = state.ActiveKind;
        if (active is null) return null;
        // A mismatched kind belongs to a different in-flight gesture; ignore it.
        if (@event.Kind != active.Value) return null;

        if (@event.Phase == GesturePhase.Update)
        {
            state.AccumulatedX += @event.DeltaX;
            state.AccumulatedY += @event.DeltaY;
            state.Phase = GesturePhase.Update;
            state.TouchPoints = @event.TouchPoints;
            return null;
        }

        // phase === 'end'
        state.AccumulatedX += @event.DeltaX;
        state.AccumulatedY += @event.DeltaY;
        var accumulated = Travelled(active.Value, state);
        var triggered = accumulated >= GestureThreshold(config.Sensitivity);
        var action = triggered ? Resolve(ActionFor(active.Value, config), active.Value, state) : GestureAction.NoneAction;
        Reset(state);
        return action;
    }
}
