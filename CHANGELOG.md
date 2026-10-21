# Changelog

All notable changes to Adrt are documented here. This project follows
[Semantic Versioning](https://semver.org/): MAJOR for a Shell bump that needs
code changes, MINOR for features, PATCH for fixes.

## [Unreleased]

### Recording shortcut and the core determinism gate

- **Bug:** a **tiled pair jittered by a pixel or two, forever**. The compositor
  reports a window's *frame* — the toplevel plus its invisible
  client-side-decoration border — so a window adrt placed exactly in its slot
  is read back one or two pixels larger. The self-heal clamp read that as an
  off-screen float and resized the window, every pass, forever (the history log
  showed `clamp_to_screen` → `tile clamp-to-screen` → `resize_retry` in a loop).
  The clamp now allows a few pixels of slack — the compositor's border — so a
  window that is really on screen is left alone.
- **Bug:** the **focus highlight was drawn before the window was in position**.
  A focus change arrives *before* the model has placed the window, so the rect
  the focus signal carries is the window's *pre-placement* frame. The border was
  drawn at that rect the moment focus changed and then snapped to the placement
  once the layout pass ran — a one-frame highlight in the wrong place, which the
  bug recorder caught as `border.focus` preceding `model.layout reason=focus`.
  `BorderState` now holds a `settled` gate: a focus signal marks the window
  unsettled, and the highlight stays hidden until the model has placed it. The
  gate is opened by the model's own focus-driven layout pass
  (`model.layout reason=focus`), by a model state pass when no placement is owed
  (an enable/disable cycle re-affirms focus with the window already in place, and
  no compositor signal precedes it), or by the focused window's frame actually
  moving off the pre-placement rect (`settleIfMoved`, used by the animated-frame
  and motion-tick paths, which observe current geometry). An unrelated model
  pass *while a placement is still owed* does not settle the border even if the
  frame has moved: the compositor can carry a window part-way to its slot, and
  settling on that intermediate rect is the same early draw by another route —
  the repeated-focus scenario caught one such draw in eighty episodes.
  Re-affirming the same focus from a state pass does not re-arm the gate, so the
  highlight cannot be hidden by a later pass with no focus layout to re-settle
  it — the enable/disable stress scenario proves it comes back.
- **Bug:** the **active-window highlight was painted on a loader**. A helper
  surface that took the focus before the real window arrived (an app's
  placeholder) is neither a tile nor a modal, so it is not a highlight
  candidate — but the state path set the border focus on whatever was focused
  and put the border back after the focus path had refused it. The border now
  follows the §23 candidate rule on that path too.
- **Bug:** a **maximized** window flickered between full screen and half width
  on every pass. Mutter reports a maximized frame including the invisible resize
  border, so it is a couple of pixels wider and taller than the monitor; the
  self-heal clamp took that for an off-screen float and resized the window —
  and the only way to resize a maximized window is to unmaximize it first. The
  window flashed to its restored size, the next pass maximized it again, and the
  clamp's retry ladder fought the client in between (a maximized lone window
  glitching on every motion tick). A maximized window is now left alone by the
  clamp: its frame belongs to Mutter.
- **Bug:** the **Record a bug** shortcut (`Super+Shift+R`) never showed the
  observation prompt, so the description of the bug was never written into the
  recording: the prompt built its box with `St.BoxLayout({ vertical: true })`,
  and GNOME 48+ removed that property ("No property vertical on StBoxLayout"),
  so the prompt failed to build every time. A vertical box is
  `orientation: Clutter.Orientation.VERTICAL` now, the way GNOME's own
  `js/ui/dialog.js` does it. A recording that could not ask for its note also
  left its file without a footer until the next recording started; the failure
  is now reported and the note closed with none instead.
- **Bug:** the same prompt could leave the Shell unable to run *any* keybinding.
  It took a `Main.pushModal` grab without keeping the handle and released it
  with the actor, so GNOME threw `incorrect pop`, dropped the stage's key focus
  and could leave the grab held — and a held grab keeps `Main.actionMode` at
  `NONE`, which filters out every keybinding. The prompt now keeps the grab
  handle, releases it with `Main.popModal(handle)` and asks for
  `Shell.ActionMode.NORMAL`, so the Shell's own shortcuts keep working while it
  is open.
- **Bug:** the shortcut was silent — a press started a recording with nothing on
  screen, which reads as a broken shortcut. Starting, stopping and saving a
  recording now raise a notice.
- **Tooling:** the core determinism gate (`npm run check:core`) no longer
  false-positives on a parameter default (`now: Date = new Date()` — the
  injection seam its `Date.now` rule already allows) nor on a date built from
  explicit components (`new Date(year, month, …)`). An argument-less
  `new Date()` outside a seam still fails the gate, and a comment that merely
  mentions an API no longer does.
- **Tooling:** the prompt's `Shell.ModalDialog` branch is gone: the GNOME modal
  dialog is a JavaScript module (`resource:///org/gnome/shell/ui/modalDialog.js`),
  not a libshell API, so the branch could never run. The overlay is the only
  mechanism, and the `gi://` declarations now match the GNOME 42+ `pushModal`
  / `popModal` API.
- **Tooling:** `npm test` runs the core suite (the script was missing).
- **Tooling:** the fixed bugs above are now pinned by tests: the core
  determinism gate is exercised against a throwaway tree
  (`tests/core/core-purity-gate.test.ts`), the Shell-API facts that broke the
  prompt are enforced over every adapter source
  (`tests/core/shell-api-drift.test.ts`), the recording lifecycle is journalled
  so a silent shortcut is provable (A147), and A171/A172 cover the clamp and the
  highlight rule live. The clamp's CSD-border and maximized-frame cases cannot be
  produced by the headless backend — they are the manual check in
  `tests/MANUAL.md` §14, with their modelled half unit-tested in the core.
- **Tooling:** A41 (same-app second window splits) no longer depends on Nautilus
  opening a window per URI: Nautilus 51 is single-instance, so a bare
  `nautilus trash://` raised the open window and the scenario saw one window and
  failed for the client's behaviour. It now drives the rule with whichever
  client really opens a second toplevel (an editor via `--new-window`, Nautilus
  as fallback) and skips only if every client is single-instance.
- **Tooling:** the agent run's journal scan no longer warns on a JS error that
  GNOME Shell itself threw (its stack frames are all
  `resource:///org/gnome/shell/` — a `windowManager.js` `_syncEnabled` race while
  a window-destroy transition runs). An error that reaches any other module, or
  that printed no stack at all, still warns.
