// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * The observation prompt for a user-initiated recording stop (§22 extension).
 * A small, dismissible modal asks "What did you observe?" plus a short free-text
 * note; on Save the text is handed to the recorder as the note that is written
 * before the footer, on Cancel the recording closes with none.
 *
 * The prompt is a full-screen `St.Widget` backdrop added to `Main.uiGroup`,
 * sized to the stage and carrying a centred `St.BoxLayout`. (The GNOME modal
 * dialog is a JavaScript module, `resource:///org/gnome/shell/ui/modalDialog.js`,
 * not a libshell API, so it is not used here.) The overlay must take a
 * `Main.pushModal` grab and focus the entry itself, otherwise keystrokes go to
 * the compositor's focused window and the user can neither type nor submit.
 * It is asynchronous (`show()`/`close()`, never a nested main loop), so it does
 * not block the Shell. It is a view: it owns no recording state and `close()`
 * releases the grab before destroying.
 */

import Clutter from 'gi://Clutter';
import type { ClutterGrab } from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import { popModal, pushModal, uiGroup } from 'resource:///org/gnome/shell/ui/main.js';

import { centerRect } from '../../core/recording.js';

export interface RecordingPromptCallbacks {
  /** Save: the observation text (entry plus the optional short note). */
  onSubmit(text: string): void;
  /** Cancel/Escape: close the recording without a note. */
  onCancel(): void;
}

/**
 * Structural views of the GJS actors the prompt drives. `gi.d.ts` declares the
 * `St`/`Shell` namespaces as `any`, so each view names only the members this file
 * uses and marks optional exactly what the code probes — the same pattern as
 * `compat.ts`/`host.ts`.
 */

/** A `St.Widget`/`St.BoxLayout`, read for layout, size and child management. */
interface StActorLike {
  spacing?: number;
  connect<A extends unknown[]>(signal: string, callback: (...args: A) => unknown): number;
  destroy(): void;
  add_child(child: unknown): void;
  set_x_align(align: unknown): void;
  set_position(x: number, y: number): void;
  set_size(width: number, height: number): void;
  get_transformed_position(): [number, number];
  get_transformed_size(): [number, number];
  get_preferred_width(forHeight: number): [number, number];
  get_preferred_height(forWidth: number): [number, number];
}

/** A focusable `St.Entry` and the `Clutter.Text` it wraps. */
interface StEntryLike extends StActorLike {
  set_text(text: string): void;
  get_text?(): string;
  clutter_text?: {
    connect<A extends unknown[]>(signal: string, callback: (...args: A) => unknown): number;
    has_key_focus?(): boolean;
  };
  has_key_focus?(): boolean;
  grab_key_focus?(): void;
}

/** A `St.Button`; only its `clicked` emission is driven programmatically. */
interface StButtonLike extends StActorLike {
  emit(signal: string, ...args: unknown[]): unknown;
}

/** Whatever is currently on screen: the overlay actor. */
interface PromptActorLike {
  close?(): void;
  destroy(): void;
}

/** A `Clutter.Event` as read by the overlay's key handler. */
interface KeyEventLike {
  get_key_symbol(): unknown;
}

export type RecordingPromptKind = 'modal' | 'overlay';

/** The on-screen content rect, for `RecordingStatus.promptRect`. */
export interface PromptRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class RecordingPrompt {
  private actor: PromptActorLike | null = null;
  private overlay: StActorLike | null = null;
  private contentBox: StActorLike | null = null;
  private entry: StEntryLike | null = null;
  private noteEntry: StEntryLike | null = null;
  private saveButton: StButtonLike | null = null;
  private cancelButton: StButtonLike | null = null;
  private mechanism: RecordingPromptKind | null = null;
  private callbacks: RecordingPromptCallbacks | null = null;
  /** True while a modal grab is held. */
  private grabHeld = false;
  /**
   * The grab handle `Main.pushModal` returned. `Main.popModal` looks the
   * handle up in the Shell's modal stack, so it is the only thing that can
   * release the grab; the actor is not.
   */
  private grab: ClutterGrab | null = null;
  /** Stage `notify::width/height` handlers, disconnected on close. */
  private stageSignals: number[] = [];

  get isOpen(): boolean {
    return this.actor !== null;
  }

  /** Which native mechanism is on screen, for diagnostics. */
  get kind(): RecordingPromptKind | null {
    return this.mechanism;
  }

  /** True while the modal grab is held, for diagnostics and tests. */
  get hasGrab(): boolean {
    return this.grabHeld;
  }

  /**
   * True while the observation entry owns key focus. `St.Entry` wraps a
   * `Clutter.Text`; focus may live on either actor depending on the Shell, so
   * both are checked, plus the stage's current focus.
   */
  get hasKeyFocus(): boolean {
    const entry = this.entry;
    if (entry === null) return false;
    try {
      if (entry.has_key_focus?.() === true) return true;
      const text = entry.clutter_text;
      if (text?.has_key_focus?.() === true) return true;
      const focus = global.stage.get_key_focus?.();
      return focus === entry || (text !== undefined && focus === text);
    } catch {
      return false;
    }
  }

