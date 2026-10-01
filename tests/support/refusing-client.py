#!/usr/bin/env python3
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
"""A window that refuses to be tiled small: the refusal-ladder test client.

GTK enforces a window's minimum size, so a client that asks for a large minimum
is one that will refuse a half of a narrow screen (model §10 step 2). The first
argument is the minimum width in pixels, the second the minimum height, the
third the window title:

    refusing-client.py 1700 400 "stubborn"

Used by the refusal-ladder scenarios (A15, A113-A116) through
`adrt SpawnWindow "python3 tests/support/refusing-client.py 1700 400 stubborn"`.

Exit codes: 0 on a clean window close, 2 on a usage error.
"""

import sys

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import GLib, Gtk  # noqa: E402


def main(argv):
    width = int(argv[1]) if len(argv) > 1 else 900
    height = int(argv[2]) if len(argv) > 2 else 300
    title = argv[3] if len(argv) > 3 else "refusing-client"

    app = Gtk.Application(application_id="dev.adrt.RefusingClient")

    def on_activate(application):
        window = Gtk.ApplicationWindow(application=application, title=title)
        window.set_default_size(max(width, 200), max(height, 120))
        # The point of the client: it will not go below this, whatever the tiler
        # asks for. A single static label makes the minimum honest.
        label = Gtk.Label(label=f"{title}\nmin {width}x{height}")
        label.set_size_request(width, height)
        window.set_child(label)
        window.present()

    app.connect("activate", on_activate)
    return app.run([argv[0]])


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except (IndexError, ValueError):
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        raise SystemExit(2)
