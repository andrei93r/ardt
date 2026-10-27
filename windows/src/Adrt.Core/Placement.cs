// Port of src/core/placement.ts. Keep names and semantics 1:1 with the TypeScript.
//
// Two names differ from the TypeScript because the namespace already owns them:
// types.ts's `Placement` (the compositor placement in Types.cs) keeps its name,
// so this module's decision type is `PlacementDecision` and the static module
// class is `PlacementPolicy`.
using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;

namespace Adrt.Core;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum Axis
{
    [JsonStringEnumMemberName("horizontal")] Horizontal,
    [JsonStringEnumMemberName("vertical")] Vertical,
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum ScreenClass
{
    [JsonStringEnumMemberName("dynamic")] Dynamic,
    [SuppressMessage("Naming", "CA1720:Identifier contains type name", Justification = "Wire name is 'single'.")]
    [JsonStringEnumMemberName("single")] Single,
    [JsonStringEnumMemberName("fixed")] Fixed,
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum Direction
{
    [JsonStringEnumMemberName("left")] Left,
    [JsonStringEnumMemberName("right")] Right,
    [JsonStringEnumMemberName("above")] Above,
    [JsonStringEnumMemberName("below")] Below,
}

public sealed record Win
{
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("minimized")] public bool? Minimized { get; init; }
    [JsonPropertyName("floating")] public bool? Floating { get; init; }
    [JsonPropertyName("maximized")] public bool? Maximized { get; init; }
    [JsonPropertyName("fullscreen")] public bool? Fullscreen { get; init; }
}

/// <summary>One workspace: the two slot occupants (visible only) plus hidden windows.</summary>
public sealed record Ws
{
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("slots")] public required IReadOnlyList<Win?> Slots { get; init; }
    [JsonPropertyName("minimized")] public required IReadOnlyList<Win> Minimized { get; init; }
    [JsonPropertyName("floats")] public IReadOnlyList<Win>? Floats { get; init; }
}

public sealed record State
{
    [JsonPropertyName("workspaces")] public required IReadOnlyList<Ws> Workspaces { get; init; }

    /// <summary>The workspace the user is looking at.</summary>
    [JsonPropertyName("viewed")] public required int Viewed { get; init; }
}

public sealed record Env
{
    [JsonPropertyName("screen")] public required ScreenClass Screen { get; init; }
    [JsonPropertyName("axis")] public required Axis Axis { get; init; }
}

/// <summary>
/// The decision of the placement policy (src/core/placement.ts `Placement`).
/// </summary>
public sealed record PlacementDecision
{
    /// <summary>Index of the target workspace in `State.Workspaces`.</summary>
    [JsonPropertyName("workspace")] public required int Workspace { get; init; }

    /// <summary>The slot the window takes, when it lands in one.</summary>
    [JsonPropertyName("slot")] public int? Slot { get; init; }

    /// <summary>A workspace must be created immediately to the right of this one.</summary>
    [JsonPropertyName("createRight")] public bool? CreateRight { get; init; }

    /// <summary>These windows must be minimized.</summary>
    [JsonPropertyName("minimize")] public IReadOnlyList<int>? Minimize { get; init; }

    /// <summary>The window takes the whole workspace (a lone arrival, or the escape).</summary>
    [JsonPropertyName("maximize")] public bool? Maximize { get; init; }

    /// <summary>Maximize where the window is instead of moving it (§4, §7).</summary>
    [JsonPropertyName("inPlace")] public bool? InPlace { get; init; }

    /// <summary>The window floats: no room, and this screen cannot create one (§6).</summary>
    [SuppressMessage("Naming", "CA1720:Identifier contains type name", Justification = "Wire name is 'float'.")]
    [JsonPropertyName("float")] public bool? Float { get; init; }

    /// <summary>The decision, for the notification catalogue (§21).</summary>
    [JsonPropertyName("note")] public string? Note { get; init; }
}

