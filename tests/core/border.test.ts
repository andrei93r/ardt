// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { BorderState } from '../../src/core/border.js';
import { rect } from './helpers.js';

describe('BorderState', () => {
  it('shows at the focused window rect once the placement is settled', () => {
    const border = new BorderState();
    border.setFocus(1, rect(10, 10, 100, 100));
    border.settle();
    expect(border.shouldShow).toBe(true);
    expect(border.rect).toEqual(rect(10, 10, 100, 100));
  });

  it('stays hidden without focus', () => {
    const border = new BorderState();
    expect(border.shouldShow).toBe(false);
    expect(border.rect).toBeNull();
  });

  it('hides while any suppression is active and reappears when cleared', () => {
    const border = new BorderState();
    border.setFocus(1, rect(0, 0, 10, 10));
    border.settle();
    border.suppress('workspace-switch');
    expect(border.shouldShow).toBe(false);
    border.suppress('drag');
    expect(border.activeSuppressions).toHaveLength(2);
    border.unsuppress('workspace-switch');
    expect(border.shouldShow).toBe(false);
    border.unsuppress('drag');
    expect(border.shouldShow).toBe(true);
  });

  it('follows the focused window rect updates', () => {
    const border = new BorderState();
    border.setFocus(7, rect(0, 0, 10, 10));
    border.settle();
    border.updateRect(rect(50, 50, 20, 20));
    expect(border.rect).toEqual(rect(50, 50, 20, 20));
  });

  it('ignores rect updates without focus', () => {
    const border = new BorderState();
    border.updateRect(rect(50, 50, 20, 20));
    expect(border.rect).toBeNull();
  });

  it('hides on clearFocus and reports focus id', () => {
    const border = new BorderState();
    border.setFocus(3, rect(0, 0, 10, 10));
    border.settle();
    expect(border.focusedId).toBe(3);
    border.clearFocus();
    expect(border.shouldShow).toBe(false);
    expect(border.focusedId).toBeNull();
  });

  it('reports a snapshot', () => {
    const border = new BorderState();
    expect(border.snapshot()).toEqual({ visible: false, rect: null });
    border.setFocus(1, rect(1, 2, 3, 4));
    border.settle();
    expect(border.snapshot()).toEqual({ visible: true, rect: rect(1, 2, 3, 4) });
  });

  it('does not treat duplicate suppressions as two', () => {
    const border = new BorderState();
    border.setFocus(1, rect(0, 0, 1, 1));
    border.settle();
    border.suppress('pause');
    border.suppress('pause');
    border.unsuppress('pause');
    expect(border.shouldShow).toBe(true);
  });
});