- **Feature:** the preferences window has a **Recordings** page. It lists every
  bug recording on disk newest first, each with the local time it started, its
  size, how long it ran and the note you typed — and a remove button per row.
  A **Delete all** action sits behind a confirmation. The list is rebuilt from
  disk after every removal, and removal only ever touches a name that is both
  present and shaped like a recording, so a stale selection cannot delete
  anything else.
- **Tooling:** the recordings list's parse/sort/remove decisions are pure
  (`core/recording.ts`: `formatBytes`, `summarizeRecording`,
  `sortRecordingsNewest`, `recordingsToRemove`) and unit-tested; the A140
  constructed-prefs pass seeds two recordings in an isolated data dir and
  asserts the page lists them newest-first, then clicks a remove button and
  checks the file is gone and the list rebuilt. The #9 fix is pinned at two
  levels: the `BorderState` settle-gate unit tests stage the pre-placement frame
  directly (a fresh focus does not draw; a state pass while a placement is owed
  does not settle, even on an intermediate frame; a state pass with none owed
  does, so an enable/disable cycle brings the highlight back), and live scenario
  A173 cycles focus across a tiled pair and reads the journal's event order,
  failing if any border is drawn before its focus-driven layout. A173 was
  probe-verified against the older settle-timing behaviour, where it reports the
  early draw in a handful of episodes — and it then caught one residual
  intermediate-frame draw in eighty on the tightened gate. A161's disable/enable
  stress caught the other half, a gate that could open early but never late.

### Backlog §3–§4 and gap-list hardening

- **Model decisions:** a `left-half`/`right-half` rule now splits along the
  screen's own axis (top/bottom on a vertical axis; decision 43 amended, portrait
  defined as `height > width`), gaps stay per orientation (15/74), and decision
  94 documents the existing min-size fallback: perpendicular axis, then stack.
- **Resize limit:** `Increase/Decrease window` (and the directional nudges) at
  the 5–95% bound now toast “Already at the limit” instead of silently writing
  the same ratio, logging `split_resize` and re-reconciling (A166/A10).
- **Apps → Registry data:** Clear all asks for confirmation; Import offers
  Replace or Merge (existing data kept, Never-tile OR-ed, new apps added);
  newer-version files are refused with a clear message; export and merge re-read
  the registry first so recent Shell observations survive.
- **Tooling:** typed `DumpState` schema (`dump-schema.ts`), a bounded
  `recentErrors` ring in the dump, and a core determinism gate
  (`check-core-purity.sh` now rejects `Math.random`, IO and wall-clock reads
  outside the injection seams).
- **Bug:** a focused **modal** occluded by another window kept its focus border —
  the occlusion pass now treats modals like tiles (`getsActiveHighlight`), with
  the modal case added to A130.
- **Bug:** the active-window highlight was drawn **over app menus, popovers and
  tooltips**. They are window actors below the chrome layer, so the border
  painted through an open menu. The highlight now hides while a popup belonging
  to the focused window is mapped (`popup` suppression) and returns when the
  last one closes; A170 covers both transitions.
- **Gestures:** a swipe whose configured action matches GNOME's own is no longer
  intercepted. Three- and four-finger workspace switching now reaches GNOME's
  swipe tracker and follows the fingers; previously the extension swallowed it
  and called `activate()` only on release, which read as lag while switching
  workspaces. A custom action on either axis still owns that finger count, and
  `none` leaves the gesture to GNOME (the master toggle disables gestures).
- **Backlog §3:** A167 (screen-change single-plan stability), A168 (bounded
  refusal ladder, no top flip) and A169 (focus only after a real frame) verify
  the capture-era symptoms no longer reproduce on this build; §3.3 is fixed and
  covered.

### Rules float action, resize shortcuts and registry tools

- **Rules → Action → Float**: a rule can now leave a matching window floating
  (exactly like an exception app) instead of only forcing `full`/`left half`/
  `right half`. Matching is unchanged — the app picker plus an optional
  case-insensitive title glob (`*`, `?`; every filled field must match). The
  durable per-app alternative stays in "Never tile these apps".
- **Increase/Decrease window shortcuts** (`kb-increase-window`,
  `kb-decrease-window`; defaults `<Super><Control>plus` / `<Super><Control>minus`):
  grow or shrink the focused window along its pair's shared edge — horizontally
  on a landscape split, vertically on a vertical axis — whichever side the
  focused window is on. The step moved next to the resize shortcuts (Keys →
  Resize) and now defaults to 10 % (`nudge-step`; the directional nudges use it
  too).
- **Apps → registry data**: Clear all, Export… and Import… for the app
  registry, with a shape-validated JSON round-trip. Every registry change
  (Never-tile switch, forget, clear, import) bumps the internal
  `registry-revision`, which the running Shell watches: it drops its in-memory
  copy and re-reads the file immediately instead of waiting for the next login.

### Performance, correctness and typing (`perf-gnome`)

- **Compositor loop**: journal/history writes are buffered into one
  low-priority flush per second and flushed on disable, instead of an
  open/append/close per event; `surface-frame-changed` reaches the ring and
  any recorder but is only persisted while tracing/recording.
- **Correctness**: one timestamped echo cancels our own maximize/workspace
  signals (the synchronous flags were already cleared when Mutter's async
  signal arrived); every drain timeout is owned and a failed deferral can no
  longer leave a lane armed; split ratios are keyed by monitor connector with
  a legacy index-key migration; `checkPlan` receives window minimums; registry
  saves are guarded and retried; `History.prune` is actually wired.
- **Allocations**: classification returns its cache without building inputs;
  animation records/rects are built only while recording; animator hooks are
  pre-bound; the tiler config and compiled rule globs are built once per pass;
  resolved timing is cached behind named invalidation events; the event queue
  `has()` is O(1) and `drain()` reuses a documented buffer; focus/normalize are
  single-pass; screens are indexed by monitor.
- **Typing**: `src` now has **zero explicit `any`** — every GJS namespace in
  `gi.d.ts` is declared, `PlatformHost.on` is generic over the event union,
  and `compat.ts` uses structural interfaces. `eslint no-explicit-any` is an
  error, and a new `check:types` gate type-checks `src` and `tests` locally
  and in CI.
- **Dead code**: `platform/gestures.ts`, `RetileScheduler`,
  `AdaptationStore`/`FloatStore` and five zero-reference compat exports
  removed; a knip gate now holds files, dependencies and exports at zero
  findings.
