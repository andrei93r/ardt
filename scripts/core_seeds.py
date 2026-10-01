"""Seed cases for the pure-core (business logic) test matrix.

Every seed is one logical case. `gen-core-cases.py` expands each seed across the axes
it declares (`vary`) and the screen sets it is valid for (`needs`), writing
tests/generated/core-cases.json and the catalogue in docs/V2_TEST_MATRIX.md.

Conventions
  * expectations are DECISION level — workspace, slot, maximized, floating, minimized —
    never pixels, so they stay true whatever the screen geometry or the pair axis is.
  * "viewed" means the workspace being looked at; "SPARE" is GNOME's trailing empty one.
  * rule cites the section of docs/V2_MODEL.md the outcome comes from.

vary flags: s = screen sets · a = pair axis (horizontal/vertical) · e = extras present
            (none / a float / a minimized window) · b = extras (none / both) ·
            o = order of the two windows (A first / B first)
needs: ws (some screen has workspaces) · nows (some screen has none) · 2s/3s (screens)
       · 2ws (two screens with workspaces) · 1s · portrait · landscape · any
"""

SEEDS = [
    # ---------------------------------------------------------------- routing (R)
    dict(id="R01", fam="routing", rule="\u00a73", needs="ws", vary="sa", setup="a workspace-capable screen; the viewed workspace is the empty trailing one", act="open A", exp="A is alone on the viewed workspace, so it maximizes; GNOME adds a new spare after it; no other workspace changes"),
    dict(id="R02", fam="routing", rule="\u00a73", needs="ws", vary="saeo", setup="the viewed workspace holds A, maximized alone", act="open B", exp="A takes slot 0 un-maximized, B slot 1: a pair on the viewed workspace; no new workspace; the view stays"),
    dict(id="R03", fam="routing", rule="\u00a73", needs="ws", vary="sao", setup="the viewed workspace holds a full pair A|B", act="open C", exp="a workspace is created immediately right of the viewed one, C is maximized there, the view follows; A|B untouched"),
    dict(id="R04", fam="routing", rule="\u00a73", needs="ws 2s", vary="sa", setup="the viewed workspace is full; another screen or workspace has a free slot", act="open C", exp="still a new workspace immediately right of the viewed one: routing never scans neighbours or screens"),
    dict(id="R05", fam="routing", rule="\u00a73", needs="ws", vary="s", setup="the viewed workspace holds A visible and B minimized", act="open C", exp="B holds no slot, so C splits with A (B stays hidden); C lands in slot 1"),
    dict(id="R06", fam="routing", rule="\u00a73", needs="ws", vary="s", setup="the viewed workspace holds A maximized and a float F", act="open C", exp="the float holds no slot: A takes slot 0, C slot 1; F is untouched"),
    dict(id="R07", fam="routing", rule="\u00a73", needs="ws", vary="s", setup="the viewed workspace's only window A is fullscreen", act="open C", exp="A's geometry is never touched, so C gets its own workspace to the right, maximized; the view follows"),
    dict(id="R08", fam="routing", rule="\u00a73", needs="ws", vary="s", setup="a workspace you are NOT viewing is full", act="a restored app opens C on it", exp="C is routed there: a workspace created immediately right of THAT one, C maximized; the view does not move"),
    dict(id="R09", fam="routing", rule="\u00a73", needs="ws", vary="s", setup="a workspace you are NOT viewing holds one window", act="a restored app opens C on it", exp="C tiles there beside it; the view does not move"),
    dict(id="R10", fam="routing", rule="\u00a716", needs="ws", vary="s", setup="the viewed workspace holds A maximized alone", act="open C, a client wider than the whole work area", exp="C cannot fit a slot: its own workspace to the right, its width clamped to the screen; A maximizes alone"),
    dict(id="R11", fam="routing", rule="\u00a716", needs="ws", vary="s", setup="the viewed workspace holds A maximized alone (A accepts 900 px at least)", act="open C, which accepts no less than 1700 px on a 2560 screen", exp="A refuses 1280 and C cannot adapt to 860: C takes its own workspace to the right, A maximizes alone; the view stays with the arriving C"),
    dict(id="R12", fam="routing", rule="\u00a716", needs="ws", vary="s", setup="the viewed workspace holds A maximized", act="open an app that maps itself maximized (Files)", exp="an app's own maximize is not a user maximize: it is un-maximized and tiled beside A"),
    dict(id="R13", fam="routing", rule="\u00a716", needs="ws", vary="s", setup="the viewed workspace holds a pair A|B", act="open D, a dialog of A", exp="D floats, centred on its parent A and raised; the pair is untouched"),
    dict(id="R14", fam="routing", rule="\u00a73", needs="ws", vary="s", setup="the viewed workspace is empty", act="open A and B together", exp="A lands first and maximizes; B arrives into slot 1: a pair"),
    dict(id="R15", fam="routing", rule="\u00a77", needs="nows", vary="sa", setup="a screen with no workspaces, its one layout empty", act="open A", exp="A is alone, so it maximizes; nothing is created"),
    dict(id="R16", fam="routing", rule="\u00a77", needs="nows", vary="sa", setup="a screen with no workspaces holding one visible window", act="open B", exp="they split: the existing window keeps its side, B takes the other"),
    dict(id="R17", fam="routing", rule="\u00a77", needs="nows", vary="s", setup="a screen with no workspaces holding a full pair", act="open C", exp="C floats on that screen: nothing is created, nobody is displaced"),
    dict(id="R18", fam="routing", rule="\u00a77", needs="nows", vary="s", setup="a fixed-workspace screen; the viewed workspace is full, a later one has a free slot", act="open C", exp="C goes to the nearest workspace with room, right first, on the side it came from; the view follows"),
    dict(id="R19", fam="routing", rule="\u00a77", needs="nows", vary="s", setup="a fixed-workspace screen with every workspace full", act="open C", exp="C floats; nothing is created"),
    dict(id="R20", fam="routing", rule="\u00a75", needs="ws", vary="s", setup="the user reordered the workspaces so an empty one sits in the middle", act="open C on the viewed (full) workspace", exp="a workspace is created immediately right of the viewed one; the reorder is not corrected"),
    dict(id="R21", fam="routing", rule="\u00a716", needs="ws", vary="s", setup="the viewed workspace holds a pair", act="open a sticky window (pinned to every workspace)", exp="it is never managed: no slot, nothing moved, the workspace list untouched"),
    dict(id="R22", fam="routing", rule="\u00a716", needs="ws", vary="s", setup="the viewed workspace holds a pair", act="open a skip-taskbar window (a drop-down terminal)", exp="it is never managed: no slot, the pair untouched"),

    # ------------------------------------------------- maximize / unmaximize (M)
    dict(id="M01", fam="maximize", rule="\u00a74", needs="ws", vary="saeo", setup="the viewed workspace holds a pair A|B", act="maximize B", exp="B moves to a workspace created immediately right, maximized; A is alone and fills the screen; the view follows"),
    dict(id="M02", fam="maximize", rule="\u00a74", needs="ws", vary="sao", setup="B was just maximized onto its own workspace; A is alone on the previous one", act="unmaximize B", exp="B joins the left workspace into slot 1: A|B; the workspace B left is reaped; the view returns"),
    dict(id="M03", fam="maximize", rule="\u00a74", needs="ws", vary="s", setup="the viewed workspace holds a pair; a workspace to the right is full", act="maximize the slot-0 window", exp="the same: its own workspace created to the right, the leftover fills the screen"),
    dict(id="M04", fam="maximize", rule="\u00a74", needs="nows", vary="sa", setup="a screen with no workspaces holding a pair", act="maximize A", exp="A maximizes in place; B is minimized on that screen only; nothing is created"),
    dict(id="M05", fam="maximize", rule="\u00a74", needs="nows", vary="s", setup="A was maximized in place on a screen with no workspaces and B was minimized by it", act="unmaximize A", exp="B returns and keeps slot 0; A arrives into slot 1: B|A"),
    dict(id="M06", fam="maximize", rule="\u00a717", needs="ws", vary="s", setup="a window alone on its workspace, already maximized", act="maximize it again", exp="nothing changes and a toast says so"),
    dict(id="M07", fam="maximize", rule="\u00a716", needs="ws", vary="sa", setup="the viewed workspace holds a pair A|B", act="make B fullscreen", exp="B gets a workspace immediately right, fullscreen, its geometry untouched; A fills the screen; the view follows"),
    dict(id="M08", fam="maximize", rule="\u00a716", needs="ws", vary="s", setup="B is fullscreen on its own workspace", act="leave fullscreen", exp="B rejoins the left workspace into slot 1: A|B; the workspace is reaped; the view returns"),
    dict(id="M09", fam="maximize", rule="\u00a77", needs="nows", vary="s", setup="a screen with no workspaces holding a pair", act="make B fullscreen", exp="B fills the screen where it is; A is minimized and returns when B exits (then landing in slot 1)"),
    dict(id="M10", fam="maximize", rule="\u00a76", needs="ws", vary="s", setup="the viewed workspace holds a pair and a float F", act="maximize F", exp="F maximizes in place, still floating; the pair is untouched"),
    dict(id="M11", fam="maximize", rule="\u00a76", needs="nows", vary="s", setup="a screen with no workspaces holds a float F", act="make F fullscreen", exp="F fills where it is and stays floating"),
    dict(id="M12", fam="maximize", rule="\u00a74", needs="ws", vary="a", setup="X is maximized alone on its workspace; the left workspace holds exactly one window", act="unmaximize X", exp="X joins the left workspace into slot 1: a pair"),
    dict(id="M13", fam="maximize", rule="\u00a74", needs="ws", vary="s", setup="X is maximized alone; the left workspace holds only a minimized window", act="unmaximize X", exp="X joins there and, being alone among visible windows, maximizes; the minimized one stays hidden"),
    dict(id="M14", fam="maximize", rule="\u00a74", needs="ws", vary="s", setup="X is maximized alone; the left workspace is a full pair, the right is empty", act="unmaximize X", exp="an empty target would leave X alone and maximized again, so X is minimized and moved into the left workspace"),
    dict(id="M15", fam="maximize", rule="\u00a74", needs="ws", vary="s", setup="X is maximized alone; both neighbours are full pairs", act="unmaximize X", exp="X is minimized and moved into the left workspace; its own workspace is reaped"),
    dict(id="M16", fam="maximize", rule="\u00a74", needs="ws", vary="s", setup="X is maximized alone on the FIRST workspace; the right is a full pair", act="unmaximize X", exp="there is no left neighbour, so X is minimized into the right one; the workspace is reaped"),
    dict(id="M17", fam="maximize", rule="\u00a77", needs="nows", vary="s", setup="a fixed-workspace screen with a free slot somewhere", act="maximize A", exp="A moves into an existing workspace with a free slot, maximized; if none is free it maximizes in place; nothing is created"),
    dict(id="M18", fam="maximize", rule="\u00a717", needs="nows", vary="s", setup="a window that is already fullscreen", act="make it fullscreen again", exp="nothing changes and a toast says so"),
    dict(id="M19", fam="maximize", rule="\u00a74", needs="nows", vary="s", setup="A is fullscreen on a screen with no workspaces and B was minimized by it", act="minimize A", exp="B returns, is alone among visible windows and maximizes"),
    dict(id="M20", fam="maximize", rule="\u00a74", needs="ws", vary="s", setup="B is fullscreen on its own workspace; the left workspace is a full pair", act="leave fullscreen", exp="B is minimized and moved into the left workspace"),

    # ---------------------------------------------------- minimize / restore (N)
    dict(id="N01", fam="minimize", rule="\u00a74", needs="ws", vary="saeo", setup="the viewed workspace holds a pair A|B", act="minimize B", exp="B releases its slot; A fills the screen; the view does not move"),
    dict(id="N02", fam="minimize", rule="\u00a74", needs="ws", vary="sao", setup="A is alone and maximized on the viewed workspace; B is minimized on it", act="restore B", exp="B arrives into the free slot; the pair is formed with B in slot 1"),
    dict(id="N03", fam="minimize", rule="\u00a74", needs="ws 2s", vary="s", setup="the viewed workspace holds A alone; a neighbour holds windows", act="minimize A", exp="A is minimized into the neighbour that holds windows (left first); the workspace is reaped; the view moves there"),
    dict(id="N04", fam="minimize", rule="\u00a74", needs="ws", vary="s", setup="the viewed workspace holds A alone; no neighbour holds any window", act="minimize A", exp="A stays where it is, minimized; the workspace persists looking empty"),
    dict(id="N05", fam="minimize", rule="\u00a76", needs="ws", vary="s", setup="a workspace holds a full pair A|C", act="restore a window B that was minimized earlier", exp="no slot is free, so B floats, offset from the pair; nobody is displaced"),
    dict(id="N06", fam="minimize", rule="\u00a75", needs="ws", vary="saeo", setup="the viewed workspace holds a pair A|B", act="close B", exp="A is alone, so it maximizes; no new workspace"),
    dict(id="N07", fam="minimize", rule="\u00a75", needs="ws 2s", vary="s", setup="the viewed workspace holds A alone; a neighbour holds windows", act="close A", exp="the workspace is empty, so it is reaped and the view moves to the nearest workspace that holds windows"),
    dict(id="N08", fam="minimize", rule="\u00a74", needs="ws 2s", vary="s", setup="the viewed workspace holds A visible and B minimized; a neighbour holds windows", act="close A", exp="B is now the only window there and it is minimized: it is moved into the neighbour, the viewed workspace is reaped and the view follows"),
    dict(id="N09", fam="minimize", rule="\u00a74", needs="nows", vary="s", setup="a screen with no workspaces, A maximized in place, B minimized by it", act="minimize A", exp="B returns and maximizes; A stays minimized on that screen"),
    dict(id="N10", fam="minimize", rule="\u00a74", needs="nows", vary="s", setup="a screen with no workspaces, A visible alone, B minimized", act="restore B", exp="A takes slot 0 and B slot 1: the pair splits; nothing is created"),
    dict(id="N11", fam="minimize", rule="\u00a76", needs="ws", vary="s", setup="the viewed workspace holds a pair and a float F", act="minimize F", exp="F hides; no slot is touched; the pair stays"),
    dict(id="N12", fam="minimize", rule="\u00a75", needs="ws", vary="s", setup="a workspace holds only a float F", act="close F", exp="the workspace is empty and is reaped (unless it is the spare)"),
    dict(id="N13", fam="minimize", rule="\u00a74", needs="ws", vary="s", setup="a workspace holds A and B as a pair", act="minimize A then B", exp="after the last one the workspace holds only minimized windows: the occupant is moved into a neighbour that holds windows (left first) or stays; the workspace is reaped when emptied"),
    dict(id="N14", fam="minimize", rule="\u00a74", needs="ws 2s", vary="s", setup="the view is on screen 1; screen 2 shows a full pair", act="close one of the pair on screen 2", exp="nothing on screen 1 changes; the survivor on screen 2 maximizes; the view stays"),

    # ------------------------------------------------- slots, arrival, order (S)
    dict(id="S01", fam="slots", rule="\u00a73", needs="ws", vary="s", setup="the newcomer arrives on an empty workspace", act="open A", exp="it is alone, so it maximizes (slot 0 by definition)"),
    dict(id="S02", fam="slots", rule="\u00a73", needs="ws", vary="saeo", setup="the workspace holds one window, alone and maximized", act="open B", exp="the existing one keeps slot 0, B takes slot 1"),
    dict(id="S03", fam="slots", rule="\u00a73", needs="ws", vary="s", setup="the workspace holds one window that is already in slot 1 (slot 0 was closed)", act="open B", exp="the free slot 0 is taken by B; the resident keeps its side"),
    dict(id="S04", fam="slots", rule="\u00a73", needs="ws", vary="s", setup="a window is moved in from the workspace on its left", act="drop it on the target workspace", exp="it takes slot 0"),
    dict(id="S05", fam="slots", rule="\u00a73", needs="ws", vary="s", setup="a window is moved in from the workspace on its right", act="drop it on the target workspace", exp="it takes slot 1"),
    dict(id="S06", fam="slots", rule="\u00a73", needs="ws", vary="s", setup="a window is moved in from the screen above", act="drop it on the target screen", exp="it takes slot 0 (the top)"),
    dict(id="S07", fam="slots", rule="\u00a73", needs="ws", vary="s", setup="a window is moved in from the screen below", act="drop it on the target screen", exp="it takes slot 1 (the bottom)"),
    dict(id="S08", fam="slots", rule="\u00a73", needs="ws", vary="s", setup="the target workspace holds exactly one window", act="move a window in from the left", exp="the free slot is the one it came from: the newcomer takes slot 0 and the resident moves to slot 1"),
    dict(id="S09", fam="slots", rule="\u00a74", needs="ws", vary="s", setup="an empty workspace (the spare)", act="move a window into it with the shortcut", exp="it is alone there, so it maximizes; GNOME adds a new spare"),
    dict(id="S10", fam="slots", rule="\u00a76", needs="ws", vary="s", setup="the target workspace is full", act="move a window into it with the shortcut", exp="it floats there, on the side it came from; the pair keeps both slots; the view follows"),
    dict(id="S11", fam="slots", rule="\u00a73", needs="ws", vary="s", setup="the target workspace holds only a minimized window (it looks empty)", act="move a window into it", exp="the newcomer is alone among visible windows, so it maximizes; the minimized one stays"),

    # ------------------------------------------------------ no-workspace screens (O)
    dict(id="O01", fam="single", rule="\u00a77", needs="nows", vary="sa", setup="a screen with no workspaces, all windows visible: one window A", act="open B", exp="A keeps its side, B takes the other; nothing is created"),
    dict(id="O02", fam="single", rule="\u00a77", needs="nows", vary="sa", setup="it holds a full pair A|B", act="open C", exp="C floats: no workspace can be created, nobody is displaced"),
    dict(id="O03", fam="single", rule="\u00a77", needs="nows", vary="s", setup="it holds a pair, A|B", act="minimize B, then open C", exp="B holds no slot, so C splits with A; B stays minimized"),
    dict(id="O04", fam="single", rule="\u00a77", needs="nows 2s", vary="s", setup="its pair A|B is on screen; the other screen has workspaces", act="switch the other screen's workspace", exp="nothing here moves, is resized or re-tiled; nothing is said"),
    dict(id="O05", fam="single", rule="\u00a77", needs="nows", vary="s", setup="it holds a pair A|B", act="maximize A (then unmaximize)", exp="A fills the screen in place with B minimized; on unmaximize B returns to slot 0 and A lands in slot 1"),
    dict(id="O06", fam="single", rule="\u00a76", needs="nows", vary="s", setup="it holds a pair and a float", act="drag a window onto it from the other screen", exp="the float holds no slot, so the dragged window takes the free slot on the side it came from"),
    dict(id="O07", fam="single", rule="\u00a76", needs="nows", vary="s", setup="it holds a full pair", act="drag a window onto it from the other screen", exp="it floats where it was dropped"),
    dict(id="O08", fam="single", rule="\u00a77", needs="nows", vary="s", setup="it holds one window", act="a window already on it is dragged and dropped on empty space", exp="nothing moves between workspaces: it is alone, so it maximizes again"),

    # ------------------------------------------------------- fixed-workspace (F)
    dict(id="F01", fam="fixed", rule="\u00a77", needs="nows", vary="s", setup="a static-workspace screen (four workspaces); the viewed one is full, the next has a free slot", act="open C", exp="the nearest workspace with room takes it, right first, on the side it came from; the view follows; nothing is created"),
    dict(id="F02", fam="fixed", rule="\u00a77", needs="nows", vary="s", setup="the workspaces to the right are all full, one to the left has room", act="open C", exp="C is routed left after checking right first"),
    dict(id="F03", fam="fixed", rule="\u00a77", needs="nows", vary="s", setup="every workspace is full", act="open C", exp="C floats; nothing is created"),
    dict(id="F04", fam="fixed", rule="\u00a77", needs="nows", vary="s", setup="a screen with no workspaces and a free slot", act="maximize A", exp="A moves into the existing workspace with a free slot; if none is free it maximizes in place"),
    dict(id="F05", fam="fixed", rule="\u00a77", needs="nows", vary="s", setup="a static-workspace screen", act="empty a workspace completely", exp="nothing is created and nothing is removed: the workspace stays"),

    # ------------------------------------------------------------- floats (L)
    dict(id="L01", fam="floats", rule="\u00a76", needs="ws", vary="sa", setup="the viewed workspace holds a pair A|B", act="press the float key on B", exp="B stays exactly in its half, floating; A is alone among tiled windows and fills the screen"),
    dict(id="L02", fam="floats", rule="\u00a76", needs="ws", vary="s", setup="the viewed workspace holds A and a float F", act="press the float key on F", exp="F takes the free slot; being alone among visible windows it maximizes"),
    dict(id="L03", fam="floats", rule="\u00a76", needs="ws", vary="s", setup="the viewed workspace holds a full pair and a float F", act="press the float key on F", exp="F stays floating and a toast says it cannot un-float"),
    dict(id="L04", fam="floats", rule="\u00a76", needs="ws", vary="s", setup="a float F is placed by adrt (an overflow case)", act="inspect F", exp="F is offset from the window beneath it, fully inside the work area: clickable and visible"),
    dict(id="L05", fam="floats", rule="\u00a76", needs="ws", vary="s", setup="the viewed workspace holds a pair and a float F", act="resize F by its edge", exp="nothing pulls it back: floats are unmanaged"),
    dict(id="L06", fam="floats", rule="\u00a710", needs="ws", vary="sa", setup="the viewed workspace holds a pair A|B", act="drag the OUTER edge of A", exp="it snaps back: a tile always fills its region, and a float is only ever explicit"),
    dict(id="L07", fam="floats", rule="\u00a76", needs="ws", vary="s", setup="a float F holds the focus, on a screen beside another one", act="press the move key toward the other screen", exp="F moves there and stays floating, on the side it came from"),
    dict(id="L08", fam="floats", rule="\u00a76", needs="ws", vary="s", setup="a float F holds the focus", act="press move-to-next-workspace", exp="F moves to the next workspace, still floating"),
    dict(id="L09", fam="floats", rule="\u00a717", needs="ws", vary="s", setup="the viewed workspace holds a pair and two floats F1, F2", act="press the focus cycle key repeatedly", exp="it walks the managed windows in slot order, then the floats left to right, wrapping; minimized windows are skipped"),
    dict(id="L10", fam="floats", rule="\u00a76", needs="ws", vary="s", setup="a workspace holds a pair A|B and a float F", act="close A and B", exp="the workspace is not empty: the float pins it, and the view stays"),

    # ------------------------------------------------------- drags and drops (G)
    dict(id="G01", fam="drags", rule="\u00a76", needs="ws", vary="saeo", setup="the viewed workspace holds a pair A|B", act="drag A a little over B and drop", exp="they swap: B takes slot 0 and A slot 1; same sizes, same workspace"),
    dict(id="G02", fam="drags", rule="\u00a76", needs="2s", vary="s", setup="a screen with a free slot on its viewed workspace", act="drag a window onto it from the left screen", exp="it takes the free slot on the side it came from; its old workspace is reaped if emptied"),
    dict(id="G03", fam="drags", rule="\u00a76", needs="2s", vary="s", setup="the target screen's viewed workspace holds one window P (so a slot is free)", act="drag a window from the other screen and drop it ON P", exp="the free slot wins: the window takes it and P stays (moving to the other side if needed); no swap"),
    dict(id="G04", fam="drags", rule="\u00a76", needs="2s", vary="s", setup="the target screen's viewed workspace holds a full pair P|Q", act="drag a window from the other screen and drop it on Q", exp="no slot is free, so they swap: the dropped window takes Q's place and Q goes to where the dragged one came from"),
    dict(id="G05", fam="drags", rule="\u00a76", needs="2s", vary="s", setup="the target screen's viewed workspace holds a full pair", act="drag a window onto empty space (crossing nothing)", exp="it floats there, where it was dropped"),
    dict(id="G06", fam="drags", rule="\u00a76", needs="2s", vary="s", setup="a maximized window on screen 1", act="shake it loose and drag it to screen 2", exp="it is un-maximized at the drop, then the target's rules apply"),
    dict(id="G07", fam="drags", rule="\u00a76", needs="ws", vary="s", setup="another workspace holds a maximized single C", act="in the overview, drag B from the viewed workspace onto C", exp="C un-maximizes into slot 0 and B takes slot 1: a pair; B's old workspace keeps its survivor maximized"),
    dict(id="G08", fam="drags", rule="\u00a76", needs="ws", vary="s", setup="another workspace holds a full pair", act="in the overview, drag B onto it", exp="B floats on that workspace; its old workspace keeps its survivor maximized and the view does not move"),
    dict(id="G09", fam="drags", rule="\u00a76", needs="ws", vary="s", setup="the trailing empty workspace", act="in the overview, drag B onto it", exp="B is alone there, so it maximizes; GNOME adds a new spare; the view stays where the drag started"),
    dict(id="G10", fam="drags", rule="\u00a710", needs="ws", vary="a", setup="the viewed workspace holds a pair A|B", act="drag the inner edge to a different ratio", exp="the sibling is resized to match: the pair stays flush; the ratio is remembered for the workspace"),
    dict(id="G11", fam="drags", rule="\u00a710", needs="ws", vary="a", setup="the viewed workspace holds a pair; the client in slot 1 refuses to go below 900 px", act="drag the inner edge far to the other side", exp="the refusing window keeps 900 px and the sibling takes the rest; nothing is created or floated"),
    dict(id="G12", fam="drags", rule="\u00a76", needs="ws", vary="s", setup="the viewed workspace holds a pair and a float F", act="drop a window over the float", exp="the float does not count as a crossing; the managed window beneath it does, and if there is none the drop takes a free slot"),

    # ------------------------------------------------------- focus and moves (H)
    dict(id="H01", fam="focus", rule="\u00a76", needs="ws", vary="a", setup="the viewed workspace holds a pair A|B, focus on A", act="press the direction key along the pair's axis", exp="focus moves within the pair; the view does not change"),
    dict(id="H02", fam="focus", rule="\u00a76", needs="2s", vary="s", setup="a pair stacked on the left screen, a pair stacked on the right one; focus on the bottom-left window", act="focus right", exp="focus lands on the window at the same height on the right screen, not on the first one there"),
    dict(id="H03", fam="focus", rule="\u00a717", needs="ws", vary="s", setup="one window only, on one screen", act="press a direction with nothing that way", exp="nothing happens and nothing is said"),
    dict(id="H04", fam="focus", rule="\u00a717", needs="ws", vary="s", setup="the focused window is on a screen with no workspaces", act="press move-to-next-workspace", exp="nothing happens and a toast says the screen has only one workspace"),
    dict(id="H05", fam="focus", rule="\u00a76", needs="2s", vary="s", setup="the target screen's workspace holds one visible window", act="move the focused window toward it", exp="it takes the free slot on the side it came from"),
    dict(id="H06", fam="focus", rule="\u00a76", needs="2s", vary="s", setup="the target screen's workspace holds a full pair", act="move the focused window toward it", exp="the plane is joined, so they swap with the window nearest in that direction"),
    dict(id="H07", fam="focus", rule="\u00a76", needs="ws", vary="s", setup="focus is on a workspace; other workspaces hold windows", act="press a direction key", exp="focus never changes workspace"),

    # -------------------------------------------------------------- displays (D)
    dict(id="D01", fam="displays", rule="\u00a79", needs="ws 2s", vary="s", setup="two screens; one holds A maximized alone", act="unplug that screen", exp="A is rescued to the primary screen: tiled there by the usual rules; the view does not move"),
    dict(id="D02", fam="displays", rule="\u00a79", needs="ws 2s", vary="s", setup="two screens; one holds a full pair", act="unplug it", exp="the pair is rescued to a workspace inserted immediately on the physical side the screen was on (right → right); nothing is flattened"),
    dict(id="D03", fam="displays", rule="\u00a79", needs="ws 2s", vary="s", setup="two screens; one holds three windows across two workspaces (a pair and a single)", act="unplug it", exp="exactly two fresh workspaces are created (as many as needed), keeping the arrangement; the view does not move"),
    dict(id="D04", fam="displays", rule="\u00a79", needs="ws 2s", vary="s", setup="the screen being unplugged sat to the LEFT", act="unplug it", exp="the rescued workspaces are placed to the left of the current one (leftmost if screens existed to the left)"),
    dict(id="D05", fam="displays", rule="\u00a79", needs="ws 2s", vary="s", setup="a remembered connector is reconnected; its windows still exist", act="plug it back in", exp="they return to their remembered slots, order and pairing; nothing is flattened and nothing floats"),
    dict(id="D06", fam="displays", rule="\u00a79", needs="ws 2s", vary="s", setup="a screen is away; a window was opened on the remaining screen meanwhile", act="reconnect the remembered screen", exp="the new window stays where it is: it has no memory of that connector"),
    dict(id="D07", fam="displays", rule="\u00a79", needs="2s", vary="s", setup="two screens, one with workspaces holding windows on several of them; a screen with none", act="change which screen is the primary (GNOME)", exp="no window moves; the work areas change and the tiled windows re-fit by ratio; the extra window from the old primary's other workspace becomes a float"),
    dict(id="D08", fam="displays", rule="\u00a710", needs="ws", vary="s", setup="a screen with a top bar (the primary) and a screen without", act="tile a pair on each", exp="each pair fits its own work area: the bar's strip is excluded on the primary only"),
    dict(id="D09", fam="displays", rule="\u00a710", needs="ws", vary="s", setup="a pair on a screen whose dock is set to autohide", act="turn the dock's autohide off (it becomes fixed)", exp="the work area shrinks and both windows re-fit by ratio; turning it back on gives the surface back"),
    dict(id="D10", fam="displays", rule="\u00a710", needs="ws", vary="s", setup="a pair, with a gap configured between windows", act="change the gap", exp="the pair re-fits by ratio to the new surface"),
    dict(id="D11", fam="displays", rule="\u00a79", needs="ws 2s", vary="s", setup="a fullscreen window on the screen that is unplugged", act="unplug that screen", exp="the rescue keeps it fullscreen on the primary, and display memory remembers it"),
    dict(id="D12", fam="displays", rule="\u00a79", needs="ws", vary="s", setup="a screen goes away and its windows are rescued, then it is reconnected", act="wait for the reap", exp="the workspaces the rescue created and then emptied are reaped; the spare is never removed"),

    # --------------------------------------------------- workspaces and reaping (W)
    dict(id="W01", fam="workspaces", rule="\u00a75", needs="ws", vary="s", setup="a workspace is emptied by a move", act="reach the next drain", exp="it is reaped wherever it sits (the property, not the event)"),
    dict(id="W02", fam="workspaces", rule="\u00a75", needs="ws", vary="s", setup="a window is closed on a workspace that a float also inhabits", act="reach the next drain", exp="the workspace is not empty and is not reaped; the float pins it"),
    dict(id="W03", fam="workspaces", rule="\u00a78", needs="ws", vary="s", setup="the user reorders workspaces, dragging a loaded one past another", act="reach the next drain", exp="the order is honoured exactly: no correction, no tagging, no toast"),
    dict(id="W04", fam="workspaces", rule="\u00a78", needs="ws", vary="s", setup="the user drags the empty trailing workspace somewhere else", act="reach the next drain", exp="reaping is a property, so the empty workspace is pruned wherever it sits; no lasting effect"),
    dict(id="W05", fam="workspaces", rule="\u00a75", needs="ws", vary="s", setup="an empty workspace sits between two loaded ones", act="reach the next drain", exp="it is reaped; the view does not move unless it was on it"),
    dict(id="W06", fam="workspaces", rule="\u00a75", needs="ws", vary="s", setup="the only loaded workspace becomes empty and the spare follows it", act="close its last window", exp="it is simply left empty: there is nothing to move the view to, and the spare is always free"),

    # ------------------------------------------------- undo, toasts, session (U)
    dict(id="U01", fam="session", rule="\u00a713", needs="ws", vary="s", setup="B was just maximized onto its own workspace", act="press undo", exp="B rejoins its pair in slot 1, the created workspace disappears and the view returns"),
    dict(id="U02", fam="session", rule="\u00a713", needs="ws", vary="s", setup="B was just unmaximized and its workspace was reaped", act="press undo", exp="the workspace is recreated, B is maximized on it again and the view follows"),
    dict(id="U03", fam="session", rule="\u00a713", needs="ws", vary="s", setup="two windows were just swapped by a drag", act="press undo", exp="both instances and their slots go back"),
    dict(id="U04", fam="session", rule="\u00a713", needs="ws", vary="s", setup="a float was just un-floated into a free slot", act="press undo", exp="it floats again where it was"),
    dict(id="U05", fam="session", rule="\u00a713", needs="ws", vary="s", setup="the window involved has since been closed", act="press undo", exp="nothing is applied, partially or otherwise, and a toast says the change cannot be reverted"),
    dict(id="U06", fam="session", rule="\u00a717", needs="ws", vary="s", setup="a request that cannot do anything: move-to-workspace on a one-workspace screen", act="press it", exp="nothing changes and a toast says why; the same for an empty undo, an un-float with no room and a nudge with nothing to nudge"),
    dict(id="U07", fam="session", rule="\u00a719", needs="ws", vary="s", setup="the session is locked while the queue still holds work", act="unlock", exp="the queue finishes what it held; new work was gated while locked; the layout retiles once on resume"),
    dict(id="U08", fam="session", rule="\u00a719", needs="ws", vary="s", setup="the screen is being shared", act="look at the tiling", exp="tiling continues, the focus highlight is hidden"),
    dict(id="U09", fam="session", rule="\u00a720", needs="ws", vary="s", setup="the extension is disabled with tiled windows, minimized windows and floats on screen", act="disable it", exp="everything is left exactly as it is; only the border disappears; re-enabling normalises again"),
    dict(id="U10", fam="session", rule="\u00a720", needs="ws", vary="s", setup="the extension is enabled on a busy desktop (workspaces with scattered windows)", act="finish the first drain", exp="per workspace, one dominating window (70% or more) is maximized and the rest minimized; otherwise the two largest become the pair; floats and fullscreen windows are untouched"),
]
