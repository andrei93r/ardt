// Port of src/core/timing.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>
/// Whether animations are enabled, the OS slow-down factor, the nominal refresh
/// rate, and an optional measured frame interval (VRR) that takes precedence
/// over the nominal rate when set.
/// </summary>
public sealed record FrameTimingOptions
{
    [JsonPropertyName("animationsEnabled")] public required bool AnimationsEnabled { get; init; }
    [JsonPropertyName("slowDownFactor")] public required double SlowDownFactor { get; init; }
    [JsonPropertyName("refreshRate")] public required double RefreshRate { get; init; }

    /// <summary>
    /// A measured frame interval (VRR): when set it takes precedence over the
    /// nominal <c>RefreshRate</c>.
    /// </summary>
    [JsonPropertyName("observedIntervalMs")] public double? ObservedIntervalMs { get; init; }
}

public sealed record ScreenTiming
{
    [JsonPropertyName("index")] public required int Index { get; init; }
    [JsonPropertyName("refreshRate")] public required double RefreshRate { get; init; }

    /// <summary><c>1000 / refreshRate</c>, raw so callers can budget against it.</summary>
    [JsonPropertyName("frameIntervalMs")] public required double FrameIntervalMs { get; init; }
}

/// <summary>The structural <c>{ index, refreshRate }</c> row <c>Timing.ResolveTiming</c> reads.</summary>
public readonly record struct ScreenRate(int Index, double RefreshRate);

public sealed record ResolvedTiming
{
    [JsonPropertyName("animationsEnabled")] public required bool AnimationsEnabled { get; init; }
    [JsonPropertyName("slowDownFactor")] public required double SlowDownFactor { get; init; }

    /// <summary>Read-only: callers hold a shared, immutable resolution and must not mutate it.</summary>
    [JsonPropertyName("screens")] public required IReadOnlyList<ScreenTiming> Screens { get; init; }

    /// <summary>
    /// The tightest nominal frame interval across every screen. Signal-sampling
    /// cadences use it so they are never slower than the fastest fixed display.
    /// </summary>
    [JsonPropertyName("baseFrameIntervalMs")] public required double BaseFrameIntervalMs { get; init; }

    /// <summary>The measured frame interval, once enough frames have been seen (VRR).</summary>
    [JsonPropertyName("observedFrameIntervalMs")] public required double? ObservedFrameIntervalMs { get; init; }

    /// <summary>Whether the OS reports adaptive sync (the experimental feature) is on.</summary>
    [JsonPropertyName("adaptiveSync")] public required bool AdaptiveSync { get; init; }

    /// <summary>Whether the measured sequence looks adaptive (spread beyond a threshold).</summary>
    [JsonPropertyName("variableRefresh")] public required bool VariableRefresh { get; init; }

    /// <summary>The interval a single-number caller should use: measured under VRR, else tightest.</summary>
    [JsonPropertyName("resolvedFrameIntervalMs")] public required double ResolvedFrameIntervalMs { get; init; }
}

/// <summary>A rolling summary of observed compositor frame intervals.</summary>
public sealed record FrameIntervalSummary
{
    [JsonPropertyName("samples")] public required int Samples { get; init; }

    /// <summary>Median observed interval, robust to a single outlier.</summary>
    [JsonPropertyName("intervalMs")] public required double IntervalMs { get; init; }

    [JsonPropertyName("minMs")] public required double MinMs { get; init; }
    [JsonPropertyName("maxMs")] public required double MaxMs { get; init; }

    /// <summary><c>(max - min) / median</c>; the spread that reveals adaptive sync.</summary>
    [JsonPropertyName("spread")] public required double Spread { get; init; }

    /// <summary>True when the spread exceeds the threshold for long enough.</summary>
    [JsonPropertyName("variable")] public required bool Variable { get; init; }
}

/// <summary>
/// Pure animation timing (§11.3, §18). No compositor imports: the adapter reads
/// the OS (the Shell's animation settings, per-screen refresh rate, observed frame
/// intervals) and feeds these functions, so the arithmetic is unit-testable and no
/// screen is assumed to be 60 Hz.
///
/// Fixed refresh (a constant 60/120/144 Hz panel): the frame interval is
/// <c>1000 / refreshRate</c> and durations are snapped to whole frames.
///
/// Variable refresh (VRR / adaptive sync): the interval is not constant, so a
/// single nominal rate is not enough. The compositor frame clock is preferred
/// (frame-clock-driven timelines and eases follow actual presentation); where a
/// number is unavoidable, <c>FrameIntervalTracker</c> keeps a rolling estimate of
/// the observed interval and <c>EffectiveIntervalMs</c> prefers it over the
/// nominal rate.
/// </summary>
public static class Timing
{
    /// <summary>Refresh rate assumed only when the compositor reports none.</summary>
    public const double DefaultRefreshRate = 60;

