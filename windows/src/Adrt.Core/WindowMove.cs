// Port of src/core/windowmove.ts. Keep names and semantics 1:1 with the TypeScript.
using System.Text.Json.Serialization;

namespace Adrt.Core;

/// <summary>The inline input object of `dragIsWindowMove`.</summary>
public readonly record struct DragIsWindowMoveInput(
    [property: JsonPropertyName("ready")] bool Ready,
    [property: JsonPropertyName("routePending")] bool RoutePending);

/// <summary>
/// §6/§11: whether a compositor move grab is a window move adrt may interpret.
///
/// A gesture that begins on a window adrt has not adopted and placed yet is not
/// the user moving a window: the application created the window during the
/// gesture (a Chrome tab tear-off, a VS Code editor-tab drop) and is moving it
/// itself. The newcomer has no slot to swap out of, so interpreting its drop
/// swaps it with the window it came from. The window must have committed its
/// first frame (`ready`) and have been routed (`!routePending`) before a move
/// grab on it is a window move.
/// </summary>
public static class WindowMove
{
    public static bool DragIsWindowMove(DragIsWindowMoveInput input) => input.Ready && !input.RoutePending;
}