- **Structure**: `session.ts` is decomposed from 4,083 to 1,875 lines
  (diagnostics, undo, focus, drain, workspace, self-heal, display, retiler
  and drag modules), the D-Bus XML and dispatch are generated from one
  trigger table, JSONL line/buffer logic is shared, and a dev-gated section
  profiler (`trace-enabled`) surfaces drain/retile/apply/classify timings in
  `DumpState.perfStats`.
- **Tooling**: `check:types` type-checks `src` + `tests`, CI runs the
  scenario-coverage guard and shellcheck, and `docs/ARCHITECTURE.md`
  records the layer rules and invariants.
- **Live-verified fixes** (found by the full nested + live suites): the
  maximize handler masks only our own maximizes, so a user maximize right
  after a tile apply is no longer swallowed; a new Rules-tab row starts
  disabled, so one click cannot install a catch-all `full` rule that silently
  defeats pairing; the app matrix skips a vanishing or dialog second window
  and retries a compositor-dropped maximize instead of failing.
- **Build**: `npm run build` cleans `dist/` first and pack/install always
  rebuild; the core-purity gate no longer false-positives on prose.

### Added (Stage 4 — app registry, prefs, migration)

- **The app registry** (`core/appregistry.ts`, adapter `registry.ts`) replaces
  `adaptation.json`, `behavior.json` and the `exception-apps` list with one entry
  per app: identity, `neverTile`, timing-only `adapt` hints, and per-instance
  placements with a durable per-app ordinal. `adapt` is **performance only**:
  the learned minimum (`refusedMin*`/`accepted*`) is gone and no geometry ever
  reaches the tiler.
- **Identity resolution** (`core/identity.ts`, adapter `appidentity.ts`): the
  documented chain — Shell desktop id → sandboxed app id → GTK application id →
  an AppImage ancestor (walking `/proc` because Chromium zeroes its own
  environment) → `wm_class` → a session-only `window:<seq>` — resolved at the
  first frame, recorded with its source, and re-keyed on `notify::wm-class` and
  the shell's `tracked-windows-changed`.
- **Settings migration**: `BUNDLE_VERSION` 3 → 4; a v4 bundle carries the
  registry and a v3 bundle is read into it (a newer bundle is refused rather than
  downgraded). The legacy `adaptation.json`/`behavior.json` are folded in exactly
  once with copy-verify-delete.
- **Enable-time normalisation** (`core/normalize.ts`, §20), run on every enable
  including mid-session: one managed window is maximized; a window covering ≥70%
  of the work area is maximized with the rest minimized; otherwise the top two by
  visible surface pair up and the rest minimize. Floats and fullscreen windows
  are untouched.
- The **prefs app registry page** replaces the problem-windows page: one row per
  app, a durable `neverTile` switch and a forget button. The row that bound the
  deleted `undo-stack-size` key is removed (opening prefs no longer throws).
- New settings: `display-memory-minutes`, `float-pins-workspace`, the per-side
  gaps (`gaps-left/right/top/bottom`) and `gaps-between`.
- `DumpState` gains each window's resolved `identity`, `identitySource`,
  `provisional`, `instanceId`, `ordinal` and `neverTile`, plus the `registry`,
  `neverTile` and `displayMemory` blocks.
- `GetRegistry`, `SetNeverTile`, `ToggleNeverTile` and `ForgetApp` on the test
  D-Bus surface.

### Added (Stage 5 — displays and hotplug)

- **Display plans** (`core/displays.ts`, adapter wiring in the layout drain):
  `monitors-changed`/`workareas-changed` push to lane 2, never policy in the
  Mutter handler; disconnect rescue (two windows per fresh workspace, on the
  physical side the screen was on), reconnect replay (slots, minimized, floats,
  fullscreen, by instance id), connector-keyed memory with a TTL and the primary
  read from GNOME, never set.
- `SimulateScreens` (a fixture screen list) and `SimulateWorkArea` (one
  connector's work area; an invalid reading keeps the last good value), plus
  `GetDisplayMemory`/`ForgetDisplayMemory`.
- `startup-complete` gating: the first layout drain waits for the shell to
  finish starting up (with a bounded fallback so it can never hang).
- Scenarios `A98`–`A100` (registry), `A15` rewritten (a refusing client is
  accepted and no minimum is learned), `A109`–`A112`, `A122` (displays) and the
  assisted `S17-dock-drill`; `S15` covers decision 68 (a screen without
  workspaces ignores a workspace switch). `tests/MANUAL.md` is the hardware
  acceptance handover (physical hotplug/dock, real gestures, suspend/logind lock,
  fractional scaling).

### Added (Stage 0 — grounding and event-confirmed triggers)

- `ProbePlatform` on the test D-Bus surface: a capability JSON (laters and
  `BEFORE_REDRAW`, monitor count, `layout_rows`, virtual input, RemoteDesktop,
  injection, grab detection, devkit), so the harness can gate on facts instead
  of assumptions.
- **Event journal** (`adapters/gnome/journal.ts`): every raw platform event and
  every decision, one monotonic sequence, a bounded in-memory tail for
  `DumpEvents`/`DumpDecisions`, and one JSONL file per day under
  `$XDG_DATA_HOME/adrt/journal` rotated by size with a 30-day retention. The
  host now watches each window's own signals (frame, monitor, workspace,
  minimized, wm-class, unmanaged) so nothing happens unjournalled.
- **Real input injection**: `InjectPointerMove`, `InjectPointerButton` and
  `InjectKey` through `Clutter.Seat.create_virtual_device`, gated on
  `ADRT_INJECT` (the nested harness sets it; a live session never does).
- The **decision catalogue** (`core/notify.ts`) and `SimulateNotice`: decisions
  phrased as decisions, deduplicated per subject and rate-limited, opt-in behind
  the `debug-toasts` setting, with the nothing-happened notices always shown.
  Every decision is journalled whether or not it is shown.
- `DumpState` gains the pair `axis` and a derived `slot` per window, the `gaps`
  in force, and `focusedReason` for the harness's focus triggers.
- Harness: `tests/lib/common.sh` shared by both runners, `tests/MANIFEST.md`
  (generated) listing every scenario with what it needs and when it can skip,
  and `tests/support/refusing-client.py` for the refusal-ladder tests.
- `docs/platform-notes.md`: the public/private/never API table and the
  documented exceptions, probed on GNOME 50.1 rather than remembered.

