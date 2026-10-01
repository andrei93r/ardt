# The pure-core test matrix

**Generated** by `scripts/gen-core-cases.py` from `scripts/core_seeds.py`. Do not edit by
hand: change the seeds and re-run.

The business logic lives in `core/` and is tested there — pure, fast and deterministic,
no Shell and no compositor. The harness scenarios only prove that the adapter feeds the
core the right inputs and applies its decisions. This matrix is the source those core
tests are written from: **137 logical seeds expand to 5259 concrete cases**
(`tests/generated/core-cases.json`, regenerated on demand and not committed).

## What varies

| axis | values |
| --- | --- |
| screens | one screen (dynamic / one-workspace / static-four) · two (primary left, primary right, portrait second, one above) · three (primary middle, others left and right) · four (left, right, portrait, above) · two dynamic |
| work area | 2560×1440 with a 32 px top bar on the primary · 1920×1080 · 1440×2560 portrait · 1080×1920 portrait · 1024-ish small (see `SCREEN_SETS`) |
| pair axis | horizontal (side by side) · vertical (stacked, as a vertical workspace layout or a portrait screen gives) |
| extras | none · a float present · a minimized window present · both |
| order | A then B · B then A |
| geometry | standard · small (half size, 24 px bar) · large (1.5×, 40 px bar) — every case runs on all three |
| workspace position | the workspace the case happens on is first · middle · last of three loaded (for the placement-independent seeds) |
| positions | slot 0 / slot 1 / maximized single / look-empty (only minimized) / empty trailing spare / float over the pair |
| roles | workspace-capable screen · screen with one workspace · static-workspace screen · the primary |

## The invariants every case asserts

- I1 no eviction: nothing moves to another workspace because another window needs its place
- I2 packing: every workspace holds a maximized single or a full pair, plus floats and minimized parks
- I3 occupancy: a slot is held only while its window is visible; minimizing releases it
- I4 spare: exactly one empty trailing workspace exists and is never removed
- I5 view: the view moves only for the app the action is about, and only on the viewed workspace; a reactor never moves it
- I6 focus: focus never switches workspace on its own
- I7 toast: a request that changes nothing toasts with its reason; a direction with nothing stays silent
- I8 idempotence: repeating the state-producing action in the same state changes nothing
- I9 inverse: where the model promises an inverse (maximize/unmaximize, minimize/restore, float/un-float, swap twice) the decision state returns
- I10 determinism: the same state and event sequence gives the same decisions — no learned geometry, no timing dependence

## Geometry is asserted separately

Decision-level expectations (workspace, slot, maximized, floating, minimized) are
axis- and resolution-independent by construction. A small extra family asserts exact
rectangles from the work area: the pair split at the ratio, the gaps (0 outside,
`gaps-base` between), the bar's strip on the primary only, a clamped own-workspace
window, and the re-fit by ratio when the surface changes.

## The catalogue


### routing — 22 seeds, 1290 cases

