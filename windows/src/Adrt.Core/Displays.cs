// Port of src/core/displays.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>The physical side a rescued workspace is inserted on.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum DisplaySide
{
    [JsonStringEnumMemberName("left")] Left,
    [JsonStringEnumMemberName("right")] Right,
}

/// <summary>One window as the arrangement records it (only what §9 needs).</summary>
public sealed record DisplayWindow
{
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("maximized")] public bool? Maximized { get; init; }
    [JsonPropertyName("fullscreen")] public bool? Fullscreen { get; init; }

    /// <summary>Last known rect; used by the memory and by float replay.</summary>
    [JsonPropertyName("rect")] public Rect? Rect { get; init; }

    /// <summary>Compositor stacking position; a float is restored to it exactly.</summary>
    [JsonPropertyName("z")] public int? Z { get; init; }
}

/// <summary>One workspace of a screen: visible slots plus hidden windows.</summary>
public sealed record DisplayWorkspace
{
    [JsonPropertyName("id")] public required int Id { get; init; }

    /// <summary>Index of the screen displaying this workspace.</summary>
    [JsonPropertyName("screen")] public required int Screen { get; init; }

    [JsonPropertyName("slots")] public required IReadOnlyList<DisplayWindow?> Slots { get; init; }
    [JsonPropertyName("minimized")] public required IReadOnlyList<DisplayWindow> Minimized { get; init; }
    [JsonPropertyName("floats")] public IReadOnlyList<DisplayWindow>? Floats { get; init; }
}

/// <summary>A snapshot of the displays: the screens and every workspace's arrangement.</summary>
public sealed record DisplayState
{
    [JsonPropertyName("screens")] public required IReadOnlyList<Screen> Screens { get; init; }
    [JsonPropertyName("workspaces")] public required IReadOnlyList<DisplayWorkspace> Workspaces { get; init; }

    /// <summary>Id of the workspace the user is viewing (never changed here).</summary>
    [JsonPropertyName("viewed")] public required int Viewed { get; init; }
}

/// <summary>A window §9 remembers, keyed by the connector entry that holds it.</summary>
public sealed record RememberedWindow
{
    [JsonPropertyName("id")] public required int Id { get; init; }

    /// <summary>Ordinal of the workspace within the connector's workspace list.</summary>
    [JsonPropertyName("workspace")] public required int Workspace { get; init; }

    /// <summary>The slot it held while visible; absent for a minimized window.</summary>
    [JsonPropertyName("slot")] public int? Slot { get; init; }

    [JsonPropertyName("minimized")] public required bool Minimized { get; init; }
    [JsonPropertyName("floating")] public required bool Floating { get; init; }
    [JsonPropertyName("maximized")] public required bool Maximized { get; init; }
    [JsonPropertyName("fullscreen")] public required bool Fullscreen { get; init; }
    [JsonPropertyName("rect")] public required Rect Rect { get; init; }

    /// <summary>Compositor stacking position; a float replays back onto it exactly.</summary>
    [JsonPropertyName("z")] public int? Z { get; init; }
}

/// <summary>The remembered arrangement of one connector.</summary>
public sealed record MemoryEntry
{
    [JsonPropertyName("connector")] public required string Connector { get; init; }

    /// <summary>Timestamp the entry was last written, for the TTL.</summary>
    [JsonPropertyName("at")] public required double At { get; init; }

    [JsonPropertyName("windows")] public required IReadOnlyList<RememberedWindow> Windows { get; init; }
}

// DisplayMemory = readonly MemoryEntry[] in the TypeScript; use IReadOnlyList<MemoryEntry>.

/// <summary>
/// A workspace the plan asks to create. Windows that share a <see cref="Key"/> share the
/// workspace; the plan emits them in source order.
/// </summary>
public sealed record NewWorkspace
{
    /// <summary>Placeholder id (negative, unique within the plan) grouping its windows.</summary>
    [JsonPropertyName("key")] public required int Key { get; init; }

    /// <summary>Insert relative to this existing workspace id (the current one).</summary>
    [JsonPropertyName("anchor")] public required int Anchor { get; init; }
    [JsonPropertyName("side")] public required DisplaySide Side { get; init; }

    /// <summary>Insert before every other workspace, not merely left of the anchor.</summary>
    [JsonPropertyName("leftmost")] public bool? Leftmost { get; init; }

    /// <summary>Index of the screen that creates it (the primary).</summary>
    [JsonPropertyName("screen")] public required int Screen { get; init; }
}

