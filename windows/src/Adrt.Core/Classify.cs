// Port of src/core/classify.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>
/// Why a surface is not tiled. Ordered exactly as the checks in §5.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SkipReason
{
    [JsonStringEnumMemberName("skip-taskbar")] SkipTaskbar,
    [JsonStringEnumMemberName("override-redirect")] OverrideRedirect,
    [JsonStringEnumMemberName("on-all-workspaces")] OnAllWorkspaces,
    [JsonStringEnumMemberName("fullscreen")] Fullscreen,
    [JsonStringEnumMemberName("above")] Above,
    [JsonStringEnumMemberName("exception-app")] ExceptionApp,
    [JsonStringEnumMemberName("rule-float")] RuleFloat,
    [JsonStringEnumMemberName("floating")] Floating,
    [JsonStringEnumMemberName("non-tileable-kind")] NonTileableKind,
    [JsonStringEnumMemberName("min-equals-max")] MinEqualsMax,
    [JsonStringEnumMemberName("transient")] Transient,
    [JsonStringEnumMemberName("modal")] Modal,
    [JsonStringEnumMemberName("attached-dialog")] AttachedDialog,
    [JsonStringEnumMemberName("heuristic-modal")] HeuristicModal,
}

public sealed record Classification
{
    [JsonPropertyName("tileable")] public required bool Tileable { get; init; }
    [JsonPropertyName("layer")] public required Layer Layer { get; init; }

    /// <summary>null when tileable.</summary>
    [JsonPropertyName("reason")] public required SkipReason? Reason { get; init; }

    /// <summary>true when the surface is treated as a modal rather than merely ignored.</summary>
    [JsonPropertyName("modal")] public required bool Modal { get; init; }
}

public sealed record ClassifyConfig
{
    [JsonPropertyName("exceptionApps")] public required IReadOnlyList<string> ExceptionApps { get; init; }

    /// <summary>User rules. Only a `float` match changes classification; placement rules are the tiler's.</summary>
    [JsonPropertyName("rules")] public required IReadOnlyList<Rule> Rules { get; init; }

    [JsonPropertyName("heuristicModalDetect")] public required bool HeuristicModalDetect { get; init; }
}

public sealed record HeuristicContext
{
    /// <summary>Titles of other live windows, used by the heuristic modal check (§5).</summary>
    [JsonPropertyName("liveTitles")] public required IReadOnlyList<string> LiveTitles { get; init; }
}

public static class Classify
{
    /// <summary>Reasons that intentionally make a surface a modal relative to tiling.</summary>
    private static readonly IReadOnlySet<SkipReason> ModalReasons = new HashSet<SkipReason>
    {
        SkipReason.Transient,
        SkipReason.Modal,
        SkipReason.AttachedDialog,
        SkipReason.HeuristicModal,
    };

    /// <summary>
    /// Layer derivation from surface flags/kind alone (§3). Deterministic and
    /// independent of classification so `Surface.layer` is cheap to compute.
    /// </summary>
    public static Layer LayerFor(Surface surface)
    {
        var f = surface.Flags;
        if (f.Modal || f.Transient || f.AttachedDialog) return Layer.Modal;
        if (surface.Kind is SurfaceKind.Modal or SurfaceKind.Dialog) return Layer.Modal;
        if (f.Above || f.Floating) return Layer.Floating;
        if (surface.Kind == SurfaceKind.Skip) return Layer.Background;
        return Layer.Tiled;
    }

    /// <summary>
    /// Heuristic modal detection: a window whose title is `<title> — <parent>`
    /// where `<parent>` is the title of another live window is treated as a modal
    /// child that the compositor failed to flag (§5).
    /// </summary>
    public static bool HeuristicModal(Surface surface, IReadOnlyList<string> liveTitles)
    {
        const string marker = " — ";
        var idx = surface.Title.LastIndexOf(marker, StringComparison.Ordinal);
        if (idx <= 0) return false;
        var suffix = surface.Title[(idx + marker.Length)..].Trim();
        if (suffix.Length == 0 || suffix == surface.Title) return false;
        foreach (var title in liveTitles)
        {
            if (title == suffix && title != surface.Title) return true;
        }
        return false;
    }

