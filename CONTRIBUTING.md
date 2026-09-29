# Contributing

## Architecture rules

These are not negotiable; see `spec.md` §2 and §34.

- `src/core/` is pure TypeScript. It must not contain the strings `gi://`,
  `Meta.`, `Shell.`, `St.`, `Clutter.`, `global.` or `Main.`, and must not
  import from `src/platform/` or `src/adapters/`.
- `src/platform/` holds interfaces and pure types only.
- `src/adapters/gnome/` is the only place that touches the compositor.
- No KDE code ships. `platform/` exists so a KWin adapter can be added later.

Run `npm run check:core` to enforce the boundary.

## Workflow

```bash
npm install
npm run lint          # must exit 0
npm run build         # tsc must exit 0
npm run test:core     # must be green
npm run test:agent    # nested Shell scenarios
```

## Style

- Prefer inference over annotations; keep types accurate.
- Named exports, except where a framework requires a default export
  (`extension.ts`, `prefs.ts`, `vitest.config.ts`).
- Async IO at boundaries; no new `*Sync` calls.
- No comments that restate code. No TODOs.
- Every source file starts with the AI-generated notice (§4.3).

## Tests

Every behavioural change needs a `tests/core/` unit test when it lives in
`core/`, and an agent scenario when it is observable from the Shell. Never
mark an unexecuted test as passing; document missing dependencies instead.