describe('BorderState settle gate (§23.3)', () => {
  it('does not draw a fresh focus until the placement is settled', () => {
    // The focus signal hands the border the window's *pre-placement* frame; a
    // hover until `settle()` would paint the highlight at the old position and
    // then snap it into place — the reported "focus is drawn before the window
    // is in position" bug.
    const border = new BorderState();
    border.setFocus(1, rect(10, 10, 100, 100));
    expect(border.shouldShow).toBe(false);
    expect(border.rect).toBeNull();
    expect(border.isSettled).toBe(false);
    expect(border.focusedId).toBe(1);

    border.settle();
    expect(border.isSettled).toBe(true);
    expect(border.shouldShow).toBe(true);
    expect(border.rect).toEqual(rect(10, 10, 100, 100));
  });

  it('re-hides on a new focus even if the previous one was settled', () => {
    const border = new BorderState();
    border.setFocus(1, rect(0, 0, 10, 10));
    border.settle();
    expect(border.shouldShow).toBe(true);
    // A second focus change is again a pre-placement guess for the new window.
    border.setFocus(2, rect(20, 20, 10, 10));
    expect(border.shouldShow).toBe(false);
    expect(border.isSettled).toBe(false);
  });

  it('a repeated state pass for the same window does not unsettle it', () => {
    // The model's state passes re-affirm the focused window on every layout. By
    // then the focus layout has already run, so a repeat must keep the border
    // settled — unsettling on each pass would hide the highlight with no later
    // focus layout to bring it back, which is how a disable/enable cycle lost
    // the highlight entirely (A161).
    const border = new BorderState();
    border.setFocus(1, rect(10, 10, 100, 100));
    border.settle();
    expect(border.shouldShow).toBe(true);
    border.setFocusFromState(1, rect(10, 10, 100, 100));
    expect(border.isSettled).toBe(true);
    expect(border.shouldShow).toBe(true);
  });

  it('a state pass settles when no focus signal is owed', () => {
    // An enable/disable cycle creates a fresh BorderState and re-affirms focus
    // from the model, with no compositor focus signal to precede it. The rect is
    // then authoritative and the highlight must come back.
    const border = new BorderState();
    border.setFocusFromState(1, rect(10, 10, 100, 100));
    expect(border.isSettled).toBe(true);
    expect(border.shouldShow).toBe(true);
  });

  it('a state pass does not settle while a focus signal is still owed', () => {
    // Between the focus signal and the focus-driven layout an unrelated pass
    // (a route, a self-heal, a drag) re-affirms the same pre-placement frame.
    // Settling on it would draw the highlight at the old position — the A173
    // regression.
    const border = new BorderState();
    border.setFocus(1, rect(10, 10, 100, 100));
    border.setFocusFromState(1, rect(10, 10, 100, 100));
    expect(border.isSettled).toBe(false);
    expect(border.shouldShow).toBe(false);
  });

  it('a state pass does not settle on an intermediate frame while a placement is owed', () => {
    // The compositor can move a window part-way to its placement, so a state
    // pass carrying a *different* rect is still not the placement. Settling on
    // it draws the highlight at an intermediate position and snaps it — the
    // same bug by another route, which the A173 repeated-focus scenario caught.
    const border = new BorderState();
    border.setFocus(1, rect(10, 10, 100, 100));
    border.setFocusFromState(1, rect(40, 40, 100, 100));
    expect(border.isSettled).toBe(false);
    expect(border.shouldShow).toBe(false);
    // The focus layout then settles it for real.
    border.settle();
    expect(border.isSettled).toBe(true);
    expect(border.rect).toEqual(rect(40, 40, 100, 100));
  });

  it('updateRect alone does not settle — only the model may', () => {
    const border = new BorderState();
    border.setFocus(1, rect(0, 0, 10, 10));
    border.updateRect(rect(5, 5, 10, 10));
    expect(border.shouldShow).toBe(false);
    border.settle();
    expect(border.rect).toEqual(rect(5, 5, 10, 10));
  });

  it('clearFocus drops the settled flag', () => {
    const border = new BorderState();
    border.setFocus(1, rect(0, 0, 10, 10));
    border.settle();
    expect(border.isSettled).toBe(true);
    border.clearFocus();
    expect(border.isSettled).toBe(false);
  });

  it('suppression still wins over a settled border', () => {
    const border = new BorderState();
    border.suppress('workspace-switch');
    border.setFocus(1, rect(0, 0, 10, 10));
    border.settle();
    expect(border.shouldShow).toBe(false);
    border.unsuppress('workspace-switch');
    expect(border.shouldShow).toBe(true);
  });

  it('settleIfMoved refuses to settle while the frame is still the pre-placement one', () => {
    // A non-focus model pass (a route, a self-heal, a drag) can run between the
    // focus signal and the focus-driven pass. It hands back the same frame the
    // focus signal carried — the window has not moved yet — so settling on it
    // would draw the highlight at the old position, the reported bug.
    const border = new BorderState();
    border.setFocus(1, rect(10, 10, 100, 100));
    border.settleIfMoved(rect(10, 10, 100, 100));
    expect(border.isSettled).toBe(false);
    expect(border.shouldShow).toBe(false);
  });

  it('settleIfMoved settles once the window has actually moved', () => {
    // A frame that differs from the pre-placement rect is real geometry: the
    // window is on its way to (or already at) its placement, so drawing it is
    // correct even if the focus layout is still in flight.
    const border = new BorderState();
    border.setFocus(1, rect(10, 10, 100, 100));
    border.settleIfMoved(rect(40, 40, 100, 100));
    expect(border.isSettled).toBe(true);
    expect(border.rect).toEqual(rect(40, 40, 100, 100));
  });

  it('settleIfMoved treats a bare resize as movement too', () => {
    const border = new BorderState();
    border.setFocus(1, rect(10, 10, 100, 100));
    border.settleIfMoved(rect(10, 10, 120, 100));
    expect(border.isSettled).toBe(true);
    expect(border.rect).toEqual(rect(10, 10, 120, 100));
  });

  it('settleIfMoved is a no-op without focus', () => {
    const border = new BorderState();
    border.settleIfMoved(rect(0, 0, 10, 10));
    expect(border.isSettled).toBe(false);
    expect(border.shouldShow).toBe(false);
  });
});
