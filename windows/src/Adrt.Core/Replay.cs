// Port of src/core/replay.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>One workspace of the initial state: the visible slots and the hidden windows.</summary>
public sealed record TraceWorkspace
{
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("slots")] public required IReadOnlyList<int?> Slots { get; init; }

    /// <summary>Window ids hidden in this workspace, in order.</summary>
    [JsonPropertyName("minimized")] public IReadOnlyList<int>? Minimized { get; init; }

    /// <summary>Window ids floating on this workspace (§6). A float pins it (§5).</summary>
    [JsonPropertyName("floats")] public IReadOnlyList<int>? Floats { get; init; }
}

/// <summary>
/// One window of the initial state, or the payload of a `window-opened` event:
/// its identity, its screen and its geometry. Placement is expressed by the
/// workspace that references it; `maximized`/`fullscreen` are the §4 flags the
/// planners read.
/// </summary>
public sealed record TraceWindow
{
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("appId")] public required string AppId { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("kind")] public SurfaceKind? Kind { get; init; }
    [JsonPropertyName("screenId")] public required int ScreenId { get; init; }
    [JsonPropertyName("rect")] public required Rect Rect { get; init; }
    [JsonPropertyName("min")] public Size? Min { get; init; }
    [JsonPropertyName("max")] public Size? Max { get; init; }
    [JsonPropertyName("maximized")] public bool? Maximized { get; init; }
    [JsonPropertyName("fullscreen")] public bool? Fullscreen { get; init; }
}

public sealed record TraceInitial
{
    /// <summary>The workspace the user is on.</summary>
    [JsonPropertyName("viewed")] public required int Viewed { get; init; }
    [JsonPropertyName("workspaces")] public required IReadOnlyList<TraceWorkspace> Workspaces { get; init; }
    [JsonPropertyName("windows")] public required IReadOnlyList<TraceWindow> Windows { get; init; }
}

/// <summary>
/// A journal entry: raw platform event or a decision (mirrors `journal.ts`).
/// The open `[field: string]: unknown` index signature is carried by
/// <see cref="Fields"/>; JSON keys other than the four typed ones land there.
/// </summary>
public sealed record TraceEntry
{
    [JsonPropertyName("seq")] public required double Seq { get; init; }
    [JsonPropertyName("source")] public required string Source { get; init; }
    [JsonPropertyName("event")] public required string Event { get; init; }
    [JsonPropertyName("at")] public required double At { get; init; }

    [JsonExtensionData] public Dictionary<string, JsonElement>? Fields { get; init; }
}

/// <summary>A recorded session: the initial state, the ordered events and the decisions.</summary>
public sealed record Trace
{
    [JsonPropertyName("version")] public required double Version { get; init; }
    [JsonPropertyName("initial")] public required TraceInitial Initial { get; init; }
    [JsonPropertyName("events")] public required IReadOnlyList<TraceEntry> Events { get; init; }

    /// <summary>The decisions logged alongside the events, when the trace is a recording.</summary>
    [JsonPropertyName("decisions")] public IReadOnlyList<TraceEntry>? Decisions { get; init; }
}

public sealed record ReplayEnv
{
    [JsonPropertyName("screen")] public required ScreenClass Screen { get; init; }
    [JsonPropertyName("axis")] public required Axis Axis { get; init; }

    /// <summary>The monitor the planners size against (`Screen` geometry/work area/scale).</summary>
    [JsonPropertyName("monitor")] public required Screen Monitor { get; init; }

    /// <summary>Tiler config for geometry plans; gaps and ratios default to the model's.</summary>
    [JsonPropertyName("config")] public TilerConfig? Config { get; init; }
}

// Decision = TraceEntry in the TypeScript (`type Decision = TraceEntry`); the alias
// carries no extra shape, so the port uses TraceEntry directly.

