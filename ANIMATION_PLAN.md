# Animation plan for the real machine

Goal: the three programmatic transitions look clean and predictable, with no
duplicate/shadowed window.

Transitions under test:

| # | Trigger | What should be seen |
|---|---------|---------------------|
| T1 | Maximize a window that has a sibling | One clean cut/slide to the new workspace; the window arrives maximized; no second copy of it anywhere |
| T2 | Unmaximize it | It returns to the pair (or floats over it) with one clean motion |
| T3 | Minimize a window whose workspace empties | It returns to the left workspace, floating over a pair or tiling beside a survivor |
| T4 | Overview drag of a window to another workspace | Both workspaces retile; no stacked leftover |

## Step 0 — baseline (animations on)

```bash
# with a pair tiled on the test workspace
bash ./scripts/session-test.sh            # S13/S14 drive T1–T4 and report
journalctl -b -o cat --since '2 min ago' | grep '\[adrt\]'
```

## Step 1 — isolate the cause (2 min)

Set `disable-animations` on and repeat T1:

```bash
ADRT_STATE_DIR=... gsettings set org.gnome.shell.extensions.adrt disable-animations true
```

- Artifact **disappears** → it is our own frame animation (durations/easing).
- Artifact **stays** → it is Mutter's switch animation, i.e. the *clones*
  Mutter draws during the slide. Each clone carries the window's shadow, which
  is what "the window shadows itself" looks like.

## Step 2 — the implemented fix for the clone/shadow

Our own workspace slides (maximize-right, minimize-return) now run with the
switch animation suppressed, by temporarily replacing
`WorkspaceAnimationController.animateSwitch` with an immediate completion —
the same technique the "Disable Workspace Switch Animation" extension uses
(verified in its source). User-initiated switches keep their animation.

## Step 3 — if a transition is still rough

1. Trace frames: enable `trace-enabled`, then read the `frame_timing` events in
   `~/.local/share/adrt/history/<date>.jsonl` and compare against
   `max-frame-interval-ms` (default 16 ms).
2. If frames exceed budget, shorten the animated distance (snap the window that
   is not being resized) rather than lengthening the duration.
3. If a window is animated while Mutter is animating it too, the guard should
   have skipped ours — check `disable-animations` again to tell which animator
   is running.

## Step 4 — confirm

Re-run `bash ./scripts/session-test.sh` and check S13/S14 plus the journal.
Record the outcome here and in `TEST_RESULTS_SESSION.md`.

## Note on reloads

Wayland cannot reload the module in place, so a fix only takes effect after a
log out/in. From now on this is left to you (no automatic logout from the
agent); say when you have reloaded and the live suite will be run against the
new build.
