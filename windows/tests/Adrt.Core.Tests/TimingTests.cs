// Port of tests/core/timing.test.ts.
using Adrt.Core;
using Xunit;

namespace Adrt.Core.Tests;

public class TimingTests
{
    [Fact]
    public void FrameIntervalMsDerivesTheIntervalFromFixedRefreshRatesNeverAssuming60()
    {
        Assert.Equal(16.6667, Timing.FrameIntervalMs(60), 3);
        Assert.Equal(8.3333, Timing.FrameIntervalMs(120), 3);
        Assert.Equal(6.9444, Timing.FrameIntervalMs(144), 3);
        Assert.Equal(4.1667, Timing.FrameIntervalMs(240), 3);
    }

    [Fact]
    public void FrameIntervalMsFallsBackTo60HzForMissingOrNonsensicalRates()
    {
        Assert.Equal(Timing.DefaultRefreshRate, Timing.NormalizeRefreshRate(null));
        Assert.Equal(Timing.DefaultRefreshRate, Timing.NormalizeRefreshRate(0));
        Assert.Equal(Timing.DefaultRefreshRate, Timing.NormalizeRefreshRate(-120));
        Assert.Equal(Timing.DefaultRefreshRate, Timing.NormalizeRefreshRate(double.NaN));
        Assert.Equal(1000.0 / 60, Timing.FrameIntervalMs(0), 5);
    }

    [Fact]
    public void AlignToFrameSnapsADurationToWholeFramesAtAFixedRate()
    {
        var aligned60 = Timing.AlignToFrame(180, 60);
        Assert.Equal(Math.Floor(aligned60 / Timing.FrameIntervalMs(60) + 0.5), aligned60 / Timing.FrameIntervalMs(60), 6);
        Assert.True(Math.Abs(aligned60 - 180) <= Timing.FrameIntervalMs(60));

        var aligned144 = Timing.AlignToFrame(180, 144);
        Assert.Equal(Math.Floor(aligned144 / Timing.FrameIntervalMs(144) + 0.5), aligned144 / Timing.FrameIntervalMs(144), 6);
        Assert.True(Math.Abs(aligned144 - 180) <= Timing.FrameIntervalMs(144));
    }

    [Fact]
    public void AlignToFrameNeverReturnsLessThanOneFrameForAPositiveDuration()
    {
        Assert.Equal(Timing.FrameIntervalMs(60), Timing.AlignToFrame(0.1, 60), 6);
    }

    [Fact]
    public void AlignToFrameMapsAZeroDurationToZero()
    {
        Assert.Equal(0, Timing.AlignToFrame(0, 144));
        Assert.Equal(0, Timing.AlignToInterval(0, 6.944));
    }

    [Fact]
    public void AlignToFrameScalesByTheOsSlowDownFactor()
    {
        var normal = Timing.AlignToFrame(150, 60, 1);
        var slowed = Timing.AlignToFrame(150, 60, 2);
        Assert.Equal(normal * 2, slowed, 0);
        Assert.Equal(1, Timing.NormalizeSlowDownFactor(0));
        Assert.Equal(1, Timing.NormalizeSlowDownFactor(double.NaN));
        Assert.Equal(normal, Timing.AlignToFrame(150, 60, 0));
    }

    private static FrameTimingOptions Options(
        bool animationsEnabled, double slowDownFactor, double refreshRate, double? observedIntervalMs = null) => new()
        {
            AnimationsEnabled = animationsEnabled,
            SlowDownFactor = slowDownFactor,
            RefreshRate = refreshRate,
            ObservedIntervalMs = observedIntervalMs,
        };

    [Fact]
    public void EffectiveDurationIsInstantWhenAnimationsAreDisabled()
    {
        Assert.Equal(0, Timing.EffectiveDuration(180, Options(false, 1, 60)));
        Assert.Equal(0, Timing.EffectiveDuration(180, Options(false, 2, 144)));
    }

    [Fact]
    public void EffectiveDurationIsFrameAlignedWhenAnimationsAreEnabled()
    {
        var at120 = Timing.EffectiveDuration(180, Options(true, 1, 120));
        Assert.Equal(
            Math.Floor(at120 / Timing.FrameIntervalMs(120) + 0.5),
            at120 / Timing.FrameIntervalMs(120),
            6);
    }

