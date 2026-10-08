// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * The start/stop bug recorder (§22 extension). One file per session under
 * `$XDG_DATA_HOME/adrt/recordings/rec-YYYYMMDD-HHMMSS.jsonl`, one JSON object
 * per line:
 *
 *   {"kind":"header", ...}  the build, environment, monitors, settings
 *   {"kind":"event",  ...}  every journal record as it is written
 *   {"kind":"state",  ...}  a ~20 Hz snapshot, deduped while the screen is still
 *   {"kind":"note",   ...}  what the user observed (user stops only)
 *   {"kind":"footer", ...}  why it stopped, its totals and the note
 *
 * It is inert when off: no journal sink and no timer of its own. The
 * extension's existing motion tick drives `tick()`; the journal drives
 * `onJournal()`. The pure decisions (name, caps, rotation, cadence, formats)
 * live in `core/recording.ts`.
 *
 * A *user* stop defers the footer: the sink is detached and the file is left
 * open so the observation prompt can write a `note` line first. `finalizeNote`
 * (submit or cancel) writes the footer; a `cap`/`disable` stop writes it at
 * once and never prompts.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
  capReason,
  clampMaxSeconds,
  DEFAULT_MAX_BYTES,
  eventRecord,
  footerRecord,
  headerRecord,
  MAX_RECORDING_FILES,
  normalizeNote,
  noteRecord,
  recordingFileName,
  recordingsToDelete,
  sampleDue,
  snapshotKey,
  stateRecord,
} from '../../core/recording.js';
import type { StopReason } from '../../core/recording.js';
import { encodeText, jsonLine } from '../../core/jsonl.js';
import { dataDir, readText, writeAtomic } from './adapt.js';

/** A journal entry, as much of it as the sink needs to identify and timestamp. */
interface JournalLike {
  at?: unknown;
  [field: string]: unknown;
}

/** The one field of a `Gio.FileInfo` the recording enumeration reads. */
interface FileInfoLike {
  get_name(): string;
}

export interface RecorderDeps {
  /** The journal's write funnel: every record and decision is offered here. */
  journal: { setSink(sink: ((entry: JournalLike) => void) | null): void };
  /** The release build the running module came from. */
  build: () => Record<string, unknown>;
  /** The session mode, e.g. `user`. */
  mode: () => string;
  /** The one pause predicate. */
  paused: () => boolean;
  /** Every monitor: geometry, workArea, scale and refresh. */
  monitors: () => unknown[];
  /** The full settings snapshot. */
  settings: () => Record<string, unknown>;
  /** The live model snapshot for a `state` line. */
  snapshot: () => Record<string, unknown>;
  /** Called whenever recording starts or stops, so the panel can redraw. */
  onChanged: () => void;
  /** Overrides for the bound, used only by the unit tests. */
  platform?: string;
}

/** The JSON `RecordingStatus()` returns and `DumpState.recording` carries. */
export interface RecordingStatus {
  recording: boolean;
  path: string | null;
  elapsedMs: number;
  bytes: number;
  events: number;
  snapshots: number;
  maxMs: number;
  maxBytes: number;
  stopReason: string | null;
  /** True while a user stop is waiting for the observation prompt. */
  promptOpen: boolean;
  /** The note recorded so far (empty until a submit). */
  note: string;
}

function recordingDir(): string {
  const dir = `${dataDir()}/recordings`;
  GLib.mkdir_with_parents(dir, 0o755);
  return dir;
}

export class Recorder {
  private path: string | null = null;
  private recording = false;
  private startedAtMs = 0;
  private elapsedAtStop = 0;
  private bytes = 0;
  private bytesAtStop = 0;
  private events = 0;
  private snapshots = 0;
  private lastSampleMs = 0;
  private lastKey = '';
  private maxMs = 0;
  private maxBytes = DEFAULT_MAX_BYTES;
  private stopReason: StopReason | null = null;
  /** A user stop whose footer waits for the observation prompt. */
  private awaitingNote = false;
  private pendingReason: StopReason | null = null;
  private lastNote = '';

  constructor(private readonly deps: RecorderDeps) {}

  get isRecording(): boolean {
    return this.recording;
  }

  /** True while a user stop is waiting for the observation prompt. */
  get isAwaitingNote(): boolean {
    return this.awaitingNote;
  }

