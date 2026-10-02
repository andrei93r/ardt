// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * §6/§11: whether a compositor move grab is a window move adrt may interpret.
 *
 * A gesture that begins on a window adrt has not adopted and placed yet is not
 * the user moving a window: the application created the window during the
 * gesture (a Chrome tab tear-off, a VS Code editor-tab drop) and is moving it
 * itself. The newcomer has no slot to swap out of, so interpreting its drop
 * swaps it with the window it came from. The window must have committed its
 * first frame (`ready`) and have been routed (`!routePending`) before a move
 * grab on it is a window move.
 */
export function dragIsWindowMove(input: { ready: boolean; routePending: boolean }): boolean {
  return input.ready && !input.routePending;
}
