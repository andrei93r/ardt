// Presentation helpers for the generated settings window: categories, labels
// and the finite choice lists the GNOME preferences window hard-codes.
using System.Globalization;
using Adrt.Core;

namespace Adrt.Settings;

/// <summary>One group of rows in the window.</summary>
public sealed record SettingCategory(string Title, string Description);

/// <summary>
/// Groups the descriptor keys into the pages a user expects. Keys are assigned by
/// prefix so a key added to the descriptor still lands somewhere sensible.
/// </summary>
public static class SettingsCategories
{
    private static readonly SettingCategory Tiling = new(
        "Tiling",
        "Spacing around tiles and the monitor edges.");

    private static readonly SettingCategory Splitting = new(
        "Splitting",
        "Which window takes the larger share of a split.");

    private static readonly SettingCategory Windows = new(
        "Windows",
        "Which windows adrt manages and how it treats them.");

    private static readonly SettingCategory Animation = new(
        "Animation",
        "Transitions when tiles are created, moved or closed.");

    private static readonly SettingCategory Highlight = new(
        "Highlight",
        "The outline drawn around the focused window.");

    private static readonly SettingCategory Gestures = new(
        "Gestures",
        "Touchpad swipes and pinch actions.");

    private static readonly SettingCategory Keyboard = new(
        "Keyboard",
        "Global shortcuts. Values use the accelerator syntax, for example <Super>h.");

    private static readonly SettingCategory Rules = new(
        "Rules",
        "Per-app and per-title placement rules.");

    private static readonly SettingCategory History = new(
        "History",
        "The append-only event log written as JSONL files.");

    private static readonly SettingCategory Advanced = new(
        "Advanced",
        "Integration, recording and dry-run switches.");

    private static readonly SettingCategory Internal = new(
        "Internal",
        "Written by adrt. Changing these by hand can confuse migration.");

    private static readonly SettingCategory Debug = new(
        "Debug",
        "Diagnostics. Leave off unless you are chasing a bug.");

    private static readonly SettingCategory Other = new(
        "Other",
        "Settings that do not fit another category.");

    /// <summary>Every category, in the order the window shows them.</summary>
    public static IReadOnlyList<SettingCategory> All { get; } =
    [
        Tiling, Splitting, Windows, Animation, Highlight, Gestures,
        Keyboard, Rules, History, Advanced, Internal, Debug, Other,
    ];

    /// <summary>The category for one descriptor key.</summary>
    public static SettingCategory For(string key)
    {
        if (key.StartsWith("gaps-", StringComparison.Ordinal)) return Tiling;
        if (key is "primary-apps" or "primary-app-ratio" or "min-size-policy" or "reflow-keeps-edges") return Splitting;
        if (key.StartsWith("kb-", StringComparison.Ordinal) || key is "keybindings" or "nudge-step") return Keyboard;
        if (key.StartsWith("gesture-", StringComparison.Ordinal)) return Gestures;
        if (key.StartsWith("indicator-", StringComparison.Ordinal) || key == "active-window-indicator") return Highlight;
        if (key.StartsWith("history-", StringComparison.Ordinal) || key == "log-workspace-reorder") return History;
        if (key.StartsWith("rules-", StringComparison.Ordinal)) return Rules;
        if (key.StartsWith("debug-", StringComparison.Ordinal)) return Debug;
        if (key is "disable-animations" or "animation-duration" or "gnome-animation-delay"
            or "max-frame-interval-ms" or "close-animation-enabled" or "close-animation-duration")
        {
            return Animation;
        }
        if (key is "settings-version" or "registry-revision" or "first-run-complete") return Internal;
        if (key is "record" or "perf-enabled" or "trace-enabled" or "dbus-enabled" or "dry-run-mode")
        {
            return Advanced;
        }
        if (key is "float-pins-workspace" or "clamp-windows-to-screen" or "pause-during-sharing"
            or "reflow-keeps-edges" or "follow-moved-window" or "cursor-follows-focus"
            or "heuristic-modal-detect" or "exception-apps" or "adaptation-enabled"
            or "float-persistence" or "display-memory-minutes" or "scan-interval")
        {
            return Windows;
        }
        return Other;
    }
}

