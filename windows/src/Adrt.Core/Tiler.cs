// Port of src/core/tiler.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Globalization;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Adrt.Core;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum MinSizePolicy
{
    [JsonStringEnumMemberName("respect")] Respect,
    [JsonStringEnumMemberName("ignore")] Ignore,
    [JsonStringEnumMemberName("stack")] Stack,
}

/// <summary>Axis of a two-window split: `horizontal` = side by side, `vertical` = stacked.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SplitAxis
{
    [JsonStringEnumMemberName("horizontal")] Horizontal,
    [JsonStringEnumMemberName("vertical")] Vertical,
}

public sealed record TilerConfig
{
    [JsonPropertyName("gapBase")] public required double GapBase { get; init; }

    /// <summary>Negative values inherit `GapBase` (§6).</summary>
    [JsonPropertyName("gapPortrait")] public required double GapPortrait { get; init; }

    /// <summary>Negative values inherit `GapBase` (§6).</summary>
    [JsonPropertyName("gapLandscape")] public required double GapLandscape { get; init; }

    /// <summary>
    /// §10 per-side outer gaps. Default 0 (flush edge) when unset; a negative
    /// value inherits the resolved base gap (orientation override or `GapBase`).
    /// </summary>
    [JsonPropertyName("gapLeft")] public double? GapLeft { get; init; }

    [JsonPropertyName("gapRight")] public double? GapRight { get; init; }
    [JsonPropertyName("gapTop")] public double? GapTop { get; init; }
    [JsonPropertyName("gapBottom")] public double? GapBottom { get; init; }

    /// <summary>
    /// §10 gap at the split between the two windows. Unset or negative inherits the
    /// resolved base gap (orientation override or `GapBase`).
    /// </summary>
    [JsonPropertyName("gapBetween")] public double? GapBetween { get; init; }

    [JsonPropertyName("minSizePolicy")] public required MinSizePolicy MinSizePolicy { get; init; }
    [JsonPropertyName("primaryApps")] public required IReadOnlyList<string> PrimaryApps { get; init; }

    /// <summary>0..1, clamped to 0.2-0.8 when applied.</summary>
    [JsonPropertyName("primaryAppRatio")] public required double PrimaryAppRatio { get; init; }

    /// <summary>
    /// §10 ratios keyed by `connector:workspace:axis` (see `RatioKey`), fraction
    /// belonging to the sorted-first app of the pair.
    /// </summary>
    [JsonPropertyName("ratios")] public required IReadOnlyDictionary<string, double> Ratios { get; init; }

    /// <summary>Pair keys (`min|max`) whose sides are swapped.</summary>
    [JsonPropertyName("swapPairs")] public required HashSet<string> SwapPairs { get; init; }

    /// <summary>
    /// Orientation of the workspace layout (§6): with vertical workspaces the pair
    /// stacks top/bottom instead of left/right. Unset falls back to the monitor's
    /// own orientation.
    /// </summary>
    [JsonPropertyName("workspaceAxis")] public SplitAxis? WorkspaceAxis { get; init; }

    [JsonPropertyName("rules")] public required IReadOnlyList<Rule> Rules { get; init; }

    /// <summary>
    /// §6/§19.1 `reflow-keeps-edges`. When false, a lone tiled window keeps the
    /// rect it already occupies instead of expanding to fill the monitor.
    /// Defaults to true (fill).
    /// </summary>
    [JsonPropertyName("reflowKeepsEdges")] public bool? ReflowKeepsEdges { get; init; }
}

public sealed record TilerWindow
{
    [JsonPropertyName("id")] public required int Id { get; init; }
    [JsonPropertyName("appId")] public required string AppId { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }
    [JsonPropertyName("kind")] public required SurfaceKind Kind { get; init; }
    [JsonPropertyName("rect")] public required Rect Rect { get; init; }
    [JsonPropertyName("min")] public required Size Min { get; init; }
    [JsonPropertyName("max")] public required Size Max { get; init; }
    [JsonPropertyName("screenId")] public required int ScreenId { get; init; }
    [JsonPropertyName("workspaceId")] public required int WorkspaceId { get; init; }