  /**
   * Begin a recording. A request while one is already running is refused with a
   * clear error string. Returns the file path on success.
   */
  start(maxSeconds?: number): string {
    if (this.recording) return `error: already recording to ${this.path ?? '?'}`;
    // A pending note from a previous user stop would otherwise strand a file
    // without a footer; close it with no note before opening a new one.
    if (this.awaitingNote) this.finalizeNote('');
    const now = new Date();
    this.rotate();
    this.path = this.freePath(now);
    this.startedAtMs = now.getTime();
    this.elapsedAtStop = 0;
    this.bytes = 0;
    this.bytesAtStop = 0;
    this.events = 0;
    this.snapshots = 0;
    this.lastSampleMs = 0;
    this.lastKey = '';
    this.stopReason = null;
    this.awaitingNote = false;
    this.pendingReason = null;
    this.lastNote = '';
    this.maxMs = clampMaxSeconds(maxSeconds);
    this.maxBytes = DEFAULT_MAX_BYTES;
    this.recording = true;
    this.writeLine(headerRecord(now.getTime(), this.headerFields()));
    this.deps.journal.setSink(this.onJournal);
    // The first state line lands immediately, so a very short recording still
    // carries one; the motion tick adds the rest.
    this.lastSampleMs = now.getTime();
    this.writeSnapshot(now.getTime());
    this.deps.onChanged();
    return this.path;
  }

  /**
   * End the recording with `reason`. Returns the path (or a not-recording
   * error). `deferFooter` is the user-stop path: the file stays open so the
   * observation prompt can write a `note` line before the footer.
   */
  stop(reason: StopReason, deferFooter = false): string {
    if (!this.recording || this.path === null) return 'error: not recording';
    const path = this.path;
    const at = Date.now();
    this.deps.journal.setSink(null);
    this.recording = false;
    this.stopReason = reason;
    this.elapsedAtStop = at - this.startedAtMs;
    this.bytesAtStop = this.bytes;
    if (deferFooter) {
      this.awaitingNote = true;
      this.pendingReason = reason;
    } else {
      this.writeFooter(reason, '');
    }
    this.deps.onChanged();
    return path;
  }

  /**
   * Resolve a deferred user stop: write the note (when non-empty) and then the
   * footer. `finalizeNote('')` is the cancel path and records no note. Returns
   * the path, or an error when nothing is awaiting one.
   */
  finalizeNote(text: string): string {
    if (!this.awaitingNote || this.path === null) return 'error: no recording awaiting a note';
    const note = normalizeNote(text);
    this.lastNote = note;
    if (note.length > 0) this.writeLine(noteRecord(Date.now(), note));
    this.writeFooter(this.pendingReason ?? 'user', note);
    this.awaitingNote = false;
    this.pendingReason = null;
    this.deps.onChanged();
    return this.path;
  }

  /** Cancel a deferred note: close the file with an empty note. */
  cancelNote(): string {
    return this.finalizeNote('');
  }

  /**
   * The motion tick's entry point. Enforces the caps, then writes at most one
   * deduped state line per ~20 Hz slot. The extension calls it with its own
   * monotonic wall clock so the unit tests can drive it deterministically.
   */
  tick(nowMs: number = Date.now()): void {
    if (!this.recording) return;
    if (this.stopAtCap(nowMs)) return;
    if (!sampleDue(this.lastSampleMs, nowMs)) return;
    this.lastSampleMs = nowMs;
    this.writeSnapshot(nowMs);
    this.stopAtCap(nowMs);
  }

  private readonly onJournal = (entry: JournalLike): void => {
    if (!this.recording) return;
    const at = typeof entry.at === 'number' ? entry.at : Date.now();
    this.writeLine(eventRecord(at, entry));
    this.events += 1;
    // An event flood can cross the byte cap between ticks; stop right away.
    this.stopAtCap(Date.now());
  };

  /** The live status, also surfaced add-only in `DumpState.recording`. */
  describe(): RecordingStatus {
    return {
      recording: this.recording,
      path: this.path,
      elapsedMs: this.recording ? Date.now() - this.startedAtMs : this.elapsedAtStop,
      bytes: this.recording ? this.bytes : this.bytesAtStop,
      events: this.events,
      snapshots: this.snapshots,
      maxMs: this.maxMs,
      maxBytes: this.maxBytes,
      stopReason: this.stopReason,
      promptOpen: this.awaitingNote,
      note: this.lastNote,
    };
  }

