#!/usr/bin/env python3
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
"""A parent window with a transient dialog that sits above it.

Used by A130 to exercise the occlusion rule (§11): the dialog covers the
parent's centre while the parent remains the focused tile, so the active-window
highlight must be hidden rather than drawn over the covering dialog. The dialog
is non-modal so the test can keep the parent focused (a real desktop has
always-on-top windows and non-focus-stealing dialogs in exactly this position).
"""

import sys

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import GLib, Gtk  # noqa: E402


def main():
    app = Gtk.Application(application_id="dev.adrt.CoverDialogClient")

    def on_activate(application):
        parent = Gtk.ApplicationWindow(application=application, title="adrt-cover-parent")
        parent.set_default_size(900, 640)
        # Quit the application when either window is asked to close, so the test
        # client exits promptly instead of leaving windows for ensure_clean to
        # time out on.
        parent.connect("close-request", lambda *_: application.quit())
        parent.present()

        def open_dialog():
            dialog = Gtk.Window(title="adrt-cover-dialog", transient_for=parent)
            dialog.set_default_size(280, 200)
            dialog.connect("close-request", lambda *_: application.quit())
            dialog.present()
            return GLib.SOURCE_REMOVE

        GLib.timeout_add(1200, open_dialog)

    app.connect("activate", on_activate)
    return app.run([sys.argv[0]])


if __name__ == "__main__":
    raise SystemExit(main())
