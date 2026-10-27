// Port of src/core/topology.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text.Json.Serialization;
// The module's `ScreenRelation` function shares its name with the type; the alias
// keeps the function name while still naming the type in signatures.
using ScreenRelationValue = Adrt.Core.ScreenRelation;

namespace Adrt.Core;

/// <summary>A screen's own ratio class, independent of resolution.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum Orientation
{
    [JsonStringEnumMemberName("L")] L,
    [JsonStringEnumMemberName("P")] P,
}

/// <summary>
/// Where `j` sits relative to `i`: right/left (a row), below/above (a column),
/// diagonal, or overlapping.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum ScreenRelation
{
    [JsonStringEnumMemberName("R")] R,
    [JsonStringEnumMemberName("L")] L,
    [JsonStringEnumMemberName("D")] D,
    [JsonStringEnumMemberName("U")] U,
    [JsonStringEnumMemberName("X")] X,
    [JsonStringEnumMemberName("O")] O,
}

/// <summary>The shape classes the matrix covers.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum Arrangement
{
    [SuppressMessage("Naming", "CA1720:Identifier contains type name", Justification = "Wire name is 'single'.")]
    [JsonStringEnumMemberName("single")] Single,
    [JsonStringEnumMemberName("row")] Row,
    [JsonStringEnumMemberName("column")] Column,
    [JsonStringEnumMemberName("l")] L,
    [JsonStringEnumMemberName("grid")] Grid,
}

/// <summary>The minimal screen shape the signature needs. `Screen` satisfies it.</summary>
public sealed record TopologyScreen
{
    [JsonPropertyName("index")] public required int Index { get; init; }
    [JsonPropertyName("geometry")] public required Rect Geometry { get; init; }
}

/// <summary>One canonical topology the matrix can start a nested Shell for.</summary>
public sealed record TopologyCombination
{
    /// <summary>Stable short id; also names the `ADRT_TOPO_EXPECT` case.</summary>
    [JsonPropertyName("id")] public required string Id { get; init; }

    /// <summary>Screen count, 1-4.</summary>
    [JsonPropertyName("screens")] public required int Screens { get; init; }

    /// <summary>Canonical orientation string, spatial order.</summary>
    [JsonPropertyName("orientations")] public required string Orientations { get; init; }

    /// <summary>How the screens are arranged.</summary>
    [JsonPropertyName("arrangement")] public required Arrangement Arrangement { get; init; }

    /// <summary>`ADRT_MONITORS` spec that produces these orientations.</summary>
    [JsonPropertyName("monitors")] public required string Monitors { get; init; }

    /// <summary>The signature `TopologySignature` returns for this combination.</summary>
    [JsonPropertyName("signature")] public required string Signature { get; init; }

    /// <summary>Human label for the matrix report.</summary>
    [JsonPropertyName("label")] public required string Label { get; init; }
}

