// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * Touchpad gesture wiring (§41). All decisions live in `core/gestures.ts`;
 * this file only produces `GestureEvent`s and dispatches `GestureAction`s.
 * `simulate()` is the D-Bus `SimulateGesture` path (§41.1).
 */

import Clutter from 'gi://Clutter';

import type { GestureAction, GestureConfig, GestureKind, GestureState } from '../../core/gestures.js';
import { feedGesture, initialGestureState } from '../../core/gestures.js';
import type { History } from './history.js';
import type { GnomeSettings } from './settings.js';

export interface GestureDispatcher {
  switchWorkspace(direction: 'left' | 'right' | 'up' | 'down'): void;
  toggleOverview(): void;
  showDesktop(): void;
  swapPair(direction: 'left' | 'right'): void;
  custom(action: string): void;
}

const SIMULATED_STEPS = 4;

export class GestureInput {
  private state: GestureState = initialGestureState();
  private action: any = null;
  private signalIds: number[] = [];
  private lastPointer: [number, number] | null = null;

  constructor(
    private readonly settings: GnomeSettings,
    private readonly history: History,
    private readonly dispatch: GestureDispatcher,
  ) {}

  configure(): void {
    this.disable();
    // §41.5: when every configured action matches GNOME's own, defer to GNOME.
    if (!this.config().enabled || !this.overridesBuiltin()) return;
    this.connectClutterAction();
  }

  enable(): void {
    this.configure();
  }

  disable(): void {
    if (this.action === null) return;
    for (const id of this.signalIds) this.action.disconnect(id);
    this.signalIds = [];
    global.stage.remove_action(this.action);
    this.action = null;
  }

  get hasRealWiring(): boolean {
    return this.action !== null;
  }

  /**
   * Drive the pure state machine with a synthetic begin → update → end
   * sequence. Returns true when the gesture produced a non-`none` action.
   */
  simulate(kind: GestureKind, deltaX: number, deltaY: number, touchPoints: number): boolean {
    const config = this.config();
    if (!config.enabled) return false;

    this.state = initialGestureState();
    let result: GestureAction | null = feedGesture(
      this.state,
      { kind, phase: 'begin', progress: 0, deltaX: 0, deltaY: 0, direction: null, touchPoints, timestampUs: 0 },
      config,
    );
    for (let step = 1; step <= SIMULATED_STEPS; step++) {
      const isLast = step === SIMULATED_STEPS;
      result = feedGesture(
        this.state,
        {
          kind,
          phase: isLast ? 'end' : 'update',
          progress: step / SIMULATED_STEPS,
          deltaX: deltaX / SIMULATED_STEPS,
          deltaY: deltaY / SIMULATED_STEPS,
          direction: null,
          touchPoints,
          timestampUs: 0,
        },
        config,
      );
    }

    if (result === null || result.type === 'none') return false;
    this.apply(result);
    return true;
  }

  private apply(action: GestureAction): void {
    this.history.log('gesture', { action: action.type });
    switch (action.type) {
      case 'switch-workspace':
        this.dispatch.switchWorkspace(action.direction);
        break;
      case 'toggle-overview':
        this.dispatch.toggleOverview();
        break;
      case 'show-desktop':
        this.dispatch.showDesktop();
        break;
      case 'swap-pair':
        this.dispatch.swapPair(action.direction);
        break;
      case 'custom':
        this.dispatch.custom(action.action);
        break;
      default:
        break;
    }
  }

  private config(): GestureConfig {
    return {
      enabled: this.settings.boolean('gesture-enabled', true),
      swipe3Horizontal: this.settings.string('gesture-3-swipe-action', 'switch-workspace') as GestureConfig['swipe3Horizontal'],
      swipe3Vertical: this.settings.string('gesture-3-vertical-action', 'toggle-overview') as GestureConfig['swipe3Vertical'],
      swipe4Horizontal: this.settings.string('gesture-4-swipe-action', 'switch-workspace') as GestureConfig['swipe4Horizontal'],
      swipe4Vertical: this.settings.string('gesture-4-vertical-action', 'none') as GestureConfig['swipe4Vertical'],
      pinchAction: this.settings.string('gesture-pinch-action', 'show-desktop') as GestureConfig['pinchAction'],
      sensitivity: this.settings.int('gesture-sensitivity', 50),
    };
  }

  /** True when any configured action differs from GNOME's own gestures. */
  private overridesBuiltin(): boolean {
    const config = this.config();
    return (
      config.swipe3Horizontal !== 'switch-workspace' ||
      config.swipe3Vertical !== 'toggle-overview' ||
      config.swipe4Horizontal !== 'none' ||
      config.swipe4Vertical !== 'none' ||
      config.pinchAction !== 'none'
    );
  }

  private connectClutterAction(): void {
    if (typeof Clutter.GestureAction !== 'function') return;
    try {
      this.action = new Clutter.GestureAction();
      global.stage.add_action(this.action);
      this.signalIds.push(this.action.connect('gesture-begin', () => this.onClutterPhase('begin')));
      this.signalIds.push(this.action.connect('gesture-end', () => this.onClutterPhase('end')));
      this.signalIds.push(this.action.connect('gesture-cancel', () => this.onClutterPhase('cancel')));
    } catch (e) {
      console.error(`[adrt] failed to install gesture action: ${(e as Error).message}`);
      this.action = null;
      this.signalIds = [];
    }
  }

  /**
   * GNOME 48/49 expose begin/end only; direction comes from the pointer delta.
   * The pure machine still owns the threshold decision and the action.
   */
  private onClutterPhase(phase: 'begin' | 'end' | 'cancel'): void {
    const [x, y] = global.get_pointer();
    if (phase === 'begin') {
      this.state = initialGestureState();
      this.lastPointer = [x, y];
      feedGesture(
        this.state,
        { kind: 'swipe-3-horizontal', phase: 'begin', progress: 0, deltaX: 0, deltaY: 0, direction: null, touchPoints: 3, timestampUs: 0 },
        this.config(),
      );
      return;
    }
    const start = this.lastPointer ?? [x, y];
    const dx = x - start[0];
    const dy = y - start[1];
    const kind: GestureKind = Math.abs(dx) >= Math.abs(dy) ? 'swipe-3-horizontal' : 'swipe-3-vertical';
    const action = feedGesture(
      this.state,
      { kind, phase: phase === 'cancel' ? 'cancel' : 'end', progress: 1, deltaX: dx, deltaY: dy, direction: null, touchPoints: 3, timestampUs: 0 },
      this.config(),
    );
    this.lastPointer = null;
    if (action !== null && action.type !== 'none') this.apply(action);
  }
}