/// <summary>One window the drain should move.</summary>
public sealed record DisplayMove
{
    [JsonPropertyName("id")] public required int Id { get; init; }

    /// <summary>Target workspace id, when it already exists.</summary>
    [JsonPropertyName("workspace")] public int? Workspace { get; init; }

    /// <summary>A workspace to create for this window.</summary>
    [JsonPropertyName("create")] public NewWorkspace? Create { get; init; }

    /// <summary>The screen the window is routed back onto (a reconnect replay).</summary>
    [JsonPropertyName("screen")] public int? Screen { get; init; }

    [JsonPropertyName("slot")] public int? Slot { get; init; }

    /// <summary>Arrive minimized (a rescued or replayed minimized window).</summary>
    [JsonPropertyName("minimize")] public bool? Minimize { get; init; }

    /// <summary>Arrive as a float (a primary change's extra window, or a float replay).</summary>
    [JsonPropertyName("float")] public bool? Float { get; init; }

    /// <summary>Keep the window fullscreen on arrival (decision 88).</summary>
    [JsonPropertyName("fullscreen")] public bool? Fullscreen { get; init; }

    /// <summary>Arrive alone on its workspace, so it is maximized.</summary>
    [JsonPropertyName("maximize")] public bool? Maximize { get; init; }

    /// <summary>
    /// The exact frame a float is restored to. Only floats carry one: a tiled
    /// window's rect is recomputed by the tiler, a float's is the user's.
    /// </summary>
    [JsonPropertyName("rect")] public Rect? Rect { get; init; }

    /// <summary>The exact stacking position a float is restored to.</summary>
    [JsonPropertyName("z")] public int? Z { get; init; }
}

/// <summary>Read-from-GNOME context the policy needs but the arrangement does not hold.</summary>
public sealed record DisplayEnv
{
    /// <summary>Wall clock used for the memory TTL.</summary>
    [JsonPropertyName("now")] public required double Now { get; init; }

    /// <summary>How long a remembered connector survives (§9, default 30 min).</summary>
    [JsonPropertyName("ttlMs")] public required double TtlMs { get; init; }

    /// <summary>
    /// GNOME's class per connector (§1). Defaults to the GNOME default of
    /// `dynamic` on the primary screen and `single` elsewhere; adrt never infers
    /// the class itself.
    /// </summary>
    [JsonPropertyName("classes")] public IReadOnlyDictionary<string, ScreenClass>? Classes { get; init; }

    /// <summary>
    /// Instance ids that still exist in the session. Memory windows that are gone
    /// are dropped; omitted means "every remembered window still exists".
    /// </summary>
    [JsonPropertyName("alive")] public IReadOnlyList<int>? Alive { get; init; }
}

/// <summary>What the drain should do after a display change (§9).</summary>
public sealed record DisplayPlan
{
    [JsonPropertyName("moves")] public required IReadOnlyList<DisplayMove> Moves { get; init; }

    /// <summary>Memory entries to write (upsert), keyed by connector.</summary>
    [JsonPropertyName("remember")] public required IReadOnlyList<MemoryEntry> Remember { get; init; }

    /// <summary>Connectors whose memory is gone (TTL, or nothing left to replay).</summary>
    [JsonPropertyName("forget")] public required IReadOnlyList<string> Forget { get; init; }
}

/// <summary>The side/leftmost pair `rescueSide` returns (an inline object in the TypeScript).</summary>
public readonly record struct RescueSideResult(
    [property: JsonPropertyName("side")] DisplaySide Side,
    [property: JsonPropertyName("leftmost")] bool Leftmost);

