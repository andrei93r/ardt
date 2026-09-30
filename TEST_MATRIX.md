# Adrt Test Matrix — business-decision combinations

Every branch the extension takes, the values it can see, and how the combinations
are covered. Coverage references the harnesses:

- `A*` → nested integration (`tests/agent/`, `npm run test:agent`)
- `S*` → live Shell (`tests/session/`, `bash scripts/session-test.sh`)
- `C*` → core unit (`tests/core/`, `npm run test:core`)
- `GAP` → not covered yet

---

## 1. Decision points

| # | Decision | Values | Code |
| - | -------- | ------ | ---- |
| D1 | Tileable window count on a workspace+monitor | 0, 1, 2, 3+ | `session.tileables`, `tiler.computePlans` |
| D2 | Classification failure reason (first wins, §5 order) | skip-taskbar, override-redirect, on-all-workspaces, fullscreen, above, exception-app, floating, non-tileable-kind, min-equals-max, transient, modal, attached-dialog, rule-float, heuristic-modal | `classify.ts` |
| D3 | Layer derivation | TILED, FLOATING, MODAL, BACKGROUND, INDICATOR | `classify.layerFor` |
| D4 | Screen orientation | portrait, landscape | `tiler.isPortrait` |
| D5 | Tiling area | full geometry, work area (panel/dock struts) | `tiler.screenArea`, `host.refreshScreens` |
| D6 | Monitor scale | 1, 1.25, 2 | `types.snapRect` |
| D7 | Min-size policy | respect, ignore, stack | `tiler.computePlans` |
| D8 | Size hints at registration | known, unknown (max=0), min==max, max < monitor | `surface.refreshSizeHints`, `tracked.sizeHintsKnown` |
| D9 | Split ratio source | saved pair ratio, primary-app ratio, 50/50, clamped by min (20–80 / 5–95) | `tiler.resolveRatio`, `clampRatioForMin` |
| D10 | Pair swap flag | set, unset | `tiling.swapPairs` |
| D11 | Rule override | none, `tile: full`, `left-half`, `right-half`; `float: true` | `tiler.findRuleOverride`, `rules.firstMatch` |
| D12 | Rule match fields | appId glob, title glob, kind list, transient | `rules.ruleMatches` |
| D13 | `reflow-keeps-edges` | true (fill), false (keep rect) | `tiler.computePlans` single |
| D14 | New window at registration | plain, fully maximized (app default), third+ tileable | `session.onReady` |
| D15 | User maximize | with sibling, alone | `session.onMaximizeSignal` |
| D16 | User unmaximize | has previous workspace; no previous / lone (re-maximize); no previous / with pair (float over the pair, centred with a margin so the pair stays visible) | `session.returnFromMaximize` |
| D17 | Minimize | only tileable on ws>0, otherwise | `session.onMinimized` |
| D18 | Close | workspace empties, pair remains | `session.unregister`, `switchAwayIfEmpty` |
| D19 | Workspace lifecycle | spawn (right of current), any-empty reap, reorder, user-move grace; "done" returns the view left | `moveToNewWorkspace`, `pruneEmptyDynamicWorkspaces`, `onWorkspacesReordered` |
| D20 | Session mode | user, unlock-dialog, screen-sharing | `core/session.ts` |
| D21 | Overview | closed, open | `onOverviewChanged` |
| D22 | User gesture on a tile | inner-edge resize, outer-edge resize, move within half, move onto sibling (swap), move to other monitor | `session.beginDrag/adjustMode/interpretDrop` |
| D23 | Suppression set (§23.1) | workspace-switch, drag, fullscreen, pause, sharing, overview — any subset × focus present/absent | `core/border.ts` |
| D24 | Focus | none, tileable, non-tileable/modal; next/prev by direction/cycle; no window in the requested direction falls back to the other side, else nothing | `onFocusChanged`, `focusDirection` |
| D25 | Float | toggle on, toggle off, persisted (opt-in), restored on launch | `toggleFloat`, `FloatStore` |
| D26 | Adaptation | disabled; refusal 1/2/3; trusted ≥2; stubborn 3-consecutive → cooldown; skipAnimation at 3 | `adapt.ts` |
| D27 | Gesture | enabled/disabled × kind (3-h/3-v/4-h/4-v/pinch-in/pinch-out) × (begin/update/end/cancel) × above/below threshold × overlap | `core/gestures.ts` |
| D28 | Gesture vs GNOME built-ins | matches (defer), differs (override) | `gesture-input.overridesBuiltin` |
| D29 | Keybinding | each action; name=accelerator override; accelerator collision | `extension.registerKeybindings` |
| D30 | Source of `on-all-workspaces` | genuinely pinned (`sticky`); implied by a non-primary monitor while `workspaces-only-on-primary` is set (not a skip) | `classify` (`on-all-workspaces`), `surface.sticky`, `host.flagContext` |
| D31 | Drag intent | resize (exactly one axis changes); move (both axes, a translation, or a no-op) | `core/adjust.ts` |
| D32 | Drag release | received (interpret the drop); never received (abandoned after 2.5 s quiet with no button held, drop not interpreted) | `session.dragIsStale`, `session.abandonDrag` |
| D33 | Window changed monitor | re-read the whole surface (flags depend on the monitor) | `TrackedWindow.refreshFrame` |
| D34 | Policy scope | per workspace **and** monitor: lone-maximize, "more than a pair", unfloat | `session.retile`, `session.evaluateLoneMaximize` |
| D35 | Workspace creation | allowed (empty workspace to the right, or within budget and cap); refused (cooldown, re-entrant, budget/cap spent → float over the pair) | `session.moveToNewWorkspace`, `core/budget.ts` |
| D36 | Drop interpretation | lands on the sibling → swap (whatever the reported mode); else move (nothing) or resize (save the ratio) | `session.interpretDrop`, `session.landsOn` |
| D30 | Indicator style | accent vs hex; width 1–20; opacity 0–100; radius 0–32; pulse on/off | `indicator.ts` |
| D31 | Close ghost | window was tiled, never tiled, override-redirect | `session.unregister` |
| D32 | Config bundle | v3, v2; merge, replace; malformed; unknown keys | `core/config.ts` |
| D33 | Undo | after move, after swap, across workspaces, closed window in entry, stack size 0 | `session.undo` |
| D34 | Monitor change | unplug (orphan tracked), replug (return), work-area change (dock autohide), scale change | `host`, `session` |
| D35 | Scan tick | idle (back-off 5/10/30/60s), active, paused, memory-bounds violation | `session.scanTick` |
| D36 | D-Bus surface | every §22 method + test triggers, valid and invalid input | `dbus.ts` |
| D37 | First run / migration | first enable, schema migration, dry-run-mode | `extension.firstRun/migrate` |