/// <summary>
/// Replay (§11, §22, §23.19 / Stage 6). A recorded session is the initial model
/// state plus the ordered journal entries and the decisions that were logged
/// alongside them. `replay` feeds the events back through the **pure** planners
/// (`routeNewWindow`, `unmaximizeWindow`, `maximizeWindow`, `reapPlan`,
/// `computePlans`) and returns the decisions the run produced, so a test can
/// assert that a trace replays to **identical** decisions.
///
/// Determinism is the point (no learned geometry, no timing dependence):
///
///   * the events are ordered by their monotonic `seq` alone — `at` is never
///     read, so a trace retimed or reordered on the wire replays the same;
///   * every decision is derived from the model, never from a clock;
///   * `sameDecisions` compares two decision runs field by field, ignoring only
///     the `at` timestamp, so "differs only in timing" is a checkable property.
///
/// The trace format is deliberately small and explicit — it mirrors the journal
/// shape (`{ seq, source, event, at, ...fields }`, `adapters/gnome/journal.ts`)
/// so a real recording is a projection of the journal, and it is reducer-shaped
/// so a hand-written fixture is a few lines.
/// </summary>
public static class Replay
{
    private enum LocationWhere
    {
        Slot,
        Minimized,
        Float,
    }

    private readonly record struct Location(int Ws, LocationWhere Where, int? Slot);

    /// <summary>
    /// One workspace of the runtime model. The TypeScript mutates `Ws` in place;
    /// the port keeps the mutable lists here and projects an immutable `Ws` for
    /// the planners.
    /// </summary>
    private sealed class RuntimeWorkspace
    {
        public required int Id { get; init; }
        public required List<Win?> Slots { get; init; }
        public required List<Win> Minimized { get; init; }
        public List<Win> Floats { get; init; } = new();

        public Ws ToWs() => new()
        {
            Id = Id,
            Slots = Slots,
            Minimized = Minimized,
            Floats = Floats,
        };
    }

    private sealed class Runtime
    {
        public required List<RuntimeWorkspace> Workspaces { get; init; }
        public required int Viewed { get; set; }
        public required Dictionary<int, TraceWindow> Windows { get; init; }
    }

    private static readonly TilerConfig DefaultConfig = new()
    {
        GapBase = 0,
        GapPortrait = -1,
        GapLandscape = -1,
        MinSizePolicy = MinSizePolicy.Respect,
        PrimaryApps = Array.Empty<string>(),
        PrimaryAppRatio = 0.5,
        Ratios = new Dictionary<string, double>(),
        SwapPairs = new HashSet<string>(),
        Rules = Array.Empty<Rule>(),
    };

    private static State StateOf(Runtime runtime) => new()
    {
        Workspaces = runtime.Workspaces.Select(workspace => workspace.ToWs()).ToList(),
        Viewed = runtime.Viewed,
    };

    private static Env EnvOf(ReplayEnv env) => new() { Screen = env.Screen, Axis = env.Axis };

    // --- Trace field readers ----------------------------------------------------

    /// <summary>The TypeScript's `entry[key]`: typed fields first, then extension data.</summary>
    private static JsonElement? Field(TraceEntry entry, string key)
    {
        switch (key)
        {
            case "seq": return JsonSerializer.SerializeToElement(entry.Seq);
            case "source": return JsonSerializer.SerializeToElement(entry.Source);
            case "event": return JsonSerializer.SerializeToElement(entry.Event);
            case "at": return JsonSerializer.SerializeToElement(entry.At);
        }
        var fields = entry.Fields;
        if (fields is not null && fields.TryGetValue(key, out var value)) return value;
        return null;
    }

    // `readNumber` in the TypeScript: every caller reads an integer field (id,
    // workspace, screenId), so the port narrows once here.
    private static int? ReadInt(TraceEntry entry, string key)
    {
        var value = Field(entry, key);
        if (value is null) return null;
        var number = value.Value;
        if (number.ValueKind != JsonValueKind.Number) return null;
        if (number.TryGetInt32(out var intValue)) return intValue;
        if (number.TryGetDouble(out var doubleValue)) return (int)doubleValue;
        return null;
    }

    private static string? ReadString(TraceEntry entry, string key)
    {
        var value = Field(entry, key);
        return value is not null && value.Value.ValueKind == JsonValueKind.String ? value.Value.GetString() : null;
    }

