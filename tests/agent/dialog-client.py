#!/usr/bin/env python3
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
"""A parent window that opens a transient modal dialog after a moment.

Used by A120 to exercise the dialog rule (model §16): a dialog floats, is
centred on its parent and raised. The parent is a normal tileable window; the
child is `transient_for` it, so the extension can find the parent by identity.
"""

import sys

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import GLib, Gtk  # noqa: E402


def main():
    app = Gtk.Application(application_id="dev.adrt.DialogClient")

    def on_activate(application):
        parent = Gtk.ApplicationWindow(application=application, title="adrt-parent")
        parent.set_default_size(760, 560)
        # A modal child defers the parent's close, so a plain delete of the parent
        # leaves both windows tracked and makes ensure_clean wait out its timeout.
        # Quitting the whole application when either window is asked to close
        # makes the test client exit promptly.
        parent.connect("close-request", lambda *_: application.quit())
        parent.present()

        def open_dialog():
            dialog = Gtk.Window(title="adrt-dialog", transient_for=parent, modal=True)
            dialog.set_default_size(240, 160)
            dialog.connect("close-request", lambda *_: application.quit())
            dialog.present()
            return GLib.SOURCE_REMOVE

        GLib.timeout_add(1200, open_dialog)

    app.connect("activate", on_activate)
    return app.run([sys.argv[0]])


if __name__ == "__main__":
    raise SystemExit(main())