| id | rule | setup | action | expected | varies | cases |
| --- | --- | --- | --- | --- | --- | --- |
| `R01` | §3 | a workspace-capable screen; the viewed workspace is the empty trailing one | open A | A is alone on the viewed workspace, so it maximizes; GNOME adds a new spare after it; no other workspace changes | screens axis | 45 |
| `R02` | §3 | the viewed workspace holds A, maximized alone | open B | A takes slot 0 un-maximized, B slot 1: a pair on the viewed workspace; no new workspace; the view stays | screens axis extras | 405 |
| `R03` | §3 | the viewed workspace holds a full pair A|B | open C | a workspace is created immediately right of the viewed one, C is maximized there, the view follows; A|B untouched | screens axis | 135 |
| `R04` | §3 | the viewed workspace is full; another screen or workspace has a free slot | open C | still a new workspace immediately right of the viewed one: routing never scans neighbours or screens | screens axis | 36 |
| `R05` | §3 | the viewed workspace holds A visible and B minimized | open C | B holds no slot, so C splits with A (B stays hidden); C lands in slot 1 | screens | 81 |
| `R06` | §3 | the viewed workspace holds A maximized and a float F | open C | the float holds no slot: A takes slot 0, C slot 1; F is untouched | screens | 81 |
| `R07` | §3 | the viewed workspace's only window A is fullscreen | open C | A's geometry is never touched, so C gets its own workspace to the right, maximized; the view follows | screens | 27 |
| `R08` | §3 | a workspace you are NOT viewing is full | a restored app opens C on it | C is routed there: a workspace created immediately right of THAT one, C maximized; the view does not move | screens | 27 |
| `R09` | §3 | a workspace you are NOT viewing holds one window | a restored app opens C on it | C tiles there beside it; the view does not move | screens | 27 |
| `R10` | §16 | the viewed workspace holds A maximized alone | open C, a client wider than the whole work area | C cannot fit a slot: its own workspace to the right, its width clamped to the screen; A maximizes alone | screens | 27 |
| `R11` | §16 | the viewed workspace holds A maximized alone (A accepts 900 px at least) | open C, which accepts no less than 1700 px on a 2560 screen | A refuses 1280 and C cannot adapt to 860: C takes its own workspace to the right, A maximizes alone; the view stays with the arriving C | screens | 27 |
| `R12` | §16 | the viewed workspace holds A maximized | open an app that maps itself maximized (Files) | an app's own maximize is not a user maximize: it is un-maximized and tiled beside A | screens | 27 |
| `R13` | §16 | the viewed workspace holds a pair A|B | open D, a dialog of A | D floats, centred on its parent A and raised; the pair is untouched | screens | 27 |
| `R14` | §3 | the viewed workspace is empty | open A and B together | A lands first and maximizes; B arrives into slot 1: a pair | screens | 81 |
| `R15` | §7 | a screen with no workspaces, its one layout empty | open A | A is alone, so it maximizes; nothing is created | screens axis | 42 |
| `R16` | §7 | a screen with no workspaces holding one visible window | open B | they split: the existing window keeps its side, B takes the other | screens axis | 42 |
| `R17` | §7 | a screen with no workspaces holding a full pair | open C | C floats on that screen: nothing is created, nobody is displaced | screens | 24 |
| `R18` | §7 | a fixed-workspace screen; the viewed workspace is full, a later one has a free slot | open C | C goes to the nearest workspace with room, right first, on the side it came from; the view follows | screens | 24 |
| `R19` | §7 | a fixed-workspace screen with every workspace full | open C | C floats; nothing is created | screens | 24 |
| `R20` | §5 | the user reordered the workspaces so an empty one sits in the middle | open C on the viewed (full) workspace | a workspace is created immediately right of the viewed one; the reorder is not corrected | screens | 27 |
| `R21` | §16 | the viewed workspace holds a pair | open a sticky window (pinned to every workspace) | it is never managed: no slot, nothing moved, the workspace list untouched | screens | 27 |
| `R22` | §16 | the viewed workspace holds a pair | open a skip-taskbar window (a drop-down terminal) | it is never managed: no slot, the pair untouched | screens | 27 |

### maximize — 20 seeds, 750 cases