    private static Rect? ReadRect(TraceEntry entry, string key)
    {
        var value = Field(entry, key);
        if (value is null) return null;
        var rect = value.Value;
        if (rect.ValueKind != JsonValueKind.Object) return null;
        if (
            rect.TryGetProperty("x", out var x) && x.ValueKind == JsonValueKind.Number &&
            rect.TryGetProperty("y", out var y) && y.ValueKind == JsonValueKind.Number &&
            rect.TryGetProperty("width", out var width) && width.ValueKind == JsonValueKind.Number &&
            rect.TryGetProperty("height", out var height) && height.ValueKind == JsonValueKind.Number
        )
        {
            return new Rect(x.GetDouble(), y.GetDouble(), width.GetDouble(), height.GetDouble());
        }
        return null;
    }

    private static Size? ReadSize(TraceEntry entry, string key)
    {
        var value = Field(entry, key);
        if (value is null) return null;
        var size = value.Value;
        if (size.ValueKind != JsonValueKind.Object) return null;
        if (
            size.TryGetProperty("width", out var width) && width.ValueKind == JsonValueKind.Number &&
            size.TryGetProperty("height", out var height) && height.ValueKind == JsonValueKind.Number
        )
        {
            return new Size(width.GetDouble(), height.GetDouble());
        }
        return null;
    }

    private static Direction? ReadDirection(TraceEntry entry)
    {
        var value = ReadString(entry, "from");
        switch (value)
        {
            case "left": return Direction.Left;
            case "right": return Direction.Right;
            case "above": return Direction.Above;
            case "below": return Direction.Below;
            default: return null;
        }
    }

    private static bool TryParseSurfaceKind(string value, out SurfaceKind kind)
    {
        switch (value)
        {
            case "normal": kind = SurfaceKind.Normal; return true;
            case "dialog": kind = SurfaceKind.Dialog; return true;
            case "modal": kind = SurfaceKind.Modal; return true;
            case "utility": kind = SurfaceKind.Utility; return true;
            case "toolbar": kind = SurfaceKind.Toolbar; return true;
            case "skip": kind = SurfaceKind.Skip; return true;
            default: kind = default; return false;
        }
    }

    private static SurfaceKind ReadKind(TraceEntry entry, SurfaceKind fallback)
    {
        var value = ReadString(entry, "kind");
        return value is not null && TryParseSurfaceKind(value, out var kind) ? kind : fallback;
    }

    private static bool IsTrue(TraceEntry entry, string key)
    {
        var value = Field(entry, key);
        return value is not null && value.Value.ValueKind == JsonValueKind.True;
    }

    private static Win ToWin(TraceWindow? record, int id, bool minimized = false, bool floating = false) => new()
    {
        Id = id,
        Minimized = minimized ? true : null,
        Floating = floating ? true : null,
        Maximized = record?.Maximized ?? false,
        Fullscreen = record?.Fullscreen ?? false,
    };

    // --- Runtime model ----------------------------------------------------------

    private static Runtime BuildRuntime(TraceInitial initial)
    {
        var windows = new Dictionary<int, TraceWindow>();
        foreach (var record in initial.Windows) windows[record.Id] = record;
        var workspaces = initial.Workspaces.Select(workspace =>
        {
            var slot0 = workspace.Slots[0];
            var slot1 = workspace.Slots[1];
            return new RuntimeWorkspace
            {
                Id = workspace.Id,
                Slots = new List<Win?>
                {
                    slot0 is null ? null : ToWin(windows.GetValueOrDefault(slot0.Value), slot0.Value),
                    slot1 is null ? null : ToWin(windows.GetValueOrDefault(slot1.Value), slot1.Value),
                },
                Minimized = (workspace.Minimized ?? Array.Empty<int>())
                    .Select(id => ToWin(windows.GetValueOrDefault(id), id, minimized: true))
                    .ToList(),
                Floats = (workspace.Floats ?? Array.Empty<int>())
                    .Select(id => ToWin(windows.GetValueOrDefault(id), id, floating: true))
                    .ToList(),
            };
        }).ToList();
        return new Runtime { Workspaces = workspaces, Viewed = initial.Viewed, Windows = windows };
    }