### Added (Stage 1 — one scheduling path)

- **The event queue** (`core/queue.ts`, adapter wiring): `Map<lane, Map<key,
  event>>` with lanes 1 feedback / 2 layout / 3 maintenance, per-key coalescing,
  and one deferred drain armed on demand (lane 1 on `BEFORE_REDRAW`, lane 2 on
  the compositor's resize-later, lane 3 on a settle timeout) and removed when it
  empties. Every signal handler now only pushes — `scheduleReconcile`,
  `screens-changed`, session resume, reset, the post-close sweep and the periodic
  motion pass all ride the drain; the 60 ms reconcile debounce is gone (the queue
  coalesces), and the drain waits out a running animation instead of applying a
  frame onto a moving surface.
- **Config caching**: the classifier config is memoised and invalidated on any
  change, so a cached classification no longer rebuilds its inputs; `A66` records
  the ratio (tens of classifications per rebuild against hundreds before).
- `DumpState` gains the queue counters `drains`, `queuePending` and `drainMsMax`
  (extended by Stage 6); scenario `A84` proves ten frame pushes coalesce to one
  pass, and `core/queue.test.ts` covers the queue (13 tests).
- The work surfaced and fixed: `InjectVerifyFailure` ignored the window id and
  failed every window's applies, so another window's shrink looked like a refusal
  and taught a bogus minimum (A52); a per-window refusal now needs the same
  target refused twice with the size unchanged, and the border's
  suppression/release events are journalled with their reason (A02).

### Changed

- `A22`/`A23`/`A24` (keybindings) run headlessly by injection instead of being
  skipped for lack of a seat; `A01`/`A14` derive their bounds from `DumpState`
  instead of the literal `1281x801`; `A32`/`A59`/`A64` poll with a real budget
  instead of single-shot assertions.
- Scripts that no longer apply to the laptop's harness are struck from the plan
  with a reason (`scripts/server-test.sh` needs the not-yet-set-up server).

### Added (Stage 2 — slots, routing, maximise, emptiness)

- The adapter now routes, maximises, unmaximises, fullscreens and reaps through
  the pure v2 model (`core/placement.ts` + `core/workspaces.ts`):
  `routeNewWindow`, `maximizeWindow`, `unmaximizeWindow`, `reapPlan` and the
  escape. The screen class is read from GNOME (`org.gnome.mutter`
  `dynamic-workspaces`/`workspaces-only-on-primary` and
  `org.gnome.desktop.wm.preferences num-workspaces`), never from internal vs
  external. `ScreenClass`/`Env`/`State` are built per drain.
- **The escape rule** (§16/§10): a managed window that does not fit its slot
  (oversized, `min == max`, or refusing) gets its own workspace to the right,
  sized to itself, clamped to `[1/6, full screen]`, flush at slot 0; on a
  single-workspace screen the trigger keeps the screen and the others minimize.
- **`follow-moved-window`** (default on), the workspace-move shortcuts
  (next/previous/by index), and nudge on both axes; `DumpState` gains each
  window's `min`/`max`.
- New scenarios: `A85`–`A93`, `A106`, `A113`–`A118`.
- `MoveFocusedToWorkspace` on the test D-Bus surface.

### Changed (Stage 2)

- Maximize is in place with the other managed windows minimized on a
  single-workspace screen; on a workspace-capable screen it is a workspace to
  the right. Fullscreen behaves the same.
- **Classification** (§16): an always-on-top window (a picture-in-picture video,
  a widget) now floats and **keeps** its flag (reversing the old A61 behaviour);
  a dialog or transient floats; an app that maps itself maximized is unmaximized
  and tiled with its sibling; fullscreen is the "does not fit" case.
- Unmaximize joins the left workspace when it holds exactly one window (into
  slot 1), else the right, else parks minimized left/right, else re-maximizes
  the lone window. No origin memory.
- Reaping is a property: every empty workspace other than GNOME's trailing spare
  is removed wherever it sits; a workspace holding only minimized windows
  relocates its occupant first; a float pins its workspace.
- The `get_min_size()`/`get_max_size()` reading is fixed for GNOME 50, which
  returns `[hasSize, width, height]` (it previously read the leading boolean).
- A not-yet-ready window is excluded from the tiling until its routing decides
  its side, removing the race that could form a pair swapped.
- `A50`, `A53`, `A59` and `A40` are retired with recorded skips; their v2
  replacements are `A90`/`A91`/`A113`.

### Removed (Stage 2 — dead v1 machinery)

- The `tileables.length > 2` extra branch (both in `retile` and the coherence
  sweep) and `floatOverPair`-as-eviction.
- `unmaximizeStaleLone`, `returnFromMaximize`, `previousWorkspaceIdx` and the
  `onMaximizeSignal` origin memory.
- The minimise-slide (`onMinimized` moving a lone window left) and the old
  `pruneEmptyWorkspaces` rules (the `dynamicWorkspaces` set and its cooldown).
- `EXILE_COOLDOWN_MS`, the spawn-budget gates and `core/budget.ts` (with its
  test): the model has no rationing, no budget and no cooldown.
- `workspaceOpDepth` (the reorder re-entry guard is now unnecessary: the
  reorder handler only schedules a drain).
- Settings `workspace-auto-name`, `workspace-move-grace-seconds` and
  `respect-user-workspace-move`.
- The auto-float pull-back from the coherence sweep: a float pins its workspace.

### Added (Stage 3 — user-driven interactions)

- **The drop ladder** (`core/placement.ts` `dropPlacement`): a free slot wins, on
  the side the window came from; otherwise a window whose perimeter was crossed
  is swapped with; otherwise the window floats where it was dropped. Same-plane
  drops that cross nothing simply return to their tile. Cross-screen moves pick
  the adjacent screen by geometry and run the same ladder; a maximized window is
  un-maximized at the drop.
- **Focus order** (`core/focus.ts` `cycleOrder`): the cycle walks the current
  screen and workspace — managed windows in slot order, then floats left to
  right (a perfect overlap resolves by stacking order), minimized skipped,
  wrapping; focusing a float raises it. A direction with nothing that way stays
  silent (the opposite-direction fallback is gone).
- Dialogs are raised as well as centred; `un-float` with both slots taken toasts
  and changes nothing.
- `disable-animations` now switches off GNOME's own Shell animations
  (`St.Settings.enable_animations`) as well as adrt's frame animations.
- New scenarios: `A94`, `A95`, `A96`, `A97`, `A107`, `A108`, `A119`, `A120`,
  `A121` (`A107`/`A108` need two screens and skip otherwise, like `A106`).

### Added (Stage 6 — undo, flags, replay)

- **Undo** (`core/undo.ts`): exactly one in-memory change, per instance and
  configuration — workspace, slot, rect, maximized, floating — plus the ratios.
  It reverses a swap (two instances) and an un-float (the flag), validates the
  whole change before applying any of it, and toasts (`undo-impossible`,
  `nothing-to-undo`) when it cannot. A routed new window is not a change.
  `ChangeLog` replaces the persisted `UndoStack`; `undo-stack-size` and its
  persisted state are gone.
- **Session modes** (§19): lock/suspend pauses new work, lets the queue finish
  what it already holds, then retiles once on resume; screen sharing keeps tiling
  and hides the highlight.
- **Flags**: per-subsystem `debug.*` (`debug-tiling`, `debug-focus`,
  `debug-displays`, `debug-undo`, `debug-session`), `perf-enabled` with a
  `perfStats` block (queue depth, drains, drain/apply p50 and p95), and `record`
  plus `DumpTrace`, which exposes the model journal and decisions as a replayable
  trace (`core/replay.ts` shape).
- New scenarios: `A101`, `A102`, `A103`, `A104`, `A123`.

### Changed (Stage 3/6)

- `A44` is retired with a recorded skip: the v1 opposite-direction focus fallback
  is deleted by the model (§6/§17, decision 58); the silent direction is covered
  by `A57`/`A121`.

### Added (Stage 7 — monitor matrix and vertical hardening)

- **The per-screen split axis**: `moveToward` and `DumpState.tileAxis` read the
  focused screen's own axis (portrait or `layout_rows === -1` stacks; landscape
  with horizontal workspaces splits side by side) instead of a session-wide
  guess. A window crossing an edge re-slots on the target's axis.