| id | rule | setup | action | expected | varies | cases |
| --- | --- | --- | --- | --- | --- | --- |
| `M01` | §4 | the viewed workspace holds a pair A|B | maximize B | B moves to a workspace created immediately right, maximized; A is alone and fills the screen; the view follows | screens axis | 135 |
| `M02` | §4 | B was just maximized onto its own workspace; A is alone on the previous one | unmaximize B | B joins the left workspace into slot 1: A|B; the workspace B left is reaped; the view returns | screens axis | 135 |
| `M03` | §4 | the viewed workspace holds a pair; a workspace to the right is full | maximize the slot-0 window | the same: its own workspace created to the right, the leftover fills the screen | screens | 27 |
| `M04` | §4 | a screen with no workspaces holding a pair | maximize A | A maximizes in place; B is minimized on that screen only; nothing is created | screens axis | 42 |
| `M05` | §4 | A was maximized in place on a screen with no workspaces and B was minimized by it | unmaximize A | B returns and keeps slot 0; A arrives into slot 1: B|A | screens | 24 |
| `M06` | §17 | a window alone on its workspace, already maximized | maximize it again | nothing changes and a toast says so | screens | 27 |
| `M07` | §16 | the viewed workspace holds a pair A|B | make B fullscreen | B gets a workspace immediately right, fullscreen, its geometry untouched; A fills the screen; the view follows | screens axis | 45 |
| `M08` | §16 | B is fullscreen on its own workspace | leave fullscreen | B rejoins the left workspace into slot 1: A|B; the workspace is reaped; the view returns | screens | 27 |
| `M09` | §7 | a screen with no workspaces holding a pair | make B fullscreen | B fills the screen where it is; A is minimized and returns when B exits (then landing in slot 1) | screens | 24 |
| `M10` | §6 | the viewed workspace holds a pair and a float F | maximize F | F maximizes in place, still floating; the pair is untouched | screens | 27 |
| `M11` | §6 | a screen with no workspaces holds a float F | make F fullscreen | F fills where it is and stays floating | screens | 24 |
| `M12` | §4 | X is maximized alone on its workspace; the left workspace holds exactly one window | unmaximize X | X joins the left workspace into slot 1: a pair | axis | 6 |
| `M13` | §4 | X is maximized alone; the left workspace holds only a minimized window | unmaximize X | X joins there and, being alone among visible windows, maximizes; the minimized one stays hidden | screens | 27 |
| `M14` | §4 | X is maximized alone; the left workspace is a full pair, the right is empty | unmaximize X | an empty target would leave X alone and maximized again, so X is minimized and moved into the left workspace | screens | 27 |
| `M15` | §4 | X is maximized alone; both neighbours are full pairs | unmaximize X | X is minimized and moved into the left workspace; its own workspace is reaped | screens | 27 |
| `M16` | §4 | X is maximized alone on the FIRST workspace; the right is a full pair | unmaximize X | there is no left neighbour, so X is minimized into the right one; the workspace is reaped | screens | 27 |
| `M17` | §7 | a fixed-workspace screen with a free slot somewhere | maximize A | A moves into an existing workspace with a free slot, maximized; if none is free it maximizes in place; nothing is created | screens | 24 |
| `M18` | §17 | a window that is already fullscreen | make it fullscreen again | nothing changes and a toast says so | screens | 24 |
| `M19` | §4 | A is fullscreen on a screen with no workspaces and B was minimized by it | minimize A | B returns, is alone among visible windows and maximizes | screens | 24 |
| `M20` | §4 | B is fullscreen on its own workspace; the left workspace is a full pair | leave fullscreen | B is minimized and moved into the left workspace | screens | 27 |

### minimize — 14 seeds, 714 cases

| id | rule | setup | action | expected | varies | cases |
| --- | --- | --- | --- | --- | --- | --- |
| `N01` | §4 | the viewed workspace holds a pair A|B | minimize B | B releases its slot; A fills the screen; the view does not move | screens axis | 135 |
| `N02` | §4 | A is alone and maximized on the viewed workspace; B is minimized on it | restore B | B arrives into the free slot; the pair is formed with B in slot 1 | screens axis | 135 |
| `N03` | §4 | the viewed workspace holds A alone; a neighbour holds windows | minimize A | A is minimized into the neighbour that holds windows (left first); the workspace is reaped; the view moves there | screens | 63 |
| `N04` | §4 | the viewed workspace holds A alone; no neighbour holds any window | minimize A | A stays where it is, minimized; the workspace persists looking empty | screens | 27 |
| `N05` | §6 | a workspace holds a full pair A|C | restore a window B that was minimized earlier | no slot is free, so B floats, offset from the pair; nobody is displaced | screens | 27 |
| `N06` | §5 | the viewed workspace holds a pair A|B | close B | A is alone, so it maximizes; no new workspace | screens axis | 135 |
| `N07` | §5 | the viewed workspace holds A alone; a neighbour holds windows | close A | the workspace is empty, so it is reaped and the view moves to the nearest workspace that holds windows | screens | 21 |
| `N08` | §4 | the viewed workspace holds A visible and B minimized; a neighbour holds windows | close A | B is now the only window there and it is minimized: it is moved into the neighbour, the viewed workspace is reaped and the view follows | screens | 21 |
| `N09` | §4 | a screen with no workspaces, A maximized in place, B minimized by it | minimize A | B returns and maximizes; A stays minimized on that screen | screens | 24 |
| `N10` | §4 | a screen with no workspaces, A visible alone, B minimized | restore B | A takes slot 0 and B slot 1: the pair splits; nothing is created | screens | 24 |
| `N11` | §6 | the viewed workspace holds a pair and a float F | minimize F | F hides; no slot is touched; the pair stays | screens | 27 |
| `N12` | §5 | a workspace holds only a float F | close F | the workspace is empty and is reaped (unless it is the spare) | screens | 27 |
| `N13` | §4 | a workspace holds A and B as a pair | minimize A then B | after the last one the workspace holds only minimized windows: the occupant is moved into a neighbour that holds windows (left first) or stays; the workspace is reaped when emptied | screens | 27 |
| `N14` | §4 | the view is on screen 1; screen 2 shows a full pair | close one of the pair on screen 2 | nothing on screen 1 changes; the survivor on screen 2 maximizes; the view stays | screens | 21 |