    /// <summary>
    /// §3/§4: the slot the window's own change chose for it — a routed newcomer's
    /// slot 1, an unmaximized window joining slot 1. When both windows of a pair
    /// carry one, the tiler honours it instead of guessing from position.
    /// </summary>
    [JsonPropertyName("slot")] public int? Slot { get; init; }
}

public sealed record TilerInput
{
    [JsonPropertyName("windows")] public required IReadOnlyList<TilerWindow> Windows { get; init; }
    [JsonPropertyName("screens")] public required IReadOnlyList<Screen> Screens { get; init; }
    [JsonPropertyName("config")] public required TilerConfig Config { get; init; }
}

public sealed record RatioKeyParts
{
    [JsonPropertyName("connector")] public required string Connector { get; init; }
    [JsonPropertyName("workspaceId")] public required int WorkspaceId { get; init; }
    [JsonPropertyName("axis")] public required SplitAxis Axis { get; init; }
}

/// <summary>§10: the four outer insets and the split gap, resolved for one monitor.</summary>
public sealed record Gaps
{
    [JsonPropertyName("left")] public required double Left { get; init; }
    [JsonPropertyName("right")] public required double Right { get; init; }
    [JsonPropertyName("top")] public required double Top { get; init; }
    [JsonPropertyName("bottom")] public required double Bottom { get; init; }
    [JsonPropertyName("between")] public required double Between { get; init; }
}

public sealed record WorkspacePlan
{
    [JsonPropertyName("workspaceId")] public required int WorkspaceId { get; init; }
    [JsonPropertyName("screenId")] public required int ScreenId { get; init; }
    [JsonPropertyName("plan")] public required TilePlan Plan { get; init; }
}

public static class Tiler
{
    /// <summary>Anchored `connector:workspace:axis` key, as `parseRatioKey` accepts it.</summary>
    private static readonly Regex RatioKeyPattern =
        new("^([^:]+):([0-9]+):(horizontal|vertical)\\z", RegexOptions.CultureInvariant);

    public static string PairKey(double a, double b) =>
        a < b
            ? FormattableString.Invariant($"{a}|{b}")
            : FormattableString.Invariant($"{b}|{a}");

    /// <summary>
    /// §10: ratios are per workspace (per pair). A pair lives on one screen, and two
    /// screens can show the same workspace, so the key is
    /// `connector:workspace:axis`. The monitor is named by its connector (`eDP-1`,
    /// `HDMI-1`) rather than its index, so a replug or reorder cannot bind a saved
    /// ratio to the wrong screen. The old key was the app pair
    /// (`appA|appB|axis`), which leaked a ratio the user set on one pair to every
    /// later pair of the same apps — decision 14 says there is no app-pair ratio
    /// learning. The fraction stored is the sorted-first app's share (see
    /// `ResolveRatio`), so the pair is recognised regardless of which window opened
    /// first or sits on which side.
    /// </summary>
    public static string RatioKey(string connector, int workspaceId, SplitAxis axis) =>
        FormattableString.Invariant(
            $"{connector}:{workspaceId}:{(axis == SplitAxis.Horizontal ? "horizontal" : "vertical")}");

    /// <summary>
    /// Parse a `connector:workspace:axis` ratio key; null for a legacy app-pair key.
    /// The connector is any non-empty segment without a colon, so hyphenated names
    /// (`eDP-1`, `HDMI-1`) and the numeric form of an unmigrated legacy key both
    /// parse. `MigrateLegacyRatioKeys` resolves the numeric form before use.
    /// </summary>
    public static RatioKeyParts? ParseRatioKey(string key)
    {
        var match = RatioKeyPattern.Match(key);
        if (!match.Success) return null;
        return new RatioKeyParts
        {
            Connector = match.Groups[1].Value,
            WorkspaceId = int.Parse(match.Groups[2].Value, NumberStyles.None, CultureInfo.InvariantCulture),
            Axis = match.Groups[3].Value == "horizontal" ? SplitAxis.Horizontal : SplitAxis.Vertical,
        };
    }

