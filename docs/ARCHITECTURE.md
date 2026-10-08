# Adrt — architecture

> **Status:** current for `perf-gnome`, 2026-10-08. This is the structural map
> and the invariants that keep it honest; behaviour is specified separately in
> `docs/V2_MODEL.md`. When a change here would alter user-visible behaviour,
> stop and route it through the model first.

## Layers

The dependency direction is one-way: `adapters → platform → core`. Nothing in
`core/` or `platform/` may import upward or reach for a compositor.

| Layer | Path | What lives here |
| --- | --- | --- |
| Pure model | `src/core/` | Decisions only: tiling/placement (`tiler.ts`, `placement.ts`), classification (`classify.ts`), workspace lifecycle (`workspaces.ts`), rules/globs (`rules.ts`), config (`config.ts`), gestures (`gestures.ts`), undo (`undo.ts`), D-Bus trigger table (`triggers.ts`), shared JSONL primitives (`jsonl.ts`, `ringbuffer.ts`). No `gi://`, no I/O, no clock, no randomness. |
| Ports | `src/platform/` | The interfaces a compositor adapter must implement: `host.ts`, `indicator.ts`, `settings.ts`, `dbus.ts`, `events.ts`. No GNOME types. |
| GNOME adapter | `src/adapters/gnome/` | The GNOME Shell implementation: composition root (`extension.ts`), tiling runtime (`session.ts`), screen/session state (`host.ts`, `shell-tracker.ts`), presentation (`indicator.ts`, `border.ts`), persistence and journals (`history.ts`, `journal.ts`, `recorder.ts`), lifecycle (`lifecycle.ts`). |
| Entry/packaging | `packages/gnome/` | `metadata.json`, gschema, stylesheet — the shipped extension shell. |
| Tests | `tests/core/`, `tests/agent/`, `tests/session/` | Vitest unit suite, nested-Shell scenarios, live-session scenarios. |
| Tooling | `scripts/` | Build/install/package and the CI guards (`check-core-purity.sh`, `check-test-coverage.py`, `scenario-manifest.py`). |

## Invariants

### Core is pure and deterministic
`src/core/` contains no compositor token and no I/O. This is enforced, not
aspired to: `scripts/check-core-purity.sh` fails when `gi://` or a `Meta.` /
`Shell.` / `St.` / `Clutter.` / `global.` / `Main.` member appears under
`src/core` or `src/platform` (`npm run check:core`). Determinism — no wall
clock, randomness or disk — is what makes the generated core matrix
(`docs/V2_TEST_MATRIX.md`) meaningful.

### No policy in signal handlers
Handlers registered anywhere in the adapter only translate an event and hand it
to the owning state machine. All decision logic runs in the lane-2 drain in
`src/adapters/gnome/session.ts` (or in `core/`), never inside a GObject
callback. `src/adapters/gnome/shell-tracker.ts` turns compositor signals into
plain events instead of acting on them.

### Every signal and timer is owned by a registry
No bare `connect()`/`GLib.timeout_add()` is allowed to escape. Both registries
live in `src/adapters/gnome/lifecycle.ts` (`SignalRegistry`,
`TimeoutRegistry`); `extension.disable()` drains them in one pass, so teardown
is idempotent and no source outlives the extension. A GLib source that is not
registered cannot be cancelled and is a bug.

### One owner per state
Each piece of state has exactly one writer. `host.ts` owns the screen list,
`shell-tracker.ts` owns session mode / overview / workspace actors and the
system settings it mirrors, `indicator.ts` owns its actors, and
`session.ts` owns the tiling model and the tracked windows. Caches name the
event that invalidates them, or they do not land.

### `DumpState` is add-only
`extension.dumpState()` is the observability contract used by the nested and
live harnesses. Fields and counters may be added; an existing name is never
repurposed or removed, because scenarios and `DumpState`-based assertions
depend on their meaning. The migration/version gate (`extension.ts`) is a
separate, differently-named field and must not be conflated with it.

### Trigger taxonomy
`src/core/triggers.ts` is the single table of test/D-Bus triggers and tags each
`'inject' | 'simulate' | 'api'`. `Inject*` means a real input reached the
extension; `Simulate*` means state was changed directly. `dbus.ts` generates
the introspection XML from the same table (`buildInterfaceXml`) so the wire
surface cannot drift from the dispatch map.

### Buffered, append-only JSONL I/O
The stores (`journal.ts`, `history.ts`, `recorder.ts`) never do synchronous
disk I/O per event. They keep an in-memory `RingBuffer` (`core/ringbuffer.ts`)
for `DumpEvents` and push serialized lines into a `JsonlBuffer`
(`core/jsonl.ts`) that is flushed once per idle interval through one
open/append/close. Rotation and retention belong to each store; the shared pure
pieces live in `core/jsonl.ts`.

### Self-applies are echo-cancelled
When Adrt maximises, unmaximises or switches a workspace itself, the resulting
Mutter signal must not be mistaken for a user action. `session.ts` pairs each
programmatic call with `withSelfUnmaximize()` (and workspace-switch suppression)
and cancels the echo by payload/timestamp (`SELF_APPLY_MS`), rather than by a
fixed sleep around the call.

## Where to change what

- A tiling/placement decision → `src/core/` and a test in `tests/core/`.
- A compositor interaction → `src/adapters/gnome/`, behind a `src/platform/` port.
- A new trigger → `src/core/triggers.ts` only; the XML and dispatch follow.
- A new observable → add a field in `dumpState()`; never rename one.
