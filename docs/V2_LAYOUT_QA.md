# Layout Q&A — 100 questions answered from the model

**Derived, not authoritative.** Every answer below comes from `docs/V2_MODEL.md`; where
the two ever disagree, the model wins. Questions marked ⚠ are ones the model does not
actually settle — my call is given, and they are collected at the end for a decision.

## Opening a window (routing) — 1–15

1. A workspace has one maximized window A; B opens.
   → A takes slot 0, B slot 1: a pair.
2. A workspace has a pair A|B; C opens.
   → A workspace immediately right, C maximized there; the view follows.
3. Same, but the workspace to the right has a free slot.
   → Still a new workspace right of the current one — routing never scans neighbours.
4. Two screens have workspaces; the viewed one is full, the other has room; C opens.
   → C gets a new workspace on the viewed screen; routing is per screen.
5. A window opens on the other screen's workspace.
   → It is routed there; the view does not move.
6. A window opens while you are viewing the empty trailing workspace.
   → It lands there alone, maximizes, and GNOME adds a new empty one after it.
7. A window opens on a workspace you are not viewing, and it is full.
   → A workspace immediately right of *that* one, the window maximized there; the view
   does not move.
8. A new window is wider than the whole work area.
   → It does not fit: its own workspace to the right, width clamped to the screen.
9. An app opens already maximized (Files).
   → Not a user maximize: it is unmaximized and tiled; alone, it maximizes.
10. Two windows open at the same moment on an empty workspace.
    → The first maximizes; the second arrives into slot 1: a pair.
11. A window opens where the visible window is A and the other is minimized.
    → The minimized one holds no slot, so the newcomer splits with A; it stays hidden.
12. A window opens on a screen with no workspaces whose layout already has a pair.
    → It floats.
13. A window opens on a fixed-workspace screen whose viewed workspace is full.
    → The nearest workspace with a free slot (right first); the view follows.
14. Same screen, every workspace full.
    → It floats.
15. A window opens where the only window is a float.
    → The float holds no slot, so the newcomer is alone among managed windows and
    maximizes under the float.

## Maximize, unmaximize, fullscreen — 16–33

16. Maximize half of a pair on a workspace-capable screen.
    → Its own workspace to the right, maximized; the leftover fills the screen; the view
    follows.
17. Unmaximize it again.
    → It rejoins into slot 1; the pair is back; the emptied workspace is reaped; the view
    returns.
18. Maximize the other half.
    → Same, mirrored.
19. Maximize on a single-workspace screen with two windows.
    → In place; the other window minimized.
20. Unmaximize it there.
    → The minimized one returns and keeps the left; the unmaximized one arrives into
    slot 1: `B | A`.
21. Maximize a window that is alone and already maximized.
    → Nothing changes; toast "already maximized".
22. Fullscreen half of a pair on a workspace-capable screen.
    → Its own workspace to the right, fullscreen; the leftover fills the screen; the view
    follows.
23. Leave fullscreen.
    → It rejoins as slot 1 into `A | B`; the workspace it left is reaped; the view returns.
24. Fullscreen on a single-workspace screen with two windows.
    → In place; the other minimized; both return when it exits.
25. Maximize a float.
    → It maximizes in place, still floating; nothing is un-floated.
26. Fullscreen a float. ⚠
    → Same as maximize: it fills where it is and stays floating.
27. Unmaximize when the left neighbour holds exactly one window.
    → It joins the left, slot 1: a pair.
28. Unmaximize when the left is full and the right is empty.
    → Minimized and moved into the left — an empty target would leave it alone and
    therefore maximized again.
29. Unmaximize when both neighbours are full.
    → Minimized and moved into the left.
30. Unmaximize when the left holds only a minimized window. ⚠
    → That is exactly one window: it joins there and, being alone among visible windows,
    maximizes.
31. Unmaximize with no left neighbour.
    → It parks minimized into the right if that holds windows, else stays where it is.