    /// <summary>
    /// §23 migration: ratios persisted before keys named the monitor by connector
    /// used the monitor index (`0:2:horizontal`). Such a key can be bound to a
    /// different screen after a replug or reorder, so map each numeric first segment
    /// through the current `index → connector` table. A legacy key whose index has no
    /// live screen is dropped; keys that already name a connector pass through
    /// untouched. Pure, so the rewrite is unit-testable.
    /// </summary>
    public static Dictionary<string, double> MigrateLegacyRatioKeys(
        IReadOnlyDictionary<string, double> raw,
        IReadOnlyDictionary<int, string> connectorByIndex)
    {
        var output = new Dictionary<string, double>();
        foreach (var (key, value) in raw)
        {
            var colon = key.IndexOf(':');
            var first = colon == -1 ? key : key[..colon];
            if (colon == -1 || !IsAllDigits(first))
            {
                output[key] = value;
                continue;
            }
            if (!int.TryParse(first, NumberStyles.None, CultureInfo.InvariantCulture, out var index)) continue;
            if (!connectorByIndex.TryGetValue(index, out var connector)) continue;
            output[$"{connector}{key[colon..]}"] = value;
        }
        return output;
    }

    /// <summary>
    /// §23 migration: state persisted before ratios were workspace-scoped keyed them
    /// by app pair (`appA|appB|axis`). Such a key can never be applied under the new
    /// scheme, but leaving it in the map leaves dead state; drop everything that is
    /// not a valid workspace key so an old file is handled without crashing and is
    /// never misapplied.
    /// </summary>
    public static Dictionary<string, double> SanitizeRatios(IReadOnlyDictionary<string, double> raw)
    {
        var output = new Dictionary<string, double>();
        foreach (var (key, value) in raw)
        {
            if (ParseRatioKey(key) != null && double.IsFinite(value)) output[key] = value;
        }
        return output;
    }

    /// <summary>
    /// §10/§5: after the workspaces in `reaped` are removed, a reaped workspace
    /// drops its ratio and every workspace to its right shifts down one index, so
    /// its ratio moves with it. Without this a stale key would be misapplied to
    /// whatever workspace later reuses the vacated index. Legacy app-pair keys are
    /// dropped. Pure, so the shift is unit-testable.
    /// </summary>
    public static Dictionary<string, double> RemapRatiosAfterReap(
        IReadOnlyDictionary<string, double> ratios,
        IReadOnlyList<int> reaped)
    {
        if (reaped.Count == 0) return ratios.ToDictionary(entry => entry.Key, entry => entry.Value);
        var removed = new HashSet<int>(reaped);
        var output = new Dictionary<string, double>();
        foreach (var (key, value) in ratios)
        {
            var parts = ParseRatioKey(key);
            if (parts == null) continue;
            if (removed.Contains(parts.WorkspaceId)) continue;
            var workspaceId = parts.WorkspaceId;
            foreach (var index in reaped) if (index < workspaceId) workspaceId -= 1;
            output[RatioKey(parts.Connector, workspaceId, parts.Axis)] = value;
        }
        return output;
    }

    private static bool IsPortrait(Screen screen) => screen.Geometry.Height > screen.Geometry.Width;

    /// <summary>The area tiles may occupy: the work area (struts removed) or the monitor.</summary>
    public static Rect ScreenArea(Screen screen) => screen.WorkArea ?? screen.Geometry;

    /// <summary>
    /// §6/§10: the resolved base gap for a monitor. `gaps-portrait`/`gaps-landscape`
    /// override `gaps-base` per orientation; a negative override inherits the base.
    /// The between-window gap and any negative per-side gap inherit this value.
    /// </summary>
    private static double EffectiveGap(TilerConfig config, Screen screen)
    {
        var gapOverride = IsPortrait(screen) ? config.GapPortrait : config.GapLandscape;
        return gapOverride >= 0 ? gapOverride : config.GapBase;
    }