/// <summary>
/// §6: the outcome of a user drop (a drag or an overview drop) on a target
/// workspace. The ladder, in order:
///   * a **free slot wins**, on the side the window came from;
///   * otherwise a window whose perimeter was crossed is **swapped** with;
///   * otherwise the window **floats** where it was dropped.
/// A drop onto the empty trailing workspace maximises there (a lone arrival);
/// the single-workspace screen never swaps — with no free slot it floats.
/// </summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(SlotDropResult), "slot")]
[JsonDerivedType(typeof(MaximizeDropResult), "maximize")]
[JsonDerivedType(typeof(SwapDropResult), "swap")]
[JsonDerivedType(typeof(FloatDropResult), "float")]
public abstract record DropResult;

public sealed record SlotDropResult : DropResult
{
    [JsonPropertyName("workspace")] public required int Workspace { get; init; }
    [JsonPropertyName("slot")] public required int Slot { get; init; }
}

public sealed record MaximizeDropResult : DropResult
{
    [JsonPropertyName("workspace")] public required int Workspace { get; init; }
}

public sealed record SwapDropResult : DropResult
{
    [JsonPropertyName("workspace")] public required int Workspace { get; init; }
    [JsonPropertyName("with")] public required int With { get; init; }
}

public sealed record FloatDropResult : DropResult
{
    [JsonPropertyName("workspace")] public required int Workspace { get; init; }
}

/// <summary>§10 steps 3-4: who gives way when a split cannot exist.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum GiveWayTo
{
    [JsonStringEnumMemberName("own-workspace")] OwnWorkspace,
    [JsonStringEnumMemberName("minimized")] Minimized,
}

public sealed record SplitOutcome
{
    /// <summary>The window the action was about: it keeps the screen.</summary>
    [JsonPropertyName("keep")] public required int Keep { get; init; }

    /// <summary>The window that has to give way.</summary>
    [JsonPropertyName("giveWay")] public required int GiveWay { get; init; }

    [JsonPropertyName("giveWayTo")] public required GiveWayTo GiveWayTo { get; init; }
}

/// <summary>§4: where a workspace's only (minimized) window moves to.</summary>
public sealed record MinimizeRelocationResult
{
    [JsonPropertyName("to")] public required int To { get; init; }
}

/// <summary>
/// Placement policy (§3-§7, §10, §16). Pure: it takes a description of the
/// workspaces and returns a decision — which workspace, which slot, what to
/// minimize, whether a workspace must be created. The adapter turns that into
/// platform calls, in the drain.
///
/// The rules, in one place:
///   * a slot is held only while its window is visible; a minimized window holds
///     none (§5);
///   * a newcomer takes slot 1 unless a direction says otherwise, and a lone
///     arrival is maximized;
///   * when the workspace has no room, a workspace is created immediately right;
///   * unmaximizing joins a neighbour that holds **exactly one** window (left
///     first, then right); otherwise the window is parked minimized in the left
///     neighbour that holds windows, else the right one, else it stays;
///   * a window that cannot fit a share gets its own workspace (the escape);
///   * when a split cannot exist, the window the action is about keeps the screen
///     and the reactor gives way: its own workspace, or minimized on a screen
///     that cannot create one.
/// </summary>
public static class PlacementPolicy
{
    /// <summary>The free slot in a workspace, or null when both are taken (§5).</summary>
    public static int? FreeSlot(Ws ws)
    {
        if (Slot(ws, 0) == null) return 0;
        if (Slot(ws, 1) == null) return 1;
        return null;
    }

    /// <summary>
    /// The slot an arrival takes: the right one (slot 1) when no side is known,
    /// else the side it came from (§3). A cross-screen or cross-workspace arrival
    /// lands against the edge it just crossed, and the window already in that slot
    /// is pushed to the other one — the adapter pins both sides. Null only when
    /// there is no free slot at all.
    /// </summary>
    private static int? ArrivalSlot(Ws ws, Direction? from = null)
    {
        if (FreeSlot(ws) == null) return null;
        if (from != null) return SideSlot(from);
        return Slot(ws, 1) == null ? 1 : 0;
    }

    /// <summary>How many windows are visible in a workspace's two slots (§5).</summary>
    private static int VisibleCount(Ws ws) =>
        (Slot(ws, 0) == null ? 0 : 1) + (Slot(ws, 1) == null ? 0 : 1);

