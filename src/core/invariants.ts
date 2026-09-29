// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import type { Size, TilePlan } from './types.js';

export interface InvariantViolation {
  kind: 'out-of-bounds' | 'overlap' | 'non-positive' | 'below-min' | 'duplicate';
  surfaceId?: number;
  detail: string;
}

const TOLERANCE = 1;

function intersect(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return (
    a.x < b.x + b.width - TOLERANCE &&
    b.x < a.x + a.width - TOLERANCE &&
    a.y < b.y + b.height - TOLERANCE &&
    b.y < a.y + a.height - TOLERANCE
  );
}

export interface Bounds {
  width: number;
  height: number;
}

/**
 * Post-conditions a plan must satisfy (§36): every placement is inside the
 * monitor, positive-sized, unique, non-overlapping and at or above its minimum.
 */
export function checkPlan(
  plan: TilePlan,
  bounds: Bounds,
  mins?: ReadonlyMap<number, Size>,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const seen = new Set<number>();

  for (const placement of plan.placements) {
    const { surfaceId, rect } = placement;
    if (seen.has(surfaceId)) {
      violations.push({ kind: 'duplicate', surfaceId, detail: `surface ${surfaceId} placed more than once` });
    }
    seen.add(surfaceId);

    if (rect.width <= 0 || rect.height <= 0) {
      violations.push({ kind: 'non-positive', surfaceId, detail: `surface ${surfaceId} has non-positive size` });
    }

    if (
      rect.x < -TOLERANCE ||
      rect.y < -TOLERANCE ||
      rect.x + rect.width > bounds.width + TOLERANCE ||
      rect.y + rect.height > bounds.height + TOLERANCE
    ) {
      violations.push({ kind: 'out-of-bounds', surfaceId, detail: `surface ${surfaceId} is outside the monitor` });
    }

    const min = mins?.get(surfaceId);
    if (min !== undefined && (rect.width < min.width - TOLERANCE || rect.height < min.height - TOLERANCE)) {
      violations.push({ kind: 'below-min', surfaceId, detail: `surface ${surfaceId} is below its minimum size` });
    }
  }

  for (let i = 0; i < plan.placements.length; i++) {
    for (let j = i + 1; j < plan.placements.length; j++) {
      if (intersect(plan.placements[i].rect, plan.placements[j].rect)) {
        violations.push({
          kind: 'overlap',
          surfaceId: plan.placements[j].surfaceId,
          detail: `surfaces ${plan.placements[i].surfaceId} and ${plan.placements[j].surfaceId} overlap`,
        });
      }
    }
  }

  return violations;
}

export function planIsValid(plan: TilePlan, bounds: Bounds, mins?: ReadonlyMap<number, Size>): boolean {
  return checkPlan(plan, bounds, mins).length === 0;
}