- **Geometry-based monitor movement**: `adjacentScreen` picks the next screen by
  rectangle adjacency (perpendicular overlap first, then the nearest edge) — never
  by index — so a mixed landscape/portrait layout moves a window the way a user
  sees it.
- **`screens-changed` re-reads the surface**: `WindowSession.onScreensChanged`
  refreshes every tracked surface (monitor, frame, monitor-implied sticky, size
  hints) and drops classification before the deferred replan.
- The host keys screens by the real Mutter index and connector, and marks the
  primary from GNOME's current `primaryIndex`; `workAreaOf`/`axisOf` look a
  monitor up by index.
- **The cross-screen arrival waits for the move to land**: `move_to_monitor` is
  asynchronous, so the arrival ladder could float a window against the *source*
  work area and drag it straight back (A106 failed on two monitors at HEAD). The
  drain now re-arms until the window reports the target screen (bounded).
- New scenario `A105-per-screen-axis` (a landscape and a portrait screen in one
  session, plus the `layout_rows === -1` stack); `A81` derives the monitor set
  from the actual geometry (a size multiset plus the primary from `isPrimary`,
  never the input order); `A64` expects the screen's own axis after the
  orientation override is lifted (a portrait monitor keeps stacking).

### Removed (Stage 7 — hard-coded geometry)

- `fallbackScreen` (`session.ts`) and `dummyScreen` (`tiling.ts`): the hard-coded
  `1920x1080` and `0x0` screens. A missing screen now skips the frame instead of
  inventing one.

### Changed (Stage 8 — docs, dead code, perf re-scope)

- `spec.md`/`README.md`: the superseded v1 behaviour sections (§5–§7, §9,
  §11–§21, §35) are replaced with pointers to `docs/V2_MODEL.md`; the metadata
  description and `version-name` move to `0.2.0`.
- `PERFORMANCE_PLAN.md` re-scoped: Stage 1 (config caching) and Stage 2 (O(1)
  host lookup) carried onto the v2 code; Stage 3 and the sweep back-off struck
  (the queue and the lane-3 maintenance pass replace them), and re-measured:
  idle `configBuilds`/`rulesParses` drop 29.9/s → 3.5/s, `classifyMisses` is 0,
  and `hostScans` stays **0** across 138 `hostLookups` on the tile/animation
  path, with the queue empty between bursts.

### Removed (Stage 8 — dead code and settings)

- Setting `escape-fullscreen-only-fullscreen`: declared for compatibility but
  never read (Adrt never grabbed `Escape`).
- `UndoStack` and `UndoEntry` (`adapters/gnome/history.ts`): the persisted v1
  undo stack, superseded by the single in-memory `core/undo.ts` change.
- `isSwapped` (`tiling.ts`), `layerOf`/`pairKeyFor`/`pruneEmptyNow`
  (`session.ts`), `easeOutQuad` (`frame-clock.ts`), `hasClutterGestureAction`
  (`compat.ts`), `refusalLadder` (`core/placement.ts`), `isTileable`
  (`core/classify.ts`), `sizeEquals` (`core/types.ts`) and `EventQueue.isEmpty`
  (`core/queue.ts`): all were unreferenced.

### Added (Stage 8 — long-run invariant test)

- `A125-long-mixed-run`, opt-in behind `ADRT_LONG_RUN=1` (180 s by default,
  overridable with `ADRT_LONG_RUN_SECONDS`): a loop of
  spawn/close/move/minimize/maximize/drag/workspace-switch that asserts the
  journal and the in-memory decision tail record no `invariant_violated` entry,
  proving the packing invariant (§5) holds under sustained churn.

### Fixed

- **A maximize is no longer reversed 20–45 ms after it lands.** A stale verify
  from the pre-maximize plan applied a tile frame, `applyFrame` unmaximized the
  window to fit, and the signal path read that as a *user* unmaximize and dragged
  the window back. `TrackedWindow.selfUnmaximize` now marks the tiler's own
  unmaximize, and a user maximize is kept as a property (`maximizeRequested`)
  that the lane-2 drain re-asserts, so a missed or raced signal cannot leave a
  maximized window sharing its pair.
- **The float key no longer persists a durable `neverTile`.** Pressing `Super+F`
  wrote the registry's `neverTile` flag on every float, so one float permanently
  floated that app (and cascaded into later scenarios). It now persists only when
  `float-persistence` is on; the float is otherwise session-scoped as the model
  says.

## [0.1.0] - 2026-09-29

### Added

- Pure `core/` decision logic: classification, pair tiling with learned split
  ratios, rule matching, config bundle merge, border state machine, retile
  coalescing, gesture and session state machines, app profiles, plan
  invariants.
