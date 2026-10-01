// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Screen topology (§1, §6, §9): a resolution-independent description of how the
 * screens are arranged, plus the canonical enumeration of the arrangements the
 * test matrix covers.
 *
 * # Why a signature
 *
 * A monitor's pixel resolution must never decide what a test asserts. Two
 * laptops docked into the same physical shape — a portrait screen beside a
 * landscape one, two screens stacked — are the *same* topology however many
 * pixels each panel has. So the signature is built only from facts that do not
 * move when the resolution does:
 *
 *   * **count** — how many screens;
 *   * **orientation** per screen — portrait (`height > width`) or landscape;
 *   * **relative arrangement** — for every pair, which side one is of the other,
 *     derived from the geometry centres/edges (overlap on one axis and a gap on
 *     the other), never from an absolute pixel.
 *
 * The relative arrangement is deliberately *discrete*: a pair sharing a row is
 * "left/right" whether the seam is at 1280 or 2560 or whether the panels are
 * 1:1 or 2:1. Extent ratios only survive as the two classes that change how a
 * screen tiles — landscape (side by side) and portrait (stacked) — which is why
 * the orientation is part of the signature. That is the "ratios, not
 * resolutions" reading: the arrangement is a shape, and the shape is what the
 * tests gate on.
 *
 * # Format
 *
 * `"<n>:<orientations>:<relations>"`, e.g. `2:LP:01R`, `3:LLP:01R,02D,12X`.
 *
 *   * `<n>` — screen count.
 *   * `<orientations>` — `L`/`P` per screen, in canonical spatial order: sorted
 *     by top edge, then left edge, then index. A single row reads left to right;
 *     a single column reads top to bottom; a grid reads row-major.
 *   * `<relations>` — one `ij<D>` per unordered pair `i<j` (indices into the
 *     canonical order), where the direction `D` is `j` relative to `i`:
 *       `R` right, `L` left, `U` above, `D` below, `X` diagonal, `O` overlapping.
 *     A pair is "rowed" when their vertical spans overlap and their horizontal
 *     spans do not, "columned" when the reverse, `X` when neither overlaps and
 *     `O` in the (invalid) case both do.
 *
 * The string is stable under translating or scaling the whole arrangement, and
 * under reordering the input array (it is canonicalised internally). It is what
 * a scenario compares against a declared value, so a case for a two-screen
 * topology can never run on a three-screen one.
 *
 * # The canonical combinations
 *
 * The test matrix covers every count from one to four, the orientation patterns
 * that matter for each, and the arrangements that matter (a single row, a single
 * column, an L at three, a 2×2 at four). Orientation patterns are taken up to
 * reversal (a row `LP` is the mirror of `PL`; the signature still distinguishes
 * the two because which screen is on the left is real, but the matrix only needs
 * one of them). Each non-row arrangement is exercised with the canonical mixed
 * pattern (`LP`, `LLP`, `LLPP`), so a single run shows both orientations in that
 * shape.
 *
 * | count | orientations (canonical)   | arrangements        |
 * | ----- | -------------------------- | ------------------- |
 * | 1     | L, P                       | single              |
 * | 2     | LL, LP, PP                 | row, column         |
 * | 3     | LLL, LLP, LPP, PPP         | row, column, L      |
 * | 4     | LLLL, LLLP, LLPP, PPPP     | row, column, 2×2    |
 *
 * `TOPOLOGY_COMBINATIONS` is that set materialised, with the `ADRT_MONITORS`
 * spec that produces its orientations and the arrangement its real virtual
 * monitors are placed into. `scripts/topology-matrix.sh` walks the list: it
 * starts a nested Shell per combination, arranges the monitors, and runs the one
 * gated scenario that declares the signature.
 *
 * Pure: no compositor import, no absolute pixels in the signature. See
 * `tests/core/topology.test.ts`.
 */

import type { Rect } from './types.js';

/** A screen's own ratio class, independent of resolution. */
export type Orientation = 'L' | 'P';

/** The minimal screen shape the signature needs. `Screen` satisfies it. */
export interface TopologyScreen {
  index: number;
  geometry: Rect;
}

/**
 * Where `j` sits relative to `i`: right/left (a row), below/above (a column),
 * diagonal, or overlapping.
 */
export type ScreenRelation = 'R' | 'L' | 'D' | 'U' | 'X' | 'O';

