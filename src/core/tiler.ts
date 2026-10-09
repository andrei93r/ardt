// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import type { Rule, RuleContext, TileMode } from './rules.js';
import { firstMatch } from './rules.js';
import type { Rect, Screen, Size, TilePlan } from './types.js';
import { Layer, SurfaceKind, clamp, snap, snapRect, snapRectInward } from './types.js';

export type MinSizePolicy = 'respect' | 'ignore' | 'stack';

/** Axis of a two-window split: `horizontal` = side by side, `vertical` = stacked. */
export type SplitAxis = 'horizontal' | 'vertical';

export interface TilerConfig {
  gapBase: number;
  /** Negative values inherit `gapBase` (§6). */
  gapPortrait: number;
  /** Negative values inherit `gapBase` (§6). */
  gapLandscape: number;
  /**
   * §10 per-side outer gaps. Default 0 (flush edge) when unset; a negative
   * value inherits the resolved base gap (orientation override or `gapBase`).
   */
  gapLeft?: number;
  gapRight?: number;
  gapTop?: number;
  gapBottom?: number;
  /**
   * §10 gap at the split between the two windows. Unset or negative inherits the
   * resolved base gap (orientation override or `gapBase`).
   */
  gapBetween?: number;
  minSizePolicy: MinSizePolicy;
  primaryApps: readonly string[];
  /** 0..1, clamped to 0.2–0.8 when applied. */
  primaryAppRatio: number;
  /**
   * §10 ratios keyed by `connector:workspace:axis` (see `ratioKey`), fraction
   * belonging to the sorted-first app of the pair.
   */
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
 * §10: ratios are per workspace (per pair). A pair lives on one screen, and two
 * screens can show the same workspace, so the key is
 * `connector:workspace:axis`. The monitor is named by its connector (`eDP-1`,
 * `HDMI-1`) rather than its index, so a replug or reorder cannot bind a saved
 * ratio to the wrong screen. The old key was the app pair
 * (`appA|appB|axis`), which leaked a ratio the user set on one pair to every
 * later pair of the same apps — decision 14 says there is no app-pair ratio
 * learning. The fraction stored is the sorted-first app's share (see
 * `resolveRatio`), so the pair is recognised regardless of which window opened
 * first or sits on which side.
 */
export function ratioKey(connector: string, workspaceId: number, axis: SplitAxis): string {
  return `${connector}:${workspaceId}:${axis}`;
}

export interface RatioKeyParts {
  connector: string;
  workspaceId: number;
  axis: SplitAxis;
}

/**
 * Parse a `connector:workspace:axis` ratio key; null for a legacy app-pair key.
 * The connector is any non-empty segment without a colon, so hyphenated names
 * (`eDP-1`, `HDMI-1`) and the numeric form of an unmigrated legacy key both
 * parse. `migrateLegacyRatioKeys` resolves the numeric form before use.
 */
export function parseRatioKey(key: string): RatioKeyParts | null {
  const match = /^([^:]+):(\d+):(horizontal|vertical)$/.exec(key);
  if (match === null) return null;
  return { connector: match[1], workspaceId: Number(match[2]), axis: match[3] as SplitAxis };
}

/**
 * §23 migration: ratios persisted before keys named the monitor by connector
 * used the monitor index (`0:2:horizontal`). Such a key can be bound to a
 * different screen after a replug or reorder, so map each numeric first segment
 * through the current `index → connector` table. A legacy key whose index has no
 * live screen is dropped; keys that already name a connector pass through
 * untouched. Pure, so the rewrite is unit-testable.
 */
export function migrateLegacyRatioKeys(
  raw: Readonly<Record<string, number>>,
  connectorByIndex: ReadonlyMap<number, string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const colon = key.indexOf(':');
    const first = colon === -1 ? key : key.slice(0, colon);
    if (colon === -1 || !/^\d+$/.test(first)) {
      out[key] = value;
      continue;
    }
    const connector = connectorByIndex.get(Number(first));
    if (connector === undefined) continue;
    out[`${connector}${key.slice(colon)}`] = value;
  }
  return out;
}

/**
 * §23 migration: state persisted before ratios were workspace-scoped keyed them
 * by app pair (`appA|appB|axis`). Such a key can never be applied under the new
 * scheme, but leaving it in the map leaves dead state; drop everything that is
 * not a valid workspace key so an old file is handled without crashing and is
 * never misapplied.
 */
