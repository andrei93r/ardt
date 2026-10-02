// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * The observation prompt for a user-initiated recording stop (§22 extension).
 * A small, dismissible Shell-native modal asks "What did you observe?" plus a
 * short free-text note; on Save the text is handed to the recorder as the note
 * that is written before the footer, on Cancel the recording closes with none.
 *
 * `Shell.ModalDialog` is used when the running Shell exposes it; otherwise an
 * `St.BoxLayout` overlay in `Main.uiGroup` is the fallback. Either way the
 * dialog is asynchronous (`open()`/`close()`, never a nested main loop), so it
 * does not block the Shell. It is a view: it owns no recording state and is
 * closed by `close()` from `disable()`.
 */

import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';
import { uiGroup } from 'resource:///org/gnome/shell/ui/main.js';

export interface RecordingPromptCallbacks {
  /** Save: the observation text (entry plus the optional short note). */
  onSubmit(text: string): void;
  /** Cancel/Escape: close the recording without a note. */
  onCancel(): void;
}

export type RecordingPromptKind = 'modal' | 'overlay';

export class RecordingPrompt {
  private actor: any = null;
  private mechanism: RecordingPromptKind | null = null;
  private entry: any = null;
  private noteEntry: any = null;
  private callbacks: RecordingPromptCallbacks | null = null;

  get isOpen(): boolean {
    return this.actor !== null;
  }

  /** Which native mechanism is on screen, for diagnostics. */
  get kind(): RecordingPromptKind | null {
    return this.mechanism;
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

  /** Tear the prompt down without firing a callback. Safe when already closed. */
  close(): void {
    const actor = this.actor;
    this.actor = null;
    this.entry = null;
    this.noteEntry = null;
    this.mechanism = null;
    this.callbacks = null;
    if (actor === null) return;
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
    return box;
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
      return true;
    } catch (error) {
      console.error(`[adrt] recording prompt (modal) unavailable: ${(error as Error).message}`);
      this.actor = null;
      this.entry = null;
      this.noteEntry = null;
      return false;
    }
  }

  private tryOverlay(): boolean {
    try {
      const overlay = new St.Widget({
        style_class: 'adrt-recording-overlay',
        reactive: true,
        layout_manager: new Clutter.BinLayout(),
      });
      const box = this.buildFields();
      box.set_x_align(Clutter.ActorAlign.CENTER);
      box.set_y_align(Clutter.ActorAlign.CENTER);

      const buttons = new St.BoxLayout({ style_class: 'adrt-recording-buttons' });
      buttons.spacing = 8;
      buttons.set_x_align(Clutter.ActorAlign.END);
      const cancel = new St.Button({ label: 'Cancel', style_class: 'adrt-recording-button' });
      cancel.connect('clicked', () => this.cancel());
      const save = new St.Button({ label: 'Save', style_class: 'adrt-recording-button', can_focus: true });
      save.connect('clicked', () => this.submit());
      buttons.add_child(cancel);
      buttons.add_child(save);
      box.add_child(buttons);

      overlay.add_child(box);
      uiGroup.add_child(overlay);
      this.actor = overlay;
      this.mechanism = 'overlay';
      return true;
    } catch (error) {
      console.error(`[adrt] recording prompt (overlay) failed: ${(error as Error).message}`);
      this.actor = null;
      return false;
    }
  }
}