    /// <summary>Merge a `window-opened` payload into the window table, keeping prior fields.</summary>
    private static TraceWindow UpsertWindow(Runtime runtime, int id, TraceEntry entry)
    {
        var existing = runtime.Windows.GetValueOrDefault(id);
        var record = new TraceWindow
        {
            Id = id,
            AppId = ReadString(entry, "appId") ?? existing?.AppId ?? $"window:{id}",
            Title = ReadString(entry, "title") ?? existing?.Title,
            Kind = ReadKind(entry, existing?.Kind ?? SurfaceKind.Normal),
            ScreenId = ReadInt(entry, "screenId") ?? existing?.ScreenId ?? 0,
            Rect = ReadRect(entry, "rect") ?? existing?.Rect ?? new Rect(0, 0, 0, 0),
            Min = ReadSize(entry, "min") ?? existing?.Min,
            Max = ReadSize(entry, "max") ?? existing?.Max,
            Maximized = existing?.Maximized ?? false,
            Fullscreen = existing?.Fullscreen ?? false,
        };
        runtime.Windows[id] = record;
        return record;
    }

    private static Location? Locate(Runtime runtime, int id)
    {
        for (var index = 0; index < runtime.Workspaces.Count; index++)
        {
            var workspace = runtime.Workspaces[index];
            if (workspace.Slots[0]?.Id == id) return new Location(index, LocationWhere.Slot, 0);
            if (workspace.Slots[1]?.Id == id) return new Location(index, LocationWhere.Slot, 1);
            if (workspace.Minimized.Any(win => win.Id == id)) return new Location(index, LocationWhere.Minimized, null);
            if (workspace.Floats.Any(win => win.Id == id)) return new Location(index, LocationWhere.Float, null);
        }
        return null;
    }

    /// <summary>Remove a window from wherever it sits and return its record.</summary>
    private static Win? TakeWin(Runtime runtime, int id)
    {
        var location = Locate(runtime, id);
        if (location is not { } loc) return null;
        var workspace = runtime.Workspaces[loc.Ws];
        if (loc.Where == LocationWhere.Slot)
        {
            if (loc.Slot is not { } slot) return null;
            var win = workspace.Slots[slot];
            workspace.Slots[slot] = null;
            return win;
        }
        if (loc.Where == LocationWhere.Minimized)
        {
            var index = workspace.Minimized.FindIndex(win => win.Id == id);
            if (index < 0) return null;
            var win = workspace.Minimized[index];
            workspace.Minimized.RemoveAt(index);
            return win;
        }
        var floatIndex = workspace.Floats.FindIndex(win => win.Id == id);
        if (floatIndex < 0) return null;
        var floatWin = workspace.Floats[floatIndex];
        workspace.Floats.RemoveAt(floatIndex);
        return floatWin;
    }

    /// <summary>Minimize a visible window in place (§4): it releases its slot (§5).</summary>
    private static void MinimizeInPlace(Runtime runtime, int id)
    {
        var location = Locate(runtime, id);
        if (location is not { } loc || loc.Where != LocationWhere.Slot) return;
        var win = TakeWin(runtime, id);
        if (win is null) return;
        runtime.Workspaces[loc.Ws].Minimized.Add(win with { Minimized = true });
    }

    private static TilerWindow TilerWindowFor(Runtime runtime, int workspaceIndex, int id, int slot)
    {
        var record = runtime.Windows.GetValueOrDefault(id);
        return new TilerWindow
        {
            Id = id,
            AppId = record?.AppId ?? $"window:{id}",
            Title = record?.Title ?? "",
            Kind = record?.Kind ?? SurfaceKind.Normal,
            Rect = record?.Rect ?? new Rect(0, 0, 0, 0),
            Min = record?.Min ?? new Size(0, 0),
            Max = record?.Max ?? new Size(0, 0),
            ScreenId = record?.ScreenId ?? 0,
            WorkspaceId = runtime.Workspaces[workspaceIndex].Id,
            Slot = slot,
        };
    }

    /// <summary>Create an empty workspace at `at` (the trailing spare is pushed right, §3).</summary>
    private static int InsertWorkspace(Runtime runtime, int at)
    {
        var id = runtime.Workspaces.Select(workspace => workspace.Id).DefaultIfEmpty(-1).Max() + 1;
        var index = Math.Max(0, Math.Min(at, runtime.Workspaces.Count));
        runtime.Workspaces.Insert(index, new RuntimeWorkspace
        {
            Id = id,
            Slots = new List<Win?> { null, null },
            Minimized = new List<Win>(),
        });
        return index;
    }

