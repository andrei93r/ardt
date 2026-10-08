// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/**
 * The one trigger table (§22, quality plan P6a). Every D-Bus method exposed on
 * `org.adrt.Adrt` is described here exactly once; `dbus.ts` derives the
 * introspection XML from it and `extension.ts` builds its dispatch map from it,
 * so a method can no longer be added to one without the other. This module is
 * pure data and pure functions — no `gi://`, no I/O (core purity §2.2).
 */

/** How a trigger reaches the system. `inject` performs real input; `simulate`
 * only mutates adrt's model; `api` is a real query or control call. */
export type TriggerTaxonomy = 'inject' | 'simulate' | 'api';

/** One D-Bus method: its wire signature, its handler and its honest taxonomy. */
export interface Trigger {
  /** The D-Bus method name and, because `Gio.DBusExportedObject.wrapJSObject`
   * dispatches by name, the key of the JS handler object. */
  readonly name: string;
  /** The key `extension.ts` supplies the implementation under. Kept explicit so
   * a future indirection (a name mapping) does not need a table rewrite. */
  readonly handler: string;
  /** Argument D-Bus type signatures, in wire order, all `direction="in"`. */
  readonly in: readonly string[];
  /** Return D-Bus type signatures, in wire order, all `direction="out"`. */
  readonly out: readonly string[];
  readonly taxonomy: TriggerTaxonomy;
}

/** The taxonomy implied by the name prefix; the table must agree with it. */
export function taxonomyFor(name: string): TriggerTaxonomy {
  if (name.startsWith('Inject')) return 'inject';
  if (name.startsWith('Simulate')) return 'simulate';
  return 'api';
}

/** Every method the extension exposes over D-Bus, in a stable declaration
 * order. The order is the XML declaration order. */