- `platform/` interfaces designed for a future KWin adapter.
- GNOME Shell 48–50 adapter: window lifecycle, workspace policy, animation,
  verification and problem-window adaptation, D-Bus interface, event history.
- Touchpad gestures: 3- and 4-finger swipes and pinch, with a pure state
  machine and D-Bus simulation.
- Active window indicator with a single visibility owner.
- Autonomous agent harness that runs 30 scenarios in a nested GNOME Shell.
- 114 core unit tests.

### Recently completed

- Per-window min/max dimensions are captured from Mutter once and cached, so
  tile calculation never re-queries the compositor.
- Dynamic workspaces are removed when they become empty; workspace reorders
  re-derive every index and retile.
- `respect-user-workspace-move` + `workspace-move-grace-seconds`: policies
  leave a window alone after the user moves it.
- `float-persistence` stores opt-in floats in `behavior.json` and restores
  them on the next launch.
- `reflow-keeps-edges` can keep a lone window at its current rect.
- `keybindings` accepts `name=accelerator` overrides.
- `perf` telemetry measures scan reconciliation and retile application time.
- `workspace-auto-name` names spawned workspaces.
- Dragging a window freezes reflow and hides the border; releasing interprets
  the gesture: an inner-edge resize saves the split ratio (§12), dragging a
  window past its sibling swaps the pair (§13), and anything else reflows.
- Resizing a tile is detected from frame changes, not just compositor grabs,
  so client-side (CSD) resizes work: the sibling follows live and the ratio
  persists instead of snapping back.
- A plan is re-applied when a window no longer matches it, not only when the
  plan changes. Previously a window moved outside the drag path (or by the
  user after a missed signal) was never put back, leaving tiles overlapping
  and half the screen empty.
- Every window on every screen and workspace is re-checked after any create,
  close, move, resize, workspace or screen event, and corrected when it does
  not match its plan. Window creation/destruction, mapping, focus, monitor
  changes, workspace add/remove/count/switch and screen/work-area changes all
  funnel into the same debounced reconcile pass.
- Dragging a window swaps with its sibling when it lands on the sibling's area
  (its centre inside, or ≥35% overlap), not only when it crosses the sibling's
  centre. Move-vs-resize is inferred from the geometry, so it no longer depends
  on which grab-op code the compositor reports.
- An app that opens maximized (e.g. Files/Nautilus) is tiled with its siblings
  instead of being exiled; only a user-initiated maximize gets its own
  workspace.
- Workspace model: new space is created to the right and a maximized window
  gets its own workspace there; finishing (close/unmaximize/minimize) returns
  the view to the left.
- Focus by direction falls back to the opposite side when there is no window
  in the requested direction (and does nothing with no neighbour at all).
- Every empty workspace is reaped (not only ones Adrt created), never while
  active, and closing the last window switches the view away first.
- Apps that open maximized (Files) are unmaximized and tiled with their
  siblings; registration-time maximize/workspace signals no longer exile the
  first window.
- Unmaximizing a window onto a workspace that already holds a pair floats the
  newcomer on top, centred with a margin, so the tiled pair stays visible
  instead of being completely covered.
- A new workspace is created immediately to the **right** of the current one
  (appended then reordered) and the view follows the window there, instead of
  parking it at the end of the workspace line.
- Empty dynamic workspaces are reaped on the safety-net scan and never while
  the user is on them, which avoids the Shell bouncing into the overview when
  a workspace is removed mid-action.
- Window resizing no longer depends on the mouse-button state being reported;
  a frame change that differs from the last planned rect (and is not our own
  apply, an animation, a maximize/fullscreen/minimize state change, or a
  stubborn refusal) is treated as the user resizing.
- `DumpState` reports `workspaceActors`, `wsSwitchEvents` and
  `motionSuppressions` to diagnose border suppression on real hardware.
- Tiling keeps running while the overview is open; only the border is hidden
  there (and it returns when the overview closes). The overview never pauses
  or suspends the tiler.
- Unmaximizing a window whose **left** workspace already holds a pair returns it
  there floating on top of the pair (not tiled, not re-maximized in place), and
  the view follows it back — finishing never strands you on an empty workspace.
  Scenario A50.
- The active-window highlight is suppressed while the focused tile is covered
  by a floating window, so it can no longer be drawn over a window above it.
- A drag swap takes effect as soon as the window is dropped instead of waiting
  out the reconcile debounce (now 60 ms). Scenario A32 asserts the latency.
- A fresh pair splits 50/50 when the windows' minimum sizes allow it; the live
  suite clears the ratios it sets so a test run cannot leave your pairs on a
  test split.
- The adaptation store no longer learns a minimum width from a window that
  refused to *grow* (a max-size app): that recorded its current size as a
  minimum, which pinned e.g. Chrome to 1477 px and made a 50/50 split
  impossible. Only a window that refused to shrink teaches a minimum.
- The border is hidden at once when Adrt moves a window to another workspace
  (a third window going right), instead of being drawn at the old spot while
  the window is pushed away.
- Animation frames are clamped to the screen's work area and eased out cubic
  at 130-190 ms (up to 240 ms for large moves), so a reflow stays smooth
  without exceeding the boundary.
- A pair is laid out by where its windows actually are, not by window id, so
  the window on the left stays the left tile (and the top one stays on top in
  a stacked split) even after a window is created or reordered out of id order.
  A pair the user marked *swapped* keeps the stable id order instead, so the
  two rules cannot fight and oscillate.
- Keyboard-driven focus system: directional focus (left/right/up/down) relative
  to the selected window, following the layout — side-by-side for a horizontal
  pair, stacked for a vertical one — and reaching other monitors. It only ever
  considers the current workspace: focusing never switches or navigates to
  another workspace. Directional move, fullscreen toggle and quit are bound too.
  All shortcuts are customisable (`kb-*` keys and the new Keys page in the
  preferences window); changing one re-registers it immediately. Core covers the
  directional picker (`pickDirectional`) and A57 covers the bindings.
- The coherence sweep walks the whole system every 700 ms: every workspace,
  every monitor, every window. A single tileable window is maximized (there is
  no such thing as an untiled single window), a pair is tiled, more than a pair
  floats the extra, and an automatic float left alone is pulled back into the
  tiling. It is no longer skipped while any animation runs — it skips only the
  individual windows that are animating — and it retries a lone window at most
  every 3 s so a refusing window is not hammered. `coherenceFixes` is exposed in
  `DumpState` (A56/A58/A59).
