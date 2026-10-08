// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Fixed-capacity circular buffer (§5.11). `push` overwrites the oldest item
 * once full and never shifts: O(1) per push instead of the O(n) copy an
 * unbounded array with `shift()` pays on every event past the cap.
 *
 * `tail`/`tailWhere` always hand back **insertion order** (oldest first), so
 * this is a drop-in for a bounded "last N" log kept on the compositor thread.
 * The backing array is allocated once; only `clear` replaces it, releasing the
 * retained entries immediately.
 */
export class RingBuffer<T> {
  private readonly capacity: number;
  private items: T[];
  /** Index the next `push` writes to. */
  private head = 0;
  /** Live item count, never above `capacity`. */
  private size = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(0, Math.trunc(capacity));
    this.items = new Array<T>(this.capacity);
  }

  get length(): number {
    return this.size;
  }

  push(item: T): void {
    if (this.capacity === 0) return;
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  clear(): void {
    this.items = new Array<T>(this.capacity);
    this.head = 0;
    this.size = 0;
  }

  /** The newest `limit` items, oldest first. Fewer when not yet full. */
  tail(limit: number): T[] {
    const n = limit > 0 ? Math.min(Math.trunc(limit), this.size) : 0;
    const out: T[] = new Array<T>(n);
    const first = this.size - n;
    for (let i = 0; i < n; i++) out[i] = this.itemAt(first + i);
    return out;
  }

  /** The newest `limit` items matching `predicate`, oldest first. */
  tailWhere(predicate: (item: T) => boolean, limit: number): T[] {
    const n = limit > 0 ? Math.trunc(limit) : 0;
    const out: T[] = [];
    for (let i = this.size - 1; i >= 0 && out.length < n; i--) {
      const item = this.itemAt(i);
      if (predicate(item)) out.push(item);
    }
    out.reverse();
    return out;
  }

  /** The item at logical position `i` (0 = oldest); `0 <= i < size`. */
  private itemAt(i: number): T {
    return this.items[(this.head - this.size + i + this.capacity) % this.capacity];
  }
}