    /// <summary>
    /// Apply a placement to the runtime model. The view policy is here too (§3): a
    /// workspace created for the viewed workspace moves the view onto it; one created
    /// elsewhere only shifts the viewed index.
    /// </summary>
    private static void ApplyPlacement(Runtime runtime, PlacementDecision placement, int id)
    {
        var preView = runtime.Viewed;
        var target = placement.Workspace;
        var index = target;
        if (placement.CreateRight == true) index = InsertWorkspace(runtime, target + 1);
        if (index < 0 || index >= runtime.Workspaces.Count) return;
        var workspace = runtime.Workspaces[index];
        TakeWin(runtime, id);
        var record = runtime.Windows.GetValueOrDefault(id);
        if (placement.Float == true)
        {
            workspace.Floats.Add(new Win
            {
                Id = id,
                Minimized = false,
                Floating = true,
                Maximized = record?.Maximized ?? false,
                Fullscreen = record?.Fullscreen ?? false,
            });
        }
        else
        {
            var minimize = placement.Minimize;
            if (minimize is not null)
            {
                foreach (var victim in minimize) if (victim != id) MinimizeInPlace(runtime, victim);
            }
            if (minimize?.Contains(id) == true)
            {
                workspace.Minimized.Add(new Win { Id = id, Minimized = true });
            }
            else
            {
                var slot = placement.Slot ?? 0;
                workspace.Slots[slot] = new Win { Id = id, Maximized = placement.Maximize == true };
            }
        }
        if (placement.CreateRight == true)
        {
            if (target == preView) runtime.Viewed = index;
            else if (index <= preView) runtime.Viewed = preView + 1;
        }
    }

    /// <summary>The nearest workspace left first, then right, that still holds windows (§5).</summary>
    private static int? NearestLoaded(Runtime runtime, int from, HashSet<int> reaped)
    {
        for (var index = from - 1; index >= 0; index--)
        {
            if (!reaped.Contains(index) && PlacementPolicy.WindowCount(runtime.Workspaces[index].ToWs()) > 0) return index;
        }
        for (var index = from + 1; index < runtime.Workspaces.Count; index++)
        {
            if (!reaped.Contains(index) && PlacementPolicy.WindowCount(runtime.Workspaces[index].ToWs()) > 0) return index;
        }
        return null;
    }

    /// <summary>An index in the old list, remapped after the reaped indexes are removed.</summary>
    private static int Remap(int index, HashSet<int> reaped)
    {
        var shift = 0;
        for (var i = 0; i < index; i++) if (reaped.Contains(i)) shift++;
        return index - shift;
    }

    /// <summary>
    /// Reaping is a property, not an event (§5): after every mutation, any empty
    /// workspace other than the spare is removed and a workspace holding only
    /// minimized windows relocates its occupant first. If the viewed workspace is
    /// reaped, the view moves to the nearest workspace that holds windows.
    /// </summary>
    private static void Reap(Runtime runtime, TraceEntry evt, List<TraceEntry> decisions)
    {
        var plan = Workspaces.ReapPlan(StateOf(runtime));
        if (plan.Reap.Count == 0 && plan.Relocate.Count == 0) return;
        var preView = runtime.Viewed;
        var reaped = new HashSet<int>(plan.Reap);
        var newView = preView;
        if (reaped.Contains(preView))
        {
            var nearest = NearestLoaded(runtime, preView, reaped);
            if (nearest is not null) newView = nearest.Value;
        }
        var relocate = new List<RelocateMove>();
        foreach (var move in plan.Relocate)
        {
            var win = TakeWin(runtime, move.Id);
            if (win is null || move.To < 0 || move.To >= runtime.Workspaces.Count) continue;
            runtime.Workspaces[move.To].Minimized.Add(win with { Minimized = true });
            relocate.Add(move);
        }
        for (var index = plan.Reap.Count - 1; index >= 0; index--) runtime.Workspaces.RemoveAt(plan.Reap[index]);
        runtime.Viewed = Remap(newView, reaped);
        var fields = new Dictionary<string, object?>
        {
            ["reap"] = plan.Reap,
            ["relocate"] = relocate,
        };
        if (runtime.Viewed != preView) fields["view"] = runtime.Viewed;
        decisions.Add(Decision(evt, "reapPlan", fields));
    }

