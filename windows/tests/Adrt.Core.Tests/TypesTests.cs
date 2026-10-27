// Port of tests/core/types.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class TypesTests
{
    private static readonly Rect Area = H.Rect(0, 0, 1280, 800);

    [Fact]
    public void ReturnsUnchangedCoordinatesWhenAlreadyInside()
    {
        var rect = H.Rect(100, 100, 200, 150);
        Assert.Equal(rect, Types.ClampRectToArea(rect, Area));
    }

    [Fact]
    public void ReturnsARectTouchingEveryEdge()
    {
        var rect = H.Rect(0, 0, 1280, 800);
        Assert.Equal(rect, Types.ClampRectToArea(rect, Area));
    }

    [Fact]
    public void MovesAWindowThatHangsOffTheLeftEdgeBackInside()
    {
        Assert.Equal(H.Rect(0, 100, 400, 300), Types.ClampRectToArea(H.Rect(-200, 100, 400, 300), Area));
    }

    [Fact]
    public void MovesAWindowThatHangsOffTheTopEdgeBackInside()
    {
        Assert.Equal(H.Rect(100, 0, 400, 300), Types.ClampRectToArea(H.Rect(100, -150, 400, 300), Area));
    }

    [Fact]
    public void MovesAWindowThatHangsOffTheRightEdgeBackInside()
    {
        Assert.Equal(H.Rect(880, 100, 400, 300), Types.ClampRectToArea(H.Rect(1000, 100, 400, 300), Area));
    }

    [Fact]
    public void MovesAWindowThatHangsOffTheBottomEdgeBackInside()
    {
        Assert.Equal(H.Rect(100, 500, 400, 300), Types.ClampRectToArea(H.Rect(100, 600, 400, 300), Area));
    }

    [Fact]
    public void ShrinksAWindowLargerThanTheAreaToTheWholeArea()
    {
        Assert.Equal(H.Rect(0, 0, 1280, 800), Types.ClampRectToArea(H.Rect(-50, -50, 3000, 2000), Area));
    }

    [Fact]
    public void ShrinksOnlyTheAxisThatOverflows()
    {
        Assert.Equal(H.Rect(0, 10, 1280, 200), Types.ClampRectToArea(H.Rect(10, 10, 3000, 200), Area));
    }

    [Fact]
    public void CollapsesToAnEmptyRectAtTheAreaOriginForAZeroSizeArea()
    {
        var empty = H.Rect(50, 60, 0, 0);
        Assert.Equal(H.Rect(50, 60, 0, 0), Types.ClampRectToArea(H.Rect(-100, -100, 400, 300), empty));
    }

    [Fact]
    public void NeverReturnsANegativeWidthOrHeight()
    {
        Assert.Equal(H.Rect(10, 10, 0, 0), Types.ClampRectToArea(H.Rect(10, 10, -40, -30), Area));
    }

    [Fact]
    public void RoundsAnAdjustedRectToIntegerCoordinates()
    {
        Assert.Equal(H.Rect(0, 21, 301, 201), Types.ClampRectToArea(H.Rect(-10.4, 20.6, 300.5, 200.5), Area));
    }

    [Fact]
    public void AccountsForAMonitorThatDoesNotStartAtTheOrigin()
    {
        var offset = H.Rect(1920, 0, 1280, 800);
        Assert.Equal(H.Rect(1920, 50, 400, 300), Types.ClampRectToArea(H.Rect(1800, 50, 400, 300), offset));
    }

    [Fact]
    public void LeavesARectThatPokesOutByNoMoreThanTheToleranceAlone()
    {
        var work = H.Rect(0, 34, 1920, 1166);
        var frame = H.Rect(962, 34, 960, 1167);
        Assert.NotEqual(frame, Types.ClampRectToArea(frame, work));
        Assert.Equal(frame, Types.ClampRectToArea(frame, work, 4));
    }

    [Fact]
    public void StillClampsARectThatIsReallyOutsideTheArea()
    {
        var work = H.Rect(0, 34, 1920, 1166);
        var off = H.Rect(2000, 34, 400, 300);
        Assert.Equal(H.Rect(1520, 34, 400, 300), Types.ClampRectToArea(off, work, 4));
    }
}
