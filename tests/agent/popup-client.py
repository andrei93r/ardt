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

Set `ADRT_POPUP_CLOSE_MS` to open the popover once and pop it down after that
many milliseconds instead, so a scenario can observe both the mapped and the
closed state.
"""

import os
import sys

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import GLib, Gtk  # noqa: E402


def main():
    app = Gtk.Application(application_id="dev.adrt.PopupClient")

    def on_activate(application):
        window = Gtk.ApplicationWindow(application=application, title="popup-host")
        button = Gtk.MenuButton(label="menu")
        popover = Gtk.Popover()
        popover.set_autohide(False)
        popover.set_child(Gtk.Label(label="I am a popup"))
        button.set_popover(popover)
        window.set_child(button)
        window.connect("close-request", lambda *_: application.quit())
        window.present()

        close_ms = int(os.environ.get("ADRT_POPUP_CLOSE_MS", "0") or "0")

        def cycle():
            popover.popdown()
            button.popup()
            return GLib.SOURCE_CONTINUE

        def open_once():
            button.popup()
            if close_ms > 0:
                GLib.timeout_add(close_ms, lambda: (popover.popdown(), GLib.SOURCE_REMOVE)[1])
            return GLib.SOURCE_REMOVE

        # The parent is still being placed and animated by the tiler just after
        # map; opening a popover then can be dismissed by GTK immediately.
        GLib.timeout_add(2000, open_once)
        if close_ms <= 0:
            GLib.timeout_add(250, cycle)

    app.connect("activate", on_activate)
    return app.run(sys.argv)


if __name__ == "__main__":
    raise SystemExit(main())