- Returning from a maximize no longer overshoots: its workspace switch runs with
  no slide/clones (like the maximize-right), and the landing is applied snapped
  instead of animating a maximized rect down to a tile while the workspace
  changes. The minimize-return snaps too.
- A workspace that ends up with more than a pair no longer floats an extra that
  simply *opened* there: a window the user dragged in (the overview) floats over
  the pair, while a newly opened third window goes to its own workspace, as the
  model requires. The sweep could previously float a fresh third window before
  the register policy moved it right.
- The history log is a real append with size-based rotation: `append()` used to
  read the whole file and rewrite it on *every* event, which is what turned a
  200 MB log into an out-of-memory crash. It now appends through a stream,
  rotates at `history-max-bytes` (default 8 MiB) into `<day>.N.jsonl`, keeps 5
  parts per day and prunes the rest (core/rotation.ts, A65).
- `DumpState.build` reports the running module (version + install-directory
  mtime) so "is the running build the one I installed?" is one call away; the
  enable log records it too (A65).
- Vertical Workspaces (V-Shell) compatibility: the tile axis, `moveToward` and
  the tiler all read the same signal V-Shell sets
  (`override_workspace_layout(rows = -1, columns = 1)`), so a pair splits 50/50
  top/bottom and moving a window up/down swaps it (A64).