/// <summary>Friendly labels for the descriptor keys.</summary>
public static class SettingLabels
{
    private static readonly IReadOnlyDictionary<string, string> Exact =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["gaps-base"] = "Base gap",
            ["gaps-portrait"] = "Portrait gap",
            ["gaps-landscape"] = "Landscape gap",
            ["gaps-left"] = "Left gap",
            ["gaps-right"] = "Right gap",
            ["gaps-top"] = "Top gap",
            ["gaps-bottom"] = "Bottom gap",
            ["gaps-between"] = "Gap between windows",
            ["display-memory-minutes"] = "Remember display layouts (minutes)",
            ["float-pins-workspace"] = "A floating window keeps its desktop",
            ["clamp-windows-to-screen"] = "Keep windows on screen",
            ["pause-during-sharing"] = "Pause while sharing or remote desktop",
            ["min-size-policy"] = "Minimum-size policy",
            ["reflow-keeps-edges"] = "Keep outer edges when reflowing",
            ["primary-apps"] = "Primary apps",
            ["primary-app-ratio"] = "Primary app share (%)",
            ["nudge-step"] = "Nudge step (%)",
            ["follow-moved-window"] = "Follow a window moved to another desktop",
            ["cursor-follows-focus"] = "Move the pointer to the focused window",
            ["log-workspace-reorder"] = "Log workspace reorders",
            ["heuristic-modal-detect"] = "Detect modal windows heuristically",
            ["exception-apps"] = "Never-tile these apps",
            ["rules-enabled"] = "Enable rules",
            ["rules-json"] = "Rules (JSON)",
            ["disable-animations"] = "Disable all animations",
            ["animation-duration"] = "Move duration (ms)",
            ["gnome-animation-delay"] = "Animation settle delay (ms)",
            ["max-frame-interval-ms"] = "Maximum frame interval (ms)",
            ["active-window-indicator"] = "Border on the focused window",
            ["indicator-color"] = "Border colour",
            ["indicator-opacity"] = "Border opacity (%)",
            ["indicator-width"] = "Border width (px)",
            ["indicator-corner-radius"] = "Corner radius (px)",
            ["indicator-animated-pulse"] = "Pulse the border while focused",
            ["indicator-pulse-duration"] = "Pulse duration (ms)",
            ["close-animation-enabled"] = "Fade a ghost when a window closes",
            ["close-animation-duration"] = "Close ghost duration (ms)",
            ["adaptation-enabled"] = "Adapt to slow windows",
            ["float-persistence"] = "Remember floating apps",
            ["scan-interval"] = "Scan interval (ms)",
            ["debug-enabled"] = "Enable debug logging",
            ["debug-tiling"] = "Debug tiling",
            ["debug-focus"] = "Debug focus",
            ["debug-displays"] = "Debug displays",
            ["debug-undo"] = "Debug undo",
            ["debug-session"] = "Debug session",
            ["record"] = "Record a bug",
            ["perf-enabled"] = "Collect performance counters",
            ["trace-enabled"] = "Trace decisions",
            ["history-enabled"] = "Record event history",
            ["history-retention-days"] = "Keep history (days)",
            ["history-daily-folders"] = "Store each day in its own folder",
            ["dbus-enabled"] = "Expose the automation interface",
            ["dry-run-mode"] = "Dry-run mode (plan, do not move)",
            ["gesture-enabled"] = "Enable touchpad gestures",
            ["gesture-3-swipe-action"] = "Three-finger horizontal",
            ["gesture-3-vertical-action"] = "Three-finger vertical",
            ["gesture-4-swipe-action"] = "Four-finger horizontal",
            ["gesture-4-vertical-action"] = "Four-finger vertical",
            ["gesture-pinch-action"] = "Pinch",
            ["gesture-sensitivity"] = "Gesture sensitivity",
            ["keybindings"] = "Extra key bindings",
            ["history-max-bytes"] = "Rotate each file at (bytes)",
            ["settings-version"] = "Settings file version",
            ["registry-revision"] = "App registry revision",
            ["first-run-complete"] = "First-run check completed",
            ["debug-inject-verify-failure"] = "Inject verification failure",
            ["debug-toasts"] = "Debug toast keys",
        };

    private static readonly IReadOnlyDictionary<string, string> Shortcuts =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["undo"] = "Undo",
            ["recording-toggle"] = "Record a bug",
            ["toggle-pause"] = "Pause or resume tiling",
            ["focus-next"] = "Focus next (cycle)",
            ["focus-left"] = "Focus left",
            ["focus-right"] = "Focus right",
            ["focus-up"] = "Focus up",
            ["focus-down"] = "Focus down",
            ["toggle-float"] = "Float or re-tile",
            ["nudge-left"] = "Move the split left",
            ["nudge-right"] = "Move the split right",
            ["nudge-up"] = "Move the split up",
            ["nudge-down"] = "Move the split down",
            ["increase-window"] = "Increase window",
            ["decrease-window"] = "Decrease window",
            ["move-left"] = "Move window left",
            ["move-right"] = "Move window right",
            ["move-up"] = "Move window up",
            ["move-down"] = "Move window down",
            ["toggle-fullscreen"] = "Toggle fullscreen",
            ["quit"] = "Close the focused window",
            ["cursor-centre"] = "Move pointer to the focused window",
            ["move-workspace-prev"] = "Move to the previous workspace",
            ["move-workspace-next"] = "Move to the next workspace",
        };

    /// <summary>The row title for <paramref name="key"/>.</summary>
    public static string For(string key)
    {
        if (Exact.TryGetValue(key, out string? exact)) return exact;

        if (key.StartsWith("kb-", StringComparison.Ordinal))
        {
            string tail = key[3..];
            if (Shortcuts.TryGetValue(tail, out string? shortcut)) return shortcut;
            if (tail.StartsWith("move-workspace-", StringComparison.Ordinal))
            {
                return $"Move to workspace {tail["move-workspace-".Length..]}";
            }
            return Title(tail);
        }

        return Title(key);
    }

    private static string Title(string key) =>
        CultureInfo.InvariantCulture.TextInfo.ToTitleCase(key.Replace('-', ' '));
}

