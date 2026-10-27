// Port of src/core/dump-schema.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>
/// §40.4 / P6c: the typed <c>DumpState</c> JSON schema.
///
/// This is the single typed description of the JSON the extension's
/// <c>DumpState</c> trigger emits. It lives in <c>core/</c> (no <c>gi://</c>, no
/// I/O) so both the Shell adapter that builds the payload and the harness/tests
/// that read it share one definition, and so the schema can be asserted in a pure
/// unit test.
///
/// The schema is add-only (§2.5): field order and the meaning of every existing
/// field are part of the harness contract. New fields are appended over time; a
/// reader must tolerate unknown extra fields. Nothing here changes the JSON — it
/// describes exactly what the diagnostics builder already emits.
/// </summary>
public static class DumpSchema
{
    /// <summary>
    /// The <c>DumpState</c> JSON schema version. It is deliberately separate from
    /// the settings/state migration version: this one tracks the diagnostic payload
    /// shape, which only changes add-only.
    /// </summary>
    public const int DumpSchemaVersion = 1;

    /// <summary>The wire value of <c>AdrtDumpState.Format</c>.</summary>
    public const string DumpStateFormat = "adrt.state";

    /// <summary>
    /// The platform literal the schema was written against. Kept verbatim so the
    /// payload stays byte-compatible with the GNOME fixtures; a Windows adapter
    /// decides its own value at the boundary.
    /// </summary>
    public const string DumpStatePlatform = "gnome";
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum TileAxis
{
    [JsonStringEnumMemberName("vertical")] Vertical,
    [JsonStringEnumMemberName("horizontal")] Horizontal,
}

/// <summary>One caught boundary error retained in the recent-errors ring (P6h).</summary>
public sealed record AdrtRecentError
{
    /// <summary>Wall-clock ms when the boundary caught it.</summary>
    [JsonPropertyName("at")] public required double At { get; init; }

    /// <summary>The boundary's context tag (e.g. <c>fault-test:drain</c>).</summary>
    [JsonPropertyName("context")] public required string Context { get; init; }

    /// <summary>The caught error's message, never empty for a real throw.</summary>
    [JsonPropertyName("message")] public required string Message { get; init; }
}

public sealed record DumpPanel
{
    [JsonPropertyName("present")] public required bool Present { get; init; }
    [JsonPropertyName("paused")] public required bool Paused { get; init; }
    [JsonPropertyName("indicatorEnabled")] public required bool IndicatorEnabled { get; init; }
    [JsonPropertyName("recording")] public required bool Recording { get; init; }
    [JsonPropertyName("pauseLabel")] public required string PauseLabel { get; init; }
    [JsonPropertyName("indicatorLabel")] public required string IndicatorLabel { get; init; }
    [JsonPropertyName("recordLabel")] public required string RecordLabel { get; init; }
}

public sealed record DumpRules
{
    [JsonPropertyName("count")] public required double Count { get; init; }
    [JsonPropertyName("errors")] public required IReadOnlyList<string> Errors { get; init; }
}

/// <summary>
/// The recorder status as carried by <c>DumpState.recording</c>.
/// <c>MaxMs</c>/<c>MaxBytes</c> are optional because the inert fallback object (no
/// recorder) omits them.
/// </summary>
public sealed record DumpRecording
{
    [JsonPropertyName("recording")] public required bool Recording { get; init; }
    [JsonPropertyName("path")] public required string? Path { get; init; }
    [JsonPropertyName("elapsedMs")] public required double ElapsedMs { get; init; }
    [JsonPropertyName("bytes")] public required double Bytes { get; init; }
    [JsonPropertyName("events")] public required double Events { get; init; }
    [JsonPropertyName("snapshots")] public required double Snapshots { get; init; }

