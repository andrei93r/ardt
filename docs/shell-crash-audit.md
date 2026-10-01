# Shell crash audit — adrt and the 2026-10-01 S18 SIGSEGV

Status: **fixed** — see the update below. Regression: `tests/agent/A134-popup-never-tracked.sh`.

## Update — 2026-10-01 10:18, reproduced with a JS stack, then fixed

The live smoke on the reinstalled build crashed the Shell again, this time with
the **JS** stack in the journal (the earlier dump had only the native backtrace):

```
GNOME Shell crashed with signal 11
#0  adapters/gnome/extension.js:1414   closeWindow -> tracked.win.delete(global.get_current_time())
#1  adapters/gnome/extension.js:1348   the CloseWindow D-Bus handler
#2  resource:///org/gnome/gjs/modules/core/overrides/Gio.js:379   gdbus method dispatch
```

That is the predicted path: `CloseWindow` (and the quit keybinding, via
`closeFocused`) call `Meta.Window.delete()`, and deleting an `xdg_popup` reaches
`MetaWaylandXdgPopup`, whose shell-surface `close` vfunc is NULL — a NULL call in
Mutter, i.e. SIGSEGV. `A134` proved the tracking half deterministically before
the fix (a `windowType 9` / `DROPDOWN_MENU` popup was tracked) and passes after.

### Fix

- `compat.isPopupWindow(win)` refuses the popup-family types (menu, dropdown,
  popup menu, tooltip, notification, combo, dnd).
- `WindowSession.register()` skips them, alongside override-redirect (on Wayland
  they report `override_redirect == false`, which is why the old filter missed
  them).
- `closeFocused()` and the `CloseWindow` trigger guard `isPopupWindow` as a last
  line of defence, so no path can `delete()` a popup.
- `DumpState` windows gained an add-only `windowType` so a test can assert it.
- Regression: `tests/agent/A134-popup-never-tracked.sh` — samples across popup
  cycles (none may be tracked), then closes every tracked window and requires the
  Shell to still answer.

## Incident

On 2026-10-01 at 08:47:11 the user's live session Shell crashed during the live
suite, while `tests/session/S18-trigger-wins.sh` was driving a refusing GTK
client. Apport wrote `/var/crash/_usr_bin_gnome-shell.1000.crash`:

- `Signal: 11`, `SignalName: SIGSEGV`
- `ProcCmdline: /usr/bin/gnome-shell --mode=ubuntu`
- `gnome-shell 50.1-0ubuntu1.2`, `libmutter-18-0 50.1-0ubuntu2.4`
- `Unpacked` core: `si_signo = 11`, `si_code = SI_TKILL (-6)`, and the signal
  frame reports `RIP = 0`.

`SI_TKILL` means the captured signal is the one Shell's own handler re-raised
after `gjs_dumpstack()`; the core is therefore the *re-raised* fault, not the
original. The native frames gdb reconstructs below the signal trampoline are
partly synthetic and must be read as a call chain, not as exact PCs.

## What the core showed

The main thread's backtrace contains **no `adrt` frame at all** — no extension
frame, no `gjs` JS frame. It is:

```
__pthread_kill_implementation
__GI_raise
<gnome-shell SIGSEGV handler>          # prints the JS stack, then raise(SIGSEGV)
<signal handler called>
0x0
meta_window_delete+37                   # /usr/lib/.../libmutter-18.so.0
libffi                                  # gjs marshalling
libgjs
libmozjs-140
<JIT code>
```

The link to our code is in the **journal**, not the core. The Shell's handler
dumped the gjs stack immediately before re-raising:

```
#0  .../adrt@adrt.dev/adapters/gnome/extension.js:1340   # tracked.win.delete(global.get_current_time())
#1  .../adrt@adrt.dev/adapters/gnome/extension.js:1275   # CloseWindow: (id) => this.closeWindow(id)
#2  resource:///org/gnome/gjs/modules/core/overrides/Gio.js:379
#3  resource:///org/gnome/gjs/modules/core/overrides/Gio.js:448
#4  resource:///org/gnome/shell/ui/init.js:20
```

So the fault happened inside `MetaWindow.delete()` called by our
`CloseWindow` D-Bus method (`extension.js:1340` is `tracked.win.delete(...)` in
`closeWindow`). The two lines immediately before the crash are
`Tried to ping window W71 (stubborn)` and `W72 (Home)` — those pings are
`meta_window_check_alive()` running after each earlier `delete()`, so the
`CloseWindow` loop was closing tracked windows one by one when the third one
faulted. The crashed window's `parsed desc` in the core is `W73 ([untitled])`.

## Mutter-side hypothesis (static analysis)

The installed mutter is 50.1. Reading the matching upstream sources
(`GNOME/mutter` tag `50.1`; the distro package is 50.1-0ubuntu2.4):

`src/core/delete.c: meta_window_delete()`

```c
g_return_if_fail (!window->unmanaging);
META_WINDOW_GET_CLASS (window)->delete (window, timestamp);
meta_window_check_alive (window, timestamp);      /* the pings above */
```