    /// <summary>
    /// §10: resolve the gaps for the monitor being planned, so "per-monitor gaps"
    /// follows that monitor's orientation. Outer sides default to 0 and a negative
    /// per-side value inherits the base; the between-window gap defaults to the base.
    /// </summary>
    public static Gaps ResolveGaps(TilerConfig config, Screen screen)
    {
        var baseGap = EffectiveGap(config, screen);
        double Outer(double? value)
        {
            if (value == null) return 0;
            return value.Value < 0 ? baseGap : value.Value;
        }
        var between = config.GapBetween == null || config.GapBetween.Value < 0 ? baseGap : config.GapBetween.Value;
        return new Gaps
        {
            Left = Outer(config.GapLeft),
            Right = Outer(config.GapRight),
            Top = Outer(config.GapTop),
            Bottom = Outer(config.GapBottom),
            Between = between,
        };
    }

    /// <summary>Inset a rect by each outer side independently (§10).</summary>
    private static Rect Inset(Rect rect, Gaps gaps) => new(
        rect.X + gaps.Left,
        rect.Y + gaps.Top,
        Math.Max(0, rect.Width - gaps.Left - gaps.Right),
        Math.Max(0, rect.Height - gaps.Top - gaps.Bottom));

    private static Rect FillRect(Rect avail, Size min, Rect area)
    {
        var width = Math.Min(Math.Max(avail.Width, min.Width), area.Width);
        var height = Math.Min(Math.Max(avail.Height, min.Height), area.Height);
        return new Rect(avail.X, avail.Y, width, height);
    }

    /// <summary>Keep a rect inside the tiling area without expanding it.</summary>
    private static Rect ClampRect(Rect rect, Size min, Rect area)
    {
        var width = Math.Max(min.Width, Math.Min(rect.Width, area.Width));
        var height = Math.Max(min.Height, Math.Min(rect.Height, area.Height));
        var x = Math.Max(area.X, Math.Min(rect.X, area.X + area.Width - width));
        var y = Math.Max(area.Y, Math.Min(rect.Y, area.Y + area.Height - height));
        return new Rect(x, y, width, height);
    }

    private static double AxisExtent(Rect rect, SplitAxis axis) =>
        axis == SplitAxis.Horizontal ? rect.Width : rect.Height;

    private sealed record SplitResult(Rect Rect0, Rect Rect1);

    /// <summary>
    /// §10/§25: reconcile the boundary between two tiles at a fractional scale.
    ///
    /// `SnapRect` rounds each tile's `x` and `width` independently, so at 125%/150%
    /// the two sides of the split can round in opposite directions — a sub-pixel
    /// seam where the pair should meet, or a 1 px overlap. Here the shared boundary
    /// is rounded *once* and both tiles are measured from it, so they meet exactly;
    /// `avail` has already been snapped inward (`SnapRectInward`), so the pair can
    /// never overhang the work area. The caller keeps the plain split at an integer
    /// scale, so scale 1/2 geometry is byte-identical.
    /// </summary>
    private static SplitResult ReconcileSplit(
        Rect rect0, Rect rect1, Rect avail, double gap, SplitAxis axis, double scale)
    {
        if (axis == SplitAxis.Horizontal)
        {
            var end = avail.X + avail.Width;
            var boundary = Types.Clamp(Types.Snap(rect0.X + rect0.Width, scale), avail.X, end);
            var between = Math.Max(0, Types.Snap(gap, scale));
            var secondStart = Math.Min(boundary + between, end);
            return new SplitResult(
                new Rect(avail.X, rect0.Y, Math.Max(0, boundary - avail.X), rect0.Height),
                new Rect(secondStart, rect1.Y, Math.Max(0, end - secondStart), rect1.Height));
        }
        var bottom = avail.Y + avail.Height;
        var yBoundary = Types.Clamp(Types.Snap(rect0.Y + rect0.Height, scale), avail.Y, bottom);
        var yBetween = Math.Max(0, Types.Snap(gap, scale));
        var ySecondStart = Math.Min(yBoundary + yBetween, bottom);
        return new SplitResult(
            new Rect(rect0.X, avail.Y, rect0.Width, Math.Max(0, yBoundary - avail.Y)),
            new Rect(rect1.X, ySecondStart, rect1.Width, Math.Max(0, bottom - ySecondStart)));
    }

