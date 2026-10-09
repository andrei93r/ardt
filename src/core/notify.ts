// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * The debug notification catalogue (§21). Each entry is one decision the user
 * can opt into; when it is on, that decision raises a live notification phrased
 * as the decision itself, so the logic can be followed as it happens.
 *
 * Two rules keep it usable rather than noisy:
 *   * a notice is deduplicated per (key, subject) inside a short window, and
 *   * at most a few notices are shown inside a longer window.
 *
 * The "nothing happened" notices are the exception: they are always on, never
 * behind a checkbox (a request that changes nothing must say why).
 */

export interface Notice {
  key: string;
  title: string;
  /** Always shown, never gated by a setting. */
  always?: boolean;
}

export const NOTICE_CATALOGUE: Notice[] = [
  { key: 'workspace-created', title: 'Workspace full → created one to the right' },
  { key: 'did-not-fit', title: 'Window did not fit → maximizing on the next workspace' },
  { key: 'trigger-wins', title: 'No room to share → keeping this window, the other gives way' },
  { key: 'sibling-adapted', title: 'A client refused the split → the sibling adapted' },
  { key: 'sibling-could-not', title: 'The sibling could not adapt → own workspace' },
  { key: 'no-room-floats', title: 'No room on this screen → floating' },
  { key: 'maximize-moved', title: 'Maximizing → moving it to its own workspace' },
  { key: 'minimized-others', title: 'Minimizing the other windows on this screen' },
  { key: 'minimized-moved', title: 'Only a minimized window left → moved to the neighbouring workspace' },
  { key: 'workspace-reaped', title: 'Empty workspace reaped' },
  { key: 'screen-changed', title: 'Screen changed → windows kept' },
  { key: 'normalised', title: 'Enabled → normalising the workspaces' },
];

/** Requests that changed nothing: always shown, never a checkbox (§21). */
export const NOTICE_ALWAYS: Notice[] = [
  { key: 'nothing-to-undo', title: 'Nothing to undo', always: true },
  { key: 'cannot-move-workspace', title: 'Cannot move: this screen has only one workspace', always: true },
  { key: 'un-float-full', title: 'Cannot un-float: both slots are taken', always: true },
  { key: 'nothing-to-nudge', title: 'Nothing to nudge', always: true },
  { key: 'resize-limit', title: 'Already at the limit', always: true },
  { key: 'undo-impossible', title: 'Cannot undo: the window is gone', always: true },
];

const ALL: Notice[] = [...NOTICE_CATALOGUE, ...NOTICE_ALWAYS];

/** The phrase for a key, or null when the key is unknown (a typo is a bug). */
export function noticeTitle(key: string): string | null {
  const entry = ALL.find((n) => n.key === key);
  return entry === undefined ? null : entry.title;
}

/** Whether a key is always shown rather than gated by a setting. */
export function isAlwaysNotice(key: string): boolean {
  return NOTICE_ALWAYS.some((n) => n.key === key);
}

interface Shown {
  key: string;
  subject: string;
  at: number;
}

export class NoticeGate {
  private readonly shown: Shown[] = [];

  constructor(
    /** The same key for the same subject is silent for this long. */
    private readonly dedupeMs = 2000,
    /** At most this many notices in the window below. */
    private readonly cap = 3,
    /** The window the cap applies to. */
    private readonly windowMs = 10000,
  ) {}

  get size(): number {
    return this.shown.length;
  }

  /** Whether this notice may be shown now. Records it when it may. */
  allow(key: string, subject: string, now: number): boolean {
    this.prune(now);
    if (this.shown.some((s) => s.key === key && s.subject === subject && now - s.at < this.dedupeMs)) {
      return false;
    }
    const inWindow = this.shown.filter((s) => now - s.at < this.windowMs).length;
    if (inWindow >= this.cap) return false;
    this.shown.push({ key, subject, at: now });
    return true;
  }

  private prune(now: number): void {
    const keep = Math.max(this.dedupeMs, this.windowMs);
    while (this.shown.length > 0 && now - this.shown[0].at >= keep) this.shown.shift();
  }
}