/** Portrait iff the screen is taller than it is wide (§1, §6). */
export function orientationOf(screen: TopologyScreen): Orientation {
  return screen.geometry.height > screen.geometry.width ? 'P' : 'L';
}

function centreX(screen: TopologyScreen): number {
  return screen.geometry.x + screen.geometry.width / 2;
}

function centreY(screen: TopologyScreen): number {
  return screen.geometry.y + screen.geometry.height / 2;
}

/** Overlap of two intervals; positive when they share pixels, 0 at a seam. */
function overlap(startA: number, lengthA: number, startB: number, lengthB: number): number {
  return Math.min(startA + lengthA, startB + lengthB) - Math.max(startA, startB);
}

/**
 * The relation from `a` to `b`, by geometry only. Sharing a row means the
 * vertical spans overlap while the horizontal ones meet at a seam (or leave a
 * gap); the reverse is a column; neither overlap is diagonal.
 */
export function screenRelation(a: TopologyScreen, b: TopologyScreen): ScreenRelation {
  const ga = a.geometry;
  const gb = b.geometry;
  const horizontalOverlap = overlap(ga.x, ga.width, gb.x, gb.width);
  const verticalOverlap = overlap(ga.y, ga.height, gb.y, gb.height);
  if (horizontalOverlap > 0 && verticalOverlap > 0) return 'O';
  if (verticalOverlap > 0) return centreX(b) >= centreX(a) ? 'R' : 'L';
  if (horizontalOverlap > 0) return centreY(b) >= centreY(a) ? 'D' : 'U';
  return 'X';
}

/** Top edge, then left edge, then index: the canonical reading order. */
function canonicalOrder(screens: readonly TopologyScreen[]): TopologyScreen[] {
  return [...screens].sort(
    (a, b) =>
      a.geometry.y - b.geometry.y ||
      a.geometry.x - b.geometry.x ||
      a.index - b.index,
  );
}

/**
 * The stable, resolution-independent signature of a screen list. Input order
 * does not matter; the screens are canonicalised internally.
 */
export function topologySignature(screens: readonly TopologyScreen[]): string {
  const ordered = canonicalOrder(screens);
  const n = ordered.length;
  if (n === 0) return '0::';
  const orientations = ordered.map(orientationOf).join('');
  const relations: string[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      relations.push(`${i}${j}${screenRelation(ordered[i]!, ordered[j]!)}`);
    }
  }
  return `${n}:${orientations}:${relations.join(',')}`;
}

/** The screen count a signature describes, or 0 when it is malformed. */
export function signatureCount(signature: string): number {
  const count = Number.parseInt(signature.split(':', 1)[0] ?? '', 10);
  return Number.isFinite(count) ? count : 0;
}

/** The orientation string a signature carries (`"LP"`, `"LLP"` …). */
export function signatureOrientations(signature: string): string {
  return signature.split(':')[1] ?? '';
}

// --------------------------------------------------------------- combinations

/** The shape classes the matrix covers. */
export type Arrangement = 'single' | 'row' | 'column' | 'l' | 'grid';

/** One canonical topology the matrix can start a nested Shell for. */
export interface TopologyCombination {
  /** Stable short id; also names the `ADRT_TOPO_EXPECT` case. */
  id: string;
  /** Screen count, 1–4. */
  screens: number;
  /** Canonical orientation string, spatial order. */
  orientations: string;
  /** How the screens are arranged. */
  arrangement: Arrangement;
  /** `ADRT_MONITORS` spec that produces these orientations. */
  monitors: string;
  /** The signature `topologySignature` returns for this combination. */
  signature: string;
  /** Human label for the matrix report. */
  label: string;
}

const LANDSCAPE: readonly [number, number] = [1280, 800];
const PORTRAIT: readonly [number, number] = [800, 1280];

function sizeFor(orientation: Orientation): [number, number] {
  return orientation === 'P' ? [PORTRAIT[0], PORTRAIT[1]] : [LANDSCAPE[0], LANDSCAPE[1]];
}

/**
 * The grid cells each screen occupies, in screen order, for an arrangement. The
 * matrix turns these into absolute positions (column widths and row heights);
 * `comboScreens` does the same in reverse for the signature unit tests.
 */