    private static Layer IgnoredLayer(Surface surface) =>
        surface.Kind == SurfaceKind.Skip ? Layer.Background : Layer.Floating;

    /// <summary>Pure classification (§5). Returns the first failing check as the reason.</summary>
    public static Classification ClassifySurface(Surface surface, ClassifyConfig config, HeuristicContext? context = null)
    {
        context ??= new HeuristicContext { LiveTitles = Array.Empty<string>() };
        var f = surface.Flags;

        static Classification Fail(Surface surface, SkipReason reason)
        {
            var modal = ModalReasons.Contains(reason);
            return new Classification
            {
                Tileable = false,
                Layer = modal ? Layer.Modal : IgnoredLayer(surface),
                Reason = reason,
                Modal = modal,
            };
        }

        if (f.SkipTaskbar) return Fail(surface, SkipReason.SkipTaskbar);
        if (f.OverrideRedirect) return Fail(surface, SkipReason.OverrideRedirect);
        // Mutter reports `on_all_workspaces` for every window on a secondary monitor
        // when `workspaces-only-on-primary` is set (GNOME's default), so that flag
        // must not disqualify a window: only a genuinely pinned window has no
        // workspace of its own. `sticky` carries that distinction (§5).
        if (f.Sticky) return Fail(surface, SkipReason.OnAllWorkspaces);
        if (f.Fullscreen) return Fail(surface, SkipReason.Fullscreen);
        // §16 (reversing the old A61): a window that asks to be "always on top" wants
        // to float above the tiling — a picture-in-picture video, a widget — so it is
        // never tiled and the flag is never cleared. The model is explicit that this
        // is the user's decision, not an accident to correct.
        if (f.Above) return Fail(surface, SkipReason.Above);
        foreach (var exception in config.ExceptionApps)
        {
            if (Rules.GlobMatch(exception, surface.AppId)) return Fail(surface, SkipReason.ExceptionApp);
        }
        // A `float` rule is the live, editable form of "do not tile this": it mirrors
        // the exception-app verdict, and the window floats rather than being ignored.
        // A full/half rule is not a classifier input — the tiler applies it later.
        var rule = Rules.FirstMatch(config.Rules, Rules.ContextFor(surface));
        if (rule?.Tile == TileMode.Float) return Fail(surface, SkipReason.RuleFloat);
        if (f.Floating) return Fail(surface, SkipReason.Floating);
        if (Types.NonTileableKinds.Contains(surface.Kind)) return Fail(surface, SkipReason.NonTileableKind);
        // A window without size hints reports min == max == 0 on both axes; that is
        // not a fixed size, so only a non-zero equal value fails this check (§5).
        if ((surface.Min.Width == surface.Max.Width && surface.Min.Width > 0) ||
            (surface.Min.Height == surface.Max.Height && surface.Min.Height > 0))
        {
            return Fail(surface, SkipReason.MinEqualsMax);
        }
        if (f.Transient) return Fail(surface, SkipReason.Transient);
        if (f.Modal) return Fail(surface, SkipReason.Modal);
        if (f.AttachedDialog) return Fail(surface, SkipReason.AttachedDialog);

        if (config.HeuristicModalDetect && HeuristicModal(surface, context.LiveTitles))
        {
            return Fail(surface, SkipReason.HeuristicModal);
        }

        return new Classification { Tileable = true, Layer = Layer.Tiled, Reason = null, Modal = false };
    }

    /// <summary>
    /// §23: whether a classification is a candidate for the active-window highlight.
    /// A tiled window and a **modal** (a transient dialog is not tileable, but it is
    /// the active window and still gets the border) both are; nothing else is. The
    /// Shell adapter asks this before re-deriving occlusion, so an occluded modal is
    /// suppressed exactly like an occluded tile instead of keeping a border drawn
    /// over the window that covered it.
    /// </summary>
    public static bool GetsActiveHighlight(Classification classification) =>
        classification.Tileable || classification.Modal;
}