    /// <summary>A guard for nonsense rates from the compositor; real panels stay well inside.</summary>
    private const double MinRefreshRate = 1;

    private const double MaxRefreshRate = 1000;

    /// <summary>A frame gap larger than this is a stall, not a frame; it is not sampled.</summary>
    internal const double MaxFrameGapMs = 250;

    /// <summary>A finite, positive refresh rate, else the 60 Hz fallback.</summary>
    public static double NormalizeRefreshRate(double? refreshRate)
    {
        if (refreshRate is null || !double.IsFinite(refreshRate.Value) || refreshRate.Value <= 0)
        {
            return DefaultRefreshRate;
        }
        return Math.Min(MaxRefreshRate, Math.Max(MinRefreshRate, refreshRate.Value));
    }

    /// <summary>The frame interval for a screen, in milliseconds (<c>1000 / refreshRate</c>).</summary>
    public static double FrameIntervalMs(double? refreshRate) => 1000 / NormalizeRefreshRate(refreshRate);

    /// <summary>A positive slow-down factor, else 1 (GNOME's "no slow-down").</summary>
    public static double NormalizeSlowDownFactor(double? factor)
    {
        if (factor is null || !double.IsFinite(factor.Value) || factor.Value <= 0) return 1;
        return factor.Value;
    }

    /// <summary>
    /// Snap a duration to a whole number of compositor frames at an explicit
    /// interval (milliseconds), scaled first by <paramref name="slowDownFactor"/>.
    /// Returns the nearest whole-frame duration, so a caller handing the result to a
    /// frame-clock timeline is at most one frame off the requested length.
    /// </summary>
    public static double AlignToInterval(double durationMs, double? intervalMs, double? slowDownFactor = 1)
    {
        var requested = Math.Max(0, durationMs) * NormalizeSlowDownFactor(slowDownFactor);
        if (requested <= 0) return 0;
        var interval = intervalMs is double measured && double.IsFinite(measured) && measured > 0
            ? measured
            : FrameIntervalMs(DefaultRefreshRate);
        var frames = Math.Max(1, JsRound(requested / interval));
        return frames * interval;
    }

    /// <summary>Snap a duration to whole frames at a nominal refresh rate.</summary>
    public static double AlignToFrame(double durationMs, double? refreshRate, double? slowDownFactor = 1) =>
        AlignToInterval(durationMs, FrameIntervalMs(refreshRate), slowDownFactor);

    /// <summary>
    /// The duration an animation should actually run for: zero when the OS (or the
    /// user's adrt setting) disables animations, otherwise frame-aligned against the
    /// measured interval when one is available, else the nominal refresh rate.
    /// </summary>
    public static double EffectiveDuration(double durationMs, FrameTimingOptions options)
    {
        if (!options.AnimationsEnabled) return 0;
        var observed = options.ObservedIntervalMs;
        if (observed is double measured && double.IsFinite(measured) && measured > 0)
        {
            return AlignToInterval(durationMs, observed, options.SlowDownFactor);
        }
        return AlignToFrame(durationMs, options.RefreshRate, options.SlowDownFactor);
    }

    /// <summary>
    /// The interval a fixed timer should use: the measured interval once it has
    /// enough samples, else the nominal rate. <paramref name="minSamples"/> keeps a
    /// couple of start-up frames from being mistaken for the panel's rate.
    /// </summary>
    public static double EffectiveIntervalMs(
        double? nominalRefreshRate,
        FrameIntervalSummary? observed,
        int minSamples = 8)
    {
        if (observed is not null && observed.Samples >= minSamples && observed.IntervalMs > 0)
        {
            return observed.IntervalMs;
        }
        return FrameIntervalMs(nominalRefreshRate);
    }