- **Multi-monitor: nothing on the second monitor could be tiled.** Mutter reports
  `on-all-workspaces` for every window on a non-primary monitor while
  `workspaces-only-on-primary` is set (GNOME's default, and this machine's), and
  the classifier treated that flag as a hard skip — so those windows were never
  tiled and simply stacked on top of each other. The skip now uses a `sticky`
  flag computed the way Mutter does it (`workspaces-only-on-primary` plus the
  window's monitor). Spec §5; A72 and the live S15.
- A window that changed monitor kept a stale classification: the hot frame path
  re-read only the rect and monitor, so a window moved from the secondary
  monitor to the primary stayed "on all workspaces" (and the other way round).
  `TrackedWindow.refreshFrame()` now re-reads the whole surface when the monitor
  changes. S15.
- Lone-maximize, the "more than a pair" rule and the unfloat pass were evaluated
  per *workspace* while the tiler plans per *monitor*: with two monitors a pair
  on one screen made a lone window on the other an "extra" — floated over the
  pair or exiled to a new workspace. All three are scoped to one workspace and
  one monitor now, matching §9. A72, A75, S15.
- A drag whose release signal never arrived (an overview drag, a Shell restart, a
  lost `grab-op-end`) froze every tiling path — reconcile, coherence sweep and
  periodic retile all skip while a drag is in flight — so windows stayed stacked
  until the next real drag. The sweep now abandons such a drag once it has been
  quiet for 2.5 s with no mouse button held, and does not interpret the drop.
  A73.
- An overview drop scales the window as well as moving it, and the drop was read
  as an inner-edge *resize*, saving a bogus split ratio for the app pair that
  then persisted (the pair came back skewed instead of 50/50 for good). Move
  versus resize is now decided by `core/adjust.ts`: a resize changes exactly one
  axis, anything else is a move. Spec §12; A74 and 6 core tests.
- **The exile policy could run away and explode the workspace list.** Sending a
  window to its own workspace calls `WorkspaceManager.reorder_workspace()`,
  which emits `workspaces-reordered` **synchronously**; that handler retiled,
  which called straight back into the exile policy for the same window. One
  window was exiled 160 times in a second at ~1 ms per iteration and the
  workspace count reached **86**: the window ended up on workspace 86 while its
  clone was left on every workspace, and the desktop was unusable. Deeper
  containment now: the reorder handler only schedules a debounced pass, a
  workspace operation can never re-enter `moveToNewWorkspace`, a window that was
  just exiled waits 3 s before it can be exiled again, and workspace *creation*
  is rationed (`core/budget.ts`, 12 per 10 s) and capped at `windows + 4`. A
  refused exile floats the window over the pair instead of leaving it stacked,
  and the refusal is logged as `ws_spawn_blocked`. A76.
- A drop that lands on the sibling is a swap whatever the reported drag mode says:
  a client or the compositor can clamp a dragged window's size, which used to be
  read as an inner-edge resize and skewed the split ratio instead of swapping at
  all (A32, A77). Spec §13.
- New scenarios A72 (pinned versus monitor-implied), A73 (lost drag release), A74
  (overview drop is a move), A75 (overview patterns stay tiled), A76 (the exile
  runaway), A77 (a clamped drop still swaps) and live S15 (multi-monitor
  tiling). A66's resize assertion no longer depends on the pair's current ratio,
  and is polled instead of sampled once.
- Performance work starts with measurement (stage 0 of `PERFORMANCE_PLAN.md`):
  `DumpState.counters` reports the per-call costs that matter — coherence sweeps
  and their timing, classify calls and cache misses, config builds, rules
  parses, plans computed/applied, Mutter frame reads from the sweep, host window
  lookups, `list_all_windows()` scans and log events. The agent harness gains
  `counters`, `counter`, `counter_delta` and `assert_num` helpers; scenario A66
  is the baseline every later stage measures against. No behaviour changes: the
  counters are only observed, never read to decide anything.
- Client text is bounded (core/text.ts): a window title is clipped at 256 chars
  and every history payload string at 512. A corrupted client title (a
  mojibake-doubling one reached 805 million characters) produced a 256 MB
  history line and exhausted GJS, which crashed the Shell with SIGSEGV in
  layout.js. `surface.title`/`appId` and the history writer clip at the edges;
  A63 guards it and 6 core tests cover the clipper.
- Floating a window over a pair never touches a *minimized* window's geometry:
  applying a frame to a minimized window makes Mutter un-minimize it, so a
  window the user minimized popped back on screen. It now keeps the float
  state and receives the float rect when it is restored (A62).
- Adrt's own float paths set Mutter's "always on top" flag (`applyLayer(FLOATING)`
  → `make_above()`), and the classifier then treated `above` as non-tileable, so
  a window we had floated over a pair stayed an orphan after the pair was gone.
  `above` no longer disqualifies a normal window, the flag is cleared whenever
  the window is tiled, and it is cleared on close with a sweep so a leftover
  auto-float returns to the tiling (A59/A61).
- Swap pairs are pruned on enable: they are keyed by window id, which does not
  survive a restart.
- A workspace-switch animation that never finishes leaves its clone group on
  screen, which is the doubled/frozen view seen in a screenshot. A watchdog now
  tears it down when it is still running after 1.5 s and no gesture owns it (a
  live swipe is left alone). `workspaceAnimating` is exposed in `DumpState`;
  A60 covers it.
- Our frame animations no longer run for a window that is maximized or
  minimized, and are cancelled when a window is minimized, so they cannot fight
  Mutter's own transitions.
- Maximizing a window with a sibling keeps its size and slides it onto its own
  workspace (it arrives maximized) instead of unmaximizing and re-maximizing it.
- Minimizing a window whose workspace empties slides it to the workspace on the
  left; if that one already holds a pair it comes back floating on top of it,
  otherwise it tiles with the window already there.
- The active-window marker follows the focused window's geometry, including
  during the animations Adrt runs (it used to keep the rect from focus time).
- The preferences window works again: `indicator-color` is a plain string and
  `entryRow` called `get_strv` on it, which returned null and aborted the whole
  window.
- Live scenario S14 walks the whole model on the real Shell.
- With a vertical workspace layout (e.g. the Vertical Workspaces extension) a
  pair splits 50/50 **top/bottom** instead of left/right; every other rule is
  unchanged. `workspaceLayoutRows` is exposed in `DumpState`.
- Moving a window to another workspace outside Adrt (the overview) now triggers
  a full recalculation of **every** workspace. Change detection compares
  against the index Adrt last recorded, because a per-frame `refresh()` copied
  the live workspace into the cache before the signal arrived and the move was
  silently ignored. If the move races a drag, the recalculation is retried once
  the drag ends. Switching workspaces recalculates every workspace too.
  Scenarios A54/A55 and live S13.
- A workspace that ends up holding more than a pair (e.g. a window was dragged
  here in the overview) never leaves an extra stacked: the newest extra floats
  centred over the pair, which also retiles the pair. Both the origin and the
  target workspace are retiled after such a move.
- Maximizing a window with a sibling moves it to its own workspace at its
  current size and maximizes it there, instead of animating the grow on the
  workspace it is about to leave.
- The live test suite no longer calls ResetLayoutState, which had been wiping
  the split ratios the user set by hand.
- A workspace reduced to a single tile plus an automatic float tiles both again
  (no floating leftover), ahead of the lone-maximize policy. A window the user
  floated themselves, and the 2-tiles-plus-1-float case, are left alone.
  Scenario A53.
- Adrt cancels a window's in-flight frame animation before moving it to another
  workspace, so Mutter's workspace-switch clone no longer doubles the window or
  lags behind it.
- Maximize keeps the immediate view follow: delaying it so the window lands
  first was tried and Mutter drops the maximise while the window sits on a
  workspace the view has not reached. The border is hidden during the move
  instead, so the window is not "selected" on the workspace it leaves.
- An emptied workspace is reaped promptly: the post-close prune runs again once
  the asynchronous workspace switch has landed, and a debounced reconcile only
  records undo for user adjusts.
- Only the workspaces Adrt itself creates (third-window, maximize-right and
  minimize policies) are reaped when empty, and never one that holds any window
  — tracked or not. Reaping a workspace out from under a window is what made
  one "disappear", and reaping a workspace the user or the session owns caused
  churn against GNOME's dynamic workspaces.
- Unmaximizing is robust against a stale workspace index (workspaces reaped
  since the maximize): it falls back to the nearest workspace that holds
  windows instead of doing nothing.
- Undo restores the split ratios along with the window rects, so the restored
  layout agrees with the plan and no later reconcile re-tiles over it. This was
  an existing inconsistency that the periodic tiling pass made visible.
- Safety-net passes (the scan tick, full reconciles on screens-changed/settings
  and the periodic retile) never record undo entries, and a debounced reconcile
  only does when it is a genuine user adjust. They also skip while an apply is
  animating, so they can never mask the entry a user action pushed.
- The nested harness closes the overview when its Shell comes up (a headless
  devkit Shell opens it during startup; a real session never does), and the
  live scenarios wait for a settled state instead of sampling once, so the
  slower real Shell no longer produces false failures. No test ever opens the
  overview.
- Live scenarios run on a window-free workspace and rotate the client across
  Files, Chrome and Calculator, so several real apps (Chrome in particular)
  exercise the tiler.
- The border's workspace-switch suppression is driven by GNOME's
  `WorkspaceAnimationController`: the swipe tracker's `begin`/`update` hide it
  the instant a touchpad gesture starts, and the motion watcher polls
  `_switchData` for keyboard animations. GNOME slides window *clones* during a
  switch, so the old position-based watcher never saw a gesture and left the
  active-window border stuck on screen for the whole swipe. Scenario A47.
- The tiling plan is re-run on a slow cadence — every ~10 samples of the
  focused-window watcher, about 500 ms — as a backstop for a layout that
  drifted without a usable signal. The countdown restarts after any tile has
  landed, so the periodic pass never stacks on top of a fresh apply. A
  `motionRetiles` counter is exposed in `DumpState`. Scenario A48.
- The close ghost only animates for windows that were actually tiled, and
  override-redirect surfaces (popups, context menus, tooltips) are no longer
  tracked at all, so closing a right-click menu no longer flashes a border.
- Keybinding defaults no longer collide with GNOME's own bindings: focus is
  `Super+Alt+{h,j,k,l}`, swap is `Super+Shift+{h,l}`, nudge split is
  `Super+Ctrl+{h,l}`. The previous `Super+Shift+Left/Right` was shadowed by
  GNOME's move-to-monitor action, so keyboard swap never fired.
- User geometry changes are recognised by the mouse button being held, so the
  tiler never mistakes its own applies (retiles, undo, follow) for user input.
- Plan validation is work-area-relative, so a monitor with a top panel no
  longer reports false out-of-bounds placements.
- Agent suite gains a scenario per fixed bug: A31 keyboard swap, A32 drag
  swap (landing zone), A33 global reconcile, A34 app opens maximized, A35
  minimize, A36 close ghost, A37 overview suspend, A38 indicator style, A39
  keybinding conflicts; 39 scenarios total.
- A window counts as tiled (and so gets a close ghost, and is subject to
  user-change detection) from the moment a plan is aimed at it, not only once
  verification succeeds.- The border hides during any workspace transition — keyboard or touchpad —
  by watching the focused actor's stage-space position (so a sliding workspace
  parent is detected), returning once it settles.