### slots — 11 seeds, 621 cases

| id | rule | setup | action | expected | varies | cases |
| --- | --- | --- | --- | --- | --- | --- |
| `S01` | §3 | the newcomer arrives on an empty workspace | open A | it is alone, so it maximizes (slot 0 by definition) | screens | 81 |
| `S02` | §3 | the workspace holds one window, alone and maximized | open B | the existing one keeps slot 0, B takes slot 1 | screens axis | 135 |
| `S03` | §3 | the workspace holds one window that is already in slot 1 (slot 0 was closed) | open B | the free slot 0 is taken by B; the resident keeps its side | screens | 27 |
| `S04` | §3 | a window is moved in from the workspace on its left | drop it on the target workspace | it takes slot 0 | screens | 27 |
| `S05` | §3 | a window is moved in from the workspace on its right | drop it on the target workspace | it takes slot 1 | screens | 27 |
| `S06` | §3 | a window is moved in from the screen above | drop it on the target screen | it takes slot 0 (the top) | screens | 27 |
| `S07` | §3 | a window is moved in from the screen below | drop it on the target screen | it takes slot 1 (the bottom) | screens | 27 |
| `S08` | §3 | the target workspace holds exactly one window | move a window in from the left | the free slot is the one it came from: the newcomer takes slot 0 and the resident moves to slot 1 | screens | 27 |
| `S09` | §4 | an empty workspace (the spare) | move a window into it with the shortcut | it is alone there, so it maximizes; GNOME adds a new spare | screens | 81 |
| `S10` | §6 | the target workspace is full | move a window into it with the shortcut | it floats there, on the side it came from; the pair keeps both slots; the view follows | screens | 81 |
| `S11` | §3 | the target workspace holds only a minimized window (it looks empty) | move a window into it | the newcomer is alone among visible windows, so it maximizes; the minimized one stays | screens | 81 |

### single — 8 seeds, 222 cases

| id | rule | setup | action | expected | varies | cases |
| --- | --- | --- | --- | --- | --- | --- |
| `O01` | §7 | a screen with no workspaces, all windows visible: one window A | open B | A keeps its side, B takes the other; nothing is created | screens axis | 42 |
| `O02` | §7 | it holds a full pair A|B | open C | C floats: no workspace can be created, nobody is displaced | screens axis | 42 |
| `O03` | §7 | it holds a pair, A|B | minimize B, then open C | B holds no slot, so C splits with A; B stays minimized | screens | 24 |
| `O04` | §7 | its pair A|B is on screen; the other screen has workspaces | switch the other screen's workspace | nothing here moves, is resized or re-tiled; nothing is said | screens | 18 |
| `O05` | §7 | it holds a pair A|B | maximize A (then unmaximize) | A fills the screen in place with B minimized; on unmaximize B returns to slot 0 and A lands in slot 1 | screens | 24 |
| `O06` | §6 | it holds a pair and a float | drag a window onto it from the other screen | the float holds no slot, so the dragged window takes the free slot on the side it came from | screens | 24 |
| `O07` | §6 | it holds a full pair | drag a window onto it from the other screen | it floats where it was dropped | screens | 24 |
| `O08` | §7 | it holds one window | a window already on it is dragged and dropped on empty space | nothing moves between workspaces: it is alone, so it maximizes again | screens | 24 |