    /// <summary>Derive the resolved timing property from the OS readings and screen list.</summary>
    public static ResolvedTiming ResolveTiming(
        IReadOnlyList<ScreenRate> screens,
        bool animationsEnabled,
        double? slowDownFactor,
        FrameIntervalSummary? observed = null,
        bool adaptiveSync = false)
    {
        var list = screens
            .Select(screen => new ScreenTiming
            {
                Index = screen.Index,
                RefreshRate = NormalizeRefreshRate(screen.RefreshRate),
                FrameIntervalMs = FrameIntervalMs(screen.RefreshRate),
            })
            .ToList();
        var baseFrameIntervalMs = list.Count == 0
            ? FrameIntervalMs(DefaultRefreshRate)
            : list.Min(screen => screen.FrameIntervalMs);
        var measured = observed is not null && observed.Samples > 0 ? observed : null;
        var measuredReady = measured is not null && measured.Samples >= 8;
        var observedFrameIntervalMs = measured?.IntervalMs;
        // Follow the measured interval only when the OS actually reports adaptive
        // sync; a fixed display (or a headless shell whose frame clock is not
        // vsync-limited) uses the nominal per-screen rate, which is exact there.
        var useMeasured = adaptiveSync && measuredReady;
        return new ResolvedTiming
        {
            AnimationsEnabled = animationsEnabled,
            SlowDownFactor = NormalizeSlowDownFactor(slowDownFactor),
            Screens = list,
            BaseFrameIntervalMs = baseFrameIntervalMs,
            ObservedFrameIntervalMs = observedFrameIntervalMs,
            AdaptiveSync = adaptiveSync,
            VariableRefresh = adaptiveSync && measured is not null && measured.Variable,
            ResolvedFrameIntervalMs = useMeasured && measured is not null ? measured.IntervalMs : baseFrameIntervalMs,
        };
    }

    /// <summary>The frame interval of one screen by index, falling back to the resolved one.</summary>
    public static double FrameIntervalForScreen(ResolvedTiming timing, int? screenId)
    {
        if (timing.AdaptiveSync && timing.ObservedFrameIntervalMs is not null) return timing.ObservedFrameIntervalMs.Value;
        if (screenId is null) return timing.BaseFrameIntervalMs;
        return timing.Screens.FirstOrDefault(screen => screen.Index == screenId.Value)?.FrameIntervalMs
            ?? timing.BaseFrameIntervalMs;
    }

    /// <summary>JS <c>Math.round</c>: nearest integer, halves away from zero for positives.</summary>
    private static double JsRound(double value) => Math.Floor(value + 0.5);
}

/// <summary>
/// Keep re-measuring frame intervals instead of caching a nominal rate once. Feed
/// it every compositor frame while animating; <c>Summary()</c> gives a robust median
/// and a VRR hint. Pure: no timers, no compositor access.
/// </summary>
public sealed class FrameIntervalTracker
{
    private readonly List<double> _window = [];

    /// <summary>
    /// Sorted view of <c>_window</c>, rebuilt lazily after an <c>Observe()</c>/
    /// <c>Reset()</c>. <c>Summary()</c> may be read several times between two samples
    /// (a resolve and a diagnostic dump in the same frame), so the copy+sort is paid
    /// once per sample instead of once per read; null means "stale, rebuild on next
    /// read".
    /// </summary>
    private List<double>? _sorted;

    private readonly int _capacity;
    private readonly double _variableThreshold;

    public FrameIntervalTracker(int capacity = 48, double variableThreshold = 0.15)
    {
        _capacity = Math.Max(4, capacity);
        _variableThreshold = variableThreshold;
    }

    /// <summary>Sample one frame interval; a stall or nonsense value is ignored.</summary>
    public bool Observe(double intervalMs)
    {
        if (!double.IsFinite(intervalMs) || intervalMs <= 0) return false;
        if (intervalMs > Timing.MaxFrameGapMs) return false;
        _window.Add(intervalMs);
        if (_window.Count > _capacity) _window.RemoveAt(0);
        _sorted = null;
        return true;
    }

    public int Size => _window.Count;

    public void Reset()
    {
        _window.Clear();
        _sorted = null;
    }

    /// <summary>The window in ascending order, copying and sorting at most once per sample.</summary>
    private List<double> SortedWindow()
    {
        _sorted ??= [.. _window.OrderBy(value => value)];
        return _sorted;
    }

    public FrameIntervalSummary Summary()
    {
        if (_window.Count == 0)
        {
            return new FrameIntervalSummary
            {
                Samples = 0,
                IntervalMs = 0,
                MinMs = 0,
                MaxMs = 0,
                Spread = 0,
                Variable = false,
            };
        }
        var sorted = SortedWindow();
        var mid = sorted.Count / 2;
        var median = sorted.Count % 2 == 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        var min = sorted[0];
        var max = sorted[^1];
        var spread = median > 0 ? (max - min) / median : 0;
        return new FrameIntervalSummary
        {
            Samples = sorted.Count,
            IntervalMs = median,
            MinMs = min,
            MaxMs = max,
            Spread = spread,
            Variable = sorted.Count >= 4 && spread > _variableThreshold,
        };
    }
}
