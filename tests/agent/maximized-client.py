#!/usr/bin/env python3
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
"""A normal tileable window that opens fully maximized.

Used by A126 to exercise §16's "an app that opens maximized" path: a client
like Nautilus or Chrome that asks Mutter to maximize the window before its first
frame reaches adrt. Unlike `MaximizeWindow` (an explicit user maximize), this is
the arrival-time state the routing rule has to handle.
"""

import sys

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import Gtk  # noqa: E402


def main():
    app = Gtk.Application(application_id="dev.adrt.MaximizedClient")

    def on_activate(application):
        win = Gtk.ApplicationWindow(application=application, title="adrt-maximized")
        win.set_default_size(800, 600)
        # Ask to be maximized before the surface is mapped, so the maximize is
        # part of the window's initial state (like Nautilus/Chrome), not a later
        # user-style transition adrt would read differently.
        win.maximize()
        win.present()

    app.connect("activate", on_activate)
    return app.run([sys.argv[0]])


if __name__ == "__main__":
    raise SystemExit(main())
