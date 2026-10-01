// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Retile coalescing and signature-based skip (§6, §24 items 4 and 7).
 * Pure data structures; the adapter owns the GLib source that drains them.
 */
export class RetileScheduler {
  private readonly pending = new Set<string>();

  /** Returns true when the key was not already queued. */
  schedule(key: string): boolean {
    if (this.pending.has(key)) return false;
    this.pending.add(key);
    return true;
  }

  has(key: string): boolean {
    return this.pending.has(key);
  }

  get size(): number {
    return this.pending.size;
  }

  keys(): string[] {
    return [...this.pending];
  }

  /** Remove and return every queued key. */
  take(): string[] {
    const keys = [...this.pending];
    this.pending.clear();
    return keys;
  }

  clear(key: string): void {
    this.pending.delete(key);
  }

  clearAll(): void {
    this.pending.clear();
  }
}

/**
 * Remembers the last applied plan signature per workspace so an unchanged
 * plan is never re-applied (§24 item 4).
 */
export class SignatureCache {
  private readonly signatures = new Map<string, string>();

  /** True when the signature differs from the cached one (and updates it). */
  changed(key: string, signature: string): boolean {
    const previous = this.signatures.get(key);
    if (previous === signature) return false;
    this.signatures.set(key, signature);
    return true;
  }

  peek(key: string): string | undefined {
    return this.signatures.get(key);
  }

  clear(key: string): void {
    this.signatures.delete(key);
  }

  clearAll(): void {
    this.signatures.clear();
  }

  get size(): number {
    return this.signatures.size;
  }
}

/** Stable signature for a computed plan, used by the signature cache. */
export function planSignature(placements: ReadonlyArray<{ surfaceId: number; rect: { x: number; y: number; width: number; height: number } }>): string {
  return placements
    .map((p) => `${p.surfaceId}:${p.rect.x},${p.rect.y},${p.rect.width},${p.rect.height}`)
    .join(';');
}

/**
 * Whether a computed plan should be applied, from its pure inputs.
 *
 * `changed` is true when the plan differs from the last one applied for its
 * workspace — but the per-workspace cache can also be cleared by an unrelated
 * signal (a title or frame change), which makes `changed` true for a plan that
 * is byte-identical to the one already applied. When the windows already aim at
 * exactly this plan (`alreadyTargeted`) and none has genuinely drifted
 * (`mismatch`), re-applying it would restart the frame animation from a
 * mid-transition rect — the "overshoot then corrects". So an unchanged,
 * already-targeted plan is adopted without re-applying; a real drift
 * (`mismatch`) still applies.
 */
export function shouldApplyPlan(input: { mismatch: boolean; changed: boolean; alreadyTargeted: boolean }): boolean {
  if (!input.mismatch && !input.changed) return false;
  if (!input.mismatch && input.alreadyTargeted) return false;
  return true;
}