    private static TraceEntry Decision(TraceEntry evt, string name, Dictionary<string, object?> fields)
    {
        var clean = new Dictionary<string, JsonElement>();
        foreach (var (key, value) in fields)
        {
            if (value is null) continue;
            clean[key] = JsonSerializer.SerializeToElement(value);
        }
        return new TraceEntry { Seq = evt.Seq, Source = "decision", Event = name, At = evt.At, Fields = clean };
    }

    private static TraceEntry PlacementDecision(
        TraceEntry evt,
        string name,
        int id,
        PlacementDecision placement,
        int? view)
    {
        return Decision(evt, name, new Dictionary<string, object?>
        {
            ["window"] = id,
            ["workspace"] = placement.Workspace,
            ["slot"] = placement.Slot,
            ["createRight"] = placement.CreateRight,
            ["maximize"] = placement.Maximize,
            ["inPlace"] = placement.InPlace,
            ["float"] = placement.Float,
            ["minimize"] = placement.Minimize,
            ["note"] = placement.Note,
            ["view"] = view,
        });
    }

    private static void Layout(
        Runtime runtime,
        TraceEntry evt,
        ReplayEnv env,
        TilerConfig config,
        List<TraceEntry> decisions)
    {
        for (var index = 0; index < runtime.Workspaces.Count; index++)
        {
            var workspace = runtime.Workspaces[index];
            var windows = new List<TilerWindow>();
            if (workspace.Slots[0] is not null) windows.Add(TilerWindowFor(runtime, index, workspace.Slots[0]!.Id, 0));
            if (workspace.Slots[1] is not null) windows.Add(TilerWindowFor(runtime, index, workspace.Slots[1]!.Id, 1));
            if (windows.Count == 0) continue;
            var plan = Tiler.ComputePlans(windows, env.Monitor, config);
            decisions.Add(Decision(evt, "computePlans", new Dictionary<string, object?>
            {
                ["workspace"] = workspace.Id,
                ["plan"] = plan,
            }));
        }
    }

    /// <summary>
    /// Feed a recorded trace's events through the pure planners and return the
    /// decisions. Events are ordered by `seq`; `at` is never consulted, and nothing
    /// is learned, so the same trace always produces the same decisions.
    ///
    /// TS name: `replay` (the method cannot share the enclosing class's name).
    /// </summary>
    public static IReadOnlyList<TraceEntry> Run(Trace trace, ReplayEnv env)
    {
        var runtime = BuildRuntime(trace.Initial);
        var config = env.Config ?? DefaultConfig;
        var decisions = new List<TraceEntry>();
        var events = trace.Events.OrderBy(evt => evt.Seq).ToList();
        foreach (var evt in events)
        {
            var id = ReadInt(evt, "id");
            switch (evt.Event)
            {
                case "window-opened":
                {
                    if (id is null) break;
                    UpsertWindow(runtime, id.Value, evt);
                    var placement = PlacementPolicy.RouteNewWindow(
                        StateOf(runtime),
                        EnvOf(env),
                        ToWin(runtime.Windows.GetValueOrDefault(id.Value), id.Value),
                        ReadDirection(evt),
                        ReadInt(evt, "workspace"),
                        IsTrue(evt, "doesNotFit"));
                    var preView = runtime.Viewed;
                    ApplyPlacement(runtime, placement, id.Value);
                    decisions.Add(
                        PlacementDecision(evt, "routeNewWindow", id.Value, placement, runtime.Viewed != preView ? runtime.Viewed : null));
                    Reap(runtime, evt, decisions);
                    break;
                }
                case "window-closed":
                {
                    if (id is null) break;
                    TakeWin(runtime, id.Value);
                    runtime.Windows.Remove(id.Value);
                    Reap(runtime, evt, decisions);
                    break;
                }
                case "window-unmaximized":
                {
                    if (id is null) break;
                    var placement = PlacementPolicy.UnmaximizeWindow(
                        StateOf(runtime),
                        EnvOf(env),
                        ReadInt(evt, "workspace") ?? runtime.Viewed,
                        id.Value);
                    var preView = runtime.Viewed;
                    ApplyPlacement(runtime, placement, id.Value);
                    decisions.Add(
                        PlacementDecision(evt, "unmaximizeWindow", id.Value, placement, runtime.Viewed != preView ? runtime.Viewed : null));
                    Reap(runtime, evt, decisions);
                    break;
                }
                case "window-maximized":
                {
                    if (id is null) break;
                    var placement = PlacementPolicy.MaximizeWindow(
                        StateOf(runtime),
                        EnvOf(env),
                        ReadInt(evt, "workspace") ?? runtime.Viewed);
                    var preView = runtime.Viewed;
                    ApplyPlacement(runtime, placement, id.Value);
                    decisions.Add(
                        PlacementDecision(evt, "maximizeWindow", id.Value, placement, runtime.Viewed != preView ? runtime.Viewed : null));
                    Reap(runtime, evt, decisions);
                    break;
                }
                case "window-minimized":
                {
                    if (id is null) break;
                    MinimizeInPlace(runtime, id.Value);
                    Reap(runtime, evt, decisions);
                    break;
                }
                case "layout":
                {
                    Layout(runtime, evt, env, config, decisions);
                    break;
                }
                default:
                    // Unknown events are deterministically ignored.
                    break;
            }
        }
        return decisions;
    }