  /** The content box's on-screen rect, for diagnostics and tests. */
  get contentRect(): PromptRect | null {
    if (this.contentBox === null) return null;
    try {
      const [x, y] = this.contentBox.get_transformed_position();
      const [width, height] = this.contentBox.get_transformed_size();
      return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    } catch {
      return null;
    }
  }

  /**
   * Show the prompt. Returns false when the overlay could not be built (the
   * recorder still holds the deferred note, so the D-Bus test can still submit
   * one). A second `show()` while open is a no-op.
   */
  show(callbacks: RecordingPromptCallbacks): boolean {
    if (this.actor !== null) return true;
    this.callbacks = callbacks;
    if (this.tryOverlay()) return true;
    this.callbacks = null;
    return false;
  }

  /** Set the observation entry's text (the real widget path). */
  setText(text: string): boolean {
    if (this.entry === null) return false;
    this.entry.set_text(text);
    return true;
  }

  /** Press the real Save button; falls back to the submit action for a modal. */
  pressSave(): boolean {
    if (this.actor === null) return false;
    // StButton.clicked carries the ClutterButtonEvent; null is accepted and is
    // what a programmatic press has.
    if (this.saveButton !== null) this.saveButton.emit('clicked', null);
    else this.submit();
    return true;
  }

  /** Press the real Cancel button; falls back to the cancel action for a modal. */
  pressCancel(): boolean {
    if (this.actor === null) return false;
    if (this.cancelButton !== null) this.cancelButton.emit('clicked', null);
    else this.cancel();
    return true;
  }

  /**
   * Tear the prompt down without firing a callback: release the grab, drop the
   * stage signals and destroy the actor. Safe when already closed or when no
   * grab was ever taken (`disable()` may run at any point).
   */
  close(): void {
    const actor = this.actor;
    const grab = this.grab;
    this.actor = null;
    this.overlay = null;
    this.contentBox = null;
    this.entry = null;
    this.noteEntry = null;
    this.saveButton = null;
    this.cancelButton = null;
    this.mechanism = null;
    this.callbacks = null;
    this.grabHeld = false;
    this.grab = null;
    this.disconnectStage();
    if (actor === null) return;
    try {
      // The grab *handle*, never the actor: `Main.popModal` looks the handle
      // up in the Shell's modal stack and throws `incorrect pop` for anything
      // else — which would drop the stage's key focus and leave the grab held.
      if (grab !== null) popModal(grab);
    } catch {
      /* the grab was already released */
    }
    try {
      if (typeof actor.close === 'function') actor.close();
      actor.destroy();
    } catch {
      /* already gone */
    }
  }