/// <summary>
/// Screen topology (§1, §6, §9): a resolution-independent description of how the
/// screens are arranged, plus the canonical enumeration of the arrangements the
/// test matrix covers.
///
/// # Why a signature
///
/// A monitor's pixel resolution must never decide what a test asserts. Two
/// laptops docked into the same physical shape — a portrait screen beside a
/// landscape one, two screens stacked — are the *same* topology however many
/// pixels each panel has. So the signature is built only from facts that do not
/// move when the resolution does:
///
///   * **count** — how many screens;
///   * **orientation** per screen — portrait (`height &gt; width`) or landscape;
///   * **relative arrangement** — for every pair, which side one is of the other,
///     derived from the geometry centres/edges (overlap on one axis and a gap on
///     the other), never from an absolute pixel.
///
/// The relative arrangement is deliberately *discrete*: a pair sharing a row is
/// "left/right" whether the seam is at 1280 or 2560 or whether the panels are
/// 1:1 or 2:1. Extent ratios only survive as the two classes that change how a
/// screen tiles — landscape (side by side) and portrait (stacked) — which is why
/// the orientation is part of the signature. That is the "ratios, not
/// resolutions" reading: the arrangement is a shape, and the shape is what the
/// tests gate on.
///
/// # Format
///
/// `"&lt;n&gt;:&lt;orientations&gt;:&lt;relations&gt;"`, e.g. `2:LP:01R`, `3:LLP:01R,02D,12X`.
///
///   * `&lt;n&gt;` — screen count.
///   * `&lt;orientations&gt;` — `L`/`P` per screen, in canonical spatial order: sorted
///     by top edge, then left edge, then index. A single row reads left to right;
///     a single column reads top to bottom; a grid reads row-major.
///   * `&lt;relations&gt;` — one `ij&lt;D&gt;` per unordered pair `i&lt;j` (indices into the
///     canonical order), where the direction `D` is `j` relative to `i`:
///       `R` right, `L` left, `U` above, `D` below, `X` diagonal, `O` overlapping.
///     A pair is "rowed" when their vertical spans overlap and their horizontal
///     spans do not, "columned" when the reverse, `X` when neither overlaps and
///     `O` in the (invalid) case both do.
///
/// The string is stable under translating or scaling the whole arrangement, and
/// under reordering the input array (it is canonicalised internally). It is what
/// a scenario compares against a declared value, so a case for a two-screen
/// topology can never run on a three-screen one.
///
/// # The canonical combinations
///
/// The test matrix covers every count from one to four, the orientation patterns
/// that matter for each, and the arrangements that matter (a single row, a single
/// column, an L at three, a 2x2 at four). Orientation patterns are taken up to
/// reversal (a row `LP` is the mirror of `PL`; the signature still distinguishes
/// the two because which screen is on the left is real, but the matrix only needs
/// one of them). Each non-row arrangement is exercised with the canonical mixed
/// pattern (`LP`, `LLP`, `LLPP`), so a single run shows both orientations in that
/// shape.
///
/// | count | orientations (canonical)   | arrangements        |
/// | ----- | -------------------------- | ------------------- |
/// | 1     | L, P                       | single              |
/// | 2     | LL, LP, PP                 | row, column         |
/// | 3     | LLL, LLP, LPP, PPP         | row, column, L      |
/// | 4     | LLLL, LLLP, LLPP, PPPP     | row, column, 2x2    |
///
/// `TopologyCombinations` is that set materialised, with the `ADRT_MONITORS`
/// spec that produces its orientations and the arrangement its real virtual
/// monitors are placed into. `scripts/topology-matrix.sh` walks the list: it
/// starts a nested Shell per combination, arranges the monitors, and runs the one
/// gated scenario that declares the signature.
///
/// Pure: no compositor import, no absolute pixels in the signature. See
/// `tests/core/topology.test.ts`.
/// </summary>
public static class Topology
{
    private static readonly Size LandscapeSize = new(1280, 800);
    private static readonly Size PortraitSize = new(800, 1280);

    /// <summary>Portrait iff the screen is taller than it is wide (§1, §6).</summary>
    public static Orientation OrientationOf(TopologyScreen screen) =>
        screen.Geometry.Height > screen.Geometry.Width ? Orientation.P : Orientation.L;

    private static double CentreX(TopologyScreen screen) => screen.Geometry.X + screen.Geometry.Width / 2;

    private static double CentreY(TopologyScreen screen) => screen.Geometry.Y + screen.Geometry.Height / 2;

    /// <summary>Overlap of two intervals; positive when they share pixels, 0 at a seam.</summary>
    private static double Overlap(double startA, double lengthA, double startB, double lengthB) =>
        Math.Min(startA + lengthA, startB + lengthB) - Math.Max(startA, startB);

    /// <summary>
    /// The relation from `a` to `b`, by geometry only. Sharing a row means the
    /// vertical spans overlap while the horizontal ones meet at a seam (or leave a
    /// gap); the reverse is a column; neither overlap is diagonal.
    /// </summary>
    public static ScreenRelationValue ScreenRelation(TopologyScreen a, TopologyScreen b)
    {
        var ga = a.Geometry;
        var gb = b.Geometry;
        var horizontalOverlap = Overlap(ga.X, ga.Width, gb.X, gb.Width);
        var verticalOverlap = Overlap(ga.Y, ga.Height, gb.Y, gb.Height);
        if (horizontalOverlap > 0 && verticalOverlap > 0) return ScreenRelationValue.O;
        if (verticalOverlap > 0) return CentreX(b) >= CentreX(a) ? ScreenRelationValue.R : ScreenRelationValue.L;
        if (horizontalOverlap > 0) return CentreY(b) >= CentreY(a) ? ScreenRelationValue.D : ScreenRelationValue.U;
        return ScreenRelationValue.X;
    }

