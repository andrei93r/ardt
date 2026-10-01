#!/usr/bin/env python3
"""Expand scripts/core_seeds.py into concrete business-logic test cases.

Writes:
  tests/generated/core-cases.json   every concrete case (decision-level expectations)
  docs/V2_TEST_MATRIX.md            the human catalogue: axes, policy, generated tables

Run:  python3 scripts/gen-core-cases.py
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core_seeds import SEEDS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --------------------------------------------------------------------------- axes

SCREEN_SETS = [
    dict(id="S1", scr=[dict(cls="D", prim=True, w=2560, h=1440, bar=32, x=0, y=0)]),
    dict(id="S1p", scr=[dict(cls="D", prim=True, w=1440, h=2560, bar=32, x=0, y=0, portrait=True)]),
    dict(id="S1o", scr=[dict(cls="O", prim=True, w=2560, h=1440, bar=32, x=0, y=0)]),
    dict(id="S1f", scr=[dict(cls="F", n=4, prim=True, w=2560, h=1440, bar=32, x=0, y=0)]),
    dict(id="S2L", scr=[dict(cls="D", prim=True, w=2560, h=1440, bar=32, x=0, y=0),
                        dict(cls="O", w=1920, h=1080, x=2560, y=0)]),
    dict(id="S2R", scr=[dict(cls="O", w=1920, h=1080, x=0, y=0),
                        dict(cls="D", prim=True, w=2560, h=1440, bar=32, x=1920, y=0)]),
    dict(id="S2P", scr=[dict(cls="D", prim=True, w=2560, h=1440, bar=32, x=0, y=0),
                        dict(cls="O", w=1080, h=1920, x=2560, y=0, portrait=True)]),
    dict(id="S2V", scr=[dict(cls="D", prim=True, w=2560, h=1440, bar=32, x=0, y=0),
                        dict(cls="O", w=1920, h=1080, x=0, y=-1080)]),
    dict(id="S3", scr=[dict(cls="O", w=1920, h=1080, x=0, y=0),
                       dict(cls="D", prim=True, w=2560, h=1440, bar=32, x=1920, y=0),
                       dict(cls="O", w=1920, h=1080, x=4480, y=0)]),
    dict(id="S4", scr=[dict(cls="O", w=1920, h=1080, x=0, y=0),
                       dict(cls="D", prim=True, w=2560, h=1440, bar=32, x=1920, y=0),
                       dict(cls="O", w=1080, h=1920, x=4480, y=0, portrait=True),
                       dict(cls="O", w=1920, h=1080, x=1920, y=-1080)]),
    dict(id="S2D", scr=[dict(cls="D", prim=True, w=2560, h=1440, bar=32, x=0, y=0),
                        dict(cls="D", w=1920, h=1080, x=2560, y=0)]),
]

NEEDS = {
    "ws": lambda s: any(x["cls"] == "D" for x in s),
    "nows": lambda s: any(x["cls"] != "D" for x in s),
    "nowsonly": lambda s: all(x["cls"] != "D" for x in s),
    "2s": lambda s: len(s) >= 2,
    "3s": lambda s: len(s) >= 3,
    "4s": lambda s: len(s) >= 4,
    "2ws": lambda s: sum(1 for x in s if x["cls"] == "D") >= 2,
    "1s": lambda s: len(s) == 1,
    "portrait": lambda s: any(x.get("portrait") for x in s),
    "landscape": lambda s: any(not x.get("portrait") for x in s),
    "any": lambda s: True,
}

EXTRAS = {"e": ["none", "float", "minimized"], "b": ["none", "both"]}
ORDERS = {"o": ["ab", "ba"]}
AXES = {"a": ["h", "v"]}
GEOMS = [("std", 1.0, 32), ("sm", 0.5, 24), ("lg", 1.5, 40)]
POSITIONS = ["first", "middle", "last"]
# seeds whose outcome is independent of WHERE the workspace sits in the list
POSITION_SEEDS = {"R02", "R03", "R05", "R06", "R14", "N01", "N02", "N03", "N06",
                  "S01", "S02", "S09", "S10", "S11", "W01", "W05", "M01", "M02"}

INVARIANTS = [
    "I1 no eviction: nothing moves to another workspace because another window needs its place",
    "I2 packing: every workspace holds a maximized single or a full pair, plus floats and minimized parks",
    "I3 occupancy: a slot is held only while its window is visible; minimizing releases it",
    "I4 spare: exactly one empty trailing workspace exists and is never removed",
    "I5 view: the view moves only for the app the action is about, and only on the viewed workspace; a reactor never moves it",
    "I6 focus: focus never switches workspace on its own",
    "I7 toast: a request that changes nothing toasts with its reason; a direction with nothing stays silent",
    "I8 idempotence: repeating the state-producing action in the same state changes nothing",
    "I9 inverse: where the model promises an inverse (maximize/unmaximize, minimize/restore, float/un-float, swap twice) the decision state returns",
    "I10 determinism: the same state and event sequence gives the same decisions — no learned geometry, no timing dependence",
]


def qualifies(screens, needs):
    return all(NEEDS[n](screens) for n in needs.split() if n)


def target_role(screens, needs):
    """Which screen the case is about: the one with workspaces, else the one without."""
    if "nowsonly" in needs:
        return "nows"
    if "nows" in needs:
        return "nows"
    if "ws" in needs:
        return "ws"
    return "any"


def vary_order(text):
    """Swap the window names A and B as whole words (for the ab/ba order axis)."""
    text = re.sub(r"\bA\b", "\x00", text)
    text = re.sub(r"\bB\b", "A", text)
    return re.sub(r"\x00", "B", text)


def apply_geom(scr, scale, bar):
    """Scale a screen set, relaying it out: a row, with screens that were above kept above."""
    sized = []
    for x in scr:
        y = dict(x)
        y["w"] = max(640, int(x["w"] * scale / 2) * 2)
        y["h"] = max(480, int(x["h"] * scale / 2) * 2)
        y["bar"] = bar if x.get("prim") else 0
        y["_above"] = x.get("y", 0) < 0
        sized.append(y)
    x = 0
    for y in sized:
        if not y["_above"]:
            y["x"], y["y"] = x, 0
            x += y["w"]
    above = [y for y in sized if y["_above"]]
    if above:
        base = sized[0]
        for y in above:
            y["x"], y["y"] = base["x"], -y["h"]
    for y in sized:
        y.pop("_above", None)
    return sized


def expand(seed):
    out = []
    screens_sets = [s for s in SCREEN_SETS if qualifies(s["scr"], seed.get("needs", "any"))]
    axes = AXES["a"] if "a" in seed["vary"] else [None]
    extras = EXTRAS["e"] if "e" in seed["vary"] else (EXTRAS["b"] if "b" in seed["vary"] else [None])
    orders = ORDERS["o"] if "o" in seed["vary"] else [None]
    positions = POSITIONS if seed["id"] in POSITION_SEEDS and "ws" in seed.get("needs", "") else [None]
    geoms = GEOMS
    for ss in (screens_sets if "s" in seed["vary"] else [SCREEN_SETS[0]]):
        if not qualifies(ss["scr"], seed.get("needs", "any")):
            continue
        portraits = [x for x in ss["scr"] if x.get("portrait")]
        for ax in axes:
            if ax == "h" and portraits:
                continue  # a portrait screen's pair axis is stacked
            for ex in extras:
                for od in orders:
                    for gp in geoms:
                        for pos in positions:
                            parts = [seed["id"], ss["id"], gp[0]]
                            if ax:
                                parts.append(ax)
                            if ex:
                                parts.append(ex)
                            if od:
                                parts.append(od)
                            if pos:
                                parts.append(pos[0])
                            setup, act, exp = seed["setup"], seed["act"], seed["exp"]
                            if od == "ba":
                                setup, act, exp = vary_order(setup), vary_order(act), vary_order(exp)
                            out.append(dict(
                                id="-".join(parts), seed=seed["id"], family=seed["fam"], rule=seed["rule"],
                                screens=[dict(role=("ws" if s["cls"] == "D" else "nows"), **s)
                                         for s in apply_geom(ss["scr"], gp[1], gp[2])],
                                target=target_role(ss["scr"], seed.get("needs", "any")),
                                axis=ax, extras=ex, order=od, ws_position=pos,
                                setup=setup, action=act, expect=exp,
                                invariants=INVARIANTS,
                            ))
    return out


def main():
    cases = [c for s in SEEDS for c in expand(s)]
    os.makedirs(os.path.join(ROOT, "tests/generated"), exist_ok=True)
    out = os.path.join(ROOT, "tests/generated/core-cases.json")
    with open(out, "w", encoding="utf8") as f:
        json.dump(dict(generated_from="scripts/core_seeds.py", count=len(cases), cases=cases), f, indent=1)

    # ---- the catalogue document -------------------------------------------------
    fams = []
    for s in SEEDS:
        if s["fam"] not in fams:
            fams.append(s["fam"])
    lines = []
    for fam in fams:
        rows = [s for s in SEEDS if s["fam"] == fam]
        n = sum(len(expand(s)) for s in rows)
        lines.append(f"\n### {fam} — {len(rows)} seeds, {n} cases\n")
        lines.append("| id | rule | setup | action | expected | varies | cases |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- |")
        for s in rows:
            cnt = len(expand(s))
            varies = " ".join(x for x in [
                "screens" if "s" in s["vary"] else "",
                "axis" if "a" in s["vary"] else "",
                "extras" if ("e" in s["vary"] or "b" in s["vary"]) else "",
                "order" if "o" in s["vary"] else "",
            ] if x)
            lines.append("| `{id}` | {rule} | {setup} | {act} | {exp} | {varies} | {cnt} |".format(
                id=s["id"], rule=s["rule"], setup=s["setup"], act=s["act"], exp=s["exp"],
                varies=varies or "—", cnt=cnt))
    catalogue = "\n".join(lines)

    doc = f"""# The pure-core test matrix