---

## 2. Full-factorial matrices (small sets)

### 2.1 Count × policy (D1 × D7) — expected layout

| Count | respect | ignore | stack |
| ----- | ------- | ------ | ----- |
| 0 | nothing | nothing | nothing |
| 1 | fill work area (or keep rect if `reflow-keeps-edges=false`) | same | same |
| 2 | split; if neither axis fits → stack fallback | split at ratio, ignoring mins | min-size stack, edges pinned |
| 3+ | (policy moves the third to its own workspace before tiling) | same | same |

Covered: 0 `C`, 1 `C/A02`, 2 respect `C/A01/A07/A32`, ignore `C`, stack `C`, 3+ `A02/S03`.

### 2.2 Orientation × screen/work area (D4 × D5 × D6)

| Orientation | Area | Scale | Expected |
| ----------- | ---- | ----- | -------- |
| landscape | full | 1 | side-by-side |
| portrait | full | 1 | stacked |
| landscape | work area (top bar) | 1 | y = workArea.y + gap |
| landscape | work area (right dock) | 1 | width = dock-left − gap |
| any | work area | 1.25 / 2 | rects snapped to the scale grid |

Covered: all `C`; landscape+work area `C/A*`; scale `C`. `GAP`: 1.25/2 exercised only at scale=2 in core.

### 2.3 Classification precedence (D2 × D3) — first reason wins

Order as implemented: skip-taskbar → override-redirect → on-all-workspaces → fullscreen → above → exception-app → floating → non-tileable-kind → min-equals-max → transient → modal → attached-dialog → rule-float → heuristic-modal → tileable.

Covered: every single reason `C`; combinations (e.g. transient **and** fullscreen) `GAP`.

### 2.4 Border suppression set (D23) — any subset

| Suppressions active | Focus | Border |
| ------------------- | ----- | ------ |
| ∅ | none | hidden |
| ∅ | present | **shown** at focus rect |
| any 1 | present | hidden |
| any ≥2 | present | hidden |
| ∅ → add reason → remove all | present | shown → hidden → shown |

Covered: ∅/any `C/A06`; overview `A37/S11`; workspace-switch `A12/S11`; drag `A32`; pause `A13`; sharing `A28`. `GAP`: explicit "two reasons then remove one" transitions beyond unit level (covered in `C/border`).

### 2.5 Session mode × indicator × tiling (D20)

| Mode | Paused | Indicator | Scan | Retile on resume |
| ---- | ------ | --------- | ---- | ---------------- |
| user | no | shown | on | n/a |
| unlock-dialog | yes | hidden | off | once → user |
| screen-sharing | no | hidden | on | no |

Covered: `C/session`, `A13`, `A27`, `A28`.

### 2.6 Gesture (D27) — full axis

| Kind | Above threshold | Below | Cancel | Overlapping |
| ---- | --------------- | ----- | ------ | ----------- |
| swipe-3-horizontal | switch-workspace l/r | none | none+reset | second ignored |
| swipe-3-vertical | toggle-overview | none | none+reset | ignored |
| swipe-4-horizontal / vertical | configured action | none | none | ignored |
| pinch-in / out | configured action | none | none | ignored |
| hold-3-swipe | none (unsupported) | none | none | ignored |
| disabled (any) | null/false | null | null | null |