32. Maximize on a fixed-workspace screen.
    → An existing workspace with a free slot; if none, in place. Nothing is created.
33. Maximize a window whose sibling was just closed.
    → Nothing (it is already maximized) plus the toast.

## Minimize and restore — 34–44

34. Minimize one half of a pair.
    → The slot is released; the other fills the screen.
35. Restore it.
    → It returns into the free slot (slot 1 while the other keeps slot 0).
36. Minimize the only window of a workspace whose neighbours hold windows.
    → It moves minimized into the left neighbour (else the right); the workspace is
    reaped; the view moves to where it went.
37. Minimize the only window on a screen with no other workspaces.
    → It stays minimized; the workspace persists and looks empty.
38. Restore a window onto a workspace whose two slots are taken.
    → It floats, offset from the pair.
39. Minimize the maximized window on a single-workspace screen.
    → The sibling the maximize had minimized returns and fills the screen.
40. Restore the first window now.
    → It arrives into slot 1: `B | A`.
41. Minimize the focused window while a float is on the same workspace.
    → The float is untouched; focus goes where GNOME puts it.
42. Close the last visible window while a minimized one is on the same workspace.
    → The minimized one is alone: it moves into a neighbour holding windows (or stays)
    and the workspace is reaped.
43. Minimize a float.
    → It hides; no slot is involved.
44. Minimize every window of a workspace.
    → With only minimized windows left, the last occupant moves out (left, else right,
    else stays) and the workspace is reaped.

## Slots, pairs and the axis — 45–55

45. Which slot does a newcomer take when both are free?
    → Slot 1.
46. A newcomer when the workspace holds one window?
    → The free slot.
47. Slot 0's window closes; the survivor.
    → It is alone, so it maximizes.
48. Which slot is a vertical layout's newcomer?
    → The bottom (slot 1).
49. A window arriving from the left screen.
    → Slot 0.
50. From the right screen.
    → Slot 1.
51. From the screen above.
    → Slot 0 (top).
52. From the screen below.
    → Slot 1 (bottom).
53. An overview drop onto another workspace holding one window.
    → Slot 1.
54. An overview drop onto the empty trailing workspace.
    → It is alone, so it maximizes.
55. A keyboard move into a screen holding one visible window.
    → The slot on the side it came from.

## Screens with one workspace — 56–63

56. The first window.
    → Maximized.
57. The second.
    → A pair: the existing keeps its side, the newcomer the other.
58. The third.
    → Floats.
59. The other screen switches workspace.
    → Nothing here moves, and nothing is said.
60. A pair member is minimized, then a window opens.
    → The newcomer splits with the visible one.
61. A window is dragged in while the pair is full.
    → It floats.
62. A window is dragged in while one is minimized and one visible.
    → It splits, on the side it came from.
63. Maximize while a float is on the screen.
    → The float is untouched.

## Screens with fixed workspaces — 64–68

64. Routing while the viewed workspace is full.
    → The nearest workspace with room, right first; the view follows.
65. Routing while everything is full.
    → Floats.
66. A static-number screen.
    → Exactly the same case.
67. Maximize.
    → Existing workspaces only; if none is free, in place.
68. Creation.
    → Never.

## Floats — 69–79

69. The float key on a pair member.
    → It floats exactly in place; the sibling fills the screen.
70. Un-float with a free slot.
    → It takes the slot; alone among visible windows it maximizes.
71. Un-float with both slots taken.
    → It stays floating; toast "cannot un-float".
72. An overview drop onto a full pair.
    → Floats where it was dropped.
73. Overflow on a single-workspace screen.
    → Floats.
74. A dialog.
    → Floats, centred on its parent, raised.
75. A window marked `neverTile`.
    → Always floats.
76. Resizing a float by hand.
    → Free: floats are unmanaged and adrt never touches them.
77. Resizing a tiled window by its outer edge.
    → Snaps back: a float is only ever explicit.
