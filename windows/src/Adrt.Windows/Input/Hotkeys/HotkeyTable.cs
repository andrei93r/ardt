using Adrt.Core;

namespace Adrt.Windows.Input;

/// <summary>What a binding does. Names follow the core trigger table where one exists.</summary>
internal enum HotkeyAction
{
    /// <summary>No action; a table entry must never use this.</summary>
    None = 0,

    /// <summary><c>FocusDirection</c> with <see cref="HotkeyBinding.Direction"/>.</summary>
    FocusDirection,

    /// <summary><c>FocusCycle</c>.</summary>
    FocusCycle,

    /// <summary><c>SwapPair</c>: swap the focused window with its half.</summary>
    SwapPair,

    /// <summary>Put the focused window in the monitor's other half.</summary>
    MoveToOtherHalf,

    /// <summary><c>MoveDirection</c>: move the focused window toward a direction.</summary>
    MoveDirection,

    /// <summary><c>NudgeSplit</c>: move the shared edge of the focused pair.</summary>
    NudgeSplit,

    /// <summary><c>ResizeFocused</c>: grow (<see cref="HotkeyBinding.Grow"/>) or shrink.</summary>
    ResizeFocused,

    /// <summary><c>ToggleFloat</c>.</summary>
    ToggleFloat,

    /// <summary><c>MaximizeWindow</c>/<c>UnmaximizeWindow</c> as one toggle.</summary>
    ToggleMaximize,

    /// <summary><c>Undo</c>.</summary>
    Undo,

    /// <summary><c>CursorToCentre</c>.</summary>
    CursorToCentre,

    /// <summary><c>QuitFocused</c>: close the focused window.</summary>
    QuitFocused,

    /// <summary><c>TogglePause</c>.</summary>
    TogglePause,

    /// <summary>Windows-only: show/hide the focus border.</summary>
    ToggleBorder,

    /// <summary>Exit the adrt host.</summary>
    Quit,
}

/// <summary>
/// One default binding: the core trigger it drives, a human label, and the
/// Windows key combination.
/// </summary>
/// <param name="Id">Stable id passed to <c>RegisterHotKey</c> (matches <c>WM_HOTKEY.wParam</c>).</param>
/// <param name="Trigger">Core trigger name, or the Windows-only action name.</param>
/// <param name="Label">Human-readable action, logged next to the binding.</param>
/// <param name="Action">Dispatch target.</param>
/// <param name="Modifiers">Modifiers; <c>MOD_NOREPEAT</c> is added by the registrar.</param>
/// <param name="VirtualKey">Virtual-key code.</param>
/// <param name="Direction">Direction for focus/move/nudge bindings.</param>
/// <param name="Grow">True for the grow half of <see cref="HotkeyAction.ResizeFocused"/>.</param>
internal sealed record HotkeyBinding(
    int Id,
    string Trigger,
    string Label,
    HotkeyAction Action,
    HotkeyModifiers Modifiers,
    uint VirtualKey,
    FocusDirection? Direction = null,
    bool Grow = false);

/// <summary>
/// The Windows default hotkey table.
/// </summary>
/// <remarks>
/// <para>
/// Windows owns most <c>Win+&lt;key&gt;</c> combinations (<c>Win+arrows</c>,
/// <c>Win+D/E/L</c>, ...), so the defaults use <c>Win+Ctrl+&lt;letter&gt;</c> —
/// the combination proposed in <c>docs/WINDOWS_PORT.md</c> §5.6/§11 and the one
/// W0.5 probed as acceptable to <c>RegisterHotKey</c>. Session/chrome keys keep
/// the pre-W5 <c>Ctrl+Alt</c> prefix, so <c>Ctrl+Alt+P</c>/<c>Q</c> continue to
/// work unchanged.
/// </para>
/// <para>
/// The directional letters mirror vim/HJKL and the GNOME defaults. The two
/// <c>ResizeSplit</c> defaults are the same 10% step as <c>nudge-step</c>.
/// </para>
/// <para>
/// A binding is data only. <see cref="HotkeyRegistrar"/> validates the table for
/// duplicates and registers it; a refused combination (reserved by Windows or
/// taken by another app) is logged and skipped rather than fatal.
/// </para>
/// </remarks>
internal static class HotkeyTable
{
    private const HotkeyModifiers WinCtrl = HotkeyModifiers.Win | HotkeyModifiers.Control;
    private const HotkeyModifiers WinCtrlShift =
        HotkeyModifiers.Win | HotkeyModifiers.Control | HotkeyModifiers.Shift;
    private const HotkeyModifiers CtrlAlt = HotkeyModifiers.Control | HotkeyModifiers.Alt;