Covered: `C/gestures` (all kinds, threshold, cancel, overlap, sensitivity), `A18/A19/A20/A21`.

---

## 3. Interaction matrix (pairwise)

Rows × columns = the combination to test; reference = coverage.

| | D1 count | D7 policy | D5 work area | D10 swap | D11 rule | D15 maximize | D20 session | D21 overview | D22 drag | D26 adapt |
| - | - | - | - | - | - | - | - | - | - | - |
| **D1 count** | — | C | A*/C | A08 | C | A03/A04 | A27 | A37 | — | A15 |
| **D7 policy** | C | — | C | — | C | — | — | — | — | — |
| **D5 area** | A*/C | C | — | — | — | S08 | — | — | — | — |
| **D10 swap** | A08 | — | — | — | A32 | — | — | — | A32 | — |
| **D11 rule** | C | C | — | — | — | — | — | — | — | — |
| **D14 register** | A02/A34 | — | — | — | — | A34 | — | — | — | — |
| **D16 unmaximize** | A05/A40/S13 | — | — | — | — | A05 | — | — | A40 | — |
| **D17 minimize** | A35/S09 | — | — | — | — | — | — | — | — | — |
| **D19 workspace** | A02/S03 | — | — | — | — | A04 | — | — | — | — |
| **D22 drag** | A07/S04 | — | — | A32 | — | — | — | — | — | — |
| **D25 float** | A11/S06 | — | — | — | — | — | — | — | — | — |
| **D34 monitor** | A14 | — | S01 | — | — | — | — | — | — | — |

---

## 4. Coverage gaps to add

| # | Gap | Proposed test |
| - | --- | ------------- |
| G1 | Classification **combinations** (two reasons at once) and precedence order | `C`: table of surfaces with 2+ flags, assert first reason |
| G2 | `reflow-keeps-edges = false` on the live/nested path | `A`: set false, break a pair, assert the survivor keeps its rect |
| G3 | Fractional scale 1.25/2 end-to-end | nested with `scale=2`; assert snapped rects |
| G4 | Portrait monitor end-to-end | nested `--virtual-monitor 800x1280`; assert stacked |
| G5 | Second monitor (left/right) and `workspaces-only-on-primary` | nested with two virtual monitors; move across |
| G6 | Monitor unplug/replug orphans (D34) | `InjectSignal('screens-changed')` + virtual monitor restart |
| G7 | Rule override `full`/`left-half`/`right-half` at integration level | `A`: write `rules-json`, retile, assert |
| G8 | `minSizePolicy = ignore` and `stack` at integration level | `A`: set policy, assert layout |
| G9 | Primary-app ratio and saved-ratio precedence together | `C` + `A`: primary ratio vs saved |
| G10 | Undo across workspaces and with a closed window in the entry | `A`: resize, switch ws, undo |
| G11 | Float persistence across an extension restart | `A`: toggle float, reload, assert restored |
| G12 | Adaptation thresholds (2 observations → trusted; 3 → skipAnimation; stubborn 3 → cooldown) | `C` unit for `adapt.ts` + `A15` |
| G13 | `respect-user-workspace-move` grace window | `A`: move, immediately retile, assert untouched |
| G14 | `workspace-auto-name` | `A`: enable, spawn ws, assert `workspace-names` |
| G15 | `keybindings` override (`name=accelerator`) | `A`: set override, inject, assert |
| G16 | Dry-run mode (no `move_resize_frame`) | `C`/`A`: enable, retile, assert rects unchanged |
| G17 | Config import **merge vs replace** on classes/floats and settings | `A16/A17` + `C/config` (mostly covered) |
| G18 | Session mode `screen-sharing` → `user` does **not** retile | `C/session` (covered) + `A28` |
| G19 | Gesture `hold-3-swipe` (unsupported kind) | `C` (covered) |
| G20 | Memory-bounds violation path (disable after 3) | `A30` partial; needs a forced-growth injection |
| G21 | Reorder while windows are tiled | `A`: reorder workspaces, assert indices retiled |
| G22 | `heuristic-modal-detect` on/off at integration level | `C` covered; add `A` |
| G23 | Close ghost for an override-redirect popup (no ghost) | `A36` covers dialog; add a popup |
| G24 | `max-frame-interval-ms` / frame-timing budget | `A29` partial |
| G25 | Unmaximize onto a **full pair**: float rect must be strictly smaller than the work area and must not fully cover every tiled window | covered by `A40` / `S13` |

---

## 5. Priorities

1. **G2, G7, G8, G9, G10, G13** — pure business decisions with no integration coverage today.
2. **G1, G12, G16, G18, G19** — core-only today; cheap to lift into the nested suite.
3. **G3, G4, G5, G6** — environment-dependent; need nested `--virtual-monitor` variations.
4. **G11, G14, G15, G17, G20, G21, G22, G23, G24** — nice-to-have hardening.
