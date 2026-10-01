// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import type { Rule, RuleContext, TileMode } from './rules.js';
import { firstMatch } from './rules.js';
import type { Rect, Screen, Size, TilePlan } from './types.js';
import { Layer, SurfaceKind, clamp, snapRect } from './types.js';

export type MinSizePolicy = 'respect' | 'ignore' | 'stack';

/** Axis of a two-window split: `horizontal` = side by side, `vertical` = stacked. */
export type SplitAxis = 'horizontal' | 'vertical';

export interface TilerConfig {
  gapBase: number;
  /** Negative values inherit `gapBase` (§6). */
  gapPortrait: number;
  /** Negative values inherit `gapBase` (§6). */
  gapLandscape: number;
  minSizePolicy: MinSizePolicy;
  primaryApps: readonly string[];
  /** 0..1, clamped to 0.2–0.8 when applied. */
  primaryAppRatio: number;
  /** Ratio keyed by `appA|appB|axis`, fraction belonging to the sorted-first app. */
  ratios: Readonly<Record<string, number>>;
  /** Pair keys (`min|max`) whose sides are swapped. */
  swapPairs: ReadonlySet<string>;
  /**
   * Orientation of the workspace layout (§6): with vertical workspaces the pair
   * stacks top/bottom instead of left/right. Unset falls back to the monitor's
   * own orientation.
   */
  workspaceAxis?: SplitAxis;
  rules: readonly Rule[];
  /**
   * §6/§19.1 `reflow-keeps-edges`. When false, a lone tiled window keeps the
   * rect it already occupies instead of expanding to fill the monitor.
   * Defaults to true (fill).
   */
  reflowKeepsEdges?: boolean;
}

export interface TilerWindow {
  id: number;
  appId: string;
  title: string;
  kind: SurfaceKind;
  rect: Rect;
  min: Size;
  max: Size;
  screenId: number;
  workspaceId: number;
  /**
   * §3/§4: the slot the window's own change chose for it — a routed newcomer's
   * slot 1, an unmaximized window joining slot 1. When both windows of a pair
   * carry one, the tiler honours it instead of guessing from position.
   */
  slot?: 0 | 1;
}

export interface TilerInput {
  windows: readonly TilerWindow[];
  screens: readonly Screen[];
  config: TilerConfig;
}

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Ratio keys are order-independent: app ids are sorted so the same pair is
 * recognised regardless of which window opened first or sits on which side.
 */
export function ratioKey(appA: string, appB: string, axis: SplitAxis): string {
  const [first, second] = appA <= appB ? [appA, appB] : [appB, appA];
  return `${first}|${second}|${axis}`;
}

export function isPortrait(screen: Screen): boolean {
  return screen.geometry.height > screen.geometry.width;
}

/** The area tiles may occupy: the work area (struts removed) or the monitor. */
export function screenArea(screen: Screen): Rect {
  return screen.workArea ?? screen.geometry;
}

export function effectiveGap(config: TilerConfig, screen: Screen): number {
  const override = isPortrait(screen) ? config.gapPortrait : config.gapLandscape;
  return override >= 0 ? override : config.gapBase;
}

function inset(rect: Rect, gap: number): Rect {
  return {
    x: rect.x + gap,
    y: rect.y + gap,
    width: Math.max(0, rect.width - 2 * gap),
    height: Math.max(0, rect.height - 2 * gap),
  };
}

function fillRect(avail: Rect, min: Size, area: Rect): Rect {
  const width = Math.min(Math.max(avail.width, min.width), area.width);
  const height = Math.min(Math.max(avail.height, min.height), area.height);
  return { x: avail.x, y: avail.y, width, height };
}

/** Keep a rect inside the tiling area without expanding it. */
function clampRect(rect: Rect, min: Size, area: Rect): Rect {
  const width = Math.max(min.width, Math.min(rect.width, area.width));
  const height = Math.max(min.height, Math.min(rect.height, area.height));
  const x = Math.max(area.x, Math.min(rect.x, area.x + area.width - width));
  const y = Math.max(area.y, Math.min(rect.y, area.y + area.height - height));
  return { x, y, width, height };
}

function axisExtent(rect: Rect, axis: SplitAxis): number {
  return axis === 'horizontal' ? rect.width : rect.height;
}

interface SplitResult {
  rect0: Rect;
  rect1: Rect;
}

/**
 * Split the available rect along `axis` at `ratio` (fraction for the first
 * window), leaving one `gap` between the two windows.
 */
function splitAt(avail: Rect, gap: number, axis: SplitAxis, ratio: number): SplitResult {
  const extent = axisExtent(avail, axis);
  const split = Math.max(0, extent - gap);
  const first = split * ratio;
  const second = split - first;
  if (axis === 'horizontal') {
    return {
      rect0: { x: avail.x, y: avail.y, width: first, height: avail.height },
      rect1: { x: avail.x + first + gap, y: avail.y, width: second, height: avail.height },
    };
  }
  return {
    rect0: { x: avail.x, y: avail.y, width: avail.width, height: first },
    rect1: { x: avail.x, y: avail.y + first + gap, width: avail.width, height: second },
  };
}