    /// <summary>
    /// Split the available rect along `axis` at `ratio` (fraction for the first
    /// window), leaving one `gap` between the two windows. At a fractional scale the
    /// two tiles are reconciled so they meet exactly (see `ReconcileSplit`).
    /// </summary>
    private static SplitResult SplitAt(Rect avail, double gap, SplitAxis axis, double ratio, double scale)
    {
        var extent = AxisExtent(avail, axis);
        var split = Math.Max(0, extent - gap);
        var first = split * ratio;
        var second = split - first;
        Rect rect0;
        Rect rect1;
        if (axis == SplitAxis.Horizontal)
        {
            rect0 = new Rect(avail.X, avail.Y, first, avail.Height);
            rect1 = new Rect(avail.X + first + gap, avail.Y, second, avail.Height);
        }
        else
        {
            rect0 = new Rect(avail.X, avail.Y, avail.Width, first);
            rect1 = new Rect(avail.X, avail.Y + first + gap, avail.Width, second);
        }
        if (scale <= 1 || (double.IsFinite(scale) && scale == Math.Floor(scale)))
        {
            // A whole-number scale stores integer logical pixels, but a saved ratio can
            // be fractional — a drag writes the pointer fraction, e.g.
            // `2552 * 0.2421875 = 618.0625`. `Snap`/`SnapRect` deliberately leave a
            // whole-number scale byte-identical, so the fraction reached the plan and
            // Mutter truncated each argument on its own. Round the shared boundary once
            // and measure both tiles from it, so the pair still meets exactly (§25).
            var boundary = JsRound(first);
            if (axis == SplitAxis.Horizontal)
            {
                return new SplitResult(
                    rect0 with { Width = boundary },
                    new Rect(avail.X + boundary + gap, rect1.Y, Math.Max(0, extent - boundary - gap), rect1.Height));
            }
            return new SplitResult(
                rect0 with { Height = boundary },
                new Rect(rect1.X, avail.Y + boundary + gap, rect1.Width, Math.Max(0, extent - boundary - gap)));
        }
        return ReconcileSplit(rect0, rect1, avail, gap, axis, scale);
    }

    private static bool FitsAt(Rect avail, double gap, SplitAxis axis, Size min0, Size min1)
    {
        var split = AxisExtent(avail, axis) - gap;
        if (split <= 0) return false;
        var need = (axis == SplitAxis.Horizontal ? min0.Width : min0.Height) +
                   (axis == SplitAxis.Horizontal ? min1.Width : min1.Height);
        return split >= need;
    }

    private static double ClampRatioForMin(
        double ratio, Rect avail, double gap, SplitAxis axis, Size min0, Size min1)
    {
        var split = AxisExtent(avail, axis) - gap;
        if (split <= 0) return ratio;
        var m0 = axis == SplitAxis.Horizontal ? min0.Width : min0.Height;
        var m1 = axis == SplitAxis.Horizontal ? min1.Width : min1.Height;
        var minRatio = m0 / split;
        var maxRatio = 1 - m1 / split;
        return Types.Clamp(ratio, minRatio, maxRatio);
    }

    private static bool IsPrimary(string appId, IReadOnlyList<string> primaryApps) =>
        primaryApps.Contains(appId);

    /// <summary>Fraction of the split that belongs to window index 0.</summary>
    private static double ResolveRatio(
        TilerWindow w0, TilerWindow w1, SplitAxis axis, string connector, TilerConfig config)
    {
        if (config.Ratios.TryGetValue(RatioKey(connector, w0.WorkspaceId, axis), out var saved))
        {
            var w0First = string.CompareOrdinal(w0.AppId, w1.AppId) <= 0;
            return w0First ? saved : 1 - saved;
        }
        var p0 = IsPrimary(w0.AppId, config.PrimaryApps);
        var p1 = IsPrimary(w1.AppId, config.PrimaryApps);
        if (p0 != p1)
        {
            var primaryRatio = Types.Clamp(config.PrimaryAppRatio, 0.2, 0.8);
            return p0 ? primaryRatio : 1 - primaryRatio;
        }
        return 0.5;
    }