78. A float adrt places itself.
    → Offset from the window beneath; never exactly aligned.
79. Every other window of the float's workspace closes.
    → The workspace stays alive: the float pins it.

## Drags and drops — 80–88

80. Dragging one half of a pair onto the other.
    → They swap; a slight overlap is enough.
81. Dragging a window across screens onto a screen with a free slot.
    → It takes the slot on the side it came from.
82. …onto a full screen.
    → Floats where it was dropped.
83. …onto a window.
    → A swap.
84. Dragging a maximized window across screens.
    → Un-maximized at the drop, then the usual rules.
85. A cross-screen drop over a window while the target also has a free slot. ⚠
    → The crossing wins: a swap.
86. A drop over a float. ⚠
    → The float does not count as a crossing; the managed window beneath it does.
87. The source workspace becomes empty after a drop.
    → Reaped; the view moves only if it was there.
88. An overview drop onto the empty trailing workspace.
    → Maximized there; a new empty one appears after it.

## Focus and directions — 89–93

89. Focus right from the bottom half of a stacked pair.
    → The window at the same height on the next screen.
90. Focus in a direction with nothing that way.
    → Nothing happens, silently.
91. The focus cycle.
    → The current screen and workspace: managed windows in slot order, then floats,
    wrapping; minimized windows are skipped.
92. The workspace-move key on a screen with one workspace.
    → Nothing; toast "this screen has only one workspace".
93. The move keys with a float focused.
    → The float moves to the target screen or workspace and stays a float.

## Displays — 94–97

94. Unplugging a screen that held a pair and a maximized single.
    → They are rescued to the primary as fresh workspaces inserted on the side the screen
    was on; the view does not move.
95. Replugging a remembered connector.
    → Its windows return to their remembered slots; windows opened meanwhile stay put.
96. Changing the primary.
    → No window moves; the work areas change; the extra window from the old primary's
    other workspace becomes a float.
97. Unplugging a screen whose window was fullscreen. ⚠
    → The window is rescued and keeps its fullscreen, and display memory remembers it.

## Surface and ratios — 98–99

98. A dock appears (autohide off).
    → The work area shrinks and every tiled window re-fits by ratio; floats are untouched.
99. A gap changes.
    → The same re-fit by ratio.

## Undo, toasts, session — 100

100. Undo after a maximize.
     → The window rejoins its pair in slot 1, the created workspace disappears, and the
     view returns.

# Not sure — needs a decision

These are the only answers above that the model does not actually settle. My call is
written in; each needs a yes or a correction, and then it goes into the model.

1. **A new window opens beside a fullscreen window.** The workspace's only window is
   fullscreen. The newcomer cannot split with it (a fullscreen window's geometry is
   never touched). My call: the newcomer gets **its own workspace to the right**,
   maximized, and the view follows.
2. **Fullscreen on a float** (Q26). My call: the same as maximize — it fills where it
   is and stays floating.
3. **Unmaximize when the left neighbour holds only a minimized window** (Q30). My call:
   that is "exactly one window", so the unmaximized window joins there and maximizes
   (it is alone among visible windows).
4. **A cross-screen drop over a window while the target also has a free slot** (Q85).
   My call: the crossing wins — a swap, because dropping *on* a window is a stronger
   statement than filling a free slot.
5. **A drop over a float** (Q86). My call: the float is not a tiled window, so it does
   not count as a crossing; the managed window beneath it does, and if there is none,
   the drop fills a free slot as usual.
6. **A no-room float's position after a cross-screen drop.** My call: exactly where it
   was dropped (a user placement), at the size it had.
7. **The offset cascade when it would leave the work area.** My call: the float is
   clamped back inside the work area.
8. **The order of floats in the focus cycle.** My call: their stacking order,
   top-most first.
9. **Unplugging a screen whose window was fullscreen** (Q97). My call: the rescue keeps
   it fullscreen on the primary, and display memory remembers it.
