// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * A rolling-window rate budget. Used as containment: creating workspaces is
 * meant to happen a handful of times when a window cannot share one, so a bug
 * anywhere above must not be able to turn that into an unbounded loop. A
 * runaway once created 86 workspaces at ~1 ms per iteration and left the
 * desktop unusable.
 */
export class RateBudget {
  private readonly stamps: number[] = [];

  /**
   * @param limit    how many successes are allowed inside the window
   * @param windowMs length of the rolling window
   */
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Record an event at `nowMs`. False when the budget is exhausted (and then
   * nothing is recorded, so the window keeps sliding). */
  take(nowMs: number): boolean {
    while (this.stamps.length > 0 && nowMs - this.stamps[0] > this.windowMs) this.stamps.shift();
    if (this.stamps.length >= this.limit) return false;
    this.stamps.push(nowMs);
    return true;
  }

  get used(): number {
    return this.stamps.length;
  }

  reset(): void {
    this.stamps.length = 0;
  }
}