    /// <summary>Top edge, then left edge, then index: the canonical reading order.</summary>
    private static List<TopologyScreen> CanonicalOrder(IReadOnlyList<TopologyScreen> screens)
    {
        var ordered = new List<TopologyScreen>(screens);
        ordered.Sort(CompareCanonical);
        return ordered;
    }

    private static int CompareCanonical(TopologyScreen a, TopologyScreen b)
    {
        var dy = a.Geometry.Y - b.Geometry.Y;
        if (dy != 0 && !double.IsNaN(dy)) return dy < 0 ? -1 : 1;
        var dx = a.Geometry.X - b.Geometry.X;
        if (dx != 0 && !double.IsNaN(dx)) return dx < 0 ? -1 : 1;
        return a.Index - b.Index;
    }

    /// <summary>
    /// The stable, resolution-independent signature of a screen list. Input order
    /// does not matter; the screens are canonicalised internally.
    /// </summary>
    public static string TopologySignature(IReadOnlyList<TopologyScreen> screens)
    {
        var ordered = CanonicalOrder(screens);
        var n = ordered.Count;
        if (n == 0) return "0::";
        var orientations = string.Concat(
            ordered.Select(screen => OrientationOf(screen) == Orientation.P ? 'P' : 'L'));
        var relations = new List<string>();
        for (var i = 0; i < n; i++)
        {
            for (var j = i + 1; j < n; j++)
            {
                relations.Add(FormattableString.Invariant(
                    $"{i}{j}{RelationChar(ScreenRelation(ordered[i], ordered[j]))}"));
            }
        }
        return FormattableString.Invariant($"{n}:{orientations}:{string.Join(",", relations)}");
    }

    private static char RelationChar(ScreenRelationValue relation) => relation switch
    {
        ScreenRelationValue.R => 'R',
        ScreenRelationValue.L => 'L',
        ScreenRelationValue.D => 'D',
        ScreenRelationValue.U => 'U',
        ScreenRelationValue.X => 'X',
        _ => 'O',
    };

    /// <summary>The screen count a signature describes, or 0 when it is malformed.</summary>
    public static int SignatureCount(string signature)
    {
        var first = signature.Split(':', 2)[0];
        return int.TryParse(first, NumberStyles.Integer, CultureInfo.InvariantCulture, out var count)
            ? count
            : 0;
    }

    /// <summary>The orientation string a signature carries (`"LP"`, `"LLP"` …).</summary>
    public static string SignatureOrientations(string signature)
    {
        var parts = signature.Split(':');
        return parts.Length > 1 ? parts[1] : string.Empty;
    }

    /// <summary>
    /// The grid cells each screen occupies, in screen order, for an arrangement. The
    /// matrix turns these into absolute positions (column widths and row heights);
    /// `ComboScreens` does the same in reverse for the signature unit tests.
    /// </summary>
    public static IReadOnlyList<(int Column, int Row)> ArrangementCells(Arrangement arrangement, int n)
    {
        switch (arrangement)
        {
            case Arrangement.Single:
                return new[] { (0, 0) };
            case Arrangement.Row:
            {
                var cells = new List<(int Column, int Row)>(Math.Max(0, n));
                for (var i = 0; i < n; i++) cells.Add((i, 0));
                return cells;
            }
            case Arrangement.Column:
            {
                var cells = new List<(int Column, int Row)>(Math.Max(0, n));
                for (var i = 0; i < n; i++) cells.Add((0, i));
                return cells;
            }
            case Arrangement.L:
                return new[] { (0, 0), (1, 0), (0, 1) };
            case Arrangement.Grid:
                return new[] { (0, 0), (1, 0), (0, 1), (1, 1) };
            default:
                return Array.Empty<(int Column, int Row)>();
        }
    }

    private static Size SizeFor(char orientation) =>
        orientation == 'P' ? PortraitSize : LandscapeSize;