function fitsAt(avail: Rect, gap: number, axis: SplitAxis, min0: Size, min1: Size): boolean {
  const split = axisExtent(avail, axis) - gap;
  if (split <= 0) return false;
  const need = (axis === 'horizontal' ? min0.width : min0.height) + (axis === 'horizontal' ? min1.width : min1.height);
  return split >= need;
}

function clampRatioForMin(ratio: number, avail: Rect, gap: number, axis: SplitAxis, min0: Size, min1: Size): number {
  const split = axisExtent(avail, axis) - gap;
  if (split <= 0) return ratio;
  const m0 = axis === 'horizontal' ? min0.width : min0.height;
  const m1 = axis === 'horizontal' ? min1.width : min1.height;
  const minRatio = m0 / split;
  const maxRatio = 1 - m1 / split;
  return clamp(ratio, minRatio, maxRatio);
}

function isPrimary(appId: string, primaryApps: readonly string[]): boolean {
  return primaryApps.includes(appId);
}

/** Fraction of the split that belongs to window index 0. */
function resolveRatio(w0: TilerWindow, w1: TilerWindow, axis: SplitAxis, config: TilerConfig): number {
  const saved = config.ratios[ratioKey(w0.appId, w1.appId, axis)];
  if (saved !== undefined) {
    const w0First = w0.appId <= w1.appId;
    return w0First ? saved : 1 - saved;
  }
  const p0 = isPrimary(w0.appId, config.primaryApps);
  const p1 = isPrimary(w1.appId, config.primaryApps);
  if (p0 !== p1) {
    const primaryRatio = clamp(config.primaryAppRatio, 0.2, 0.8);
    return p0 ? primaryRatio : 1 - primaryRatio;
  }
  return 0.5;
}

/**
 * Minimum-size stack fallback (§6): both windows at their minimum size,
 * side by side when that fits, otherwise pinned to the two edges.
 */
function stackLayout(avail: Rect, gap: number, w0: TilerWindow, w1: TilerWindow, prefer: SplitAxis): SplitResult {
  const tries: SplitAxis[] = prefer === 'horizontal' ? ['horizontal', 'vertical'] : ['vertical', 'horizontal'];
  for (const axis of tries) {
    if (!fitsAt(avail, gap, axis, w0.min, w1.min)) continue;
    if (axis === 'horizontal') {
      return {
        rect0: { x: avail.x, y: avail.y, width: w0.min.width, height: Math.min(w0.min.height, avail.height) },
        rect1: {
          x: avail.x + avail.width - w1.min.width,
          y: avail.y,
          width: w1.min.width,
          height: Math.min(w1.min.height, avail.height),
        },
      };
    }
    return {
      rect0: { x: avail.x, y: avail.y, width: avail.width, height: Math.min(w0.min.height, avail.height) },
      rect1: {
        x: avail.x,
        y: avail.y + avail.height - Math.min(w1.min.height, avail.height),
        width: avail.width,
        height: Math.min(w1.min.height, avail.height),
      },
    };
  }
  // Neither minimum fits: split the available extent evenly so the plan stays
  // non-overlapping and inside the monitor.
  return splitAt(avail, gap, prefer, 0.5);
}

function place(id: number, rect: Rect, screen: Screen, order: number, max?: Size) {
  const width = max !== undefined && max.width > 0 ? Math.min(rect.width, max.width) : rect.width;
  const height = max !== undefined && max.height > 0 ? Math.min(rect.height, max.height) : rect.height;
  return { surfaceId: id, rect: snapRect({ x: rect.x, y: rect.y, width, height }, screen.scale), layer: Layer.TILED, order };
}

interface RuleOverride {
  window: TilerWindow;
  mode: TileMode;
}

function findRuleOverride(windows: readonly TilerWindow[], rules: readonly Rule[]): RuleOverride | null {
  const sorted = [...windows].sort((a, b) => a.id - b.id);
  for (const win of sorted) {
    const context = { appId: win.appId, title: win.title, kind: win.kind, transient: false } satisfies RuleContext;
    const rule = firstMatch(rules, context);
    if (rule !== null && rule.tile !== undefined) return { window: win, mode: rule.tile };
  }
  return null;
}

function applyRuleOverride(override: RuleOverride, w0: TilerWindow, w1: TilerWindow, avail: Rect, gap: number, screen: Screen): TilePlan {
  const win = override.window;
  if (override.mode === 'full') {
    return { placements: [place(win.id, fillRect(avail, win.min, screenArea(screen)), screen, 0, win.max)] };
  }
  const other = win.id === w0.id ? w1 : w0;
  const left = override.mode === 'left-half' ? win : other;
  const right = override.mode === 'left-half' ? other : win;
  const split = splitAt(avail, gap, 'horizontal', 0.5);
  return {
    placements: [place(left.id, split.rect0, screen, 0, left.max), place(right.id, split.rect1, screen, 1, right.max)],
  };
}

