// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import { describe, expect, it } from 'vitest';

import { BorderState } from '../../src/core/border.js';
import { rect } from './helpers.js';

describe('BorderState', () => {
  it('shows at the focused window rect when nothing suppresses it', () => {
    const border = new BorderState();
    border.setFocus(1, rect(10, 10, 100, 100));
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
    expect(border.focusedId).toBe(3);
    border.clearFocus();
    expect(border.shouldShow).toBe(false);
    expect(border.focusedId).toBeNull();
  });

  it('reports a snapshot', () => {
    const border = new BorderState();
    expect(border.snapshot()).toEqual({ visible: false, rect: null });
    border.setFocus(1, rect(1, 2, 3, 4));
    expect(border.snapshot()).toEqual({ visible: true, rect: rect(1, 2, 3, 4) });
  });

  it('does not treat duplicate suppressions as two', () => {
    const border = new BorderState();
    border.setFocus(1, rect(0, 0, 1, 1));
    border.suppress('pause');
    border.suppress('pause');
    border.unsuppress('pause');
    expect(border.shouldShow).toBe(true);
  });
});
