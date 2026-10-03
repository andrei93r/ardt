// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * The observation prompt for a user-initiated recording stop (§22 extension).
 * A small, dismissible modal asks "What did you observe?" plus a short free-text
 * note; on Save the text is handed to the recorder as the note that is written
 * before the footer, on Cancel the recording closes with none.
 *
 * `Shell.ModalDialog` is used when the running Shell exposes it; otherwise a
 * full-screen `St.Widget` backdrop is added to `Main.uiGroup`, sized to the
 * stage and carrying a centred `St.BoxLayout`. The overlay must take a
 * `Main.pushModal` grab and focus the entry itself, otherwise keystrokes go to
 * the compositor's focused window and the user can neither type nor submit.
 * Either way the dialog is asynchronous (`open()`/`close()`, never a nested main
 * loop), so it does not block the Shell. It is a view: it owns no recording
 * state and `close()` releases the grab before destroying.
 */

import Clutter from 'gi://Clutter';
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

export type RecordingPromptKind = 'modal' | 'overlay';

/** The on-screen content rect, for `RecordingStatus.promptRect`. */
export interface PromptRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class RecordingPrompt {
  private actor: any = null;
  private overlay: any = null;
  private contentBox: any = null;
  private entry: any = null;
  private noteEntry: any = null;
  private saveButton: any = null;
  private cancelButton: any = null;
  private mechanism: RecordingPromptKind | null = null;
  private callbacks: RecordingPromptCallbacks | null = null;
  /** True while a modal grab is held (either mechanism). */
  private grabHeld = false;
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
   * Show the prompt. Returns false when neither a modal nor the overlay could
   * be built (the recorder still holds the deferred note, so the D-Bus test can
   * still submit one). A second `show()` while open is a no-op.
   */
  show(callbacks: RecordingPromptCallbacks): boolean {
    if (this.actor !== null) return true;
    this.callbacks = callbacks;
    if (this.tryModal()) return true;
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
    const overlay = this.overlay;
    const hadGrab = this.grabHeld && overlay !== null;
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
    this.disconnectStage();
    if (actor === null) return;
    try {
      if (hadGrab) popModal(overlay);
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

  private buildFields(): any {
    const box = new St.BoxLayout({ vertical: true, style_class: 'adrt-recording-body' });
    box.spacing = 8;
    box.add_child(new St.Label({ text: 'What did you observe?', style_class: 'adrt-recording-title' }));
    this.entry = new St.Entry({
      style_class: 'adrt-recording-entry',
      hint_text: 'Describe the bug you just saw…',
      can_focus: true,
    });
    box.add_child(this.entry);
    box.add_child(new St.Label({ text: 'A short note is enough.', style_class: 'adrt-recording-hint' }));
    this.noteEntry = new St.Entry({
      style_class: 'adrt-recording-entry',
      hint_text: 'Short note (optional)',
      can_focus: true,
    });
    box.add_child(this.noteEntry);
    // Enter in either field is Save; the overlay's key handler covers Escape.
    for (const field of [this.entry, this.noteEntry]) {
      try {
        field.clutter_text?.connect('activate', () => this.submit());
      } catch {
        /* no text actor: the Save button is still wired */
      }
    }
    this.contentBox = box;
    return box;
  }

  private buildButtons(): any {
    const buttons = new St.BoxLayout({ style_class: 'adrt-recording-buttons' });
    buttons.spacing = 8;
    buttons.set_x_align(Clutter.ActorAlign.END);
    this.cancelButton = new St.Button({ label: 'Cancel', style_class: 'adrt-recording-button' });
    this.cancelButton.connect('clicked', () => this.cancel());
    this.saveButton = new St.Button({ label: 'Save', style_class: 'adrt-recording-button', can_focus: true });
    this.saveButton.connect('clicked', () => this.submit());
    buttons.add_child(this.cancelButton);
    buttons.add_child(this.saveButton);
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

  private tryModal(): boolean {
    try {
      if (typeof Shell.ModalDialog !== 'function') return false;
      const dialog = new Shell.ModalDialog({ styleClass: 'adrt-recording-dialog' });
      dialog.contentLayout.add_child(this.buildFields());
      dialog.setButtons([
        { label: 'Cancel', action: () => this.cancel(), key: Clutter.KEY_Escape },
        { label: 'Save', action: () => this.submit(), default: true },
      ]);
      dialog.open();
      this.actor = dialog;
      this.mechanism = 'modal';
      // ModalDialog owns its own grab; `close()` must not pop it again.
      this.grabHeld = true;
      this.focusEntry();
      return true;
    } catch (error) {
      console.error(`[adrt] recording prompt (modal) unavailable: ${(error as Error).message}`);
      this.actor = null;
      this.contentBox = null;
      this.entry = null;
      this.noteEntry = null;
      this.grabHeld = false;
      return false;
    }
  }

  private tryOverlay(): boolean {
    let overlay: any = null;
    try {
      overlay = new St.Widget({
        style_class: 'adrt-recording-overlay',
        reactive: true,
        // A full-screen backdrop under the centred content; the dim colour comes
        // from the stylesheet, and the size is set in `resize()`.
      });
      const box = this.buildFields();
      box.add_child(this.buildButtons());
      overlay.add_child(box);
      uiGroup.add_child(overlay);
      this.actor = overlay;
      this.overlay = overlay;
      this.mechanism = 'overlay';

      // Fit the backdrop to the stage and re-fit on every stage resize.
      this.resize();
      this.stageSignals.push(global.stage.connect('notify::width', () => this.resize()));
      this.stageSignals.push(global.stage.connect('notify::height', () => this.resize()));

      // Escape anywhere on the overlay cancels; Enter in a field is Save.
      overlay.connect('key-press-event', (_actor: any, event: any) => {
        if (event.get_key_symbol() === Clutter.KEY_Escape) {
          this.cancel();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      });

      // Without the grab the Shell keeps sending keys to the focused window.
      this.takeGrab(overlay);
      this.focusEntry();
      this.settle();
      return true;
    } catch (error) {
      console.error(`[adrt] recording prompt (overlay) failed: ${(error as Error).message}`);
      try {
        if (overlay !== null) {
          if (this.grabHeld) popModal(overlay);
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
      this.disconnectStage();
      return false;
    }
  }

  /** Take the modal grab once; guarded so a double call is a no-op. */
  private takeGrab(actor: any): void {
    if (this.grabHeld) return;
    try {
      pushModal(actor);
      this.grabHeld = true;
    } catch (error) {
      console.error(`[adrt] recording prompt could not take a modal grab: ${(error as Error).message}`);
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