export const TRIGGERS: readonly Trigger[] = [
  { name: 'DumpState', handler: 'DumpState', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'LookupWindow', handler: 'LookupWindow', in: ['u'], out: ['s'], taxonomy: 'api' },
  { name: 'ListWindows', handler: 'ListWindows', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'ListMonitors', handler: 'ListMonitors', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'GetSplitRatio', handler: 'GetSplitRatio', in: ['i', 's', 's'], out: ['d'], taxonomy: 'api' },
  { name: 'SetSplitRatio', handler: 'SetSplitRatio', in: ['i', 's', 's', 'd'], out: ['b'], taxonomy: 'api' },
  { name: 'Undo', handler: 'Undo', in: [], out: ['b'], taxonomy: 'api' },
  { name: 'NudgeSplit', handler: 'NudgeSplit', in: ['s', 'd'], out: ['b'], taxonomy: 'api' },
  { name: 'MoveFocusedToWorkspace', handler: 'MoveFocusedToWorkspace', in: ['i'], out: ['b'], taxonomy: 'api' },
  { name: 'ReloadRules', handler: 'ReloadRules', in: [], out: ['b'], taxonomy: 'api' },
  { name: 'ResetPerApp', handler: 'ResetPerApp', in: ['s'], out: ['b'], taxonomy: 'api' },
  { name: 'GetAdaptations', handler: 'GetAdaptations', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'ForgetAdaptation', handler: 'ForgetAdaptation', in: ['s'], out: ['b'], taxonomy: 'api' },
  { name: 'GetFloats', handler: 'GetFloats', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'ForgetFloat', handler: 'ForgetFloat', in: ['s'], out: ['b'], taxonomy: 'api' },
  { name: 'ExportConfig', handler: 'ExportConfig', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'ImportConfig', handler: 'ImportConfig', in: ['s', 'b'], out: ['s'], taxonomy: 'api' },
  { name: 'ListHistoryDays', handler: 'ListHistoryDays', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'SimulateGesture', handler: 'SimulateGesture', in: ['s', 'd', 'd', 'i'], out: ['b'], taxonomy: 'simulate' },
  { name: 'InjectSignal', handler: 'InjectSignal', in: ['s', 's'], out: ['b'], taxonomy: 'inject' },
  { name: 'SimulateSessionMode', handler: 'SimulateSessionMode', in: ['s'], out: ['b'], taxonomy: 'simulate' },
  { name: 'SimulateOverview', handler: 'SimulateOverview', in: ['b'], out: ['b'], taxonomy: 'simulate' },
  { name: 'SpawnWindow', handler: 'SpawnWindow', in: ['s', 's'], out: ['i'], taxonomy: 'api' },
  { name: 'CloseWindow', handler: 'CloseWindow', in: ['u'], out: ['b'], taxonomy: 'api' },
  { name: 'BeginDrag', handler: 'BeginDrag', in: ['u'], out: ['b'], taxonomy: 'api' },
  { name: 'EndDrag', handler: 'EndDrag', in: ['u'], out: ['b'], taxonomy: 'api' },
  { name: 'MoveWindow', handler: 'MoveWindow', in: ['u', 'i', 'i', 'i', 'i'], out: ['b'], taxonomy: 'api' },
  { name: 'MinimizeWindow', handler: 'MinimizeWindow', in: ['u'], out: ['b'], taxonomy: 'api' },
  { name: 'ActivateWindow', handler: 'ActivateWindow', in: ['u'], out: ['b'], taxonomy: 'api' },
  { name: 'ActivateWorkspace', handler: 'ActivateWorkspace', in: ['i'], out: ['b'], taxonomy: 'api' },
  { name: 'ToggleFloat', handler: 'ToggleFloat', in: ['u'], out: ['b'], taxonomy: 'api' },
  { name: 'SimulateResize', handler: 'SimulateResize', in: ['u', 'u', 'd'], out: ['b'], taxonomy: 'simulate' },
  { name: 'SwapPair', handler: 'SwapPair', in: ['u', 'u'], out: ['b'], taxonomy: 'api' },
  { name: 'InjectVerifyFailure', handler: 'InjectVerifyFailure', in: ['u', 'i'], out: ['b'], taxonomy: 'inject' },
  { name: 'FocusDirection', handler: 'FocusDirection', in: ['s'], out: ['b'], taxonomy: 'api' },
  { name: 'FocusCycle', handler: 'FocusCycle', in: [], out: ['b'], taxonomy: 'api' },
  { name: 'MoveToward', handler: 'MoveToward', in: ['s'], out: ['b'], taxonomy: 'api' },
  { name: 'MaximizeWindow', handler: 'MaximizeWindow', in: ['u'], out: ['b'], taxonomy: 'api' },
  { name: 'UnmaximizeWindow', handler: 'UnmaximizeWindow', in: ['u'], out: ['b'], taxonomy: 'api' },
  { name: 'ResetLayoutState', handler: 'ResetLayoutState', in: [], out: ['b'], taxonomy: 'api' },
  { name: 'SimulateWorkspaceSwitch', handler: 'SimulateWorkspaceSwitch', in: ['i'], out: ['b'], taxonomy: 'simulate' },
  { name: 'MoveToWorkspace', handler: 'MoveToWorkspace', in: ['u', 'i'], out: ['b'], taxonomy: 'api' },
  { name: 'MarkWorkspaceCached', handler: 'MarkWorkspaceCached', in: ['u', 'i'], out: ['b'], taxonomy: 'api' },
  { name: 'MoveDirection', handler: 'MoveDirection', in: ['s'], out: ['b'], taxonomy: 'api' },
  { name: 'ToggleFullscreen', handler: 'ToggleFullscreen', in: ['u'], out: ['b'], taxonomy: 'api' },
  { name: 'QuitFocused', handler: 'QuitFocused', in: [], out: ['b'], taxonomy: 'api' },
  { name: 'SimulateAbove', handler: 'SimulateAbove', in: ['u'], out: ['b'], taxonomy: 'simulate' },
  { name: 'SimulateSticky', handler: 'SimulateSticky', in: ['u', 'b'], out: ['b'], taxonomy: 'simulate' },
  { name: 'SimulateWorkspaceReorder', handler: 'SimulateWorkspaceReorder', in: ['u', 'u'], out: ['b'], taxonomy: 'simulate' },
  { name: 'SimulateWorkspaceOrientation', handler: 'SimulateWorkspaceOrientation', in: ['b'], out: ['b'], taxonomy: 'simulate' },
  { name: 'CursorToCentre', handler: 'CursorToCentre', in: [], out: ['b'], taxonomy: 'api' },
  { name: 'TogglePause', handler: 'TogglePause', in: [], out: ['b'], taxonomy: 'api' },
  { name: 'InjectFault', handler: 'InjectFault', in: ['s'], out: ['b'], taxonomy: 'inject' },
  { name: 'SimulateChromeTeardown', handler: 'SimulateChromeTeardown', in: [], out: ['b'], taxonomy: 'simulate' },
  { name: 'StartFrameRecording', handler: 'StartFrameRecording', in: [], out: ['b'], taxonomy: 'api' },
  { name: 'StopFrameRecording', handler: 'StopFrameRecording', in: [], out: ['b'], taxonomy: 'api' },
  { name: 'StartRecording', handler: 'StartRecording', in: ['i'], out: ['s'], taxonomy: 'api' },
  { name: 'StopRecording', handler: 'StopRecording', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'RecordingStatus', handler: 'RecordingStatus', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'ToggleRecording', handler: 'ToggleRecording', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'SubmitRecordingNote', handler: 'SubmitRecordingNote', in: ['s'], out: ['b'], taxonomy: 'api' },
  { name: 'PromptSetText', handler: 'PromptSetText', in: ['s'], out: ['b'], taxonomy: 'api' },
  { name: 'PromptPressSave', handler: 'PromptPressSave', in: [], out: ['b'], taxonomy: 'api' },
  { name: 'PromptPressCancel', handler: 'PromptPressCancel', in: [], out: ['b'], taxonomy: 'api' },
  { name: 'GetRegistry', handler: 'GetRegistry', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'SetNeverTile', handler: 'SetNeverTile', in: ['s', 'b'], out: ['b'], taxonomy: 'api' },
  { name: 'ToggleNeverTile', handler: 'ToggleNeverTile', in: ['s'], out: ['b'], taxonomy: 'api' },
  { name: 'ForgetApp', handler: 'ForgetApp', in: ['s'], out: ['b'], taxonomy: 'api' },
  { name: 'GetDisplayMemory', handler: 'GetDisplayMemory', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'ForgetDisplayMemory', handler: 'ForgetDisplayMemory', in: [], out: ['b'], taxonomy: 'api' },
  { name: 'SimulateScreens', handler: 'SimulateScreens', in: ['s'], out: ['b'], taxonomy: 'simulate' },
  { name: 'SimulateWorkArea', handler: 'SimulateWorkArea', in: ['s', 'i', 'i', 'i', 'i'], out: ['b'], taxonomy: 'simulate' },
  { name: 'ProbePlatform', handler: 'ProbePlatform', in: [], out: ['s'], taxonomy: 'api' },
  { name: 'DumpEvents', handler: 'DumpEvents', in: ['i', 's'], out: ['s'], taxonomy: 'api' },
  { name: 'DumpDecisions', handler: 'DumpDecisions', in: ['i'], out: ['s'], taxonomy: 'api' },
  { name: 'DumpTrace', handler: 'DumpTrace', in: ['i'], out: ['s'], taxonomy: 'api' },
  { name: 'InjectPointerMove', handler: 'InjectPointerMove', in: ['i', 'i'], out: ['b'], taxonomy: 'inject' },
  { name: 'InjectPointerButton', handler: 'InjectPointerButton', in: ['i', 'b'], out: ['b'], taxonomy: 'inject' },
  { name: 'SimulateBurst', handler: 'SimulateBurst', in: ['i', 's'], out: ['i'], taxonomy: 'simulate' },
  { name: 'SimulateNotice', handler: 'SimulateNotice', in: ['s', 's'], out: ['b'], taxonomy: 'simulate' },
  { name: 'InjectKey', handler: 'InjectKey', in: ['i', 'b'], out: ['b'], taxonomy: 'inject' },
  { name: 'SetSetting', handler: 'SetSetting', in: ['s', 's'], out: ['b'], taxonomy: 'api' },
  { name: 'SetSchemaSetting', handler: 'SetSchemaSetting', in: ['s', 's', 's'], out: ['b'], taxonomy: 'api' },
];