    /// <summary>The visible window ids of a workspace, in slot order.</summary>
    private static List<int> VisibleIds(Ws ws)
    {
        var ids = new List<int>();
        var first = Slot(ws, 0);
        if (first != null) ids.Add(first.Id);
        var second = Slot(ws, 1);
        if (second != null) ids.Add(second.Id);
        return ids;
    }

    /// <summary>How many windows a workspace holds, counting minimized and floating ones.</summary>
    public static int WindowCount(Ws ws)
    {
        var count = (Slot(ws, 0) == null ? 0 : 1) + (Slot(ws, 1) == null ? 0 : 1) + ws.Minimized.Count;
        count += ws.Floats?.Count ?? 0;
        return count;
    }

    /// <summary>The slot on the side a window came from (§3); no direction means slot 1.</summary>
    public static int SideSlot(Direction? from)
    {
        if (from == Direction.Left || from == Direction.Above) return 0;
        return 1;
    }

    /// <summary>
    /// §13: the sides a swap pins onto the two windows, given their current sides.
    /// When both are known and differ they simply trade; otherwise (a maximized or
    /// floating partner, or a drag that has moved both rects over one slot) the
    /// stable id order is reversed — the low id takes slot 1, the high id slot 0.
    /// Pure, so the swap the drop applies and the swap the preview draws agree.
    /// </summary>
    public static (int SlotA, int SlotB) SwappedSides(int idA, int? slotA, int idB, int? slotB)
    {
        if (slotA != null && slotB != null && slotA != slotB) return (slotB.Value, slotA.Value);
        return idA < idB ? (1, 0) : (0, 1);
    }

    /// <summary>
    /// Where a newly opened (or routed) window goes (§3). `ownWorkspace` is the
    /// workspace it opens on; `from` is the direction it arrived from, when known;
    /// `doesNotFit` is the escape rule's trigger (§16).
    /// </summary>
    public static PlacementDecision RouteNewWindow(
        State state,
        Env env,
        Win _,
        Direction? from = null,
        int? ownWorkspace = null,
        bool doesNotFit = false)
    {
        var target = ownWorkspace ?? state.Viewed;
        var ws = WorkspaceAt(state, target);
        if (ws == null) return new PlacementDecision { Workspace = target, Slot = 1, Maximize = true, Note = "no-workspace" };

        if (env.Screen == ScreenClass.Single)
        {
            // §10 step 4 / §16: no workspace to give, so the trigger keeps the screen
            // maximized and the windows already there are minimized.
            if (doesNotFit)
            {
                return new PlacementDecision { Workspace = target, Slot = 1, InPlace = true, Maximize = true, Minimize = VisibleIds(ws), Note = "trigger-wins" };
            }
            var freeSingle = ArrivalSlot(ws, from);
            if (freeSingle != null) return new PlacementDecision { Workspace = target, Slot = freeSingle, Maximize = VisibleCount(ws) == 0 };
            return new PlacementDecision { Workspace = target, Slot = 1, Float = true, Note = "no-room-floats" };
        }
        if (env.Screen == ScreenClass.Fixed)
        {
            var freeFixed = ArrivalSlot(ws, from);
            if (freeFixed != null && !doesNotFit) return new PlacementDecision { Workspace = target, Slot = freeFixed };
            var next = NearestWithRoom(state, target);
            if (next != null) return new PlacementDecision { Workspace = next.Value, Slot = FreeSlot(state.Workspaces[next.Value]) ?? 1 };
            return new PlacementDecision { Workspace = target, Slot = 1, Float = true, Note = "no-room-floats" };
        }

        // A workspace-capable screen: the right slot, else split a maximized single,
        // else a new workspace immediately right.
        if (doesNotFit)
        {
            // §16: its own workspace, sized to itself (the adapter clamps it).
            return new PlacementDecision { Workspace = target, Slot = 0, CreateRight = true, Note = "did-not-fit" };
        }
        var free = ArrivalSlot(ws, from);
        if (free != null)
        {
            if (VisibleCount(ws) == 0)
            {
                // Alone among the visible windows (a workspace that only *looks* empty,
                // §5): it maximizes. Minimized windows keep their place.
                return new PlacementDecision { Workspace = target, Slot = free, Maximize = true };
            }
            return new PlacementDecision { Workspace = target, Slot = free, Note = "right-slot" };
        }
        return new PlacementDecision { Workspace = target, Slot = 1, CreateRight = true, Maximize = true, Note = "workspace-created" };
    }