    /// <summary>
    /// Whether two decision runs are identical. Everything is compared — sequence,
    /// planner, workspace, slots, notes, geometry — **except `at`**, because a
    /// decision must not depend on when its event happened (§23.19).
    /// </summary>
    public static bool SameDecisions(IReadOnlyList<TraceEntry> a, IReadOnlyList<TraceEntry> b)
    {
        if (a.Count != b.Count) return false;
        for (var index = 0; index < a.Count; index++)
        {
            if (Canonical(a[index]) != Canonical(b[index])) return false;
        }
        return true;
    }

    /// <summary>
    /// The TypeScript's `canonical(stripAt(entry))`: every field except `at`, object
    /// keys sorted, emitted as compact JSON.
    /// </summary>
    private static string Canonical(TraceEntry entry)
    {
        var fields = new SortedDictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var (key, value) in CoreFields(entry))
        {
            if (key == "at" || value.ValueKind == JsonValueKind.Undefined) continue;
            fields[key] = value;
        }
        return "{" + string.Join(",", fields.Select(pair => $"{JsonSerializer.Serialize(pair.Key)}:{CanonicalElement(pair.Value)}")) + "}";
    }

    private static IEnumerable<KeyValuePair<string, JsonElement>> CoreFields(TraceEntry entry)
    {
        yield return new KeyValuePair<string, JsonElement>("seq", JsonSerializer.SerializeToElement(entry.Seq));
        yield return new KeyValuePair<string, JsonElement>("source", JsonSerializer.SerializeToElement(entry.Source));
        yield return new KeyValuePair<string, JsonElement>("event", JsonSerializer.SerializeToElement(entry.Event));
        yield return new KeyValuePair<string, JsonElement>("at", JsonSerializer.SerializeToElement(entry.At));
        var extra = entry.Fields;
        if (extra is not null)
        {
            foreach (var pair in extra) yield return pair;
        }
    }

    private static string CanonicalElement(JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                var properties = value.EnumerateObject()
                    .Where(property => property.Value.ValueKind != JsonValueKind.Undefined)
                    .OrderBy(property => property.Name, StringComparer.Ordinal);
                return "{" + string.Join(",", properties.Select(property => $"{JsonSerializer.Serialize(property.Name)}:{CanonicalElement(property.Value)}")) + "}";
            case JsonValueKind.Array:
                return "[" + string.Join(",", value.EnumerateArray().Select(CanonicalElement)) + "]";
            case JsonValueKind.String:
                return JsonSerializer.Serialize(value.GetString());
            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
                return "null";
            case JsonValueKind.Number:
                return value.GetDouble().ToString("R", System.Globalization.CultureInfo.InvariantCulture);
            default:
                return value.GetRawText();
        }
    }
}