  status(): string {
    return JSON.stringify(this.describe());
  }

  /**
   * Stop cleanly on `disable()` (or any other reason) and detach the sink. A
   * deferred user note is closed with no note first, so no file is ever left
   * without a footer; `disable` never opens the prompt (the caller never does).
   */
  destroy(reason: StopReason = 'disable'): void {
    if (this.awaitingNote) this.finalizeNote('');
    if (this.recording) this.stop(reason);
    this.deps.journal.setSink(null);
  }

  /** Write the footer for the totals already captured by `stop`. */
  private writeFooter(reason: StopReason, note: string): void {
    if (this.path === null) return;
    this.writeLine(
      footerRecord(Date.now(), {
        reason,
        durationMs: this.elapsedAtStop,
        events: this.events,
        snapshots: this.snapshots,
        bytes: this.bytesAtStop,
        note,
        path: this.path,
      }),
    );
  }

  private headerFields(): Record<string, unknown> {
    return {
      platform: this.deps.platform ?? 'gnome',
      mode: this.deps.mode(),
      paused: this.deps.paused(),
      build: this.deps.build(),
      monitors: this.deps.monitors(),
      settings: this.deps.settings(),
      startedAtMs: this.startedAtMs,
      startedAt: new Date(this.startedAtMs).toISOString(),
      bounds: { maxMs: this.maxMs, maxBytes: this.maxBytes, maxFiles: MAX_RECORDING_FILES },
    };
  }

  private writeSnapshot(nowMs: number): void {
    const snapshot = this.deps.snapshot();
    const key = snapshotKey(snapshot);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.writeLine(stateRecord(nowMs, snapshot));
    this.snapshots += 1;
  }

  /** Stop if a bound is reached; returns true when it did. */
  private stopAtCap(nowMs: number): boolean {
    if (!this.recording) return false;
    const cap = capReason(nowMs - this.startedAtMs, this.bytes, this.maxMs, this.maxBytes);
    if (cap === null) return false;
    this.stop('cap');
    return true;
  }

  /**
   * The first `rec-YYYYMMDD-HHMMSS[-N].jsonl` under the recordings dir that does
   * not already exist. Two sessions in the same second must never append to the
   * same file; the suffix keeps the timestamped name and stays unique.
   */
  private freePath(now: Date): string {
    const dir = recordingDir();
    for (let occurrence = 1; occurrence <= 999; occurrence += 1) {
      const candidate = `${dir}/${recordingFileName(now, occurrence)}`;
      try {
        if (!Gio.File.new_for_path(candidate).query_exists(null)) return candidate;
      } catch {
        return candidate;
      }
    }
    return `${dir}/${recordingFileName(now)}`;
  }

  /** Keep only the newest files, leaving room for the one about to start. */
  private rotate(): void {
    try {
      const dir = recordingDir();
      const enumerator = Gio.File.new_for_path(dir).enumerate_children(
        'standard::name',
        Gio.FileQueryInfoFlags.NONE,
        null,
      );
      const names: string[] = [];
      let info: FileInfoLike | null;
      while ((info = enumerator.next_file(null)) !== null) {
        const name: string = info.get_name();
        if (/^rec-\d{8}-\d{6}(-\d+)?\.jsonl$/.test(name)) names.push(name);
      }
      for (const name of recordingsToDelete(names, MAX_RECORDING_FILES - 1)) {
        try {
          Gio.File.new_for_path(`${dir}/${name}`).delete(null);
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* a directory that cannot be listed must not stop a recording */
    }
  }

  /** Append one JSON line and account its size. */
  private writeLine(record: Record<string, unknown>): void {
    if (this.path === null) return;
    const line = jsonLine(record);
    let size = 0;
    try {
      size = encodeText(line).length;
    } catch {
      size = line.length;
    }
    try {
      const stream = Gio.File.new_for_path(this.path).append_to(Gio.FileCreateFlags.NONE, null);
      stream.write_all(encodeText(line), null);
      stream.close(null);
      this.bytes += size;
    } catch {
      try {
        writeAtomic(this.path, `${readText(this.path) ?? ''}${line}`);
        this.bytes += size;
      } catch {
        /* never let recording break the shell */
      }
    }
  }
}