### fixed — 5 seeds, 120 cases

| id | rule | setup | action | expected | varies | cases |
| --- | --- | --- | --- | --- | --- | --- |
| `F01` | §7 | a static-workspace screen (four workspaces); the viewed one is full, the next has a free slot | open C | the nearest workspace with room takes it, right first, on the side it came from; the view follows; nothing is created | screens | 24 |
| `F02` | §7 | the workspaces to the right are all full, one to the left has room | open C | C is routed left after checking right first | screens | 24 |
| `F03` | §7 | every workspace is full | open C | C floats; nothing is created | screens | 24 |
| `F04` | §7 | a screen with no workspaces and a free slot | maximize A | A moves into the existing workspace with a free slot; if none is free it maximizes in place | screens | 24 |
| `F05` | §7 | a static-workspace screen | empty a workspace completely | nothing is created and nothing is removed: the workspace stays | screens | 24 |

### floats — 10 seeds, 306 cases

| id | rule | setup | action | expected | varies | cases |
| --- | --- | --- | --- | --- | --- | --- |
| `L01` | §6 | the viewed workspace holds a pair A|B | press the float key on B | B stays exactly in its half, floating; A is alone among tiled windows and fills the screen | screens axis | 45 |
| `L02` | §6 | the viewed workspace holds A and a float F | press the float key on F | F takes the free slot; being alone among visible windows it maximizes | screens | 27 |
| `L03` | §6 | the viewed workspace holds a full pair and a float F | press the float key on F | F stays floating and a toast says it cannot un-float | screens | 27 |
| `L04` | §6 | a float F is placed by adrt (an overflow case) | inspect F | F is offset from the window beneath it, fully inside the work area: clickable and visible | screens | 27 |
| `L05` | §6 | the viewed workspace holds a pair and a float F | resize F by its edge | nothing pulls it back: floats are unmanaged | screens | 27 |
| `L06` | §10 | the viewed workspace holds a pair A|B | drag the OUTER edge of A | it snaps back: a tile always fills its region, and a float is only ever explicit | screens axis | 45 |
| `L07` | §6 | a float F holds the focus, on a screen beside another one | press the move key toward the other screen | F moves there and stays floating, on the side it came from | screens | 27 |
| `L08` | §6 | a float F holds the focus | press move-to-next-workspace | F moves to the next workspace, still floating | screens | 27 |
| `L09` | §17 | the viewed workspace holds a pair and two floats F1, F2 | press the focus cycle key repeatedly | it walks the managed windows in slot order, then the floats left to right, wrapping; minimized windows are skipped | screens | 27 |
| `L10` | §6 | a workspace holds a pair A|B and a float F | close A and B | the workspace is not empty: the float pins it, and the view stays | screens | 27 |

### drags — 12 seeds, 270 cases