**Generated** by `scripts/gen-core-cases.py` from `scripts/core_seeds.py`. Do not edit by
hand: change the seeds and re-run.

The business logic lives in `core/` and is tested there — pure, fast and deterministic,
no Shell and no compositor. The harness scenarios only prove that the adapter feeds the
core the right inputs and applies its decisions. This matrix is the source those core
tests are written from: **{len(SEEDS)} logical seeds expand to {len(cases)} concrete cases**
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

{chr(10).join("- " + i for i in INVARIANTS)}

## Geometry is asserted separately

Decision-level expectations (workspace, slot, maximized, floating, minimized) are
axis- and resolution-independent by construction. A small extra family asserts exact
rectangles from the work area: the pair split at the ratio, the gaps (0 outside,
`gaps-base` between), the bar's strip on the primary only, a clamped own-workspace
window, and the re-fit by ratio when the surface changes.

## The catalogue

{catalogue}

## Using it

Every seed cites the model section its outcome comes from. When a stage of
`docs/V2_PLAN.md` starts, its tests are written from the matching family here — seeds
first, then their expansions — so the variations are exhaustive before the
implementation exists.
"""
    with open(os.path.join(ROOT, "docs/V2_TEST_MATRIX.md"), "w", encoding="utf8") as f:
        f.write(doc)
    print(f"seeds: {len(SEEDS)}  cases: {len(cases)}  -> {out}")
    for fam in fams:
        print(f"  {fam:12s} {sum(1 for c in cases if c['family'] == fam)}")


if __name__ == "__main__":
    main()