  private buildFields(): StActorLike {
    // GNOME 48+ dropped `St.BoxLayout`'s `vertical` property — passing it
    // throws "No property vertical on StBoxLayout" and the prompt never
    // appears. The direction is the layout's `orientation` instead.
    const box: StActorLike = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'adrt-recording-body',
    });
    box.spacing = 8;
    box.add_child(new St.Label({ text: 'What did you observe?', style_class: 'adrt-recording-title' }));
    const entry: StEntryLike = new St.Entry({
      style_class: 'adrt-recording-entry',
      hint_text: 'Describe the bug you just saw…',
      can_focus: true,
    });
    this.entry = entry;
    box.add_child(entry);
    box.add_child(new St.Label({ text: 'A short note is enough.', style_class: 'adrt-recording-hint' }));
    const noteEntry: StEntryLike = new St.Entry({
      style_class: 'adrt-recording-entry',
      hint_text: 'Short note (optional)',
      can_focus: true,
    });
    this.noteEntry = noteEntry;
    box.add_child(noteEntry);
    // Enter in either field is Save; the overlay's key handler covers Escape.
    for (const field of [entry, noteEntry]) {
      try {
        field.clutter_text?.connect('activate', () => this.submit());
      } catch {
        /* no text actor: the Save button is still wired */
      }
    }
    this.contentBox = box;
    return box;
  }

  private buildButtons(): StActorLike {
    const buttons: StActorLike = new St.BoxLayout({
      orientation: Clutter.Orientation.HORIZONTAL,
      style_class: 'adrt-recording-buttons',
    });
    buttons.spacing = 8;
    buttons.set_x_align(Clutter.ActorAlign.END);
    const cancelButton: StButtonLike = new St.Button({ label: 'Cancel', style_class: 'adrt-recording-button' });
    cancelButton.connect('clicked', () => this.cancel());
    this.cancelButton = cancelButton;
    const saveButton: StButtonLike = new St.Button({ label: 'Save', style_class: 'adrt-recording-button', can_focus: true });
    saveButton.connect('clicked', () => this.submit());
    this.saveButton = saveButton;
    buttons.add_child(cancelButton);
    buttons.add_child(saveButton);
    return buttons;
  }

  /** The entry plus the optional short note, as one note string. */
  private collect(): string {
    const first = this.entry?.get_text?.() ?? '';
    const second = this.noteEntry?.get_text?.() ?? '';
    return typeof second === 'string' && second.length > 0 ? `${first}\n${second}` : first;
  }

  private submit(): void {
    const text = this.collect();
    const callbacks = this.callbacks;
    this.close();
    callbacks?.onSubmit(text);
  }

  private cancel(): void {
    const callbacks = this.callbacks;
    this.close();
    callbacks?.onCancel();
  }

  private tryOverlay(): boolean {
    let overlay: StActorLike | null = null;
    try {
      const built: StActorLike = new St.Widget({
        style_class: 'adrt-recording-overlay',
        reactive: true,
        // A full-screen backdrop under the centred content; the dim colour comes
        // from the stylesheet, and the size is set in `resize()`.
      });
      overlay = built;
      const box = this.buildFields();
      box.add_child(this.buildButtons());
      built.add_child(box);
      uiGroup.add_child(built);
      this.actor = built;
      this.overlay = built;
      this.mechanism = 'overlay';

      // Fit the backdrop to the stage and re-fit on every stage resize.
      this.resize();
      this.stageSignals.push(global.stage.connect('notify::width', () => this.resize()));
      this.stageSignals.push(global.stage.connect('notify::height', () => this.resize()));

      // Escape anywhere on the overlay cancels; Enter in a field is Save.
      built.connect('key-press-event', (_actor: StActorLike, event: KeyEventLike) => {
        if (event.get_key_symbol() === Clutter.KEY_Escape) {
          this.cancel();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      });

      // Without the grab the Shell keeps sending keys to the focused window.
      this.takeGrab(built);
      this.focusEntry();
      this.settle();
      return true;
    } catch (error) {
      console.error(`[adrt] recording prompt (overlay) failed: ${(error as Error).message}`);
      try {
        if (overlay !== null) {
          if (this.grab !== null) popModal(this.grab);
          overlay.destroy();
        }
      } catch {
        /* ignore a half-built actor */
      }
      this.actor = null;
      this.overlay = null;
      this.contentBox = null;
      this.entry = null;
      this.noteEntry = null;
      this.saveButton = null;
      this.cancelButton = null;
      this.grabHeld = false;
      this.grab = null;
      this.disconnectStage();
      return false;
    }
  }

  /**
   * Take the modal grab once; guarded so a double call is a no-op.
   *
   * `Main.pushModal` (GNOME 42+) returns the grab handle, and `Main.popModal`
   * takes that handle — the actor is not enough, and passing it makes the Shell
   * throw `incorrect pop`, drop the stage's key focus and keep the grab.
   *
   * The action mode is explicit: the default is `Shell.ActionMode.NONE`, and
   * GNOME filters out *every* keybinding in that mode. Left at the default, the
   * prompt would silently kill the recording shortcut (and every other one)
   * for as long as it was open.
   */
  private takeGrab(actor: StActorLike): void {
    if (this.grabHeld) return;
    try {
      this.grab = pushModal(actor, { actionMode: Shell.ActionMode.NORMAL });
      this.grabHeld = true;
    } catch (error) {
      console.error(`[adrt] recording prompt could not take a modal grab: ${(error as Error).message}`);
      this.grab = null;
      this.grabHeld = false;
    }
  }

  /**
   * Fit the overlay to the stage and centre the content box in it. Called once
   * on show and again whenever the stage changes size.
   */
  private resize(): void {
    if (this.overlay === null || this.contentBox === null) return;
    try {
      const width = Number.isFinite(global.stage.width) ? global.stage.width : 0;
      const height = Number.isFinite(global.stage.height) ? global.stage.height : 0;
      this.overlay.set_position(0, 0);
      this.overlay.set_size(width, height);
      // `get_preferred_size()` returns four numbers in GJS; the width/height
      // helpers give the `[min, natural]` pairs the centering needs.
      const naturalWidth = this.contentBox.get_preferred_width(-1)[1];
      const naturalHeight = this.contentBox.get_preferred_height(naturalWidth)[1];
      const rect = centerRect({ width, height }, { width: naturalWidth, height: naturalHeight });
      this.contentBox.set_size(rect.width, rect.height);
      this.contentBox.set_position(rect.x, rect.y);
    } catch {
      /* the stage or content went away mid-resize */
    }
  }

  /**
   * One deferred pass once the actor is mapped: the box can only be measured
   * after the theme/relayout, and the entry can only hold key focus after the
   * modal grab has settled.
   */
  private settle(): void {
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      if (this.actor === null) return GLib.SOURCE_REMOVE;
      this.resize();
      this.focusEntryNow();
      return GLib.SOURCE_REMOVE;
    });
  }

  /** Focus the entry now and again after the next main-loop turn. */
  private focusEntry(): void {
    this.focusEntryNow();
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this.focusEntryNow();
      return GLib.SOURCE_REMOVE;
    });
  }

  private focusEntryNow(): void {
    const entry = this.entry;
    if (entry === null || this.actor === null) return;
    try {
      entry.grab_key_focus?.();
      global.stage.set_key_focus(entry);
    } catch {
      /* the stage went away */
    }
  }

  private disconnectStage(): void {
    for (const id of this.stageSignals) {
      try {
        global.stage.disconnect(id);
      } catch {
        /* the stage went away */
      }
    }
    this.stageSignals = [];
  }
}
