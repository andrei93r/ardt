// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import type { TopologyScreen } from '../../src/core/topology.js';
import {
  TOPOLOGY_COMBINATIONS,
  arrangementCells,
  combinationSignature,
  comboScreens,
  orientationOf,
  screenRelation,
  signatureCount,
  signatureOrientations,
  topologySignature,
} from '../../src/core/topology.js';

function screen(
  index: number,
  x: number,
  y: number,
  width: number,
  height: number,
): TopologyScreen {
  return { index, geometry: { x, y, width, height } };
}

/** The same physical shape at different resolutions and origins. */
function movedAndScaled(screens: TopologyScreen[], dx: number, dy: number, scale: number): TopologyScreen[] {
  return screens.map((s) => ({
    index: s.index,
    geometry: {
      x: s.geometry.x * scale + dx,
      y: s.geometry.y * scale + dy,
      width: s.geometry.width * scale,
      height: s.geometry.height * scale,
    },
  }));
}

describe('orientationOf', () => {
  it('is portrait only when the screen is taller than wide', () => {
    expect(orientationOf(screen(0, 0, 0, 1920, 1080))).toBe('L');
    expect(orientationOf(screen(0, 0, 0, 1080, 1920))).toBe('P');
    // A square is landscape (side by side), matching the extension's own rule.
    expect(orientationOf(screen(0, 0, 0, 1000, 1000))).toBe('L');
  });
});

describe('screenRelation', () => {
  it('reads a row, a column, a diagonal and an overlap', () => {
    const a = screen(0, 0, 0, 1280, 800);
    expect(screenRelation(a, screen(1, 1280, 0, 1280, 800))).toBe('R');
    expect(screenRelation(a, screen(1, -1280, 0, 1280, 800))).toBe('L');
    expect(screenRelation(a, screen(1, 0, 800, 1280, 800))).toBe('D');
    expect(screenRelation(a, screen(1, 0, -800, 1280, 800))).toBe('U');
    expect(screenRelation(a, screen(1, 1280, 800, 1280, 800))).toBe('X');
    expect(screenRelation(a, screen(1, 100, 100, 1280, 800))).toBe('O');
  });
});

describe('topologySignature', () => {
  it('names the count and each screen orientation', () => {
    expect(topologySignature([screen(0, 0, 0, 1920, 1080)])).toBe('1:L:');
    expect(topologySignature([screen(0, 0, 0, 1080, 1920)])).toBe('1:P:');
    expect(topologySignature([
      screen(0, 0, 0, 1920, 1080),
      screen(1, 1920, 0, 1080, 1920),
    ])).toBe('2:LP:01R');
  });

  it('is independent of absolute resolution and origin', () => {
    const base = [
      screen(0, 0, 0, 1280, 800),
      screen(1, 1280, 0, 800, 1280),
      screen(2, 0, 800, 1280, 800),
    ];
    const expected = topologySignature(base);
    expect(topologySignature(movedAndScaled(base, 4096, -512, 3))).toBe(expected);
    expect(topologySignature(movedAndScaled(base, -2000, 9000, 1))).toBe(expected);
  });

  it('does not depend on the order the screens are given in', () => {
    const base = [
      screen(0, 0, 0, 1280, 800),
      screen(1, 1280, 0, 800, 1280),
      screen(2, 0, 800, 1280, 800),
    ];
    const shuffled = [base[2]!, base[0]!, base[1]!];
    expect(topologySignature(shuffled)).toBe(topologySignature(base));
  });

  it('distinguishes a row from a column from a diagonal', () => {
    const row = topologySignature([
      screen(0, 0, 0, 1280, 800),
      screen(1, 1280, 0, 1280, 800),
    ]);
    const column = topologySignature([
      screen(0, 0, 0, 1280, 800),
      screen(1, 0, 800, 1280, 800),
    ]);
    const diagonal = topologySignature([
      screen(0, 0, 0, 1280, 800),
      screen(1, 1280, 800, 1280, 800),
    ]);
    expect(row).toBe('2:LL:01R');
    expect(column).toBe('2:LL:01D');
    expect(diagonal).toBe('2:LL:01X');
    expect(new Set([row, column, diagonal]).size).toBe(3);
  });

  it('exposes the count and orientations it encodes', () => {
    expect(signatureCount('3:LLP:01R,02D,12X')).toBe(3);
    expect(signatureOrientations('3:LLP:01R,02D,12X')).toBe('LLP');
  });
});

describe('the canonical combinations', () => {
  it('covers one to four screens', () => {
    const counts = new Set(TOPOLOGY_COMBINATIONS.map((c) => c.screens));
    expect([...counts].sort()).toEqual([1, 2, 3, 4]);
    expect(TOPOLOGY_COMBINATIONS.length).toBeGreaterThanOrEqual(16);
  });

  it('has unique ids and unique signatures', () => {
    const ids = TOPOLOGY_COMBINATIONS.map((c) => c.id);
    const signatures = TOPOLOGY_COMBINATIONS.map((c) => c.signature);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('agrees with its own declared signature and orientation string', () => {
    for (const combo of TOPOLOGY_COMBINATIONS) {
      expect(combo.orientations.length).toBe(combo.screens);
      expect(combo.monitors.split(':').length).toBe(combo.screens);
      expect(combo.signature).toBe(combinationSignature(combo.orientations, combo.arrangement));
      expect(combo.signature).toBe(topologySignature(comboScreens(combo.orientations, combo.arrangement)));
      expect(signatureOrientations(combo.signature)).toBe(combo.orientations);
      expect(signatureCount(combo.signature)).toBe(combo.screens);
    }
  });

  it('covers every arrangement that matters', () => {
    const has = (arrangement: string, screens: number): boolean =>
      TOPOLOGY_COMBINATIONS.some((c) => c.arrangement === arrangement && c.screens === screens);
    expect(has('single', 1)).toBe(true);
    expect(has('row', 2)).toBe(true);
    expect(has('column', 2)).toBe(true);
    expect(has('row', 3)).toBe(true);
    expect(has('column', 3)).toBe(true);
    expect(has('l', 3)).toBe(true);
    expect(has('row', 4)).toBe(true);
    expect(has('column', 4)).toBe(true);
    expect(has('grid', 4)).toBe(true);
  });

  it('lays out each arrangement into the cells it names', () => {
    expect(arrangementCells('row', 3)).toEqual([[0, 0], [1, 0], [2, 0]]);
    expect(arrangementCells('column', 3)).toEqual([[0, 0], [0, 1], [0, 2]]);
    expect(arrangementCells('l', 3)).toEqual([[0, 0], [1, 0], [0, 1]]);
    expect(arrangementCells('grid', 4)).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
  });

  it('spells a few combinations exactly', () => {
    const byId = new Map(TOPOLOGY_COMBINATIONS.map((c) => [c.id, c.signature]));
    expect(byId.get('1l')).toBe('1:L:');
    expect(byId.get('1p')).toBe('1:P:');
    expect(byId.get('2lp-row')).toBe('2:LP:01R');
    expect(byId.get('2lp-col')).toBe('2:LP:01D');
    expect(byId.get('3llp-l')).toBe('3:LLP:01R,02D,12X');
    expect(byId.get('3llp-col')).toBe('3:LLP:01D,02D,12D');
    expect(byId.get('4llpp-grid')).toBe('4:LLPP:01R,02D,03X,12X,13D,23R');
  });
});
