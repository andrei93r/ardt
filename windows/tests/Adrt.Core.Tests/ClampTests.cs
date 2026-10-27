// Port of tests/core/clamp.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class ClampTests
{
    private static ClampCandidate Candidate(
        bool ready = true,
        bool routePending = false,
        bool fullscreen = false,
        bool minimized = false,
        bool maximized = false,
        bool stubborn = false,
        bool settling = false,
        Rect? frame = null) => new()
        {
            Ready = ready,
            RoutePending = routePending,
            Fullscreen = fullscreen,
            Minimized = minimized,
            Maximized = maximized,
            Stubborn = stubborn,
            Settling = settling,
            Frame = frame ?? H.Rect(-200, -150, 400, 300),
        };

    [Fact]
    public void ClampsAnAdoptedFloatThatHangsOffTheScreen()
    {
        Assert.True(Clamp.ShouldClampWindow(Candidate()));
    }

    [Fact]
    public void NeverClampsAWindowThatIsNotAdoptedYet()
    {
        Assert.False(Clamp.ShouldClampWindow(Candidate(ready: false, frame: H.Rect(0, 0, 0, 0))));
    }

    [Fact]
    public void NeverClampsANewcomerWhosePlacementIsStillPending()
    {
        Assert.False(Clamp.ShouldClampWindow(Candidate(routePending: true)));
    }

    [Fact]
    public void NeverClampsADegenerateFrame()
    {
        Assert.False(Clamp.ShouldClampWindow(Candidate(frame: H.Rect(0, 0, 0, 0))));
        Assert.False(Clamp.ShouldClampWindow(Candidate(frame: H.Rect(100, 100, 0, 300))));
        Assert.False(Clamp.ShouldClampWindow(Candidate(frame: H.Rect(100, 100, 400, 0))));
    }

    [Fact]
    public void LeavesFullscreenMinimizedAndStubbornWindowsAlone()
    {
        Assert.False(Clamp.ShouldClampWindow(Candidate(fullscreen: true)));
        Assert.False(Clamp.ShouldClampWindow(Candidate(minimized: true)));
        Assert.False(Clamp.ShouldClampWindow(Candidate(stubborn: true)));
    }

    [Fact]
    public void NeverClampsAMaximizedWindow()
    {
        var maximizedFrame = H.Rect(0, 34, 1922, 1167);
        Assert.False(Clamp.ShouldClampWindow(Candidate(maximized: true, frame: maximizedFrame)));
    }

    [Fact]
    public void NeverClampsAWindowTheTilerIsMidTransitionFor()
    {
        Assert.False(Clamp.ShouldClampWindow(Candidate(settling: true)));
        Assert.False(Clamp.ShouldClampWindow(Candidate(settling: true, frame: H.Rect(1440, 679, 1372, 1462))));
    }

    [Fact]
    public void StillClampsAnOffScreenFloatOnceTheApplyHasLanded()
    {
        Assert.True(Clamp.ShouldClampWindow(Candidate(settling: false)));
    }

    [Fact]
    public void ClampToleranceIsFourPixels()
    {
        Assert.Equal(4, Clamp.ClampTolerancePx);
    }
}