    // OEM virtual-key codes (WinUser.h). Letters use their ASCII code directly.
    private const uint VkGrave = 0xC0;      // `~
    private const uint VkComma = 0xBC;      // ,<
    private const uint VkPeriod = 0xBE;     // .>
    private const uint VkOemPlus = 0xBB;    // =+
    private const uint VkOemMinus = 0xBD;   // -_

    /// <summary>The table registered at startup, in declaration (id) order.</summary>
    public static IReadOnlyList<HotkeyBinding> Default { get; } =
    [
        // Focus (core: FocusDirection, FocusCycle, CursorToCentre).
        new(1, "FocusDirection", "focus left", HotkeyAction.FocusDirection, WinCtrl, (uint)'H', FocusDirection.Left),
        new(2, "FocusDirection", "focus right", HotkeyAction.FocusDirection, WinCtrl, (uint)'L', FocusDirection.Right),
        new(3, "FocusDirection", "focus up", HotkeyAction.FocusDirection, WinCtrl, (uint)'K', FocusDirection.Up),
        new(4, "FocusDirection", "focus down", HotkeyAction.FocusDirection, WinCtrl, (uint)'J', FocusDirection.Down),
        new(5, "FocusCycle", "cycle focus", HotkeyAction.FocusCycle, WinCtrl, VkGrave),
        new(6, "CursorToCentre", "move pointer to the focused window", HotkeyAction.CursorToCentre, WinCtrl, (uint)'G'),

        // Move (core: SwapPair, MoveDirection).
        new(7, "SwapPair", "swap the pair", HotkeyAction.SwapPair, WinCtrl, (uint)'X'),
        new(8, "MoveToOtherHalf", "move window to the other half", HotkeyAction.MoveToOtherHalf, WinCtrl, (uint)'M'),
        new(9, "MoveDirection", "move window left", HotkeyAction.MoveDirection, WinCtrlShift, (uint)'H', FocusDirection.Left),
        new(10, "MoveDirection", "move window right", HotkeyAction.MoveDirection, WinCtrlShift, (uint)'L', FocusDirection.Right),
        new(11, "MoveDirection", "move window up", HotkeyAction.MoveDirection, WinCtrlShift, (uint)'K', FocusDirection.Up),
        new(12, "MoveDirection", "move window down", HotkeyAction.MoveDirection, WinCtrlShift, (uint)'J', FocusDirection.Down),

        // Resize (core: NudgeSplit, ResizeFocused).
        new(13, "NudgeSplit", "nudge the split left", HotkeyAction.NudgeSplit, WinCtrl, VkComma, FocusDirection.Left),
        new(14, "NudgeSplit", "nudge the split right", HotkeyAction.NudgeSplit, WinCtrl, VkPeriod, FocusDirection.Right),
        new(15, "NudgeSplit", "nudge the split up", HotkeyAction.NudgeSplit, WinCtrlShift, VkComma, FocusDirection.Up),
        new(16, "NudgeSplit", "nudge the split down", HotkeyAction.NudgeSplit, WinCtrlShift, VkPeriod, FocusDirection.Down),
        new(17, "ResizeFocused", "grow the focused window", HotkeyAction.ResizeFocused, WinCtrl, VkOemPlus, Grow: true),
        new(18, "ResizeFocused", "shrink the focused window", HotkeyAction.ResizeFocused, WinCtrl, VkOemMinus, Grow: false),

        // Window (core: ToggleFloat, MaximizeWindow, Undo, QuitFocused).
        new(19, "ToggleFloat", "float or re-tile the focused window", HotkeyAction.ToggleFloat, WinCtrl, (uint)'F'),
        new(20, "MaximizeWindow", "toggle maximize", HotkeyAction.ToggleMaximize, WinCtrl, (uint)'E'),
        new(21, "Undo", "undo the last change", HotkeyAction.Undo, WinCtrl, (uint)'Z'),
        new(22, "QuitFocused", "close the focused window", HotkeyAction.QuitFocused, WinCtrlShift, (uint)'Q'),

        // Session + chrome. These keep the pre-W5 Ctrl+Alt prefix.
        new(23, "TogglePause", "pause or resume tiling", HotkeyAction.TogglePause, CtrlAlt, (uint)'P'),
        new(24, "ToggleBorder", "show or hide the focus border", HotkeyAction.ToggleBorder, CtrlAlt, (uint)'B'),
        new(25, "Quit", "quit adrt", HotkeyAction.Quit, CtrlAlt, (uint)'Q'),
    ];
}