/// <summary>
/// Displays and docking (§9, decisions 17/36/40/66/67).
///
/// Pure: it compares the screen list and workspace arrangements before and after
/// a hardware/primary change and returns a decision — which windows to move
/// where, which screen memory to (re)write, and which memory to drop. The adapter
/// turns that into Mutter calls.
///
/// The rules, in one place:
///   * **Disconnect** — a vanished screen's windows move to the primary, grouped
///     into as many fresh workspaces as the source workspaces need (two windows
///     per workspace), inserted adjacent to the current workspace on the physical
///     side the screen was on (right → right; left, above, below → left, leftmost
///     when other screens were already to the left). The arrangement is kept: a
///     pair stays a pair, a single stays a single, minimized stays minimized, a
///     float stays a float, fullscreen is preserved. It never scavenges a free
///     slot on a workspace that was not the vanished screen's, and the view never
///     moves.
///   * **Reconnect** — a remembered connector replays its previous state: slots,
///     minimized, floats and fullscreen, matched by instance id, clamped by the
///     adapter into the fresh work area. It never floats a window and never
///     creates beyond what memory holds; a window opened while the screen was
///     away is not in memory and is left alone.
///   * **Memory** is keyed by connector, with a TTL (`forget`).
///   * **Primary** — adrt never sets it; a primary change is followed, not
///     caused. It moves no window between screens: the screen that loses
///     workspace capability shows everything it held at once, and the extra
///     windows from its other workspaces become **floats** over the pair that
///     stays (decision 67).
///   * The screen class (dynamic / single / fixed) is read from GNOME
///     (`env.classes`), never inferred from internal vs external.
/// </summary>
public static class Displays
{
    /// <summary>Whether a workspace holds anything at all (visible, minimized or floating).</summary>
    public static bool HoldsWindows(DisplayWorkspace ws) =>
        ws.Slots[0] is not null ||
        ws.Slots[1] is not null ||
        ws.Minimized.Count > 0 ||
        (ws.Floats?.Count ?? 0) > 0;

    /// <summary>Every window of a workspace, visible first, then minimized, then floats.</summary>
    private static List<DisplayWindow> WorkspaceWindows(DisplayWorkspace ws)
    {
        var windows = new List<DisplayWindow>();
        foreach (var slot in ws.Slots) if (slot is not null) windows.Add(slot);
        windows.AddRange(ws.Minimized);
        var floats = ws.Floats;
        if (floats is not null) windows.AddRange(floats);
        return windows;
    }

    /// <summary>How many windows are visible in a workspace's two slots (§5).</summary>
    public static int VisibleCount(DisplayWorkspace ws) =>
        (ws.Slots[0] is null ? 0 : 1) + (ws.Slots[1] is null ? 0 : 1);

    /// <summary>The workspaces a screen displays, in order.</summary>
    private static List<DisplayWorkspace> ScreenWorkspaces(DisplayState state, int screen) =>
        state.Workspaces.Where(ws => ws.Screen == screen).ToList();

    private static Screen? PrimaryOf(DisplayState state) =>
        state.Screens.FirstOrDefault(screen => screen.IsPrimary);

    private static ScreenClass ClassOf(Screen screen, DisplayEnv env)
    {
        var classes = env.Classes;
        if (classes is not null && classes.TryGetValue(screen.Connector, out var cls)) return cls;
        return screen.IsPrimary ? ScreenClass.Dynamic : ScreenClass.Single;
    }

    /// <summary>Every connector in a screen list.</summary>
    private static HashSet<string> Connectors(IReadOnlyList<Screen> screens)
    {
        var set = new HashSet<string>();
        foreach (var screen in screens) set.Add(screen.Connector);
        return set;
    }

    /// <summary>Every window id the arrangement currently displays.</summary>
    private static HashSet<int> DisplayedIds(DisplayState state)
    {
        var ids = new HashSet<int>();
        foreach (var ws in state.Workspaces)
        {
            foreach (var win in WorkspaceWindows(ws)) ids.Add(win.Id);
        }
        return ids;
    }

    /// <summary>The physical side the vanished screen sat on, and whether to insert leftmost.</summary>
    public static RescueSideResult RescueSide(
        Screen vanished,
        Screen primary,
        IReadOnlyList<Screen> screens)
    {
        var vanishedX = vanished.Geometry.X + vanished.Geometry.Width / 2;
        var primaryX = primary.Geometry.X + primary.Geometry.Width / 2;
        if (vanishedX > primaryX) return new RescueSideResult(DisplaySide.Right, false);
        var leftmost = screens.Any(
            screen => !ReferenceEquals(screen, vanished) &&
                      !ReferenceEquals(screen, primary) &&
                      screen.Geometry.X + screen.Geometry.Width / 2 < primaryX);
        return new RescueSideResult(DisplaySide.Left, leftmost);
    }