    /// <summary>
    /// Minimum-size stack fallback (§6): both windows at their minimum size,
    /// side by side when that fits, otherwise pinned to the two edges.
    /// </summary>
    private static SplitResult StackLayout(
        Rect avail, double gap, TilerWindow w0, TilerWindow w1, SplitAxis prefer, double scale)
    {
        var tries = prefer == SplitAxis.Horizontal
            ? new[] { SplitAxis.Horizontal, SplitAxis.Vertical }
            : new[] { SplitAxis.Vertical, SplitAxis.Horizontal };
        foreach (var axis in tries)
        {
            if (!FitsAt(avail, gap, axis, w0.Min, w1.Min)) continue;
            if (axis == SplitAxis.Horizontal)
            {
                return new SplitResult(
                    new Rect(avail.X, avail.Y, w0.Min.Width, Math.Min(w0.Min.Height, avail.Height)),
                    new Rect(
                        avail.X + avail.Width - w1.Min.Width,
                        avail.Y,
                        w1.Min.Width,
                        Math.Min(w1.Min.Height, avail.Height)));
            }
            return new SplitResult(
                new Rect(avail.X, avail.Y, avail.Width, Math.Min(w0.Min.Height, avail.Height)),
                new Rect(
                    avail.X,
                    avail.Y + avail.Height - Math.Min(w1.Min.Height, avail.Height),
                    avail.Width,
                    Math.Min(w1.Min.Height, avail.Height)));
        }
        // Neither minimum fits: split the available extent evenly so the plan stays
        // non-overlapping and inside the monitor.
        return SplitAt(avail, gap, prefer, 0.5, scale);
    }

    private static Placement Place(int id, Rect rect, Screen screen, int order, Size? max)
    {
        var width = max != null && max.Value.Width > 0 ? Math.Min(rect.Width, max.Value.Width) : rect.Width;
        var height = max != null && max.Value.Height > 0 ? Math.Min(rect.Height, max.Value.Height) : rect.Height;
        return new Placement
        {
            SurfaceId = id,
            Rect = Types.SnapRect(new Rect(rect.X, rect.Y, width, height), screen.Scale),
            Layer = Layer.Tiled,
            Order = order,
        };
    }

    private sealed record RuleOverride(TilerWindow Window, TileMode Mode);

    private static RuleOverride? FindRuleOverride(
        IReadOnlyList<TilerWindow> windows, IReadOnlyList<Rule> rules)
    {
        foreach (var win in windows.OrderBy(w => w.Id))
        {
            var context = new RuleContext
            {
                AppId = win.AppId,
                Title = win.Title,
                Kind = win.Kind,
                Transient = false,
            };
            var rule = Rules.FirstMatch(rules, context);
            if (rule == null) continue;
            // Classification owns `float` (§5): a rule-floated window is non-tileable, so
            // it can never reach `ComputePlans` as a tileable window. Skipping the float
            // rule here keeps the placement path purely placement, and lets a later
            // placement rule for the same window take effect instead of being masked.
            if (rule.Tile == TileMode.Float) continue;
            return new RuleOverride(win, rule.Tile);
        }
        return null;
    }

    /// <summary>
    /// §23 decision 91: a rule forces a tile placement for the matched window. `full`
    /// fills the monitor; `left-half`/`right-half` place the window in slot 0/1 along
    /// the screen's `axis` — the same `defaultAxis` the normal pair uses (decision 43),
    /// so an explicit `WorkspaceAxis` is honoured and a portrait screen stacks. The
    /// half-names are historical and axis-relative: on a vertical axis `left-half` is
    /// the **top** half and `right-half` the bottom. The sibling takes the other half
    /// at a 50/50 split.
    /// </summary>
    private static TilePlan ApplyRuleOverride(
        RuleOverride ruleOverride,
        TilerWindow w0,
        TilerWindow w1,
        Rect avail,
        double gap,
        SplitAxis axis,
        Screen screen)
    {
        var win = ruleOverride.Window;
        if (ruleOverride.Mode == TileMode.Full)
        {
            return new TilePlan
            {
                Placements = new[]
                {
                    Place(win.Id, FillRect(avail, win.Min, ScreenArea(screen)), screen, 0, win.Max),
                },
            };
        }
        var other = win.Id == w0.Id ? w1 : w0;
        var first = ruleOverride.Mode == TileMode.LeftHalf ? win : other;
        var second = ruleOverride.Mode == TileMode.LeftHalf ? other : win;
        var split = SplitAt(avail, gap, axis, 0.5, screen.Scale);
        return new TilePlan
        {
            Placements = new[]
            {
                Place(first.Id, split.Rect0, screen, 0, first.Max),
                Place(second.Id, split.Rect1, screen, 1, second.Max),
            },
        };
    }