export function sanitizeRatios(raw: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (parseRatioKey(key) !== null && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/**
 * §10/§5: after the workspaces in `reaped` are removed, a reaped workspace
 * drops its ratio and every workspace to its right shifts down one index, so
 * its ratio moves with it. Without this a stale key would be misapplied to
 * whatever workspace later reuses the vacated index. Legacy app-pair keys are
 * dropped. Pure, so the shift is unit-testable.
 */
export function remapRatiosAfterReap(
  ratios: Readonly<Record<string, number>>,
  reaped: readonly number[],
): Record<string, number> {
  if (reaped.length === 0) return { ...ratios };
  const removed = new Set(reaped);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(ratios)) {
    const parts = parseRatioKey(key);
    if (parts === null) continue;
    if (removed.has(parts.workspaceId)) continue;
    let workspaceId = parts.workspaceId;
    for (const index of reaped) if (index < workspaceId) workspaceId -= 1;
    out[ratioKey(parts.connector, workspaceId, parts.axis)] = value;
  }
  return out;
}

function isPortrait(screen: Screen): boolean {
  return screen.geometry.height > screen.geometry.width;
}

/** The area tiles may occupy: the work area (struts removed) or the monitor. */
export function screenArea(screen: Screen): Rect {
  return screen.workArea ?? screen.geometry;
}

/**
 * §6/§10: the resolved base gap for a monitor. `gaps-portrait`/`gaps-landscape`
 * override `gaps-base` per orientation; a negative override inherits the base.
 * The between-window gap and any negative per-side gap inherit this value.
 */
function effectiveGap(config: TilerConfig, screen: Screen): number {
  const override = isPortrait(screen) ? config.gapPortrait : config.gapLandscape;
  return override >= 0 ? override : config.gapBase;
}

/** §10: the four outer insets and the split gap, resolved for one monitor. */
export interface Gaps {
  left: number;
  right: number;
  top: number;
  bottom: number;
  between: number;
}

/**
 * §10: resolve the gaps for the monitor being planned, so "per-monitor gaps"
 * follows that monitor's orientation. Outer sides default to 0 and a negative
 * per-side value inherits the base; the between-window gap defaults to the base.
 */
export function resolveGaps(config: TilerConfig, screen: Screen): Gaps {
  const base = effectiveGap(config, screen);
  const outer = (value: number | undefined): number => {
    if (value === undefined) return 0;
    return value < 0 ? base : value;
  };
  const between = config.gapBetween === undefined || config.gapBetween < 0 ? base : config.gapBetween;
  return {
    left: outer(config.gapLeft),
    right: outer(config.gapRight),
    top: outer(config.gapTop),
    bottom: outer(config.gapBottom),
    between,
  };
}

/** Inset a rect by each outer side independently (§10). */
function inset(rect: Rect, gaps: Gaps): Rect {
  return {
    x: rect.x + gaps.left,
    y: rect.y + gaps.top,
    width: Math.max(0, rect.width - gaps.left - gaps.right),
    height: Math.max(0, rect.height - gaps.top - gaps.bottom),
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
 * §10/§25: reconcile the boundary between two tiles at a fractional scale.
 *
 * `snapRect` rounds each tile's `x` and `width` independently, so at 125%/150%
 * the two sides of the split can round in opposite directions — a sub-pixel
 * seam where the pair should meet, or a 1 px overlap. Here the shared boundary
 * is rounded *once* and both tiles are measured from it, so they meet exactly;
 * `avail` has already been snapped inward (`snapRectInward`), so the pair can
 * never overhang the work area. The caller keeps the plain split at an integer
 * scale, so scale 1/2 geometry is byte-identical.
 */
function reconcileSplit(rect0: Rect, rect1: Rect, avail: Rect, gap: number, axis: SplitAxis, scale: number): SplitResult {
  const start = axis === 'horizontal' ? 'x' : 'y';
  const size = axis === 'horizontal' ? 'width' : 'height';
  const end = avail[start] + avail[size];
  const boundary = clamp(snap(rect0[start] + rect0[size], scale), avail[start], end);
  const between = Math.max(0, snap(gap, scale));
  const secondStart = Math.min(boundary + between, end);
  const out0: Rect = { ...rect0 };
  const out1: Rect = { ...rect1 };
  out0[start] = avail[start];
  out0[size] = Math.max(0, boundary - avail[start]);
  out1[start] = secondStart;
  out1[size] = Math.max(0, end - secondStart);
  return { rect0: out0, rect1: out1 };
}

/**
 * Split the available rect along `axis` at `ratio` (fraction for the first
 * window), leaving one `gap` between the two windows. At a fractional scale the
 * two tiles are reconciled so they meet exactly (see `reconcileSplit`).
 */
function splitAt(avail: Rect, gap: number, axis: SplitAxis, ratio: number, scale: number): SplitResult {
  const extent = axisExtent(avail, axis);
  const split = Math.max(0, extent - gap);
  const first = split * ratio;
  const second = split - first;
  const rect0: Rect =
    axis === 'horizontal'
      ? { x: avail.x, y: avail.y, width: first, height: avail.height }
      : { x: avail.x, y: avail.y, width: avail.width, height: first };
  const rect1: Rect =
    axis === 'horizontal'
      ? { x: avail.x + first + gap, y: avail.y, width: second, height: avail.height }
      : { x: avail.x, y: avail.y + first + gap, width: avail.width, height: second };
  if (scale <= 1 || Number.isInteger(scale)) {
    // A whole-number scale stores integer logical pixels, but a saved ratio can
    // be fractional — a drag writes the pointer fraction, e.g.
    // `2552 * 0.2421875 = 618.0625`. `snap`/`snapRect` deliberately leave a
    // whole-number scale byte-identical, so the fraction reached the plan and
    // Mutter truncated each argument on its own. Round the shared boundary once
    // and measure both tiles from it, so the pair still meets exactly (§25).
    const start = axis === 'horizontal' ? 'x' : 'y';
    const size = axis === 'horizontal' ? 'width' : 'height';
    const boundary = Math.round(first);
    const out0: Rect = { ...rect0, [size]: boundary };
    const out1: Rect = {
      ...rect1,
      [start]: avail[start] + boundary + gap,
      [size]: Math.max(0, extent - boundary - gap),
    };
    return { rect0: out0, rect1: out1 };
  }
  return reconcileSplit(rect0, rect1, avail, gap, axis, scale);
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
function resolveRatio(w0: TilerWindow, w1: TilerWindow, axis: SplitAxis, connector: string, config: TilerConfig): number {
  const saved = config.ratios[ratioKey(connector, w0.workspaceId, axis)];
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
function stackLayout(avail: Rect, gap: number, w0: TilerWindow, w1: TilerWindow, prefer: SplitAxis, scale: number): SplitResult {
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
  return splitAt(avail, gap, prefer, 0.5, scale);
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
    if (rule === null) continue;
    // Classification owns `float` (§5): a rule-floated window is non-tileable, so
    // it can never reach `computePlans` as a tileable window. Skipping the float
    // rule here keeps the placement path purely placement, and lets a later
    // placement rule for the same window take effect instead of being masked.
    if (rule.tile === 'float') continue;
    return { window: win, mode: rule.tile };
  }
  return null;
}

/**
 * §23 decision 91: a rule forces a tile placement for the matched window. `full`
 * fills the monitor; `left-half`/`right-half` place the window in slot 0/1 along
 * the screen's `axis` — the same `defaultAxis` the normal pair uses (decision 43),
 * so an explicit `workspaceAxis` is honoured and a portrait screen stacks. The
 * half-names are historical and axis-relative: on a vertical axis `left-half` is
 * the **top** half and `right-half` the bottom. The sibling takes the other half
 * at a 50/50 split.
 */
function applyRuleOverride(
  override: RuleOverride,
  w0: TilerWindow,
  w1: TilerWindow,
  avail: Rect,
  gap: number,
  axis: SplitAxis,
  screen: Screen,
): TilePlan {
  const win = override.window;
  if (override.mode === 'full') {
    return { placements: [place(win.id, fillRect(avail, win.min, screenArea(screen)), screen, 0, win.max)] };
  }
  const other = win.id === w0.id ? w1 : w0;
  const first = override.mode === 'left-half' ? win : other;
  const second = override.mode === 'left-half' ? other : win;
  const split = splitAt(avail, gap, axis, 0.5, screen.scale);
  return {
    placements: [place(first.id, split.rect0, screen, 0, first.max), place(second.id, split.rect1, screen, 1, second.max)],
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

  const gaps = resolveGaps(config, screen);
  const gap = gaps.between;
  // §10/§25: fit the work area to the monitor's scale grid from the inside, so
  // a fractional strut edge can never push a tile past the work area. This is a
  // no-op at scale 1 and at integer scales.
  const avail = snapRectInward(inset(screenArea(screen), gaps), screen.scale);

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
  if (override !== null) return applyRuleOverride(override, w0, w1, avail, gap, defaultAxis, screen);

  const ratio = resolveRatio(w0, w1, defaultAxis, screen.connector, config);

  let split: SplitResult;
  if (config.minSizePolicy === 'stack') {
    split = stackLayout(avail, gap, w0, w1, defaultAxis, screen.scale);
  } else if (config.minSizePolicy === 'ignore') {
    split = splitAt(avail, gap, defaultAxis, clamp(ratio, 0.05, 0.95), screen.scale);
  } else {
    const order: SplitAxis[] = defaultAxis === 'horizontal' ? ['horizontal', 'vertical'] : ['vertical', 'horizontal'];
    const chosen = order.find((axis) => fitsAt(avail, gap, axis, w0.min, w1.min));
    if (chosen === undefined) {
      split = stackLayout(avail, gap, w0, w1, defaultAxis, screen.scale);
    } else {
      const base = resolveRatio(w0, w1, chosen, screen.connector, config);
      const clamped = clampRatioForMin(clamp(base, 0.05, 0.95), avail, gap, chosen, w0.min, w1.min);
      split = splitAt(avail, gap, chosen, clamped, screen.scale);
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