    /// <summary>The remembered arrangement of one screen.</summary>
    private static MemoryEntry Snapshot(string connector, DisplayState state, int screen, double at)
    {
        var windows = new List<RememberedWindow>();
        var screenWorkspaces = ScreenWorkspaces(state, screen);
        for (var ordinal = 0; ordinal < screenWorkspaces.Count; ordinal++)
        {
            var ws = screenWorkspaces[ordinal];
            for (var slot = 0; slot < ws.Slots.Count; slot++)
            {
                var win = ws.Slots[slot];
                if (win is null) continue;
                windows.Add(new RememberedWindow
                {
                    Id = win.Id,
                    Workspace = ordinal,
                    Slot = slot,
                    Minimized = false,
                    Floating = false,
                    Maximized = win.Maximized == true,
                    Fullscreen = win.Fullscreen == true,
                    Rect = win.Rect ?? new Rect(0, 0, 0, 0),
                });
            }
            foreach (var win in ws.Minimized)
            {
                windows.Add(new RememberedWindow
                {
                    Id = win.Id,
                    Workspace = ordinal,
                    Minimized = true,
                    Floating = false,
                    Maximized = win.Maximized == true,
                    Fullscreen = win.Fullscreen == true,
                    Rect = win.Rect ?? new Rect(0, 0, 0, 0),
                });
            }
            foreach (var win in ws.Floats ?? Array.Empty<DisplayWindow>())
            {
                windows.Add(new RememberedWindow
                {
                    Id = win.Id,
                    Workspace = ordinal,
                    Minimized = false,
                    Floating = true,
                    Maximized = win.Maximized == true,
                    Fullscreen = win.Fullscreen == true,
                    Rect = win.Rect ?? new Rect(0, 0, 0, 0),
                    Z = win.Z,
                });
            }
        }
        return new MemoryEntry { Connector = connector, At = at, Windows = windows };
    }

    /// <summary>The move a replayed remembered window gets, or null when it cannot land.</summary>
    private static DisplayMove? ReplayMove(RememberedWindow rw, DisplayWorkspace target)
    {
        if (rw.Floating)
        {
            // A float's frame and stacking are the user's; replay them exactly, never
            // re-centre or re-stack. `screen` routes it back onto the reconnected screen.
            return new DisplayMove
            {
                Id = rw.Id,
                Workspace = target.Id,
                Screen = target.Screen,
                Float = true,
                Rect = rw.Rect,
                Z = rw.Z,
                Fullscreen = rw.Fullscreen ? true : null,
            };
        }
        if (rw.Minimized)
        {
            return new DisplayMove
            {
                Id = rw.Id,
                Workspace = target.Id,
                Screen = target.Screen,
                Minimize = true,
                Fullscreen = rw.Fullscreen ? true : null,
            };
        }
        var slot = rw.Slot == 0 ? 0 : 1;
        var occupant = target.Slots[slot];
        if (occupant is not null) return null; // the slot was taken meanwhile; partial replay
        return new DisplayMove
        {
            Id = rw.Id,
            Workspace = target.Id,
            Screen = target.Screen,
            Slot = slot,
            Fullscreen = rw.Fullscreen ? true : null,
        };
    }

