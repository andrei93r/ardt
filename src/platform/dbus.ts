// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/** Method surface exposed on `org.adrt.Adrt` (§22). JSON payloads are strings. */
export interface DbusHandlers {
  DumpState(): string;
  LookupWindow(id: number): string;
  ListWindows(): string;
  ListMonitors(): string;
  GetSplitRatio(workspace: number, monitor: string, axis: string): number;
  SetSplitRatio(workspace: number, monitor: string, axis: string, ratio: number): boolean;
  Undo(): boolean;
  NudgeSplit(direction: string, step: number): boolean;
  MoveFocusedToWorkspace(index: number): boolean;
  ReloadRules(): boolean;
  ResetPerApp(appId: string): boolean;
  GetAdaptations(): string;
  ForgetAdaptation(appId: string): boolean;
  GetFloats(): string;
  ForgetFloat(appId: string): boolean;
  ExportConfig(): string;
  ImportConfig(json: string, merge: boolean): string;
  ListHistoryDays(): string;
  /* §12 app registry + §9 display memory (Stage 4/5). */
  GetRegistry(): string;
  SetNeverTile(appId: string, value: boolean): boolean;
  ToggleNeverTile(appId: string): boolean;
  ForgetApp(appId: string): boolean;
  GetDisplayMemory(): string;
  ForgetDisplayMemory(): boolean;
  SimulateScreens(screens: string): boolean;
  SimulateWorkArea(connector: string, x: number, y: number, width: number, height: number): boolean;
  SimulateGesture(kind: string, deltaX: number, deltaY: number, touchPoints: number): boolean;
  InjectSignal(type: string, payload: string): boolean;
  SimulateSessionMode(mode: string): boolean;

  /* Stage 0 additions: capability probe, the event journal, real input. */
  ProbePlatform(): string;
  DumpEvents(limit: number, filter: string): string;
  DumpDecisions(limit: number): string;
  DumpTrace(limit: number): string;
  InjectPointerMove(x: number, y: number): boolean;
  InjectPointerButton(button: number, pressed: boolean): boolean;
  InjectKey(keyval: number, pressed: boolean): boolean;
  SimulateNotice(key: string, subject: string): boolean;
  SimulateBurst(count: number, reason: string): number;
}

export interface DbusBackend {
  expose(handlers: DbusHandlers): void;
  unexpose(): void;
}
