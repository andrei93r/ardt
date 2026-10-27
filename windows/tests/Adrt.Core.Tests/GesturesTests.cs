// Port of tests/core/gestures.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class GesturesTests
{
    private static GestureConfig Config(
        bool enabled = true,
        string swipe3Horizontal = "switch-workspace",
        string swipe3Vertical = "toggle-overview",
        string swipe4Horizontal = "switch-workspace",
        string swipe4Vertical = "none",
        string pinchAction = "show-desktop",
        double sensitivity = 50) => new()
        {
            Enabled = enabled,
            Swipe3Horizontal = GestureActionType.FromWire(swipe3Horizontal),
            Swipe3Vertical = GestureActionType.FromWire(swipe3Vertical),
            Swipe4Horizontal = GestureActionType.FromWire(swipe4Horizontal),
            Swipe4Vertical = GestureActionType.FromWire(swipe4Vertical),
            PinchAction = GestureActionType.FromWire(pinchAction),
            Sensitivity = sensitivity,
        };

    private static GestureEvent Event(
        GestureKind kind, GesturePhase phase, double deltaX = 0, double deltaY = 0) => new()
        {
            Kind = kind,
            Phase = phase,
            Progress = 0,
            DeltaX = deltaX,
            DeltaY = deltaY,
            Direction = null,
            TouchPoints = 3,
            TimestampUs = 1,
        };

    private static GestureAction? Swipe(GestureKind kind, double dx, double dy, GestureConfig? cfg = null)
    {
        cfg ??= Config();
        var state = Gestures.InitialGestureState();
        Assert.Null(Gestures.FeedGesture(state, Event(kind, GesturePhase.Begin), cfg));
        Assert.Null(Gestures.FeedGesture(state, Event(kind, GesturePhase.Update, dx, dy), cfg));
        return Gestures.FeedGesture(state, Event(kind, GesturePhase.End), cfg);
    }

    private static void AssertAction(GestureActionKind type, GestureAction? action, GestureDirection? direction = null, string? custom = null)
    {
        Assert.NotNull(action);
        Assert.Equal(type, action!.Type);
        Assert.Equal(direction, action.Direction);
        Assert.Equal(custom, action.Action);
    }

    [Fact]
    public void LeavesGnomeOwned3And4FingerSwipesToGnome()
    {
        var cfg = Config();
        Assert.Equal(GestureActionType.SwitchWorkspace, Gestures.NativeAction(GestureKind.Swipe3Horizontal));
        Assert.Equal(GestureActionType.ToggleOverview, Gestures.NativeAction(GestureKind.Swipe3Vertical));
        Assert.Equal(GestureActionType.SwitchWorkspace, Gestures.NativeAction(GestureKind.Swipe4Horizontal));
        Assert.Equal(GestureActionType.ToggleOverview, Gestures.NativeAction(GestureKind.Swipe4Vertical));
        Assert.False(Gestures.OwnsGesture(GestureKind.Swipe3Horizontal, cfg));
        Assert.False(Gestures.OwnsGesture(GestureKind.Swipe3Vertical, cfg));
        Assert.False(Gestures.OwnsGesture(GestureKind.Swipe4Horizontal, cfg));
        Assert.False(Gestures.OwnsGesture(GestureKind.Swipe4Vertical, cfg));
    }

    [Fact]
    public void KeepsAdrtOnlyGesturesAndCustomActions()
    {
        Assert.True(Gestures.OwnsGesture(GestureKind.PinchIn, Config()));
        Assert.True(Gestures.OwnsGesture(GestureKind.PinchOut, Config()));
        Assert.True(Gestures.OwnsGesture(GestureKind.Swipe3Horizontal, Config(swipe3Horizontal: "swap-pair")));
        Assert.True(Gestures.OwnsGesture(GestureKind.Swipe4Vertical, Config(swipe4Vertical: "show-desktop")));
    }

    [Fact]
    public void TreatsNoneAsNoOverrideLeavingTheGestureToGnome()
    {
        Assert.False(Gestures.OwnsGesture(GestureKind.Swipe3Horizontal, Config(swipe3Horizontal: "none")));
        Assert.False(Gestures.OwnsGesture(GestureKind.PinchIn, Config(pinchAction: "none")));
    }

    [Fact]
    public void SwitchesWorkspaceLeftRightOnA3FingerHorizontalSwipe()
    {
        AssertAction(GestureActionKind.SwitchWorkspace, Swipe(GestureKind.Swipe3Horizontal, 300, 0), GestureDirection.Right);
        AssertAction(GestureActionKind.SwitchWorkspace, Swipe(GestureKind.Swipe3Horizontal, -300, 0), GestureDirection.Left);
    }

    [Fact]
    public void TogglesTheOverviewOnA3FingerVerticalSwipe()
    {
        AssertAction(GestureActionKind.ToggleOverview, Swipe(GestureKind.Swipe3Vertical, 0, 300));
    }

    [Fact]
    public void ReturnsNoneBelowTheSensitivityThreshold()
    {
        AssertAction(GestureActionKind.None, Swipe(GestureKind.Swipe3Horizontal, 10, 0));
    }

    [Fact]
    public void ResetsStateAfterCompletion()
    {
        var state = Gestures.InitialGestureState();
        var cfg = Config();
        Gestures.FeedGesture(state, Event(GestureKind.Swipe3Horizontal, GesturePhase.Begin), cfg);
        Gestures.FeedGesture(state, Event(GestureKind.Swipe3Horizontal, GesturePhase.Update, 300, 0), cfg);
        Gestures.FeedGesture(state, Event(GestureKind.Swipe3Horizontal, GesturePhase.End), cfg);
        Assert.Null(state.ActiveKind);
        Assert.Equal(0, state.AccumulatedX);
        Assert.Equal(GesturePhase.Cancel, state.Phase);
    }

    [Fact]
    public void HandsOutTheSharedNoneActionForLaterCalls()
    {
        var cancelled = Gestures.FeedGesture(
            Gestures.InitialGestureState(), Event(GestureKind.Swipe3Horizontal, GesturePhase.Cancel), Config());
        AssertAction(GestureActionKind.None, cancelled);
        var belowThreshold = Swipe(GestureKind.Swipe3Horizontal, 5, 0);
        AssertAction(GestureActionKind.None, belowThreshold);
        Assert.Same(cancelled, belowThreshold);
    }

    [Fact]
    public void ReturnsNoneAndResetsOnCancel()
    {
        var state = Gestures.InitialGestureState();
        var cfg = Config();
        Gestures.FeedGesture(state, Event(GestureKind.Swipe3Horizontal, GesturePhase.Begin), cfg);
        Gestures.FeedGesture(state, Event(GestureKind.Swipe3Horizontal, GesturePhase.Update, 250, 0), cfg);
        AssertAction(GestureActionKind.None, Gestures.FeedGesture(state, Event(GestureKind.Swipe3Horizontal, GesturePhase.Cancel), cfg));
        Assert.Null(state.ActiveKind);
    }

    [Fact]
    public void IgnoresASecondOverlappingGesture()
    {
        var state = Gestures.InitialGestureState();
        var cfg = Config();
        Gestures.FeedGesture(state, Event(GestureKind.Swipe3Horizontal, GesturePhase.Begin), cfg);
        Assert.Null(Gestures.FeedGesture(state, Event(GestureKind.Swipe3Vertical, GesturePhase.Begin), cfg));
        Assert.Equal(GestureKind.Swipe3Horizontal, state.ActiveKind);
        Assert.Null(Gestures.FeedGesture(state, Event(GestureKind.Swipe3Vertical, GesturePhase.Update, 0, 300), cfg));
        Assert.Null(Gestures.FeedGesture(state, Event(GestureKind.Swipe3Vertical, GesturePhase.End), cfg));
        AssertAction(
            GestureActionKind.SwitchWorkspace,
            Gestures.FeedGesture(state, Event(GestureKind.Swipe3Horizontal, GesturePhase.End, 300, 0), cfg),
            GestureDirection.Right);
    }

    [Fact]
    public void DoesNothingWhenDisabled()
    {
        var state = Gestures.InitialGestureState();
        var cfg = Config(enabled: false);
        Assert.Null(Gestures.FeedGesture(state, Event(GestureKind.Swipe3Horizontal, GesturePhase.Begin), cfg));
        Assert.Null(Gestures.FeedGesture(state, Event(GestureKind.Swipe3Horizontal, GesturePhase.Update, 400, 0), cfg));
        Assert.Null(Gestures.FeedGesture(state, Event(GestureKind.Swipe3Horizontal, GesturePhase.End, 400, 0), cfg));
    }

    [Fact]
    public void RespectsSensitivity()
    {
        Assert.Equal(200, Gestures.GestureThreshold(0));
        Assert.Equal(40, Gestures.GestureThreshold(100));
        AssertAction(
            GestureActionKind.None,
            Swipe(GestureKind.Swipe4Horizontal, 150, 0, Config(sensitivity: 0)));
        AssertAction(
            GestureActionKind.SwitchWorkspace,
            Swipe(GestureKind.Swipe4Horizontal, 250, 0, Config(sensitivity: 100)),
            GestureDirection.Right);
    }

    public static TheoryData<GestureKind, string, string> ActionCases => new()
    {
        { GestureKind.Swipe3Horizontal, "toggle-overview", "toggle-overview" },
        { GestureKind.Swipe3Vertical, "show-desktop", "show-desktop" },
        { GestureKind.Swipe4Horizontal, "swap-pair", "swap-pair" },
        { GestureKind.Swipe4Vertical, "switch-workspace", "switch-workspace" },
        { GestureKind.PinchIn, "show-desktop", "show-desktop" },
        { GestureKind.PinchOut, "toggle-overview", "toggle-overview" },
    };

    [Theory]
    [MemberData(nameof(ActionCases))]
    public void MapsAGestureToTheConfiguredAction(GestureKind kind, string action, string expectedType)
    {
        var cfg = kind switch
        {
            GestureKind.Swipe3Horizontal => Config(swipe3Horizontal: action),
            GestureKind.Swipe3Vertical => Config(swipe3Vertical: action),
            GestureKind.Swipe4Horizontal => Config(swipe4Horizontal: action),
            GestureKind.Swipe4Vertical => Config(swipe4Vertical: action),
            _ => Config(pinchAction: action),
        };
        var horizontal = kind is GestureKind.Swipe3Horizontal or GestureKind.Swipe4Horizontal;
        var vertical = kind is GestureKind.Swipe3Vertical or GestureKind.Swipe4Vertical;
        var dx = kind is GestureKind.PinchIn or GestureKind.PinchOut
            ? (kind == GestureKind.PinchOut ? 400 : -400)
            : horizontal ? -400 : 0;
        var dy = vertical ? 400 : 0;
        var result = Swipe(kind, dx, dy, cfg);
        Assert.Equal(GestureActionType.FromWire(expectedType), GestureActionType.FromWire(ActionWireOf(result!)));
    }

    private static string ActionWireOf(GestureAction action) => action.Type switch
    {
        GestureActionKind.SwitchWorkspace => "switch-workspace",
        GestureActionKind.ToggleOverview => "toggle-overview",
        GestureActionKind.ShowDesktop => "show-desktop",
        GestureActionKind.SwapPair => "swap-pair",
        GestureActionKind.Custom => $"custom:{action.Action}",
        _ => "none",
    };

    [Fact]
    public void SupportsCustomActions()
    {
        AssertAction(
            GestureActionKind.Custom,
            Swipe(GestureKind.Swipe3Horizontal, 300, 0, Config(swipe3Horizontal: "custom:do-a-thing")),
            custom: "do-a-thing");
    }

    [Fact]
    public void HandlesAnEndWithoutAnActiveGesture()
    {
        Assert.Null(Gestures.FeedGesture(
            Gestures.InitialGestureState(), Event(GestureKind.Swipe3Horizontal, GesturePhase.End, 400, 0), Config()));
    }
}
