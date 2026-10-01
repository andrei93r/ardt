#!/usr/bin/env python3
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
"""A normal parent window that keeps a visible `xdg_popup` on screen.

Used by A134 to prove that popup-family windows (menus, tooltips, popovers) are
never tracked. On X11 these are override-redirect; on Wayland they are
`xdg_popup` and report `override_redirect == false`, so the old
override-redirect filter let them through. Closing a tracked popup calls a NULL
`close` vfunc in Mutter and segfaults the Shell (see
`docs/shell-crash-audit.md`), so the test closes every tracked window and the
Shell must survive.

The popover is cycled so a popup is mapped often enough to be sampled; the host
window is a normal tileable window so the session is otherwise healthy.
"""

import sys

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import GLib, Gtk  # noqa: E402


def main():
    app = Gtk.Application(application_id="dev.adrt.PopupClient")

    def on_activate(application):
        window = Gtk.ApplicationWindow(application=application, title="popup-host")
        button = Gtk.Button(label="menu")
        popover = Gtk.Popover()
        popover.set_autohide(False)
        popover.set_child(Gtk.Label(label="I am a popup"))
        popover.set_parent(button)
        window.set_child(button)
        window.connect("close-request", lambda *_: application.quit())
        window.present()

        def cycle():
            popover.popdown()
            popover.popup()
            return GLib.SOURCE_CONTINUE

        GLib.timeout_add(700, lambda: (popover.popup(), GLib.SOURCE_REMOVE)[1])
        GLib.timeout_add(250, cycle)

    app.connect("activate", on_activate)
    return app.run(sys.argv)


if __name__ == "__main__":
    raise SystemExit(main())