    /// <summary>
    /// The geometry a combination lays out: each screen packed into its cell, cells
    /// sized to the widest/tallest member. This is exactly what the matrix's
    /// placement produces on the real virtual monitors, so the signature computed
    /// here is the one the harness must show.
    /// </summary>
    public static IReadOnlyList<TopologyScreen> ComboScreens(string orientations, Arrangement arrangement)
    {
        var n = orientations.Length;
        var cells = ArrangementCells(arrangement, n);
        var sizes = new List<Size>(n);
        foreach (var o in orientations) sizes.Add(SizeFor(o));
        var columnWidth = new Dictionary<int, double>();
        var rowHeight = new Dictionary<int, double>();
        for (var i = 0; i < cells.Count; i++)
        {
            var (column, row) = cells[i];
            var size = sizes[i];
            columnWidth[column] = Math.Max(
                columnWidth.TryGetValue(column, out var currentWidth) ? currentWidth : 0,
                size.Width);
            rowHeight[row] = Math.Max(
                rowHeight.TryGetValue(row, out var currentHeight) ? currentHeight : 0,
                size.Height);
        }
        double XOf(int column)
        {
            var x = 0d;
            for (var c = 0; c < column; c++) x += columnWidth.TryGetValue(c, out var width) ? width : 0;
            return x;
        }
        double YOf(int row)
        {
            var y = 0d;
            for (var r = 0; r < row; r++) y += rowHeight.TryGetValue(r, out var height) ? height : 0;
            return y;
        }
        var screens = new List<TopologyScreen>(cells.Count);
        for (var i = 0; i < cells.Count; i++)
        {
            var (column, row) = cells[i];
            var size = sizes[i];
            screens.Add(new TopologyScreen
            {
                Index = i,
                Geometry = new Rect(XOf(column), YOf(row), size.Width, size.Height),
            });
        }
        return screens;
    }

    /// <summary>The signature a combination must produce, computed from its own geometry.</summary>
    public static string CombinationSignature(string orientations, Arrangement arrangement) =>
        TopologySignature(ComboScreens(orientations, arrangement));

    private static TopologyCombination Combination(
        string id,
        string orientations,
        Arrangement arrangement,
        string label)
    {
        var monitors = string.Join(
            ":",
            orientations.Select(o => o == 'P' ? "800x1280" : "1280x800"));
        return new TopologyCombination
        {
            Id = id,
            Screens = orientations.Length,
            Orientations = orientations,
            Arrangement = arrangement,
            Monitors = monitors,
            Signature = CombinationSignature(orientations, arrangement),
            Label = label,
        };
    }

    /// <summary>
    /// Every canonical combination, 1-4 screens. See the table in the module comment:
    /// all orientation patterns for a row, plus each non-row arrangement with the
    /// canonical mixed pattern. Finite, documented, and the exact list
    /// `scripts/topology-matrix.sh` runs.
    /// </summary>
    public static readonly IReadOnlyList<TopologyCombination> TopologyCombinations = new[]
    {
        Combination("1l", "L", Arrangement.Single, "one landscape screen"),
        Combination("1p", "P", Arrangement.Single, "one portrait screen"),

        Combination("2ll-row", "LL", Arrangement.Row, "two landscape screens side by side"),
        Combination("2lp-row", "LP", Arrangement.Row, "a landscape and a portrait, side by side"),
        Combination("2pp-row", "PP", Arrangement.Row, "two portrait screens side by side"),
        Combination("2lp-col", "LP", Arrangement.Column, "a landscape above a portrait"),

        Combination("3lll-row", "LLL", Arrangement.Row, "three landscape in a row"),
        Combination("3llp-row", "LLP", Arrangement.Row, "two landscape then a portrait, in a row"),
        Combination("3lpp-row", "LPP", Arrangement.Row, "a landscape then two portrait, in a row"),
        Combination("3ppp-row", "PPP", Arrangement.Row, "three portrait in a row"),
        Combination("3llp-col", "LLP", Arrangement.Column, "two landscape above a portrait"),
        Combination("3llp-l", "LLP", Arrangement.L, "an L: two landscape in a row, a portrait below the left"),

        Combination("4llll-row", "LLLL", Arrangement.Row, "four landscape in a row"),
        Combination("4lllp-row", "LLLP", Arrangement.Row, "three landscape then a portrait, in a row"),
        Combination("4llpp-row", "LLPP", Arrangement.Row, "two landscape then two portrait, in a row"),
        Combination("4pppp-row", "PPPP", Arrangement.Row, "four portrait in a row"),
        Combination("4llpp-col", "LLPP", Arrangement.Column, "two landscape above two portrait"),
        Combination("4llpp-grid", "LLPP", Arrangement.Grid, "a 2x2 grid"),
    };
}