    /// <summary>
    /// Order windows by where they actually are, so a pair's left window stays the
    /// left tile and its right window stays the right tile — even when a window was
    /// created or reordered out of id order. Ties fall back to the id.
    /// </summary>
    private static int ByRelativePosition(TilerWindow a, TilerWindow b)
    {
        var dx = a.Rect.X - b.Rect.X;
        if (Math.Abs(dx) > 1) return dx < 0 ? -1 : 1;
        var dy = a.Rect.Y - b.Rect.Y;
        if (Math.Abs(dy) > 1) return dy < 0 ? -1 : 1;
        return a.Id - b.Id;
    }

    /// <summary>
    /// Layout for the tileable windows of a single workspace and monitor (§6).
    /// Callers guarantee at most two windows; extras are ignored.
    /// </summary>
    public static TilePlan ComputePlans(
        IReadOnlyList<TilerWindow> windows, Screen screen, TilerConfig config)
    {
        var byId = windows.OrderBy(w => w.Id).ToList();
        if (byId.Count == 0) return new TilePlan { Placements = Array.Empty<Placement>() };

        var gaps = ResolveGaps(config, screen);
        var gap = gaps.Between;
        // §10/§25: fit the work area to the monitor's scale grid from the inside, so
        // a fractional strut edge can never push a tile past the work area. This is a
        // no-op at scale 1 and at integer scales.
        var avail = Types.SnapRectInward(Inset(ScreenArea(screen), gaps), screen.Scale);

        if (byId.Count == 1)
        {
            var only = byId[0];
            // `reflow-keeps-edges` false: keep the outer edges where the user left them.
            if (config.ReflowKeepsEdges == false && only.Rect.Width > 0 && only.Rect.Height > 0)
            {
                return new TilePlan
                {
                    Placements = new[]
                    {
                        Place(only.Id, ClampRect(only.Rect, only.Min, ScreenArea(screen)), screen, 0, only.Max),
                    },
                };
            }
            return new TilePlan
            {
                Placements = new[]
                {
                    Place(only.Id, FillRect(avail, only.Min, ScreenArea(screen)), screen, 0, only.Max),
                },
            };
        }

        // Sides follow where the windows actually are, so the left window keeps the
        // left tile. A pair the user marked *swapped* uses the stable id order
        // instead: sides that followed position would flip again once the swap moved
        // the windows, oscillating forever.
        var swapped = config.SwapPairs.Contains(PairKey(byId[0].Id, byId[1].Id));
        // §3/§4: an explicit slot (a routed arrival, an unmaximize joining slot 1, or
        // a swap the user made) wins over both the geometric guess and the swap flag.
        // A swap records the new sides as explicit slots, so it is invertible even
        // when the pair's position order already matches the reverse of its id order
        // (toggling the flag alone could then change nothing); the flag remains the
        // durable/restart form of the same fact.
        var explicit0 = byId.FirstOrDefault(w => w.Slot == 0);
        var explicit1 = byId.FirstOrDefault(w => w.Slot == 1);
        List<TilerWindow> ordered;
        if (explicit0 != null && explicit1 != null && explicit0.Id != explicit1.Id)
        {
            ordered = new List<TilerWindow> { explicit0, explicit1 };
        }
        else if (swapped)
        {
            ordered = Enumerable.Reverse(byId).ToList();
        }
        else
        {
            ordered = windows
                .OrderBy(w => w, Comparer<TilerWindow>.Create(ByRelativePosition))
                .ToList();
        }
        var w0 = ordered[0];
        var w1 = ordered[1];
        var defaultAxis = config.WorkspaceAxis ?? (IsPortrait(screen) ? SplitAxis.Vertical : SplitAxis.Horizontal);

        var ruleOverride = FindRuleOverride(new[] { w0, w1 }, config.Rules);
        if (ruleOverride != null) return ApplyRuleOverride(ruleOverride, w0, w1, avail, gap, defaultAxis, screen);

        var ratio = ResolveRatio(w0, w1, defaultAxis, screen.Connector, config);

        SplitResult split;
        if (config.MinSizePolicy == MinSizePolicy.Stack)
        {
            split = StackLayout(avail, gap, w0, w1, defaultAxis, screen.Scale);
        }
        else if (config.MinSizePolicy == MinSizePolicy.Ignore)
        {
            split = SplitAt(avail, gap, defaultAxis, Types.Clamp(ratio, 0.05, 0.95), screen.Scale);
        }
        else
        {
            var order = defaultAxis == SplitAxis.Horizontal
                ? new[] { SplitAxis.Horizontal, SplitAxis.Vertical }
                : new[] { SplitAxis.Vertical, SplitAxis.Horizontal };
            SplitAxis? chosen = null;
            foreach (var axis in order)
            {
                if (!FitsAt(avail, gap, axis, w0.Min, w1.Min)) continue;
                chosen = axis;
                break;
            }
            if (chosen == null)
            {
                split = StackLayout(avail, gap, w0, w1, defaultAxis, screen.Scale);
            }
            else
            {
                var baseRatio = ResolveRatio(w0, w1, chosen.Value, screen.Connector, config);
                var clamped = ClampRatioForMin(
                    Types.Clamp(baseRatio, 0.05, 0.95), avail, gap, chosen.Value, w0.Min, w1.Min);
                split = SplitAt(avail, gap, chosen.Value, clamped, screen.Scale);
            }
        }

        return new TilePlan
        {
            Placements = new[]
            {
                Place(w0.Id, split.Rect0, screen, 0, w0.Max),
                Place(w1.Id, split.Rect1, screen, 1, w1.Max),
            },
        };
    }