/**
 * Order windows by where they actually are, so a pair's left window stays the
 * left tile and its right window stays the right tile — even when a window was
 * created or reordered out of id order. Ties fall back to the id.
 */
function byRelativePosition(a: TilerWindow, b: TilerWindow): number {
  const dx = a.rect.x - b.rect.x;
  if (Math.abs(dx) > 1) return dx;
  const dy = a.rect.y - b.rect.y;
  if (Math.abs(dy) > 1) return dy;
  return a.id - b.id;
}

/**
 * Layout for the tileable windows of a single workspace and monitor (§6).
 * Callers guarantee at most two windows; extras are ignored.
 */
export function computePlans(windows: readonly TilerWindow[], screen: Screen, config: TilerConfig): TilePlan {
  const byId = [...windows].sort((a, b) => a.id - b.id);
  if (byId.length === 0) return { placements: [] };

  const gap = effectiveGap(config, screen);
  const avail = inset(screenArea(screen), gap);

  if (byId.length === 1) {
    const only = byId[0];
    // `reflow-keeps-edges` false: keep the outer edges where the user left them.
    if (config.reflowKeepsEdges === false && only.rect.width > 0 && only.rect.height > 0) {
      return { placements: [place(only.id, clampRect(only.rect, only.min, screenArea(screen)), screen, 0, only.max)] };
    }
    return { placements: [place(only.id, fillRect(avail, only.min, screenArea(screen)), screen, 0, only.max)] };
  }

  // Sides follow where the windows actually are, so the left window keeps the
  // left tile. A pair the user marked *swapped* uses the stable id order
  // instead: sides that followed position would flip again once the swap moved
  // the windows, oscillating forever.
  const swapped = config.swapPairs.has(pairKey(byId[0].id, byId[1].id));
  // §3/§4: an explicit slot (a routed arrival, an unmaximize joining slot 1, or
  // a swap the user made) wins over both the geometric guess and the swap flag.
  // A swap records the new sides as explicit slots, so it is invertible even
  // when the pair's position order already matches the reverse of its id order
  // (toggling the flag alone could then change nothing); the flag remains the
  // durable/restart form of the same fact.
  const explicit0 = byId.find((w) => w.slot === 0);
  const explicit1 = byId.find((w) => w.slot === 1);
  const ordered =
    explicit0 !== undefined && explicit1 !== undefined && explicit0.id !== explicit1.id
      ? [explicit0, explicit1]
      : swapped
        ? [...byId].reverse()
        : [...windows].sort(byRelativePosition);
  const w0 = ordered[0];
  const w1 = ordered[1];
  const defaultAxis: SplitAxis = config.workspaceAxis ?? (isPortrait(screen) ? 'vertical' : 'horizontal');

  const override = findRuleOverride([w0, w1], config.rules);
  if (override !== null) return applyRuleOverride(override, w0, w1, avail, gap, screen);

  const ratio = resolveRatio(w0, w1, defaultAxis, config);

  let split: SplitResult;
  if (config.minSizePolicy === 'stack') {
    split = stackLayout(avail, gap, w0, w1, defaultAxis);
  } else if (config.minSizePolicy === 'ignore') {
    split = splitAt(avail, gap, defaultAxis, clamp(ratio, 0.05, 0.95));
  } else {
    const order: SplitAxis[] = defaultAxis === 'horizontal' ? ['horizontal', 'vertical'] : ['vertical', 'horizontal'];
    const chosen = order.find((axis) => fitsAt(avail, gap, axis, w0.min, w1.min));
    if (chosen === undefined) {
      split = stackLayout(avail, gap, w0, w1, defaultAxis);
    } else {
      const base = resolveRatio(w0, w1, chosen, config);
      const clamped = clampRatioForMin(clamp(base, 0.05, 0.95), avail, gap, chosen, w0.min, w1.min);
      split = splitAt(avail, gap, chosen, clamped);
    }
  }

  return {
    placements: [place(w0.id, split.rect0, screen, 0, w0.max), place(w1.id, split.rect1, screen, 1, w1.max)],
  };
}

export interface WorkspacePlan {
  workspaceId: number;
  screenId: number;
  plan: TilePlan;
}

/** Group windows by workspace + monitor and compute a plan for each group. */
export function layoutAll(input: TilerInput): WorkspacePlan[] {
  const groups = new Map<string, TilerWindow[]>();
  for (const win of input.windows) {
    const key = `${win.workspaceId}:${win.screenId}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [win]);
    else list.push(win);
  }
  const screenById = new Map<number, Screen>();
  for (const screen of input.screens) screenById.set(screen.index, screen);
  const out: WorkspacePlan[] = [];
  for (const [key, list] of groups) {
    const [workspaceId, screenId] = key.split(':').map(Number);
    const screen = screenById.get(screenId);
    if (screen === undefined) continue;
    out.push({ workspaceId, screenId, plan: computePlans(list, screen, input.config) });
  }
  return out;
}