    [JsonPropertyName("maxMs")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? MaxMs { get; init; }

    [JsonPropertyName("maxBytes")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? MaxBytes { get; init; }

    [JsonPropertyName("stopReason")] public required string? StopReason { get; init; }
    [JsonPropertyName("promptOpen")] public required bool PromptOpen { get; init; }
    [JsonPropertyName("note")] public required string Note { get; init; }

    /// <summary>
    /// The recorder's own wait flag: true while a user stop is waiting for its
    /// note. <c>PromptOpen</c> is the observable half (the prompt is on screen, or
    /// would be); this is what the journal keys the <c>stopped</c>/<c>saved</c>
    /// lifecycle states off.
    /// </summary>
    [JsonPropertyName("awaitingNote")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? AwaitingNote { get; init; }
}

public sealed record DumpWorkspaceMode
{
    [JsonPropertyName("dynamic")] public required bool Dynamic { get; init; }
    [JsonPropertyName("onlyPrimary")] public required bool OnlyPrimary { get; init; }
    [JsonPropertyName("numWorkspaces")] public required double NumWorkspaces { get; init; }
}

public sealed record DumpDebugFlags
{
    [JsonPropertyName("enabled")] public required bool Enabled { get; init; }
    [JsonPropertyName("tiling")] public required bool Tiling { get; init; }
    [JsonPropertyName("focus")] public required bool Focus { get; init; }
    [JsonPropertyName("displays")] public required bool Displays { get; init; }
    [JsonPropertyName("undo")] public required bool Undo { get; init; }
    [JsonPropertyName("session")] public required bool Session { get; init; }
}

public sealed record DumpFlags
{
    [JsonPropertyName("debug")] public required DumpDebugFlags Debug { get; init; }
    [JsonPropertyName("record")] public required bool Record { get; init; }
    [JsonPropertyName("perf")] public required bool Perf { get; init; }
}

public sealed record DumpBuild
{
    [JsonPropertyName("version")] public required string Version { get; init; }
    [JsonPropertyName("dirMtimeMs")] public required double DirMtimeMs { get; init; }
}

public sealed record DumpAnimationsBaseline
{
    [JsonPropertyName("enableAnimations")] public required bool? EnableAnimations { get; init; }
    [JsonPropertyName("slowDownFactor")] public required double? SlowDownFactor { get; init; }
}

public sealed record DumpTiming
{
    [JsonPropertyName("animationsEnabled")] public required bool AnimationsEnabled { get; init; }
    [JsonPropertyName("osAnimationsEnabled")] public required bool OsAnimationsEnabled { get; init; }
    [JsonPropertyName("reducedMotion")] public required bool ReducedMotion { get; init; }
    [JsonPropertyName("slowDownFactor")] public required double SlowDownFactor { get; init; }
    [JsonPropertyName("baseFrameIntervalMs")] public required double BaseFrameIntervalMs { get; init; }
    [JsonPropertyName("observedFrameIntervalMs")] public required double? ObservedFrameIntervalMs { get; init; }
    [JsonPropertyName("adaptiveSync")] public required bool AdaptiveSync { get; init; }
    [JsonPropertyName("variableRefresh")] public required bool VariableRefresh { get; init; }
    [JsonPropertyName("resolvedFrameIntervalMs")] public required double ResolvedFrameIntervalMs { get; init; }
    [JsonPropertyName("screens")] public required IReadOnlyList<ScreenTiming> Screens { get; init; }
    [JsonPropertyName("baseline")] public required DumpAnimationsBaseline Baseline { get; init; }
    [JsonPropertyName("mutated")] public required bool Mutated { get; init; }
    [JsonPropertyName("motionPollMs")] public required double MotionPollMs { get; init; }
    [JsonPropertyName("motionRetileTicks")] public required double MotionRetileTicks { get; init; }
    [JsonPropertyName("normaliseOnEnableMs")] public required double NormaliseOnEnableMs { get; init; }
    [JsonPropertyName("coherenceSweepMs")] public required double CoherenceSweepMs { get; init; }
    [JsonPropertyName("switchWatchdogMs")] public required double SwitchWatchdogMs { get; init; }
    [JsonPropertyName("motionSelfMs")] public required double MotionSelfMs { get; init; }
}

public sealed record DumpGaps
{
    [JsonPropertyName("base")] public required double Base { get; init; }
    [JsonPropertyName("landscape")] public required double Landscape { get; init; }
    [JsonPropertyName("portrait")] public required double Portrait { get; init; }
}

/// <summary>One window row in <c>DumpState.windows</c>.</summary>
public sealed record DumpWindow
{
    [JsonPropertyName("id")] public required int Id { get; init; }

    /// <summary>Mutter's <c>Meta.WindowType</c> (a numeric enum).</summary>
    [JsonPropertyName("windowType")] public required double WindowType { get; init; }

    [JsonPropertyName("cls")] public required string Cls { get; init; }
    [JsonPropertyName("identity")] public required string Identity { get; init; }
    [JsonPropertyName("identitySource")] public required IdentitySource IdentitySource { get; init; }
    [JsonPropertyName("provisional")] public required bool Provisional { get; init; }
    [JsonPropertyName("instanceId")] public required string InstanceId { get; init; }
    [JsonPropertyName("ordinal")] public required double? Ordinal { get; init; }
    [JsonPropertyName("neverTile")] public required bool NeverTile { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }
    [JsonPropertyName("version")] public required string Version { get; init; }
    [JsonPropertyName("workspace")] public required int Workspace { get; init; }
    [JsonPropertyName("monitor")] public required int Monitor { get; init; }
    [JsonPropertyName("rect")] public required Rect Rect { get; init; }
    [JsonPropertyName("layer")] public required Layer Layer { get; init; }
    [JsonPropertyName("z")] public required int Z { get; init; }
    [JsonPropertyName("maximized")] public required bool Maximized { get; init; }
    [JsonPropertyName("minimized")] public required bool Minimized { get; init; }
    [JsonPropertyName("fullscreen")] public required bool Fullscreen { get; init; }
    [JsonPropertyName("above")] public required bool Above { get; init; }
    [JsonPropertyName("transient")] public required bool Transient { get; init; }
    [JsonPropertyName("slot")] public required double? Slot { get; init; }
    [JsonPropertyName("axis")] public required TileAxis Axis { get; init; }
    [JsonPropertyName("tileable")] public required bool Tileable { get; init; }

    /// <summary>Why the window is not tiled; null when it is tileable.</summary>
    [JsonPropertyName("reason")] public required SkipReason? Reason { get; init; }

    [JsonPropertyName("profile")] public required string Profile { get; init; }
    [JsonPropertyName("stubborn")] public required bool Stubborn { get; init; }
    [JsonPropertyName("clamped")] public required bool Clamped { get; init; }
    [JsonPropertyName("min")] public required Size Min { get; init; }
    [JsonPropertyName("max")] public required Size Max { get; init; }
}

public sealed record DumpIndicatorPreview
{
    [JsonPropertyName("visible")] public required bool Visible { get; init; }
    [JsonPropertyName("rect")] public required Rect? Rect { get; init; }
    [JsonPropertyName("colour")] public required string Colour { get; init; }
}

public sealed record DumpIndicator
{
    [JsonPropertyName("color")] public required string Color { get; init; }
    [JsonPropertyName("width")] public required double Width { get; init; }
    [JsonPropertyName("opacity")] public required double Opacity { get; init; }
    [JsonPropertyName("radius")] public required double Radius { get; init; }
    [JsonPropertyName("stackedBelowTray")] public required bool StackedBelowTray { get; init; }
    [JsonPropertyName("pulseDurationMs")] public required double PulseDurationMs { get; init; }
    [JsonPropertyName("animationsEnabled")] public required bool AnimationsEnabled { get; init; }
    [JsonPropertyName("visible")] public required bool Visible { get; init; }
    [JsonPropertyName("ghosts")] public required double Ghosts { get; init; }
    [JsonPropertyName("suppressed")] public required IReadOnlyList<SuppressionReason> Suppressed { get; init; }
    [JsonPropertyName("preview")] public required DumpIndicatorPreview Preview { get; init; }
}

public sealed record DumpDrag
{
    [JsonPropertyName("active")] public required bool Active { get; init; }
    [JsonPropertyName("windowDrag")] public required bool WindowDrag { get; init; }
    [JsonPropertyName("clientInteraction")] public required bool ClientInteraction { get; init; }
    [JsonPropertyName("dragId")] public required int? DragId { get; init; }
    [JsonPropertyName("adjustId")] public required int? AdjustId { get; init; }
    [JsonPropertyName("button")] public required bool Button { get; init; }
    [JsonPropertyName("displayGrab")] public required bool? DisplayGrab { get; init; }
}

public sealed record DumpSessionPerf
{
    [JsonPropertyName("lastReconcileMs")] public required double LastReconcileMs { get; init; }
    [JsonPropertyName("lastApplyMs")] public required double LastApplyMs { get; init; }
    [JsonPropertyName("lastApplyAtMs")] public required double LastApplyAtMs { get; init; }
}

public sealed record DumpPerfSectionStat
{
    [JsonPropertyName("count")] public required double Count { get; init; }
    [JsonPropertyName("totalMs")] public required double TotalMs { get; init; }
}

public sealed record DumpPerfStats
{
    [JsonPropertyName("queueDepth")] public required double QueueDepth { get; init; }
    [JsonPropertyName("drains")] public required double Drains { get; init; }
    [JsonPropertyName("drainMsP50")] public required double DrainMsP50 { get; init; }
    [JsonPropertyName("drainMsP95")] public required double DrainMsP95 { get; init; }
    [JsonPropertyName("applyMsP50")] public required double ApplyMsP50 { get; init; }
    [JsonPropertyName("applyMsP95")] public required double ApplyMsP95 { get; init; }

    /// <summary>Empty while the <c>trace-enabled</c> gate never turned the probe on.</summary>
    [JsonPropertyName("sections")]
    public required Dictionary<string, DumpPerfSectionStat> Sections { get; init; }
}

/// <summary>The stage-0 counters plus the settings/tiling/host/history counters.</summary>
public sealed record DumpCounters
{
    [JsonPropertyName("sweeps")] public required double Sweeps { get; init; }
    [JsonPropertyName("sweepMsMax")] public required double SweepMsMax { get; init; }
    [JsonPropertyName("sweepMsAvg")] public required double SweepMsAvg { get; init; }
    [JsonPropertyName("classifyCalls")] public required double ClassifyCalls { get; init; }
    [JsonPropertyName("classifyMisses")] public required double ClassifyMisses { get; init; }
    [JsonPropertyName("plansComputed")] public required double PlansComputed { get; init; }
    [JsonPropertyName("sweepFrameReads")] public required double SweepFrameReads { get; init; }
    [JsonPropertyName("drains")] public required double Drains { get; init; }
    [JsonPropertyName("queuePending")] public required double QueuePending { get; init; }
    [JsonPropertyName("drainMsMax")] public required double DrainMsMax { get; init; }
    [JsonPropertyName("drainMsP50")] public required double DrainMsP50 { get; init; }
    [JsonPropertyName("drainMsP95")] public required double DrainMsP95 { get; init; }
    [JsonPropertyName("applyMsP50")] public required double ApplyMsP50 { get; init; }
    [JsonPropertyName("applyMsP95")] public required double ApplyMsP95 { get; init; }
    [JsonPropertyName("applySamples")] public required double ApplySamples { get; init; }
    [JsonPropertyName("clampsApplied")] public required double ClampsApplied { get; init; }
    [JsonPropertyName("errors")] public required double Errors { get; init; }
    [JsonPropertyName("configBuilds")] public required double ConfigBuilds { get; init; }
    [JsonPropertyName("rulesParses")] public required double RulesParses { get; init; }
    [JsonPropertyName("plansApplied")] public required double PlansApplied { get; init; }
    [JsonPropertyName("hostLookups")] public required double HostLookups { get; init; }
    [JsonPropertyName("hostScans")] public required double HostScans { get; init; }
    [JsonPropertyName("logEvents")] public required double LogEvents { get; init; }
}

public sealed record DumpBounds
{
    [JsonPropertyName("windows")] public required double Windows { get; init; }
    [JsonPropertyName("sources")] public required double Sources { get; init; }
    [JsonPropertyName("signals")] public required double Signals { get; init; }
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum AnimRecordKind
{
    [JsonStringEnumMemberName("start")] Start,
    [JsonStringEnumMemberName("frame")] Frame,
    [JsonStringEnumMemberName("end")] End,
    [JsonStringEnumMemberName("cancel")] Cancel,
}

/// <summary>One animation event from the bounded test recorder; empty unless armed.</summary>
public sealed record DumpAnimRecord
{
    [JsonPropertyName("kind")] public required AnimRecordKind Kind { get; init; }
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("at")] public required double At { get; init; }
    [JsonPropertyName("rect")] public required Rect Rect { get; init; }

    [JsonPropertyName("to")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Rect? To { get; init; }

    [JsonPropertyName("from")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Rect? From { get; init; }
}

/// <summary>A pointer position in <c>DumpState.pointer</c>.</summary>
public sealed record DumpPointer
{
    [JsonPropertyName("x")] public required double X { get; init; }
    [JsonPropertyName("y")] public required double Y { get; init; }
}

/// <summary>
/// The full <c>DumpState</c> JSON. Add-only: existing fields keep their order and
/// meaning; new diagnostic fields are appended.
/// </summary>
public sealed record AdrtDumpState
{
    [JsonPropertyName("format")] public string Format { get; init; } = DumpSchema.DumpStateFormat;
    [JsonPropertyName("version")] public int Version { get; init; } = DumpSchema.DumpSchemaVersion;
    [JsonPropertyName("platform")] public string Platform { get; init; } = DumpSchema.DumpStatePlatform;
    [JsonPropertyName("paused")] public required bool Paused { get; init; }
    [JsonPropertyName("mode")] public required SessionMode Mode { get; init; }
    [JsonPropertyName("userPaused")] public required bool UserPaused { get; init; }
    [JsonPropertyName("pauseDuringSharing")] public required bool PauseDuringSharing { get; init; }
    [JsonPropertyName("panel")] public required DumpPanel Panel { get; init; }
    [JsonPropertyName("rules")] public required DumpRules Rules { get; init; }
    [JsonPropertyName("recording")] public required DumpRecording Recording { get; init; }
    [JsonPropertyName("workspaceMode")] public required DumpWorkspaceMode WorkspaceMode { get; init; }
    [JsonPropertyName("errors")] public required double Errors { get; init; }
    [JsonPropertyName("restarts")] public required double Restarts { get; init; }
    [JsonPropertyName("selfDisables")] public required double SelfDisables { get; init; }
    [JsonPropertyName("lastErrorAt")] public required double LastErrorAt { get; init; }

    /// <summary>P6h: the last boundary errors, newest last, bounded to ten.</summary>
    [JsonPropertyName("recentErrors")] public required IReadOnlyList<AdrtRecentError> RecentErrors { get; init; }

    [JsonPropertyName("flags")] public required DumpFlags Flags { get; init; }
    [JsonPropertyName("activeWorkspace")] public required int ActiveWorkspace { get; init; }
    [JsonPropertyName("workspaceLayoutRows")] public required double WorkspaceLayoutRows { get; init; }
    [JsonPropertyName("build")] public required DumpBuild Build { get; init; }
    [JsonPropertyName("timing")] public required DumpTiming Timing { get; init; }
    [JsonPropertyName("tileAxis")] public required TileAxis TileAxis { get; init; }
    [JsonPropertyName("focusedReason")] public required string FocusedReason { get; init; }
    [JsonPropertyName("gaps")] public required DumpGaps Gaps { get; init; }
    [JsonPropertyName("workspaceAnimating")] public required bool WorkspaceAnimating { get; init; }
    [JsonPropertyName("focused")] public required int? Focused { get; init; }
    [JsonPropertyName("pointer")] public required DumpPointer? Pointer { get; init; }
    [JsonPropertyName("workspaces")] public required double Workspaces { get; init; }
    [JsonPropertyName("monitors")] public required IReadOnlyList<Screen> Monitors { get; init; }
    [JsonPropertyName("windows")] public required IReadOnlyList<DumpWindow> Windows { get; init; }
    [JsonPropertyName("ratios")] public required Dictionary<string, double> Ratios { get; init; }
    [JsonPropertyName("swapPairs")] public required IReadOnlyList<string> SwapPairs { get; init; }
    [JsonPropertyName("border")] public required BorderSnapshot Border { get; init; }
    [JsonPropertyName("indicator")] public required DumpIndicator Indicator { get; init; }
    [JsonPropertyName("overview")] public required bool Overview { get; init; }
    [JsonPropertyName("workspaceActors")] public required double WorkspaceActors { get; init; }
    [JsonPropertyName("coherenceSweeps")] public required double CoherenceSweeps { get; init; }
    [JsonPropertyName("coherenceFixes")] public required double CoherenceFixes { get; init; }
    [JsonPropertyName("wsSwitchEvents")] public required double WsSwitchEvents { get; init; }
    [JsonPropertyName("motionSuppressions")] public required double MotionSuppressions { get; init; }
    [JsonPropertyName("motionRetiles")] public required double MotionRetiles { get; init; }
    [JsonPropertyName("motionTicks")] public required double MotionTicks { get; init; }
    [JsonPropertyName("motionSkip")] public required string MotionSkip { get; init; }
    [JsonPropertyName("drag")] public required DumpDrag Drag { get; init; }
    [JsonPropertyName("adaptations")] public required double Adaptations { get; init; }
    [JsonPropertyName("registry")] public required IReadOnlyList<AppEntry> Registry { get; init; }
    [JsonPropertyName("registrySize")] public required double RegistrySize { get; init; }
    [JsonPropertyName("neverTile")] public required IReadOnlyList<string> NeverTile { get; init; }
    [JsonPropertyName("displayMemory")] public required IReadOnlyList<string> DisplayMemory { get; init; }
    [JsonPropertyName("perf")] public required DumpSessionPerf Perf { get; init; }
    [JsonPropertyName("perfStats")] public required DumpPerfStats PerfStats { get; init; }
    [JsonPropertyName("counters")] public required DumpCounters Counters { get; init; }
    [JsonPropertyName("bounds")] public required DumpBounds Bounds { get; init; }
    [JsonPropertyName("animRecords")] public required IReadOnlyList<DumpAnimRecord> AnimRecords { get; init; }
}