| id | rule | setup | action | expected | varies | cases |
| --- | --- | --- | --- | --- | --- | --- |
| `G01` | §6 | the viewed workspace holds a pair A|B | drag A a little over B and drop | they swap: B takes slot 0 and A slot 1; same sizes, same workspace | screens axis | 45 |
| `G02` | §6 | a screen with a free slot on its viewed workspace | drag a window onto it from the left screen | it takes the free slot on the side it came from; its old workspace is reaped if emptied | screens | 21 |
| `G03` | §6 | the target screen's viewed workspace holds one window P (so a slot is free) | drag a window from the other screen and drop it ON P | the free slot wins: the window takes it and P stays (moving to the other side if needed); no swap | screens | 21 |
| `G04` | §6 | the target screen's viewed workspace holds a full pair P|Q | drag a window from the other screen and drop it on Q | no slot is free, so they swap: the dropped window takes Q's place and Q goes to where the dragged one came from | screens | 21 |
| `G05` | §6 | the target screen's viewed workspace holds a full pair | drag a window onto empty space (crossing nothing) | it floats there, where it was dropped | screens | 21 |
| `G06` | §6 | a maximized window on screen 1 | shake it loose and drag it to screen 2 | it is un-maximized at the drop, then the target's rules apply | screens | 21 |
| `G07` | §6 | another workspace holds a maximized single C | in the overview, drag B from the viewed workspace onto C | C un-maximizes into slot 0 and B takes slot 1: a pair; B's old workspace keeps its survivor maximized | screens | 27 |
| `G08` | §6 | another workspace holds a full pair | in the overview, drag B onto it | B floats on that workspace; its old workspace keeps its survivor maximized and the view does not move | screens | 27 |
| `G09` | §6 | the trailing empty workspace | in the overview, drag B onto it | B is alone there, so it maximizes; GNOME adds a new spare; the view stays where the drag started | screens | 27 |
| `G10` | §10 | the viewed workspace holds a pair A|B | drag the inner edge to a different ratio | the sibling is resized to match: the pair stays flush; the ratio is remembered for the workspace | axis | 6 |
| `G11` | §10 | the viewed workspace holds a pair; the client in slot 1 refuses to go below 900 px | drag the inner edge far to the other side | the refusing window keeps 900 px and the sibling takes the rest; nothing is created or floated | axis | 6 |
| `G12` | §6 | the viewed workspace holds a pair and a float F | drop a window over the float | the float does not count as a crossing; the managed window beneath it does, and if there is none the drop takes a free slot | screens | 27 |

### focus — 7 seeds, 150 cases

| id | rule | setup | action | expected | varies | cases |
| --- | --- | --- | --- | --- | --- | --- |
| `H01` | §6 | the viewed workspace holds a pair A|B, focus on A | press the direction key along the pair's axis | focus moves within the pair; the view does not change | axis | 6 |
| `H02` | §6 | a pair stacked on the left screen, a pair stacked on the right one; focus on the bottom-left window | focus right | focus lands on the window at the same height on the right screen, not on the first one there | screens | 21 |
| `H03` | §17 | one window only, on one screen | press a direction with nothing that way | nothing happens and nothing is said | screens | 27 |
| `H04` | §17 | the focused window is on a screen with no workspaces | press move-to-next-workspace | nothing happens and a toast says the screen has only one workspace | screens | 27 |
| `H05` | §6 | the target screen's workspace holds one visible window | move the focused window toward it | it takes the free slot on the side it came from | screens | 21 |
| `H06` | §6 | the target screen's workspace holds a full pair | move the focused window toward it | the plane is joined, so they swap with the window nearest in that direction | screens | 21 |
| `H07` | §6 | focus is on a workspace; other workspaces hold windows | press a direction key | focus never changes workspace | screens | 27 |

### displays — 12 seeds, 276 cases

| id | rule | setup | action | expected | varies | cases |
| --- | --- | --- | --- | --- | --- | --- |
| `D01` | §9 | two screens; one holds A maximized alone | unplug that screen | A is rescued to the primary screen: tiled there by the usual rules; the view does not move | screens | 21 |
| `D02` | §9 | two screens; one holds a full pair | unplug it | the pair is rescued to a workspace inserted immediately on the physical side the screen was on (right → right); nothing is flattened | screens | 21 |
| `D03` | §9 | two screens; one holds three windows across two workspaces (a pair and a single) | unplug it | exactly two fresh workspaces are created (as many as needed), keeping the arrangement; the view does not move | screens | 21 |
| `D04` | §9 | the screen being unplugged sat to the LEFT | unplug it | the rescued workspaces are placed to the left of the current one (leftmost if screens existed to the left) | screens | 21 |
| `D05` | §9 | a remembered connector is reconnected; its windows still exist | plug it back in | they return to their remembered slots, order and pairing; nothing is flattened and nothing floats | screens | 21 |
| `D06` | §9 | a screen is away; a window was opened on the remaining screen meanwhile | reconnect the remembered screen | the new window stays where it is: it has no memory of that connector | screens | 21 |
| `D07` | §9 | two screens, one with workspaces holding windows on several of them; a screen with none | change which screen is the primary (GNOME) | no window moves; the work areas change and the tiled windows re-fit by ratio; the extra window from the old primary's other workspace becomes a float | screens | 21 |
| `D08` | §10 | a screen with a top bar (the primary) and a screen without | tile a pair on each | each pair fits its own work area: the bar's strip is excluded on the primary only | screens | 27 |
| `D09` | §10 | a pair on a screen whose dock is set to autohide | turn the dock's autohide off (it becomes fixed) | the work area shrinks and both windows re-fit by ratio; turning it back on gives the surface back | screens | 27 |
| `D10` | §10 | a pair, with a gap configured between windows | change the gap | the pair re-fits by ratio to the new surface | screens | 27 |
| `D11` | §9 | a fullscreen window on the screen that is unplugged | unplug that screen | the rescue keeps it fullscreen on the primary, and display memory remembers it | screens | 21 |
| `D12` | §9 | a screen goes away and its windows are rescued, then it is reconnected | wait for the reap | the workspaces the rescue created and then emptied are reaped; the spare is never removed | screens | 27 |