    /// <summary>
    /// The display plan (§9). Pure: no compositor tokens, no side effects — the
    /// adapter applies `moves`, persists `remember` and drops `forget`.
    /// </summary>
    public static DisplayPlan DisplayPlan(
        DisplayState prev,
        DisplayState next,
        IReadOnlyList<MemoryEntry> memory,
        DisplayEnv env)
    {
        var moves = new List<DisplayMove>();
        var remember = new List<MemoryEntry>();
        var forget = new List<string>();

        var prevConnectors = Connectors(prev.Screens);
        var nextConnectors = Connectors(next.Screens);
        var displayed = DisplayedIds(next);
        var alive = env.Alive;
        var aliveSet = alive is null ? null : new HashSet<int>(alive);
        bool IsAlive(int id) => aliveSet is null || aliveSet.Contains(id);

        // --- TTL: memory for a connector that is gone and has expired is dropped ----
        foreach (var entry in memory)
        {
            if (nextConnectors.Contains(entry.Connector)) continue;
            if (env.Now - entry.At > env.TtlMs) forget.Add(entry.Connector);
        }

        // --- Disconnect: rescue a vanished screen's windows to the primary ----------
        var createKey = -1; // plan-wide, so two vanished screens never share a key
        foreach (var screen in prev.Screens)
        {
            if (nextConnectors.Contains(screen.Connector)) continue;
            remember.Add(Snapshot(screen.Connector, prev, screen.Index, env.Now));

            var primary = PrimaryOf(next);
            if (primary is null) continue;
            if (ClassOf(primary, env) != ScreenClass.Dynamic) continue; // only a screen that can create

            var rescue = RescueSide(screen, primary, prev.Screens);
            var side = rescue.Side;
            var leftmost = rescue.Leftmost;
            var source = ScreenWorkspaces(prev, screen.Index).Where(HoldsWindows).ToList();
            foreach (var ws in source)
            {
                var create = new NewWorkspace
                {
                    Key = createKey,
                    Anchor = next.Viewed,
                    Side = side,
                    Screen = primary.Index,
                    Leftmost = leftmost ? true : null,
                };
                createKey -= 1;
                var lone = VisibleCount(ws) == 1;

                for (var slot = 0; slot < ws.Slots.Count; slot++)
                {
                    var win = ws.Slots[slot];
                    if (win is null) continue;
                    if (displayed.Contains(win.Id)) continue; // a surviving screen already shows it
                    moves.Add(new DisplayMove
                    {
                        Id = win.Id,
                        Create = create,
                        Slot = slot,
                        Maximize = lone ? true : null,
                        Fullscreen = win.Fullscreen == true ? true : null,
                    });
                }
                foreach (var win in ws.Minimized)
                {
                    if (displayed.Contains(win.Id)) continue;
                    moves.Add(new DisplayMove
                    {
                        Id = win.Id,
                        Create = create,
                        Minimize = true,
                        Fullscreen = win.Fullscreen == true ? true : null,
                    });
                }
                foreach (var win in ws.Floats ?? Array.Empty<DisplayWindow>())
                {
                    if (displayed.Contains(win.Id)) continue;
                    moves.Add(new DisplayMove
                    {
                        Id = win.Id,
                        Create = create,
                        Float = true,
                        // A float's frame and stacking are the user's: carry them so the
                        // rescue restores the window exactly instead of re-centring it.
                        Rect = win.Rect,
                        Z = win.Z,
                        Fullscreen = win.Fullscreen == true ? true : null,
                    });
                }
            }
        }

        // --- Reconnect: replay a remembered connector's previous state --------------
        foreach (var entry in memory)
        {
            if (prevConnectors.Contains(entry.Connector)) continue; // it stayed connected
            var screen = next.Screens.FirstOrDefault(candidate => candidate.Connector == entry.Connector);
            if (screen is null) continue; // not reconnected
            if (env.Now - entry.At > env.TtlMs)
            {
                forget.Add(entry.Connector); // expired: leave it alone and drop it
                continue;
            }

            var workspaces = ScreenWorkspaces(next, screen.Index);
            var replayed = new List<RememberedWindow>();
            foreach (var rw in entry.Windows)
            {
                if (!IsAlive(rw.Id)) continue; // the window is gone
                if (rw.Workspace < 0 || rw.Workspace >= workspaces.Count) continue; // never create beyond memory
                var target = workspaces[rw.Workspace];
                var move = ReplayMove(rw, target);
                if (move is not null) moves.Add(move);
                replayed.Add(rw);
            }
            if (replayed.Count > 0) remember.Add(new MemoryEntry { Connector = entry.Connector, At = env.Now, Windows = replayed });
            else forget.Add(entry.Connector);
        }

        // --- Primary change: follow it; move no window between screens ---------------
        var prevPrimary = PrimaryOf(prev);
        var nextPrimary = PrimaryOf(next);
        if (
            prevPrimary is not null &&
            nextPrimary is not null &&
            prevPrimary.Connector != nextPrimary.Connector
        )
        {
            var old = next.Screens.FirstOrDefault(candidate => candidate.Connector == prevPrimary.Connector);
            if (old is not null)
            {
                var workspaces = ScreenWorkspaces(next, old.Index);
                if (workspaces.Count > 0)
                {
                    var viewed = workspaces.FirstOrDefault(ws => ws.Id == next.Viewed);
                    var surviving = viewed ?? workspaces.FirstOrDefault(HoldsWindows) ?? workspaces[0];
                    foreach (var ws in workspaces)
                    {
                        if (ws.Id == surviving.Id) continue;
                        foreach (var win in WorkspaceWindows(ws))
                        {
                            moves.Add(new DisplayMove
                            {
                                Id = win.Id,
                                Workspace = surviving.Id,
                                Float = true,
                                Fullscreen = win.Fullscreen == true ? true : null,
                            });
                        }
                    }
                }
            }
        }

        // A connector that is being remembered is never also forgotten.
        var remembered = new HashSet<string>(remember.Select(entry => entry.Connector));
        return new DisplayPlan
        {
            Moves = moves,
            Remember = remember,
            Forget = forget.Where(connector => !remembered.Contains(connector)).ToList(),
        };
    }
}