/**
 * Render the `Gio.DBusExportedObject.wrapJSObject` introspection XML from a
 * trigger table. Arguments are emitted in then out, in table order, matching
 * the hand-maintained XML this replaced.
 */
export function buildInterfaceXml(interfaceName: string, triggers: readonly Trigger[]): string {
  const lines: string[] = ['<node>', `  <interface name="${interfaceName}">`];
  for (const trigger of triggers) {
    const args = [
      ...trigger.in.map((type) => `<arg type="${type}" direction="in"/>`),
      ...trigger.out.map((type) => `<arg type="${type}" direction="out"/>`),
    ].join('');
    lines.push(`    <method name="${trigger.name}">${args}</method>`);
  }
  lines.push('  </interface>', '</node>');
  return lines.join('\n');
}

/**
 * Build the D-Bus dispatch map from the table and a handler registry keyed by
 * `Trigger.handler`. Throws (never silently drops a method) when a table entry
 * has no implementation, or when a registered handler is not in the table —
 * the failure surfaces at `enable()`.
 */
export function buildDispatch<T>(
  triggers: readonly Trigger[],
  handlers: Readonly<Record<string, T>>,
  wrap: (name: string, handler: T) => T,
): Record<string, T> {
  const dispatch: Record<string, T> = {};
  const used = new Set<string>();
  for (const trigger of triggers) {
    const handler = handlers[trigger.handler];
    if (handler === undefined) {
      throw new Error(`no handler for trigger ${trigger.name} (expected ${trigger.handler})`);
    }
    used.add(trigger.handler);
    dispatch[trigger.name] = wrap(trigger.name, handler);
  }
  for (const key of Object.keys(handlers)) {
    if (!used.has(key)) throw new Error(`handler ${key} has no trigger table entry`);
  }
  return dispatch;
}