### workspaces — 6 seeds, 270 cases

| id | rule | setup | action | expected | varies | cases |
| --- | --- | --- | --- | --- | --- | --- |
| `W01` | §5 | a workspace is emptied by a move | reach the next drain | it is reaped wherever it sits (the property, not the event) | screens | 81 |
| `W02` | §5 | a window is closed on a workspace that a float also inhabits | reach the next drain | the workspace is not empty and is not reaped; the float pins it | screens | 27 |
| `W03` | §8 | the user reorders workspaces, dragging a loaded one past another | reach the next drain | the order is honoured exactly: no correction, no tagging, no toast | screens | 27 |
| `W04` | §8 | the user drags the empty trailing workspace somewhere else | reach the next drain | reaping is a property, so the empty workspace is pruned wherever it sits; no lasting effect | screens | 27 |
| `W05` | §5 | an empty workspace sits between two loaded ones | reach the next drain | it is reaped; the view does not move unless it was on it | screens | 81 |
| `W06` | §5 | the only loaded workspace becomes empty and the spare follows it | close its last window | it is simply left empty: there is nothing to move the view to, and the spare is always free | screens | 27 |

### session — 10 seeds, 270 cases

| id | rule | setup | action | expected | varies | cases |
| --- | --- | --- | --- | --- | --- | --- |
| `U01` | §13 | B was just maximized onto its own workspace | press undo | B rejoins its pair in slot 1, the created workspace disappears and the view returns | screens | 27 |
| `U02` | §13 | B was just unmaximized and its workspace was reaped | press undo | the workspace is recreated, B is maximized on it again and the view follows | screens | 27 |
| `U03` | §13 | two windows were just swapped by a drag | press undo | both instances and their slots go back | screens | 27 |
| `U04` | §13 | a float was just un-floated into a free slot | press undo | it floats again where it was | screens | 27 |
| `U05` | §13 | the window involved has since been closed | press undo | nothing is applied, partially or otherwise, and a toast says the change cannot be reverted | screens | 27 |
| `U06` | §17 | a request that cannot do anything: move-to-workspace on a one-workspace screen | press it | nothing changes and a toast says why; the same for an empty undo, an un-float with no room and a nudge with nothing to nudge | screens | 27 |
| `U07` | §19 | the session is locked while the queue still holds work | unlock | the queue finishes what it held; new work was gated while locked; the layout retiles once on resume | screens | 27 |
| `U08` | §19 | the screen is being shared | look at the tiling | tiling continues, the focus highlight is hidden | screens | 27 |
| `U09` | §20 | the extension is disabled with tiled windows, minimized windows and floats on screen | disable it | everything is left exactly as it is; only the border disappears; re-enabling normalises again | screens | 27 |
| `U10` | §20 | the extension is enabled on a busy desktop (workspaces with scattered windows) | finish the first drain | per workspace, one dominating window (70% or more) is maximized and the rest minimized; otherwise the two largest become the pair; floats and fullscreen windows are untouched | screens | 27 |

## Using it

Every seed cites the model section its outcome comes from. When a stage of
`docs/V2_PLAN.md` starts, its tests are written from the matching family here — seeds
first, then their expansions — so the variations are exhaustive before the
implementation exists.