`src/wayland/meta-window-wayland.c: meta_window_wayland_delete()`

```c
MetaWindowWayland *wl_window = META_WINDOW_WAYLAND (window);
meta_wayland_surface_delete (wl_window->surface);
```

`src/wayland/meta-wayland-surface.c: meta_wayland_surface_delete()`

```c
MetaWaylandShellSurface *shell_surface =
  META_WAYLAND_SHELL_SURFACE (surface->role);
meta_wayland_shell_surface_close (shell_surface);
```

`src/wayland/meta-wayland-shell-surface.c: meta_wayland_shell_surface_close()`

```c
MetaWaylandShellSurfaceClass *shell_surface_class =
  META_WAYLAND_SHELL_SURFACE_GET_CLASS (shell_surface);
shell_surface_class->close (shell_surface);       /* NULL for popups */
```

`src/wayland/meta-wayland-xdg-shell.c`:

- `meta_wayland_xdg_toplevel_class_init()` sets
  `shell_surface_class->close = meta_wayland_xdg_toplevel_close;`
- `meta_wayland_xdg_popup_class_init()` sets `configure` and `managed` but
  **never sets `close`**, and the abstract `MetaWaylandShellSurface` base does
  not provide one either.

**Hypothesis:** closing a Wayland **popup** (`MetaWaylandXdgPopup`,
`window type = 9 = DROPDOWN_MENU`, `override_redirect == false`) takes
`surface->role` → `MetaWaylandShellSurfaceClass::close == NULL` and calls through
NULL, which is exactly the `RIP = 0` recorded by the signal frame. The crashed
window's `delete` vfunc disassembly is consistent: it inlines
`window->surface` (`0x290(%rdi)`) → `surface->role` (`0x30(%rax)`) →
`role->g_class` → `jmp *0x110(%rax)` (the shell-surface `close` slot), with no
NULL check.

This is stated as a hypothesis: it is from upstream source + disassembly, not
from a reproduced fault.

## Our exposure

`src/adapters/gnome/session.ts: register()` filters only:

```ts
if (compat.isOverrideRedirect(win)) return;   // win.is_override_redirect()
```

An xdg_popup is **not** override-redirect, so it passes the filter and is
tracked. An instrumented build logged a live GTK4 `Gtk.Popover` popup as:

```
[adrt-debug] register id=… title=null type=9 or=false transparent=undefined attached=false
```

(`type=9` is `META_WINDOW_DROPDOWN_MENU`). Once tracked, the popup is closeable
by us through **both** paths that call `Meta.Window.delete()`:

- `CloseWindow` (the D-Bus test trigger) — the path in the crash's gjs stack;
- `closeFocused()` (`session.ts`, bound to the quit keybinding / used by reaping).

This exposure is present on the installed build.

## Confirmed vs. not confirmed

Confirmed by observation:

- A GTK4 popover creates an xdg_popup that our `register()` **does** accept
  (the `[adrt-debug]` line above; `type=9`, `or=false`).
- The native core has no `adrt` frame; the extension link is the journal gjs
  dump (`CloseWindow` → `closeWindow` → `win.delete()`).
- The two pre-crash pings are consistent with `meta_window_check_alive()` after
  two earlier successful deletes.

Not confirmed / not obtained:

- **No deterministic reproduction and no regression test.** The popup is
  transient in the nested harness, and a D-Bus `CloseWindow` round-trip rarely
  lands while the popup is tracked. Attempts that did **not** crash the nested
  Shell: immediate spawn+close loops; repeated `CloseWindow` on the same id;
  killing the client then closing; spawning `refusing-client.py 1700 400` next
  to another window on `ADRT_MONITORS='1280x800'` **and** `'800x600'`; a GTK4
  popover client cycled next to a host window.
- The direct popup→NULL-`close` crash was not observed at runtime; it is inferred
  from the mutter source and the fault address.

## Recommended guard (not implemented)

Start in `src/adapters/gnome/session.ts: register()`: refuse popup/menu window
types in addition to override-redirect — check `win.get_window_type()` against
`MENU`, `DROPDOWN_MENU`, `POPUP_MENU`, `TOOLTIP`, `COMBO`, `DND` (and keep the
existing override-redirect filter) — so popups are never added to
`session.windows` and can never be handed to `delete()`. A belt-and-braces guard
in `closeWindow()`/`closeFocused()` (skip the delete when the window is a popup
type) is optional.

Regression place: a new nested scenario at **A132 or later** (A126–A131 are
allocated to other lanes) that spawns a popup-producing client next to a normal
window and asserts (a) only the normal window is tracked and (b) the nested Shell
survives `CloseWindow`/`close_all`. Because no deterministic crash was found,
the test as-is would assert the *guard* (popup not tracked) rather than a crash;
the crash-side reproduction still needs work.

## Scratch artefacts

Unpacked core, gdb transcripts, driver scripts and `popup-client.py` live only
under `/tmp/opencode/` (e.g. `/tmp/opencode/crash/`, `/tmp/opencode/repro*.sh`,
`/tmp/opencode/popup-client.py`). Nothing here is in the repository.
