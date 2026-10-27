// Port of tests/core/adjust.test.ts, cursor.test.ts, windowmove.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class AdjustTests
{
    private static readonly Rect Start = H.Rect(8, 40, 628, 752);

    [Fact]
    public void ReadsAHorizontalInnerEdgeDragAsAResize()
    {
        Assert.Equal(AdjustMode.Resize, Adjust.ClassifyAdjust(Start, H.Rect(8, 40, 700, 752)));
        Assert.Equal(AdjustMode.Resize, Adjust.ClassifyAdjust(H.Rect(100, 40, 500, 752), H.Rect(8, 40, 592, 752)));
    }

    [Fact]
    public void ReadsAVerticalInnerEdgeDragAsAResize()
    {
        Assert.Equal(AdjustMode.Resize, Adjust.ClassifyAdjust(H.Rect(8, 40, 628, 752), H.Rect(8, 40, 628, 900)));
    }

    [Fact]
    public void ReadsAPureTranslationAsAMove()
    {
        Assert.Equal(AdjustMode.Move, Adjust.ClassifyAdjust(Start, H.Rect(300, 200, 628, 752)));
    }

    [Fact]
    public void ReadsAnOverviewDropThatScalesTheWindowAsAMove()
    {
        Assert.Equal(AdjustMode.Move, Adjust.ClassifyAdjust(Start, H.Rect(100, 100, 400, 480)));
    }

    [Fact]
    public void ReadsACompositorClampedMoveAsAMove()
    {
        Assert.Equal(AdjustMode.Move, Adjust.ClassifyAdjust(Start, H.Rect(-40, 40, 628, 752)));
    }

    [Fact]
    public void ReadsANoOpAsAMove()
    {
        Assert.Equal(AdjustMode.Move, Adjust.ClassifyAdjust(Start, H.Rect(8, 40, 628, 752)));
        Assert.Equal(AdjustMode.Move, Adjust.ClassifyAdjust(Start, H.Rect(10, 42, 630, 754)));
    }
}

public class CursorTests
{
    private static readonly Rect WorkArea = H.Rect(0, 0, 1920, 1080);
    private static readonly Rect SecondWorkArea = H.Rect(1920, 0, 1280, 800);

    [Fact]
    public void RectCentreIsTheMidpointOfAnEvenSizedRect()
    {
        Assert.Equal(new Point(480, 540), Cursor.RectCentre(H.Rect(0, 0, 960, 1080)));
    }

    [Fact]
    public void RectCentreRoundsAnOddSizedRectToTheNearerPixel()
    {
        Assert.Equal(new Point(481, 271), Cursor.RectCentre(H.Rect(0, 0, 961, 541)));
    }

    [Fact]
    public void RectCentreRespectsANonZeroOrigin()
    {
        Assert.Equal(new Point(2560, 400), Cursor.RectCentre(H.Rect(1920, 0, 1280, 800)));
    }

    [Fact]
    public void CentreInWorkAreaReturnsTheCentreOfAWindowInsideTheWorkArea()
    {
        Assert.Equal(new Point(1440, 540), Cursor.CentreInWorkArea(H.Rect(960, 0, 960, 1080), WorkArea));
    }

    [Fact]
    public void CentreInWorkAreaClampsTheTargetInsideTheWorkAreaWhenTheRectHangsOffIt()
    {
        Assert.Equal(new Point(1919, 1079), Cursor.CentreInWorkArea(H.Rect(1680, 900, 1440, 1080), WorkArea));
    }

    [Fact]
    public void CentreInWorkAreaClampsToTheAreaOriginForARectEntirelyBeforeIt()
    {
        Assert.Equal(new Point(0, 0), Cursor.CentreInWorkArea(H.Rect(-500, -400, 200, 200), WorkArea));
    }

    [Fact]
    public void CentreInWorkAreaClampsInsideAWorkAreaWithANonZeroOrigin()
    {
        Assert.Equal(new Point(3080, 799), Cursor.CentreInWorkArea(H.Rect(2880, 900, 400, 400), SecondWorkArea));
    }

    [Fact]
    public void CentreInWorkAreaLeavesAPointInANonPositiveAreaUnclamped()
    {
        Assert.Equal(new Point(60, 60), Cursor.CentreInWorkArea(H.Rect(10, 10, 100, 100), H.Rect(0, 0, 0, 0)));
    }
}

public class WindowMoveTests
{
    private static DragIsWindowMoveInput Input(bool ready, bool routePending) => new(ready, routePending);

    [Fact]
    public void AGrabOnAPlacedRoutedWindowIsAWindowMove()
    {
        Assert.True(WindowMove.DragIsWindowMove(Input(true, false)));
    }

    [Fact]
    public void AGrabOnAWindowAdrtHasNotAdoptedYetIsATabTearOff()
    {
        Assert.False(WindowMove.DragIsWindowMove(Input(false, false)));
    }

    [Fact]
    public void AGrabOnAReadyWindowWhoseRoutingIsStillPendingIsATearOff()
    {
        Assert.False(WindowMove.DragIsWindowMove(Input(true, true)));
    }

    [Fact]
    public void AGrabBeforeAdoptionAndBeforeRoutingIsATearOff()
    {
        Assert.False(WindowMove.DragIsWindowMove(Input(false, true)));
    }
}