    /// <summary>
    /// §6: the outcome of a user drop (a drag or an overview drop) on a target
    /// workspace. See <see cref="DropResult"/> for the ladder.
    /// </summary>
    public static DropResult DropPlacement(
        State state,
        Env env,
        int _,
        int workspace,
        Direction? from = null,
        int? crossed = null)
    {
        var ws = WorkspaceAt(state, workspace);
        if (ws == null) return new FloatDropResult { Workspace = workspace };
        var free = ArrivalSlot(ws, from);
        if (env.Screen == ScreenClass.Single)
        {
            // §7: a single-workspace screen never swaps; overflow floats.
            if (free == null) return new FloatDropResult { Workspace = workspace };
            if (VisibleCount(ws) == 0) return new MaximizeDropResult { Workspace = workspace };
            return new SlotDropResult { Workspace = workspace, Slot = free.Value };
        }
        if (env.Screen == ScreenClass.Fixed && free == null)
        {
            // §7: fixed screens route to the nearest existing workspace with room.
            var next = NearestWithRoom(state, workspace);
            if (next == null) return new FloatDropResult { Workspace = workspace };
            return new SlotDropResult { Workspace = next.Value, Slot = FreeSlot(state.Workspaces[next.Value]) ?? 1 };
        }
        if (free != null)
        {
            // A workspace that only looks empty hosts the drop alone → it maximises.
            if (VisibleCount(ws) == 0) return new MaximizeDropResult { Workspace = workspace };
            return new SlotDropResult { Workspace = workspace, Slot = free.Value };
        }
        if (crossed != null && VisibleIds(ws).Contains(crossed.Value))
        {
            return new SwapDropResult { Workspace = workspace, With = crossed.Value };
        }
        return new FloatDropResult { Workspace = workspace };
    }

    /// <summary>The nearest workspace with a free slot, right first, then left (§7).</summary>
    private static int? NearestWithRoom(State state, int from)
    {
        for (var index = from + 1; index < state.Workspaces.Count; index++)
        {
            if (FreeSlot(state.Workspaces[index]) != null) return index;
        }
        for (var index = from - 1; index >= 0; index--)
        {
            if (FreeSlot(state.Workspaces[index]) != null) return index;
        }
        return null;
    }

    /// <summary>Whether a workspace holds exactly one window (minimized counts, §4).</summary>
    private static bool HoldsExactlyOne(Ws ws) => WindowCount(ws) == 1;

    /// <summary>§4: maximizing moves the window to its own workspace, or in place on `single`.</summary>
    public static PlacementDecision MaximizeWindow(State state, Env env, int ownWorkspace)
    {
        if (env.Screen == ScreenClass.Single)
        {
            var hasFirstSlot = ownWorkspace >= 0 && ownWorkspace < state.Workspaces.Count && state.Workspaces[ownWorkspace].Slots.Count > 0;
            return new PlacementDecision { Workspace = ownWorkspace, Slot = hasFirstSlot ? 0 : 1, InPlace = true, Maximize = true, Note = "maximize-in-place" };
        }
        if (env.Screen == ScreenClass.Fixed)
        {
            var free = NearestWithRoom(state, ownWorkspace);
            if (free != null) return new PlacementDecision { Workspace = free.Value, Slot = FreeSlot(state.Workspaces[free.Value]) ?? 1, Maximize = true, Note = "maximize-moved" };
            return new PlacementDecision { Workspace = ownWorkspace, Slot = 0, InPlace = true, Maximize = true, Note = "maximize-in-place" };
        }
        return new PlacementDecision { Workspace = ownWorkspace, Slot = 1, CreateRight = true, Maximize = true, Note = "maximize-moved" };
    }