    [Fact]
    public void EffectiveDurationPrefersAMeasuredIntervalOverTheNominalRate()
    {
        const double measured = 11.1;
        var duration = Timing.EffectiveDuration(111, Options(true, 1, 60, measured));
        Assert.Equal(10, duration / measured, 6);
        Assert.True(Math.Abs(duration - Timing.AlignToFrame(111, 60)) > 1e-6);
    }

    [Fact]
    public void FrameIntervalTrackerReportsAStableIntervalForAFixedRefreshRate()
    {
        var tracker = new FrameIntervalTracker();
        for (var i = 0; i < 12; i++) tracker.Observe(16.7);
        var summary = tracker.Summary();
        Assert.Equal(12, summary.Samples);
        Assert.Equal(16.7, summary.IntervalMs, 3);
        Assert.Equal(0, summary.Spread);
        Assert.False(summary.Variable);
    }

    [Fact]
    public void FrameIntervalTrackerDetectsAVaryingAdaptiveSyncSequence()
    {
        var tracker = new FrameIntervalTracker();
        foreach (var interval in new[] { 8.3, 11.1, 13.9, 16.7, 8.3, 11.1, 13.9, 16.7 }) tracker.Observe(interval);
        var summary = tracker.Summary();
        Assert.True(summary.Variable);
        Assert.True(summary.Spread > 0.15);
        Assert.Equal((11.1 + 13.9) / 2, summary.IntervalMs, 3);
    }

    [Fact]
    public void FrameIntervalTrackerRejectsStallsAndNonsenseInsteadOfLearningThem()
    {
        var tracker = new FrameIntervalTracker();
        Assert.False(tracker.Observe(0));
        Assert.False(tracker.Observe(double.NaN));
        Assert.False(tracker.Observe(500));
        Assert.Equal(0, tracker.Size);
    }

    [Fact]
    public void FrameIntervalTrackerKeepsReMeasuringInsteadOfCachingTheFirstWindow()
    {
        var tracker = new FrameIntervalTracker(capacity: 4);
        for (var i = 0; i < 4; i++) tracker.Observe(16.7);
        Assert.Equal(16.7, tracker.Summary().IntervalMs, 3);
        for (var i = 0; i < 4; i++) tracker.Observe(8.3);
        Assert.Equal(8.3, tracker.Summary().IntervalMs, 3);
    }

    [Fact]
    public void FrameIntervalTrackerReportsTheExactMinMedianMaxSpreadOfTheWindow()
    {
        var even = new FrameIntervalTracker();
        foreach (var interval in new double[] { 30, 10, 20, 40 }) even.Observe(interval);
        var evenSummary = even.Summary();
        Assert.Equal(4, evenSummary.Samples);
        Assert.Equal(25, evenSummary.IntervalMs);
        Assert.Equal(10, evenSummary.MinMs);
        Assert.Equal(40, evenSummary.MaxMs);
        Assert.Equal(1.2, evenSummary.Spread, 6);
        Assert.True(evenSummary.Variable);

        var odd = new FrameIntervalTracker();
        foreach (var interval in new double[] { 3, 1, 2 }) odd.Observe(interval);
        var oddSummary = odd.Summary();
        Assert.Equal(2, oddSummary.IntervalMs);
        Assert.Equal(1, oddSummary.MinMs);
        Assert.Equal(3, oddSummary.MaxMs);
        Assert.Equal(1, oddSummary.Spread, 6);
        Assert.False(oddSummary.Variable);
    }

    [Fact]
    public void FrameIntervalTrackerInvalidatesTheCachedSortedViewWhenASampleIsObserved()
    {
        var tracker = new FrameIntervalTracker(capacity: 4);
        foreach (var interval in new double[] { 30, 10, 20, 40 }) tracker.Observe(interval);
        var first = tracker.Summary();
        Assert.Equal(25, first.IntervalMs);
        Assert.Equal(first, tracker.Summary());
        tracker.Observe(5);
        var after = tracker.Summary();
        Assert.Equal(4, after.Samples);
        Assert.Equal(15, after.IntervalMs);
        Assert.Equal(5, after.MinMs);
        Assert.Equal(40, after.MaxMs);
    }