/// <summary>
/// Finite string choices. The descriptor declares none today (the schema has no
/// <c>&lt;choices&gt;</c>), but the GNOME window hard-codes these lists, so the
/// Windows window offers them as an editable combo box rather than raw text.
/// </summary>
public static class SettingChoices
{
    private static readonly string[] SwipeActions =
        ["switch-workspace", "toggle-overview", "show-desktop", "swap-pair", "none"];

    private static readonly string[] VerticalActions =
        ["switch-workspace", "toggle-overview", "show-desktop", "none"];

    private static readonly string[] PinchActions =
        ["show-desktop", "toggle-overview", "none"];

    private static readonly IReadOnlyDictionary<string, string[]> Known =
        new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            ["min-size-policy"] = ["respect", "ignore", "stack"],
            ["gesture-3-swipe-action"] = SwipeActions,
            ["gesture-3-vertical-action"] = VerticalActions,
            ["gesture-4-swipe-action"] = SwipeActions,
            ["gesture-4-vertical-action"] = VerticalActions,
            ["gesture-pinch-action"] = PinchActions,
        };

    /// <summary>The choices for one setting, or null when it is free text.</summary>
    public static IReadOnlyList<string>? For(SettingDescriptor descriptor)
    {
        if (descriptor.Choices is { Count: > 0 } declared) return declared;
        return Known.TryGetValue(descriptor.Key, out string[]? choices) ? choices : null;
    }
}