    /// <summary>Group windows by workspace + monitor and compute a plan for each group.</summary>
    public static IReadOnlyList<WorkspacePlan> LayoutAll(TilerInput input)
    {
        var groups = new Dictionary<string, List<TilerWindow>>();
        var groupOrder = new List<string>();
        foreach (var win in input.Windows)
        {
            var key = FormattableString.Invariant($"{win.WorkspaceId}:{win.ScreenId}");
            if (!groups.TryGetValue(key, out var list))
            {
                list = new List<TilerWindow>();
                groups[key] = list;
                groupOrder.Add(key);
            }
            list.Add(win);
        }
        var screenById = new Dictionary<int, Screen>();
        foreach (var screen in input.Screens) screenById[screen.Index] = screen;
        var output = new List<WorkspacePlan>();
        foreach (var key in groupOrder)
        {
            var separator = key.IndexOf(':');
            var workspaceId = int.Parse(key[..separator], NumberStyles.Integer, CultureInfo.InvariantCulture);
            var screenId = int.Parse(key[(separator + 1)..], NumberStyles.Integer, CultureInfo.InvariantCulture);
            if (!screenById.TryGetValue(screenId, out var screen)) continue;
            output.Add(new WorkspacePlan
            {
                WorkspaceId = workspaceId,
                ScreenId = screenId,
                Plan = ComputePlans(groups[key], screen, input.Config),
            });
        }
        return output;
    }

    private static bool IsAllDigits(string value)
    {
        if (value.Length == 0) return false;
        foreach (var ch in value)
        {
            if (!char.IsAsciiDigit(ch)) return false;
        }
        return true;
    }

    /// <summary>JS `Math.round` is floor(x + 0.5); C# `Math.Round` is half to even.</summary>
    private static double JsRound(double value) => Math.Floor(value + 0.5);
}