    [Fact]
    public void FrameIntervalTrackerInvalidatesTheCachedSortedViewOnReset()
    {
        var tracker = new FrameIntervalTracker();
        tracker.Observe(16.7);
        Assert.Equal(16.7, tracker.Summary().IntervalMs, 3);
        tracker.Reset();
        Assert.Equal(
            new FrameIntervalSummary
            {
                Samples = 0,
                IntervalMs = 0,
                MinMs = 0,
                MaxMs = 0,
                Spread = 0,
                Variable = false,
            },
            tracker.Summary());
        foreach (var interval in new double[] { 8, 12 }) tracker.Observe(interval);
        Assert.Equal(10, tracker.Summary().IntervalMs);
    }

    [Fact]
    public void EffectiveIntervalMsUsesTheNominalRateUntilEnoughFramesHaveBeenMeasured()
    {
        var tracker = new FrameIntervalTracker();
        tracker.Observe(11.1);
        Assert.Equal(Timing.FrameIntervalMs(60), Timing.EffectiveIntervalMs(60, tracker.Summary(), 8), 6);
        for (var i = 0; i < 10; i++) tracker.Observe(11.1);
        Assert.Equal(11.1, Timing.EffectiveIntervalMs(60, tracker.Summary(), 8), 3);
    }

    [Fact]
    public void ResolveTimingResolvesPerScreenIntervalsAndTheTightestBase()
    {
        var timing = Timing.ResolveTiming(
            new[] { new ScreenRate(0, 60), new ScreenRate(1, 144) },
            true,
            1);
        Assert.Equal(new[] { 0, 1 }, timing.Screens.Select(s => s.Index));
        Assert.Equal(16.6667, timing.Screens[0].FrameIntervalMs, 3);
        Assert.Equal(6.9444, timing.Screens[1].FrameIntervalMs, 3);
        Assert.Equal(6.9444, timing.BaseFrameIntervalMs, 3);
        Assert.True(timing.AnimationsEnabled);
        Assert.Null(timing.ObservedFrameIntervalMs);
        Assert.False(timing.VariableRefresh);
    }

    [Fact]
    public void ResolveTimingReportsAMeasuredVariableIntervalWhenOneIsAvailable()
    {
        var tracker = new FrameIntervalTracker();
        foreach (var interval in new[] { 8.3, 11.1, 13.9, 16.7, 8.3, 11.1, 13.9, 16.7 }) tracker.Observe(interval);
        var timing = Timing.ResolveTiming(
            new[] { new ScreenRate(0, 60) }, true, 1, tracker.Summary(), adaptiveSync: true);
        Assert.Equal(12.5, timing.ObservedFrameIntervalMs!.Value, 3);
        Assert.True(timing.AdaptiveSync);
        Assert.True(timing.VariableRefresh);
        Assert.Equal(12.5, timing.ResolvedFrameIntervalMs, 3);
        Assert.Equal(12.5, Timing.FrameIntervalForScreen(timing, 0), 3);
    }

    [Fact]
    public void ResolveTimingIgnoresAMeasuredIntervalWhenTheOsReportsNoAdaptiveSync()
    {
        var tracker = new FrameIntervalTracker();
        foreach (var interval in new[] { 8.3, 11.1, 13.9, 16.7, 8.3, 11.1, 13.9, 16.7 }) tracker.Observe(interval);
        var timing = Timing.ResolveTiming(
            new[] { new ScreenRate(0, 60) }, true, 1, tracker.Summary(), adaptiveSync: false);
        Assert.Equal(12.5, timing.ObservedFrameIntervalMs!.Value, 3);
        Assert.False(timing.AdaptiveSync);
        Assert.False(timing.VariableRefresh);
        Assert.Equal(Timing.FrameIntervalMs(60), timing.ResolvedFrameIntervalMs, 3);
        Assert.Equal(Timing.FrameIntervalMs(60), Timing.FrameIntervalForScreen(timing, 0), 3);
    }

    [Fact]
    public void ResolveTimingCarriesTheResolvedSlowDownFactorAndDisablesDurations()
    {
        var timing = Timing.ResolveTiming(new[] { new ScreenRate(0, 60) }, false, 3);
        Assert.Equal(3, timing.SlowDownFactor);
        Assert.False(timing.AnimationsEnabled);
        Assert.Equal(
            0,
            Timing.EffectiveDuration(180, new FrameTimingOptions
            {
                AnimationsEnabled = timing.AnimationsEnabled,
                SlowDownFactor = timing.SlowDownFactor,
                RefreshRate = timing.Screens[0].RefreshRate,
            }));
    }
}