    /// <summary>§4: the unmaximize ladder.</summary>
    public static PlacementDecision UnmaximizeWindow(State state, Env env, int ownWorkspace, int id)
    {
        if (env.Screen == ScreenClass.Single)
        {
            return new PlacementDecision { Workspace = ownWorkspace, Slot = 1, InPlace = true, Note = "unmaximize-in-place" };
        }
        var left = WorkspaceAt(state, ownWorkspace - 1);
        var right = WorkspaceAt(state, ownWorkspace + 1);
        if (left != null && HoldsExactlyOne(left)) return new PlacementDecision { Workspace = ownWorkspace - 1, Slot = 1, Note = "unmaximize-joins-left" };
        if (right != null && HoldsExactlyOne(right)) return new PlacementDecision { Workspace = ownWorkspace + 1, Slot = 1, Note = "unmaximize-joins-right" };
        if (left != null && WindowCount(left) > 0) return new PlacementDecision { Workspace = ownWorkspace - 1, Minimize = new[] { id }, Note = "unmaximize-parks-left" };
        if (right != null && WindowCount(right) > 0) return new PlacementDecision { Workspace = ownWorkspace + 1, Minimize = new[] { id }, Note = "unmaximize-parks-right" };
        return new PlacementDecision { Workspace = ownWorkspace, Minimize = new[] { id }, Note = "unmaximize-stays" };
    }

    /// <summary>§4: where a workspace's only (minimized) window moves to, or null to stay.</summary>
    public static MinimizeRelocationResult? MinimizeRelocation(State state, int ownWorkspace)
    {
        var left = WorkspaceAt(state, ownWorkspace - 1);
        if (left != null && WindowCount(left) > 0) return new MinimizeRelocationResult { To = ownWorkspace - 1 };
        var right = WorkspaceAt(state, ownWorkspace + 1);
        if (right != null && WindowCount(right) > 0) return new MinimizeRelocationResult { To = ownWorkspace + 1 };
        return null;
    }

    /// <summary>§10 steps 3-4: a split that cannot exist, so the trigger wins.</summary>
    public static SplitOutcome ImpossibleSplit(Env env, Win trigger, Win reactor)
    {
        return new SplitOutcome
        {
            Keep = trigger.Id,
            GiveWay = reactor.Id,
            GiveWayTo = env.Screen == ScreenClass.Single ? GiveWayTo.Minimized : GiveWayTo.OwnWorkspace,
        };
    }

    /// <summary>
    /// §10 step 3 / §16: the width (along the split axis) a window gets on its own
    /// escape workspace — its own size, clamped between one sixth of the screen and
    /// the whole screen. The escaping window keeps the slot-0 position.
    /// </summary>
    public static double EscapeSize(double screen, double requested) =>
        Math.Min(Math.Max(requested, JsRound(screen / 6)), screen);

    /// <summary>
    /// §10 step 2: a client refuses the requested split, so the **sibling adapts** —
    /// the refusing window keeps the size it insists on (`keepSize`) and the sibling
    /// takes the remainder, clamped to its own minimum (`siblingMinimum`). `escaped`
    /// is true only when the sibling cannot adapt either, so the pair cannot exist
    /// and step 3's impossible split decides who gives way. `screen` is the split
    /// extent available to the pair (work area minus the gaps).
    /// </summary>
    public static (double Sibling, bool Escaped) RefusalLadder(double keepSize, double siblingMinimum, double screen)
    {
        var sibling = Math.Min(Math.Max(screen - keepSize, siblingMinimum), screen);
        if (keepSize + sibling <= screen) return (sibling, false);
        return (screen, true);
    }

    /// <summary>The workspace at `index`, or null when the index is out of range.</summary>
    private static Ws? WorkspaceAt(State state, int index) =>
        index >= 0 && index < state.Workspaces.Count ? state.Workspaces[index] : null;

    /// <summary>The slot occupant at `index`, or null (the TS tuple is always two long).</summary>
    private static Win? Slot(Ws ws, int index) =>
        index >= 0 && index < ws.Slots.Count ? ws.Slots[index] : null;

    /// <summary>JS `Math.round` is floor(x + 0.5); C# `Math.Round` is half to even.</summary>
    private static double JsRound(double value) => Math.Floor(value + 0.5);
}
