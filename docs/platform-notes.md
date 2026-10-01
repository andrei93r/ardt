# Platform notes — what adrt may call, and what it must never call

Companion to `docs/V2_MODEL.md`. Written from the code that ships and from what the
nested Shell on GNOME 50.1 actually exposes (probed with `ProbePlatform`, not from
memory). Three columns: **public** (documented, safe), **private** (works, but fragile —
used only behind a compat check) and **never** (a trap that has bitten this codebase).

## Shell and Mutter surface

| API | Class | Why |
| --- | --- | --- |
| `global.compositor.get_laters().add(BEFORE_REDRAW \| META_LATER_RESIZE \| IDLE, cb)` | public | the deferred-work idiom; `Meta.later_add` no longer exists |
| `global.get_pointer()`, `Clutter.Seat.create_virtual_device()` | public | input state and the harness's real injection (Stage 0) |
| `global.display.list_all_windows()`, `get_focus_window()`, `notify::focus-window` | public | the only window authority |
| `Meta.Window.move_resize_frame`, `maximize`, `unmaximize`, `minimize`, `change_workspace_by_index`, `make_above`/`unmake_above` | public | every geometry and state change goes through these (in the drain) |
| `global.workspace_manager` (`append_new_workspace`, `remove_workspace`, `reorder_workspace`, `layout_rows`) | public | workspaces; `layout_rows === -1` is the vertical layout |
| `layoutManager.getWorkAreaForMonitor(index)`, `monitors-changed`, `workareas-changed` | public | the only work-area authority; validated on every read |
| `Main.layoutManager`, `Main.overview`, `Main.sessionMode`, `Main.wm`, `Main.notify` | public | the extension's entry points |
| `Meta.Display` work-area methods | never | there are none in GNOME 50; `get_work_area_for_monitor` on a *workspace* is the workspace-0 answer and raises `logical_monitor != NULL` assertions for a stale index |
| `imports.misc.config.PACKAGE_VERSION` | private | the shell version is not exposed cleanly; the probe reports `unknown` rather than guessing |
| `Meta.is_wayland_compositor()` | private | works when present, guarded |

## Documented exceptions (each with its reason and its guard)

1. **Replacing `WorkspaceAnimationController.animateSwitch`** — the only way to get
   clone-free workspace slides. Guarded: the override is installed only when the
   controller exists, is restored on `disable()`, and every call forwards to the
   original for any input we do not own.
2. **Reading the `_swipeTracker` of a workspace actor** — needed to suppress tiling
   during a gesture. Guarded: a missing private member disables gesture suppression
   rather than throwing.
3. **Accepting a client's own rect after one retry** — the refusal ladder (§10). The
   window keeps the size it insists on; after one rejected frame we read back what
   the client actually took instead of fighting it.

## Harness facts on this laptop (probed, 2026-10-01)

| Fact | Value |
| --- | --- |
| GNOME Shell | 50.1, Wayland |
| `gnome-shell --devkit`, `--wayland --headless --no-x11`, `--virtual-monitor` | available |
| laters + `BEFORE_REDRAW` | available |
| virtual input (`Clutter.Seat.create_virtual_device`) | available; key **keyvals** drive real keybindings (Super+Z, Super+grave, Super+F verified) |
| `org.gnome.Mutter.RemoteDesktop` on the session bus | present (not needed while the virtual device works) |
| Shell `Eval` | **disabled** (`development-tools` off) — never rely on it |
| `global.display.get_grab_op` | not a function here; user-driven geometry is detected with `compat.button1Pressed()` (the drag's held button) |
| `ydotool` | not usable (no libinput seat in a nested Shell) |
| `session-like` target | **not runnable here**: `gnome-settings-daemon`, `xdg-desktop-portal`, `polkitd` and `gnome-remote-desktop` are not installed |