export function arrangementCells(arrangement: Arrangement, n: number): Array<[number, number]> {
  switch (arrangement) {
    case 'single':
      return [[0, 0]];
    case 'row':
      return Array.from({ length: n }, (_, i) => [i, 0] as [number, number]);
    case 'column':
      return Array.from({ length: n }, (_, i) => [0, i] as [number, number]);
    case 'l':
      return [[0, 0], [1, 0], [0, 1]];
    case 'grid':
      return [[0, 0], [1, 0], [0, 1], [1, 1]];
  }
}

/**
 * The geometry a combination lays out: each screen packed into its cell, cells
 * sized to the widest/tallest member. This is exactly what the matrix's `gdctl`
 * placement produces on the real virtual monitors, so the signature computed
 * here is the one the harness must show.
 */
export function comboScreens(orientations: string, arrangement: Arrangement): TopologyScreen[] {
  const n = orientations.length;
  const cells = arrangementCells(arrangement, n);
  const sizes = Array.from(orientations, (o) => sizeFor(o as Orientation));
  const columnWidth = new Map<number, number>();
  const rowHeight = new Map<number, number>();
  cells.forEach(([column, row], i) => {
    const [width, height] = sizes[i]!;
    columnWidth.set(column, Math.max(columnWidth.get(column) ?? 0, width));
    rowHeight.set(row, Math.max(rowHeight.get(row) ?? 0, height));
  });
  const xOf = (column: number): number => {
    let x = 0;
    for (let c = 0; c < column; c++) x += columnWidth.get(c) ?? 0;
    return x;
  };
  const yOf = (row: number): number => {
    let y = 0;
    for (let r = 0; r < row; r++) y += rowHeight.get(r) ?? 0;
    return y;
  };
  return cells.map(([column, row], i) => {
    const [width, height] = sizes[i]!;
    return { index: i, geometry: { x: xOf(column), y: yOf(row), width, height } };
  });
}

/** The signature a combination must produce, computed from its own geometry. */
export function combinationSignature(orientations: string, arrangement: Arrangement): string {
  return topologySignature(comboScreens(orientations, arrangement));
}

function combination(
  id: string,
  orientations: string,
  arrangement: Arrangement,
  label: string,
): TopologyCombination {
  const monitors = Array.from(orientations)
    .map((o) => (o === 'P' ? '800x1280' : '1280x800'))
    .join(':');
  return {
    id,
    screens: orientations.length,
    orientations,
    arrangement,
    monitors,
    signature: combinationSignature(orientations, arrangement),
    label,
  };
}

/**
 * Every canonical combination, 1–4 screens. See the table in the module comment:
 * all orientation patterns for a row, plus each non-row arrangement with the
 * canonical mixed pattern. Finite, documented, and the exact list
 * `scripts/topology-matrix.sh` runs.
 */
export const TOPOLOGY_COMBINATIONS: readonly TopologyCombination[] = [
  combination('1l', 'L', 'single', 'one landscape screen'),
  combination('1p', 'P', 'single', 'one portrait screen'),

  combination('2ll-row', 'LL', 'row', 'two landscape screens side by side'),
  combination('2lp-row', 'LP', 'row', 'a landscape and a portrait, side by side'),
  combination('2pp-row', 'PP', 'row', 'two portrait screens side by side'),
  combination('2lp-col', 'LP', 'column', 'a landscape above a portrait'),

  combination('3lll-row', 'LLL', 'row', 'three landscape in a row'),
  combination('3llp-row', 'LLP', 'row', 'two landscape then a portrait, in a row'),
  combination('3lpp-row', 'LPP', 'row', 'a landscape then two portrait, in a row'),
  combination('3ppp-row', 'PPP', 'row', 'three portrait in a row'),
  combination('3llp-col', 'LLP', 'column', 'two landscape above a portrait'),
  combination('3llp-l', 'LLP', 'l', 'an L: two landscape in a row, a portrait below the left'),

  combination('4llll-row', 'LLLL', 'row', 'four landscape in a row'),
  combination('4lllp-row', 'LLLP', 'row', 'three landscape then a portrait, in a row'),
  combination('4llpp-row', 'LLPP', 'row', 'two landscape then two portrait, in a row'),
  combination('4pppp-row', 'PPPP', 'row', 'four portrait in a row'),
  combination('4llpp-col', 'LLPP', 'column', 'two landscape above two portrait'),
  combination('4llpp-grid', 'LLPP', 'grid', 'a 2x2 grid'),
];
